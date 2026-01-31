import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Dimensions, Platform, AppState, AppStateStatus, Modal } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import TransLinkService, { TransitStop, VehiclePosition } from '../src/services/TransLinkService';
import { TripUpdate } from '../src/types/transit';
import WalkingRouteService, { WalkingRoute } from '../src/services/WalkingRouteService';
import { RouteShape } from '../src/data/routeShapes';
import RoutineService from '../src/services/RoutineService';
import DayPickerModal from '../src/components/DayPickerModal';
import { DraggableBottomSheet } from '../src/components/DraggableBottomSheet';
import { getUpcomingDepartures } from '../src/data/scheduleData';

const { width, height } = Dimensions.get('window');

export default function RouteDetailsScreen() {
    const params = useLocalSearchParams();
    console.log('[RouteDetails] RENDER. Params:', JSON.stringify(params));
    const router = useRouter();
    const mapRef = useRef<MapView>(null);

    const [stops, setStops] = useState<TransitStop[]>([]);
    const [routeShape, setRouteShape] = useState<RouteShape[]>([]);
    const [vehiclePositions, setVehiclePositions] = useState<VehiclePosition[]>([]);
    const [walkingRoute, setWalkingRoute] = useState<WalkingRoute | null>(null);
    const [loading, setLoading] = useState(true);
    const [directionId, setDirectionId] = useState<string>('0');
    const [showDayPicker, setShowDayPicker] = useState(false);
    // Add estimates state to store ETA and Trip ID
    const [estimates, setEstimates] = useState<any>(null);
    // Track selected bus for details panel
    const [selectedBus, setSelectedBus] = useState<VehiclePosition | null>(null);
    // Upcoming arrivals for the route at the target stop
    const [upcomingArrivals, setUpcomingArrivals] = useState<TripUpdate[]>([]);
    // Show all departures modal
    const [showAllDepartures, setShowAllDepartures] = useState(false);
    // App foreground/background state for adaptive polling
    const [isAppActive, setIsAppActive] = useState(true);

    const vehicleInterval = useRef<NodeJS.Timeout | null>(null);
    const pollingTimeout = useRef<NodeJS.Timeout | null>(null); // For adaptive polling
    const lastUserLocation = useRef<{ lat: number; lon: number } | null>(null);
    const lastCameraUpdate = useRef<number>(0);
    const lastInteraction = useRef<number>(0);
    // Vehicle identity locking - persist tracked vehicle across refreshes
    const lockedVehicle = useRef<{ tripId?: string; vehicleId?: string; lastSeen: number } | null>(null);

    // Route params
    const routeId = params.routeId as string;
    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;
    const userLat = params.userLat ? parseFloat(params.userLat as string) : null;
    const userLon = params.userLon ? parseFloat(params.userLon as string) : null;
    const boardingStopId = params.boardingStopId as string;

    const userId = 'demo-user'; // Placeholder

    // DEBUG: Log received params
    console.log(`[RouteDetails] 🗺️ Received params: routeId=${routeId}, routeNo=${routeNo}`);
    console.log(`[RouteDetails] 🗺️ Origin coords: userLat=${userLat}, userLon=${userLon}`);
    console.log(`[RouteDetails] 🗺️ Boarding stop ID: ${boardingStopId}`);

    useEffect(() => {
        if (routeId) {
            loadRouteData();
        }
    }, [routeId]);

    const loadRouteData = async () => {
        try {
            setLoading(true);
            console.log(`[RouteDetails] Loading data for route ID ${routeId} (Display: ${routeNo})`);

            // Try direction 0 first, then direction 1 if boarding stop not found
            let fetchedStops = await TransLinkService.getStaticStopsForRoute(routeId, '0');
            let fetchedShape = await TransLinkService.getStaticRouteShape(routeId, '0');

            // Check if boarding stop is in direction 0
            const hasStopInDir0 = fetchedStops.some(s =>
                String(s.stopId) === String(boardingStopId) ||
                String(s.stopNo) === String(boardingStopId)
            );

            if (!hasStopInDir0) {
                console.log(`[RouteDetails] Stop ${boardingStopId} not in direction 0, trying direction 1...`);
                const dir1Stops = await TransLinkService.getStaticStopsForRoute(routeId, '1');
                const hasStopInDir1 = dir1Stops.some(s =>
                    String(s.stopId) === String(boardingStopId) ||
                    String(s.stopNo) === String(boardingStopId)
                );

                if (hasStopInDir1) {
                    fetchedStops = dir1Stops;
                    fetchedShape = await TransLinkService.getStaticRouteShape(routeId, '1');
                    setDirectionId('1');
                    console.log(`[RouteDetails] Using direction 1 (found stop ${boardingStopId})`);
                } else {
                    console.warn(`[RouteDetails] Stop ${boardingStopId} not found in either direction!`);
                }
            } else {
                setDirectionId('0');
                console.log(`[RouteDetails] Using direction 0 (found stop ${boardingStopId})`);
            }

            setStops(fetchedStops);
            setRouteShape(fetchedShape);

            // Fit map to route AND user location
            if (mapRef.current) {
                const points = fetchedShape.map(p => ({
                    latitude: p.lat,
                    longitude: p.lon
                }));

                // Add user location to bounds if available
                if (userLat && userLon) {
                    points.push({ latitude: userLat, longitude: userLon });
                }

                setTimeout(() => {
                    mapRef.current?.fitToCoordinates(points, {
                        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                        animated: true
                    });
                }, 500);
            }

        } catch (error) {
            console.error('[RouteDetails] Error loading data:', error);
            Alert.alert('Error', 'Failed to load route details');
        } finally {
            setLoading(false);
        }
    };

    // Find boarding stop coordinates
    const [targetStop, setTargetStop] = useState<TransitStop | null>(null);

    useEffect(() => {
        // ASYNC function for walking distance calculation
        const findTargetStop = async () => {
            // Find stop in loaded route stops
            // boardingStopId could be GTFS ID ("11542") or Code ("61522")
            let stop = stops.find(s => s.stopId === boardingStopId || s.stopNo === boardingStopId);

            // If not found in route stops (e.g. variant), fetch it directly from static data
            if (!stop && boardingStopId) {
                const staticStops: any[] = require('../src/data/stops').STOPS;
                const manualStop = staticStops.find(s => s.id === boardingStopId || s.code === boardingStopId);

                if (manualStop) {
                    stop = {
                        stopNo: manualStop.code || manualStop.id,
                        stopId: manualStop.id,
                        stopName: manualStop.name,
                        latitude: manualStop.lat,
                        longitude: manualStop.lon,
                        routes: [routeNo]
                    };
                }
            }

            // Auto-detect nearest stop using WALKING DISTANCE (not Euclidean)
            if (!stop && !boardingStopId && userLat && userLon && stops.length > 0) {
                console.log(`[RouteDetails] 🚶 Finding nearest walkable stop from ${stops.length} candidates...`);

                const result = await WalkingRouteService.getNearestWalkableStop(
                    userLat,
                    userLon,
                    stops
                );

                if (result) {
                    console.log(`[RouteDetails] ✅ Nearest walkable: ${result.stop.stopName} (${Math.round(result.walkingDistance)}m, actual: ${result.isActualRoute})`);
                    stop = result.stop;
                }
            }

            if (stop) {
                console.log(`[RouteDetails] Found target stop: ${stop.stopName} (ID: ${stop.stopId}, Code: ${stop.stopNo})`);
            } else {
                console.log(`[RouteDetails] Target stop not found for ID: ${boardingStopId}. Fallback to ${stops[0]?.stopId}`);
            }
            setTargetStop(stop || stops[0] || null);
        };

        findTargetStop();
    }, [stops, boardingStopId, userLat, userLon]);

    // Fetch upcoming arrivals for the route at the target stop
    useEffect(() => {
        if (!routeId || !targetStop) {
            setUpcomingArrivals([]);
            return;
        }

        const fetchArrivals = async () => {
            try {
                console.log(`[RouteDetails] Fetching upcoming arrivals for route ${routeId} at stop ${targetStop.stopId} (code: ${targetStop.stopNo})`);

                // Try with stopId first, then stopNo (code)
                let arrivals = await TransLinkService.getRealtimeTripUpdates(routeId, targetStop.stopId);

                if (arrivals.length === 0 && targetStop.stopNo && targetStop.stopNo !== targetStop.stopId) {
                    console.log(`[RouteDetails] No arrivals with stopId, trying stopNo: ${targetStop.stopNo}`);
                    arrivals = await TransLinkService.getRealtimeTripUpdates(routeId, targetStop.stopNo);
                }

                console.log(`[RouteDetails] Got ${arrivals.length} real-time arrivals`);

                // If no real-time data, fall back to bundled GTFS schedule
                if (arrivals.length === 0) {
                    console.log('[RouteDetails] No real-time data, using bundled GTFS schedule...');

                    // Try to get scheduled departures using routeNo (which matches GTFS route_short_name)
                    const stopCode = targetStop.stopNo || targetStop.stopId;

                    // Import and try bundled schedule with multiple lookup strategies
                    const { getUpcomingDepartures } = require('../src/data/scheduleData');
                    let scheduledTimes: string[] = [];

                    // Strategy 1: Use routeNo directly (most common case)
                    if (routeNo) {
                        scheduledTimes = getUpcomingDepartures(routeNo, stopCode, '0', 15) || [];
                        if (scheduledTimes.length === 0) {
                            scheduledTimes = getUpcomingDepartures(routeNo, stopCode, '1', 15) || [];
                        }
                    }

                    // Strategy 2: Use routeId 
                    if (scheduledTimes.length === 0) {
                        scheduledTimes = getUpcomingDepartures(routeId, stopCode, '0', 15) || [];
                        if (scheduledTimes.length === 0) {
                            scheduledTimes = getUpcomingDepartures(routeId, stopCode, '1', 15) || [];
                        }
                    }

                    // Strategy 3: Try with stopId instead of stopNo
                    if (scheduledTimes.length === 0 && targetStop.stopId !== stopCode) {
                        scheduledTimes = getUpcomingDepartures(routeNo || routeId, targetStop.stopId, '0', 15) || [];
                    }

                    console.log(`[RouteDetails] Found ${scheduledTimes.length} bundled scheduled departures`);

                    // Convert HH:MM strings to TripUpdate format
                    if (scheduledTimes.length > 0) {
                        const today = new Date();
                        arrivals = scheduledTimes.map((timeStr: string, idx: number) => {
                            const [h, m] = timeStr.split(':').map(Number);
                            const departureDate = new Date(today);
                            departureDate.setHours(h, m, 0, 0);

                            // Handle times that are for next day
                            if (departureDate < today) {
                                departureDate.setDate(departureDate.getDate() + 1);
                            }

                            return {
                                routeNo: routeNo,
                                stopNo: stopCode,
                                scheduledTime: departureDate.toISOString(),
                                estimatedTime: departureDate.toISOString(),
                                delay: 0,
                                status: 'ON_TIME' as const,
                                tripId: `scheduled-${idx}`
                            };
                        });
                    }
                }

                // Sort by estimated time and keep top 10 (5 shown + more in modal)
                const sorted = arrivals.sort((a, b) =>
                    new Date(a.estimatedTime).getTime() - new Date(b.estimatedTime).getTime()
                ).slice(0, 10);

                console.log(`[RouteDetails] Setting ${sorted.length} upcoming arrivals`);
                setUpcomingArrivals(sorted);
            } catch (error) {
                console.error('[RouteDetails] Error fetching arrivals:', error);
                setUpcomingArrivals([]);
            }
        };

        fetchArrivals();
        // Refresh arrivals every 30 seconds
        const interval = setInterval(fetchArrivals, 30000);
        return () => clearInterval(interval);
    }, [routeId, routeNo, targetStop]);

    // Real-time vehicle tracking AND ETA Fetching with ADAPTIVE POLLING
    useEffect(() => {
        if (!routeId) return;

        // Haversine distance helper
        const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
            const R = 6371000; // Earth radius in meters
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        // Calculate adaptive polling interval
        const getPollingInterval = (positions: VehiclePosition[]): number => {
            if (!isAppActive) return 0; // Paused when backgrounded
            if (!targetStop || positions.length === 0) return 30000; // Default: 30s

            // Find nearest vehicle to target stop
            let minDist = Infinity;
            for (const v of positions) {
                const dist = haversineDistance(v.latitude, v.longitude, targetStop.latitude, targetStop.longitude);
                if (dist < minDist) minDist = dist;
            }

            // High-freq (<500m), medium otherwise
            const interval = minDist < 500 ? 8000 : 30000;
            console.log(`[RouteDetails] ⏱️ Adaptive Poll: Bus ${Math.round(minDist)}m away → ${interval / 1000}s interval`);
            return interval;
        };

        const fetchData = async () => {
            try {
                // 1. Fetch Vehicle Positions
                const positions = await TransLinkService.getRealtimeVehiclePositions(routeId);
                console.log(`[RouteDetails] Got ${positions.length} vehicles for route ${routeNo}`);
                setVehiclePositions(positions);

                // 2. Fetch ETA/TripUpdates if we have a target stop
                if (targetStop || boardingStopId) {
                    const stopId = targetStop?.stopId || boardingStopId;
                    console.log(`[RouteDetails] Fetching ETA for route ${routeId} at stop ${stopId}`);
                    const etaResult = await TransLinkService.getArrivalsForSegment(routeId, stopId);
                    setEstimates(etaResult);
                }

                // 3. Schedule next fetch with adaptive interval
                const nextInterval = getPollingInterval(positions);
                if (nextInterval > 0) {
                    pollingTimeout.current = setTimeout(fetchData, nextInterval);
                }
            } catch (error) {
                console.error('[RouteDetails] Error fetching realtime data:', error);
                // Retry after default interval on error
                pollingTimeout.current = setTimeout(fetchData, 30000);
            }
        };

        // Initial fetch
        fetchData();

        // Cleanup on unmount
        return () => {
            if (pollingTimeout.current) {
                clearTimeout(pollingTimeout.current);
            }
            if (vehicleInterval.current) {
                clearInterval(vehicleInterval.current);
            }
        };
    }, [routeId, targetStop, boardingStopId, isAppActive]); // Add isAppActive dependency

    // Reset interaction lock AND vehicle lock when route/target changes
    useEffect(() => {
        lastInteraction.current = 0;
        lockedVehicle.current = null; // Fresh vehicle selection on route change
        console.log('[RouteDetails] Reset: Cleared locked vehicle due to route/stop change');
    }, [routeId, boardingStopId]);

    // AppState listener for adaptive polling (pause when backgrounded)
    useEffect(() => {
        const handleAppStateChange = (nextState: AppStateStatus) => {
            const active = nextState === 'active';
            console.log(`[RouteDetails] 📱 App state: ${nextState} → isAppActive: ${active}`);
            setIsAppActive(active);
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);
        return () => subscription.remove();
    }, []);

    // Walking route fetching
    useEffect(() => {
        // STRICT VALIDATION: Only proceed if we have ALL required coordinates
        if (!userLat || !userLon || !targetStop || !boardingStopId) {
            if (walkingRoute) setWalkingRoute(null); // Clear stale route
            return;
        }

        // Check if user has moved significantly (>25m) to avoid thrashing
        const hasMovedEnough = () => {
            if (!lastUserLocation.current) return true;
            const dLat = Math.abs(userLat - lastUserLocation.current.lat);
            const dLon = Math.abs(userLon - lastUserLocation.current.lon);
            const approxDistM = Math.sqrt(dLat * dLat + dLon * dLon) * 111000;
            return approxDistM > 25;
        };

        if (hasMovedEnough()) {
            lastUserLocation.current = { lat: userLat, lon: userLon };

            // Non-blocking fetch
            WalkingRouteService.getWalkingRoute(
                userLat,
                userLon,
                targetStop.latitude,
                targetStop.longitude,
                boardingStopId
            ).then(route => {
                if (route) {
                    setWalkingRoute(route);
                    console.log(`[RouteDetails] Walking route updated: ${route.distanceMeters}m`);
                }
            }).catch(err => {
                console.warn('[RouteDetails] Walking route fetch failed (non-fatal)');
            });
        }
    }, [userLat, userLon, targetStop, boardingStopId]);

    // Helper to slice route shape
    const getRouteSegment = (shape: RouteShape[], vehicleLat: number, vehicleLon: number, stopLat: number, stopLon: number) => {
        if (!shape || shape.length < 2) return [];

        let vIdx = -1;
        let sIdx = -1;
        let vMinDist = Infinity;
        let sMinDist = Infinity;

        // Find closest points
        for (let i = 0; i < shape.length; i++) {
            const pt = shape[i];
            const dV = Math.pow(pt.lat - vehicleLat, 2) + Math.pow(pt.lon - vehicleLon, 2);
            const dS = Math.pow(pt.lat - stopLat, 2) + Math.pow(pt.lon - stopLon, 2);

            if (dV < vMinDist) { vMinDist = dV; vIdx = i; }
            if (dS < sMinDist) { sMinDist = dS; sIdx = i; }
        }

        // Validity check
        if (vIdx === -1 || sIdx === -1) return [];

        // Normalize direction: Always slice between min and max
        const startIdx = Math.min(vIdx, sIdx);
        const endIdx = Math.max(vIdx, sIdx);

        // Slice segment
        const segment = shape.slice(startIdx, endIdx + 1);

        // If the vehicle index was actually higher than stop index,
        // it means the semantic direction is "reversed" relative to array order
        // SO we reverse the segment to ensure it flows Vehicle -> Stop
        if (vIdx > sIdx) {
            segment.reverse();
        }

        // Prepend vehicle actual pos
        segment.unshift({ lat: vehicleLat, lon: vehicleLon });
        // Append stop actual pos
        segment.push({ lat: stopLat, lon: stopLon });

        return segment;
    };

    // ========================================================================
    // MARKER UPDATE vs POLYLINE RENDERING SEPARATION
    // ========================================================================
    // MARKERS: Update IMMEDIATELY when vehiclePositions changes (line ~826).
    //          Uses vehiclePositions state directly for low-latency GPS updates.
    //
    // POLYLINES: Update with 100ms DEBOUNCE via renderedPaths state (line ~746).
    //            Prevents visual lag from expensive polyline recalculations.
    //
    // This decoupling ensures bus markers move smoothly while polylines
    // are calculated asynchronously without blocking the UI.
    // ========================================================================

    // Calculate display variables
    let slicedShape: RouteShape[] = [];
    let activeVehiclePosition: VehiclePosition | null = null;

    // VEHICLE IDENTITY LOCKING LOGIC
    const now = Date.now();
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes grace for missing data

    // Check if locked vehicle is stale
    if (lockedVehicle.current && (now - lockedVehicle.current.lastSeen) > STALE_THRESHOLD_MS) {
        console.log('[RouteDetails] 🔓 Unlocking vehicle - data stale (>5min)');
        lockedVehicle.current = null;
    }

    // Try to find the locked vehicle first
    if (lockedVehicle.current && vehiclePositions.length > 0) {
        // Priority 1: Find by tripId (most reliable)
        if (lockedVehicle.current.tripId) {
            const byTrip = vehiclePositions.find(v => v.tripId === lockedVehicle.current!.tripId);
            if (byTrip) {
                activeVehiclePosition = byTrip;
                lockedVehicle.current.lastSeen = now;
                console.log(`[RouteDetails] 🔒 Locked vehicle found by tripId: ${lockedVehicle.current.tripId}`);
            }
        }

        // Priority 2: Find by vehicleId (fallback if tripId missing)
        if (!activeVehiclePosition && lockedVehicle.current.vehicleId) {
            const byVehicle = vehiclePositions.find(v => v.vehicleId === lockedVehicle.current!.vehicleId);
            if (byVehicle) {
                activeVehiclePosition = byVehicle;
                lockedVehicle.current.lastSeen = now;
                console.log(`[RouteDetails] 🔒 Locked vehicle found by vehicleId: ${lockedVehicle.current.vehicleId}`);
            }
        }

        // Priority 3: Grace period - keep last known position if within grace period
        if (!activeVehiclePosition && (now - lockedVehicle.current.lastSeen) < GRACE_PERIOD_MS) {
            console.log(`[RouteDetails] ⏳ Locked vehicle missing but within grace period, keeping lock`);
            // Don't unlock yet, but also don't have a position to show
        }
    }

    // If no locked vehicle or lock expired, use estimates/fallback and potentially lock new vehicle
    if (!activeVehiclePosition) {
        if (estimates && vehiclePositions.length > 0) {
            if (estimates.tripId) {
                activeVehiclePosition = vehiclePositions.find(v => v.tripId === estimates.tripId) || null;
                if (activeVehiclePosition) {
                    // Lock this vehicle
                    lockedVehicle.current = {
                        tripId: estimates.tripId,
                        vehicleId: activeVehiclePosition.vehicleId,
                        lastSeen: now
                    };
                    console.log(`[RouteDetails] 🔐 NEW LOCK: tripId=${estimates.tripId}, vehicleId=${activeVehiclePosition.vehicleId}`);
                }
            } else if (estimates.source === 'VEHICLE_POSITION' && estimates.nearestVehicle) {
                activeVehiclePosition = {
                    latitude: estimates.nearestVehicle.latitude,
                    longitude: estimates.nearestVehicle.longitude,
                    vehicleId: 'fallback',
                    routeId: routeId,
                    speed: 0,
                    bearing: 0,
                    timestamp: new Date().toISOString()
                } as VehiclePosition;
            }
        }

        // FALLBACK: If still no vehicle, pick nearest to target stop
        if (!activeVehiclePosition && vehiclePositions.length > 0) {
            if (targetStop) {
                let nearestDist = Infinity;
                for (const v of vehiclePositions) {
                    const dist = Math.pow(v.latitude - targetStop.latitude, 2) + Math.pow(v.longitude - targetStop.longitude, 2);
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        activeVehiclePosition = v;
                    }
                }
                if (activeVehiclePosition) {
                    lockedVehicle.current = {
                        vehicleId: activeVehiclePosition.vehicleId,
                        lastSeen: now
                    };
                    console.log(`[RouteDetails] 🔐 NEW LOCK (fallback): vehicleId=${activeVehiclePosition.vehicleId}`);
                }
            } else {
                activeVehiclePosition = vehiclePositions[0];
            }
        }
    }

    // If no specific match, maybe fallback to closest? 
    // Users want to see the path from the bus they are waiting for.
    // If we have 'activeVehiclePosition', assume that's the one.

    if (activeVehiclePosition && targetStop && routeShape.length > 0) {
        slicedShape = getRouteSegment(
            routeShape,
            activeVehiclePosition.latitude,
            activeVehiclePosition.longitude,
            targetStop.latitude,
            targetStop.longitude
        );
    }

    // Fallback: If no vehicle active, maybe show full route? 
    // User request: "Do not render the full route... beyond the pickup stop"
    // If no vehicle, maybe show nothing? Or show from start?
    // Let's stick to: If no vehicle, show full route (default behavior before), 
    // UNLESS user implies "Waiting for bus".
    // Actually, user said "When a bus is selected... slice".
    // If NO bus is selected, maybe we show nothing?
    // Let's default to full shape if no vehicle, or maybe just from user loc?
    // For now, if no vehicle, we keep full shape (faint) as context? 
    // User acceptance: "no 'stop -> route end' path is drawn".
    // Let's defaulting to full shape but let's see.
    // Actually, showing the WHOLE route is useful for context.
    // The "Approaching" path is the specific one.

    // Changing approach:
    // 1. Always render FULL route as background (very faint gray).
    // 2. Render SLICED route as active path (purple/blue).

    const handleSaveRoutine = async (name: string, freq: 'daily' | 'weekly', days: number[]) => {
        // ... (Same save logic as before) ...
        try {
            const primaryStop = stops[0];
            if (!primaryStop) return;

            const routine = {
                userId,
                name,
                frequency: freq,
                active: true,
                daysOfWeek: freq === 'weekly' ? days : [],
                segments: [{
                    id: `${routeNo}-${primaryStop.stopNo}`,
                    sequenceOrder: 0,
                    transitType: 'bus' as const,
                    routeNumber: routeNo,
                    stopId: primaryStop.stopNo,
                    stopName: primaryStop.stopName,
                    scheduledTime: '08:00',
                    direction: 'OUTBOUND',
                    destination: routeName,
                }]
            };

            await RoutineService.createRoutine(routine as any);
            setShowDayPicker(false);
            Alert.alert('Success', 'Routine saved!');
        } catch (err) {
            console.error(err);
        }
    };

    const handleStartTrip = () => {
        if (!stops.length) return;
        router.push({
            pathname: '/active-trip',
            params: {
                routeId,
                routeNo,
                routeName,
                stopId: targetStop?.stopId || boardingStopId || stops[0].stopId,
                directionId, // Pass the resolved direction
                userLat: userLat ? String(userLat) : '',
                userLon: userLon ? String(userLon) : ''
            }
        });
    };

    useEffect(() => {
        const now = Date.now();
        console.log('[RouteDetails] Zoom Check:', {
            hasMap: !!mapRef.current,
            hasTarget: !!targetStop,
            hasVehicle: !!activeVehiclePosition,
            throttled: now - lastCameraUpdate.current < 2000,
            interacted: now - lastInteraction.current < 10000
        });

        // 1. Throttling (Max once every 2 seconds)
        if (now - lastCameraUpdate.current < 2000) return;

        // 2. Interaction Check (STRICT LOCK: If user ever interacted, stop auto-zoom)
        if (lastInteraction.current > 0) {
            console.log('[RouteDetails] 🚫 Camera locked by user interaction');
            return;
        }

        // 3. STRICT Requirement: Only zoom if we have Target Stop AND Vehicle
        if (mapRef.current && targetStop && userLat && userLon && activeVehiclePosition) {
            console.log('[RouteDetails] 🔎 EXECUTING Stabilization Zoom (User+Stop+Bus)');

            const points = [
                { latitude: userLat, longitude: userLon },
                { latitude: targetStop.latitude, longitude: targetStop.longitude },
                { latitude: activeVehiclePosition.latitude, longitude: activeVehiclePosition.longitude }
            ];

            mapRef.current.fitToCoordinates(points, {
                edgePadding: { top: 100, right: 60, bottom: 300, left: 60 }, // Large bottom padding for bottom sheet
                animated: true
            });
            lastCameraUpdate.current = now;
        }
    }, [targetStop, userLat, userLon, activeVehiclePosition]);

    // Memoize base route coordinates to prevent re-renders
    const baseRouteCoords = useMemo(() => {
        return routeShape.map(p => ({ latitude: p.lat, longitude: p.lon }));
    }, [routeShape]);

    // Memoize cumulative distance array for distance-along-shape calculations
    const shapeDistances = useMemo(() => {
        if (!routeShape.length) return [];
        const haversine = (p1: { lat: number; lon: number }, p2: { lat: number; lon: number }): number => {
            const R = 6371000;
            const dLat = (p2.lat - p1.lat) * Math.PI / 180;
            const dLon = (p2.lon - p1.lon) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        const distances = [0];
        for (let i = 1; i < routeShape.length; i++) {
            distances.push(distances[i - 1] + haversine(routeShape[i - 1], routeShape[i]));
        }
        return distances;
    }, [routeShape]);

    // Detect if route is a loop (start ≈ end within 200m)
    const isLoopRoute = useMemo(() => {
        if (routeShape.length < 10) return false;
        const start = routeShape[0];
        const end = routeShape[routeShape.length - 1];
        const dist = Math.sqrt((start.lat - end.lat) ** 2 + (start.lon - end.lon) ** 2) * 111000;
        return dist < 200;
    }, [routeShape]);

    // Pre-calculate the approach path (Bus -> Stop) with TRIP-AWARE logic
    const approachPath = useMemo(() => {
        if (!routeShape.length || !targetStop || !shapeDistances.length) return null;

        // Prefer locked/active vehicle, fallback to first vehicle
        const trackedBus = activeVehiclePosition || (vehiclePositions.length > 0 ? vehiclePositions[0] : null);
        if (!trackedBus) return null;

        // Haversine helper
        const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
            const R = 6371000;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        // Check staleness
        const now = Date.now();
        const dataAge = now - new Date(trackedBus.timestamp).getTime();
        if (dataAge > 300000) return null;

        // Check distance to stop
        const busToStopDist = haversine(trackedBus.latitude, trackedBus.longitude, targetStop.latitude, targetStop.longitude);
        if (busToStopDist > 5000) return null;

        // Find closest shape index for STOP
        let stopIdx = 0;
        let stopMinDist = Infinity;
        for (let i = 0; i < routeShape.length; i++) {
            const d = (routeShape[i].lat - targetStop.latitude) ** 2 + (routeShape[i].lon - targetStop.longitude) ** 2;
            if (d < stopMinDist) { stopMinDist = d; stopIdx = i; }
        }
        const stopDistAlong = shapeDistances[stopIdx];

        // Find closest shape index for BUS
        let busIdx = 0;
        let busMinDist = Infinity;
        for (let i = 0; i < routeShape.length; i++) {
            const d = (routeShape[i].lat - trackedBus.latitude) ** 2 + (routeShape[i].lon - trackedBus.longitude) ** 2;
            if (d < busMinDist) { busMinDist = d; busIdx = i; }
        }
        const busDistAlong = shapeDistances[busIdx];

        // DIRECTION CHECK: Bus must be BEFORE stop along the shape
        if (isLoopRoute) {
            const totalLength = shapeDistances[shapeDistances.length - 1];
            const forwardDist = stopDistAlong >= busDistAlong
                ? stopDistAlong - busDistAlong
                : totalLength - busDistAlong + stopDistAlong;
            const backwardDist = totalLength - forwardDist;
            if (backwardDist < forwardDist) {
                console.log(`[ApproachPath] Loop: Bus past stop (fwd: ${forwardDist.toFixed(0)}m > bwd: ${backwardDist.toFixed(0)}m)`);
                return null;
            }
        } else {
            if (busDistAlong >= stopDistAlong) {
                console.log(`[ApproachPath] Bus past stop (bus: ${busDistAlong.toFixed(0)}m >= stop: ${stopDistAlong.toFixed(0)}m)`);
                return null;
            }
        }

        // Extract segment (bus to stop)
        const startIdx = Math.min(busIdx, stopIdx);
        const endIdx = Math.max(busIdx, stopIdx);
        let routeSegment = routeShape.slice(startIdx, endIdx + 1);
        if (busIdx > stopIdx) routeSegment = [...routeSegment].reverse();

        // SNAP vehicle to shape
        let snappedStart = { latitude: trackedBus.latitude, longitude: trackedBus.longitude };
        if (routeShape.length > 1 && busIdx >= 0) {
            const p = { x: trackedBus.longitude, y: trackedBus.latitude };
            const candidates: number[] = [];
            if (busIdx > 0) candidates.push(busIdx - 1);
            if (busIdx < routeShape.length - 1) candidates.push(busIdx);
            let bestProj: { x: number; y: number } | null = null;
            let minSqDist = Infinity;
            for (const idx of candidates) {
                const p1 = { x: routeShape[idx].lon, y: routeShape[idx].lat };
                const p2 = { x: routeShape[idx + 1].lon, y: routeShape[idx + 1].lat };
                const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
                if (l2 === 0) continue;
                let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
                t = Math.max(0, Math.min(1, t));
                const proj = { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
                const distSq = (p.x - proj.x) ** 2 + (p.y - proj.y) ** 2;
                if (distSq < minSqDist) { minSqDist = distSq; bestProj = proj; }
            }
            if (bestProj) snappedStart = { latitude: bestProj.y, longitude: bestProj.x };
        }

        const segmentCoords = [
            snappedStart,
            ...routeSegment.map(p => ({ latitude: p.lat, longitude: p.lon })),
            { latitude: targetStop.latitude, longitude: targetStop.longitude }
        ];
        if (segmentCoords.length < 2) return null;

        console.log(`[ApproachPath] ✅ Bus@${busDistAlong.toFixed(0)}m → Stop@${stopDistAlong.toFixed(0)}m (${segmentCoords.length} pts)`);
        return segmentCoords;
    }, [routeShape, targetStop, activeVehiclePosition, vehiclePositions, shapeDistances, isLoopRoute]);

    // ========================================================================
    // POLYLINE-ONLY DEBOUNCE STATE
    // ========================================================================
    // This state holds debounced polyline coordinates. It updates 100ms AFTER
    // the source memos (baseRouteCoords, approachPath) change.
    //
    // WHY: Polyline recalculation is expensive. Debouncing prevents visual lag
    //      when GPS updates rapidly. Bus MARKERS are NOT debounced - they use
    //      vehiclePositions directly for immediate position updates.
    // ========================================================================
    const [renderedPaths, setRenderedPaths] = useState({
        base: [] as any[],
        approach: null as any[] | null,
        walking: null as any | null
    });

    // Debounce polyline rendering (100ms) - DOES NOT AFFECT MARKERS
    useEffect(() => {
        const timer = setTimeout(() => {
            // DEBUG: Log walking route coordinates being set
            if (walkingRoute && walkingRoute.coordinates && walkingRoute.coordinates.length > 0) {
                const first = walkingRoute.coordinates[0];
                console.log(`[RouteDetails] 🚶 Setting walking path: start=(${first.latitude.toFixed(4)}, ${first.longitude.toFixed(4)}), ${walkingRoute.coordinates.length} points`);
            }
            setRenderedPaths({
                base: baseRouteCoords,
                approach: approachPath,
                walking: walkingRoute
            });
        }, 100); // 100ms stagger/debounce

        return () => clearTimeout(timer);
    }, [baseRouteCoords, approachPath, walkingRoute]);

    return (
        <View style={styles.container}>
            {/* Map Section (Top) */}
            <View style={styles.mapContainer}>
                <MapView
                    ref={mapRef}
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    showsUserLocation={false}  // Disabled - using custom marker at userLat/userLon
                    showsMyLocationButton={false}
                    onPanDrag={() => {
                        console.log('[RouteDetails] ✋ User Interacted with Map (Locking Camera)');
                        // Permanently lock camera until route changes
                        lastInteraction.current = Date.now();
                    }}
                    initialRegion={{
                        latitude: userLat || 49.2827,
                        longitude: userLon || -123.1207,
                        latitudeDelta: 0.05,
                        longitudeDelta: 0.05,
                    }}
                >
                    {/* Z-ORDER 1: Walking Path (Bottom) */}
                    {renderedPaths.walking && (
                        <Polyline
                            coordinates={renderedPaths.walking.coordinates}
                            strokeColor="#0066CC"
                            strokeWidth={3}
                            lineDashPattern={[5, 4]}
                            lineCap="round"
                            geodesic={true}
                            zIndex={10}
                        />
                    )}

                    {/* Z-ORDER 2: Base Route (Middle) */}
                    {renderedPaths.base.length > 0 && (
                        <Polyline
                            coordinates={renderedPaths.base}
                            strokeWidth={4}
                            strokeColor="rgba(180, 180, 180, 0.4)" // Even fainter
                            lineCap="round"
                            lineJoin="round"
                            zIndex={20}
                        />
                    )}

                    {/* Z-ORDER 3: Active Approach Path (Top) */}
                    {renderedPaths.approach && (
                        <Polyline
                            key="bus-approach-polyline"
                            coordinates={renderedPaths.approach}
                            strokeColor="#0066CC"
                            strokeWidth={8} // Thicker, prominent approach
                            lineCap="round"
                            lineJoin="round"
                            zIndex={60} // Topmost
                        />
                    )}

                    {/* Stops Markers */}

                    {/* User Location Marker */}
                    {userLat && userLon && (
                        <Marker
                            coordinate={{ latitude: userLat, longitude: userLon }}
                            title="You"
                            zIndex={999}
                            onPress={() => console.log(`[RouteDetails] 📍 User marker at: (${userLat}, ${userLon})`)}
                        >
                            <View style={styles.userMarker}>
                                <View style={styles.userMarkerDot} />
                            </View>
                        </Marker>
                    )}




                    {/* Stops Markers */}
                    {stops.map((stop, index) => {
                        const isBoardingStop = stop.stopId === boardingStopId;

                        // Show first, last, every 5th, AND the boarding stop
                        if (index !== 0 && index !== stops.length - 1 && index % 5 !== 0 && !isBoardingStop) return null;

                        return (
                            <Marker
                                key={`m-${stop.stopNo}`}
                                coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                                title={stop.stopName}
                                description={`Stop #${stop.stopNo}`}
                                zIndex={isBoardingStop ? 10 : 1}
                            >
                                <View style={[
                                    styles.stopMarker,
                                    (index === 0 || index === stops.length - 1) && styles.majorStopMarker,
                                    isBoardingStop && styles.boardingStopMarker
                                ]} />
                            </Marker>
                        );
                    })}

                    {/* Real-time Bus Markers with ETA */}
                    {vehiclePositions
                        .filter(vehicle => {
                            // If we have a specific Trip ID from the ETA logic, ONLY show that bus
                            // This hides "ghost" buses that are nearby but not the active trip
                            if (estimates?.tripId && vehicle.tripId) {
                                return vehicle.tripId === estimates.tripId;
                            }
                            // Fallback: if we identified an active vehicle by position/fallback logic
                            if (activeVehiclePosition) {
                                return vehicle.vehicleId === activeVehiclePosition.vehicleId;
                            }
                            return true;
                        })
                        .map((vehicle, index) => {
                            // PRIORITY: Use the Service-calculated ETA (estimates.minutes) if this is the active vehicle
                            let etaMinutes: number | null = null;

                            const isActiveVehicle =
                                (estimates?.tripId && vehicle.tripId === estimates.tripId) ||
                                (activeVehiclePosition && vehicle.vehicleId === activeVehiclePosition.vehicleId);

                            if (isActiveVehicle && estimates?.minutes !== undefined) {
                                etaMinutes = estimates.minutes;
                            } else if (targetStop) {
                                // Fallback: Client-side rough calculation (only if no official estimate)
                                const R = 6371000; // Earth radius in meters
                                const dLat = (targetStop.latitude - vehicle.latitude) * Math.PI / 180;
                                const dLon = (targetStop.longitude - vehicle.longitude) * Math.PI / 180;
                                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                                    Math.cos(vehicle.latitude * Math.PI / 180) * Math.cos(targetStop.latitude * Math.PI / 180) *
                                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                                const distMeters = R * c;

                                // Use smarter ETA calculation consistent with Service
                                const speed = (vehicle.speed || 0) * 3.6; // km/h
                                const avgSpeed = speed > 1 ? Math.max(5, Math.min(speed, 80)) : 15; // km/h
                                // speed / 60 = km/min. 1000m / (speed/60 * 1000) = min
                                // distKm / speedKmH * 60
                                etaMinutes = Math.max(1, Math.round(((distMeters / 1000) / avgSpeed) * 60));
                            }

                            return (
                                <Marker
                                    key={`bus-${index}-${vehicle.timestamp}`}
                                    coordinate={{
                                        latitude: vehicle.latitude,
                                        longitude: vehicle.longitude,
                                    }}
                                    title={`Bus ${routeNo}`}
                                    description={`Speed: ${Math.round(vehicle.speed * 3.6)} km/h`}
                                    rotation={vehicle.bearing || 0}
                                    anchor={{ x: 0.5, y: 0.5 }}
                                    zIndex={20}
                                    onPress={() => setSelectedBus(vehicle)}
                                >
                                    <View style={styles.busMarkerContainer}>
                                        {etaMinutes !== null && (
                                            <View style={styles.busEtaBadge}>
                                                <Text style={styles.busEtaText}>{etaMinutes}m</Text>
                                            </View>
                                        )}
                                        <View style={styles.busMarker}>
                                            <Ionicons name="bus" size={18} color="#fff" />
                                        </View>
                                    </View>
                                </Marker>
                            );
                        })}
                </MapView>
            </View>

            {/* Bus Details Panel (Draggable - appears when a bus is tapped) */}
            {selectedBus && (() => {
                // Calculate stops away
                let stopsAway = 0;
                let nextStopName = 'Unknown';

                if (stops.length > 0 && routeShape.length > 0 && targetStop) {
                    // Find bus shape index
                    let busShapeIdx = 0;
                    let minDist = Infinity;
                    for (let i = 0; i < routeShape.length; i++) {
                        const d = Math.pow(routeShape[i].lat - selectedBus.latitude, 2) +
                            Math.pow(routeShape[i].lon - selectedBus.longitude, 2);
                        if (d < minDist) { minDist = d; busShapeIdx = i; }
                    }

                    // Find target stop shape index
                    let targetShapeIdx = 0;
                    minDist = Infinity;
                    for (let i = 0; i < routeShape.length; i++) {
                        const d = Math.pow(routeShape[i].lat - targetStop.latitude, 2) +
                            Math.pow(routeShape[i].lon - targetStop.longitude, 2);
                        if (d < minDist) { minDist = d; targetShapeIdx = i; }
                    }

                    // Count stops between bus and target
                    stops.forEach((stop, idx) => {
                        let stopShapeIdx = 0;
                        let sDist = Infinity;
                        for (let i = 0; i < routeShape.length; i++) {
                            const d = Math.pow(routeShape[i].lat - stop.latitude, 2) +
                                Math.pow(routeShape[i].lon - stop.longitude, 2);
                            if (d < sDist) { sDist = d; stopShapeIdx = i; }
                        }

                        if (busShapeIdx <= targetShapeIdx) {
                            if (stopShapeIdx > busShapeIdx && stopShapeIdx <= targetShapeIdx) {
                                stopsAway++;
                            }
                            if (stopShapeIdx > busShapeIdx && nextStopName === 'Unknown') {
                                nextStopName = stop.stopName;
                            }
                        } else {
                            if (stopShapeIdx < busShapeIdx && stopShapeIdx >= targetShapeIdx) {
                                stopsAway++;
                            }
                            if (stopShapeIdx < busShapeIdx && nextStopName === 'Unknown') {
                                nextStopName = stop.stopName;
                            }
                        }
                    });
                }

                const dataAge = Math.round((Date.now() - new Date(selectedBus.timestamp).getTime()) / 1000);
                const etaDisplay = estimates?.minutes !== undefined ? estimates.minutes : '?';

                return (
                    <DraggableBottomSheet
                        midHeight={280}
                        fullHeight={400}
                        collapsedHeight={120}
                        style={styles.busDetailsDraggable}
                        header={
                            <View style={styles.busDetailsDragHeader}>
                                <View style={styles.busDetailsDragHandle} />
                                <TouchableOpacity
                                    style={styles.busDetailsPanelClose}
                                    onPress={() => setSelectedBus(null)}
                                >
                                    <Ionicons name="close-circle" size={28} color="#999" />
                                </TouchableOpacity>
                                <View style={styles.busDetailsPanelHeader}>
                                    <Ionicons name="navigate" size={20} color="#0066CC" />
                                    <Text style={styles.busDetailsPanelDestination}>{routeName}</Text>
                                </View>
                            </View>
                        }
                    >
                        <View style={styles.busDetailsContent}>
                            <View style={styles.busDetailsPanelMain}>
                                <Text style={styles.busDetailsStopsAway}>{stopsAway} stops away</Text>
                                <View style={styles.busDetailsEtaContainer}>
                                    <Text style={styles.busDetailsEtaNumber}>{etaDisplay}</Text>
                                    <Text style={styles.busDetailsEtaUnit}>min</Text>
                                </View>
                            </View>

                            {estimates?.scheduledTime && (
                                <Text style={styles.busDetailsScheduled}>
                                    Scheduled: {estimates.scheduledTime}
                                </Text>
                            )}

                            {/* Upcoming Arrivals Cards */}
                            {upcomingArrivals.length > 0 && (
                                <View style={styles.arrivalsSection}>
                                    <Text style={styles.arrivalsSectionTitle}>Upcoming Arrivals</Text>
                                    <ScrollView
                                        horizontal
                                        showsHorizontalScrollIndicator={false}
                                        style={styles.arrivalsScroll}
                                    >
                                        {upcomingArrivals.map((arrival, idx) => {
                                            const etaMs = new Date(arrival.estimatedTime).getTime() - Date.now();
                                            const etaMinutes = Math.max(0, Math.round(etaMs / 60000));
                                            const isSelected = arrival.tripId === selectedBus.tripId;
                                            return (
                                                <View
                                                    key={`arrival-${idx}`}
                                                    style={[
                                                        styles.arrivalCard,
                                                        isSelected && styles.arrivalCardSelected
                                                    ]}
                                                >
                                                    <Text style={styles.arrivalCardTime}>{etaMinutes}</Text>
                                                    <Text style={styles.arrivalCardUnit}>min</Text>
                                                    {arrival.status === 'DELAYED' && (
                                                        <View style={styles.arrivalCardDelayBadge}>
                                                            <Text style={styles.arrivalCardDelayText}>
                                                                +{Math.round(arrival.delay / 60)}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            );
                                        })}
                                    </ScrollView>
                                </View>
                            )}

                            <Text style={styles.busDetailsNextStop}>
                                Next stop: {nextStopName}
                            </Text>

                            {selectedBus.speed !== undefined && selectedBus.speed > 0 && (
                                <Text style={styles.busDetailsSpeed}>
                                    Speed: {Math.round(selectedBus.speed * 3.6)} km/h
                                </Text>
                            )}

                            <Text style={styles.busDetailsFooter}>
                                Bus {selectedBus.vehicleId}. Updated {dataAge < 60 ? `${dataAge}s` : `${Math.round(dataAge / 60)}m`} ago
                            </Text>
                        </View>
                    </DraggableBottomSheet>
                );
            })()}

            <DraggableBottomSheet
                header={
                    <View style={styles.sheetHeader}>
                        <View style={styles.dragHandle} />
                        <View style={styles.routeHeader}>
                            <View style={styles.routeBadge}>
                                <Ionicons name="bus" size={20} color="#fff" />
                                <Text style={styles.routeBadgeText}>{routeNo}</Text>
                            </View>
                            <View style={styles.routeInfo}>
                                <Text style={styles.routeName} numberOfLines={1}>{routeName}</Text>
                                <Text style={styles.routeSubtext}>
                                    {stops.length} stops
                                    {estimates?.scheduledTime && ` • Arrives ${estimates.scheduledTime}`}
                                    {estimates?.minutes !== undefined && estimates?.minutes !== null && ` (${estimates.minutes} min)`}
                                </Text>
                            </View>
                        </View>

                        {/* Action Buttons Row */}
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionContextButton} onPress={() => setShowDayPicker(true)}>
                                <Ionicons name="add-circle-outline" size={20} color="#0066CC" />
                                <Text style={styles.actionContextText}>Save Routine</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.goButton, stops.length === 0 && styles.disabledButton]}
                                onPress={handleStartTrip}
                                disabled={stops.length === 0}
                            >
                                <Text style={styles.goButtonText}>GO</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Upcoming Arrivals Cards */}
                        {upcomingArrivals.length > 0 ? (
                            <View style={styles.headerArrivalsSection}>
                                <Text style={styles.headerArrivalsSectionTitle}>Upcoming</Text>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    style={styles.headerArrivalsScroll}
                                    contentContainerStyle={styles.headerArrivalsContent}
                                >
                                    {upcomingArrivals.slice(0, 5).map((arrival, idx) => {
                                        const etaMs = new Date(arrival.estimatedTime).getTime() - Date.now();
                                        const etaMinutes = Math.max(0, Math.round(etaMs / 60000));
                                        const isScheduled = arrival.tripId?.startsWith('scheduled');
                                        return (
                                            <View
                                                key={`header-arrival-${idx}`}
                                                style={[
                                                    styles.headerArrivalCard,
                                                    isScheduled && styles.headerArrivalCardScheduled
                                                ]}
                                            >
                                                <Text style={styles.headerArrivalCardTime}>{etaMinutes}</Text>
                                                <Text style={styles.headerArrivalCardUnit}>min</Text>
                                                {isScheduled && (
                                                    <Text style={styles.headerArrivalCardBadge}>Sched</Text>
                                                )}
                                                {arrival.status === 'DELAYED' && (
                                                    <Text style={styles.headerArrivalCardDelayBadge}>
                                                        +{Math.round(arrival.delay)}
                                                    </Text>
                                                )}
                                            </View>
                                        );
                                    })}
                                    {/* More Departures Card */}
                                    <TouchableOpacity
                                        style={styles.headerArrivalCardMore}
                                        onPress={() => setShowAllDepartures(true)}
                                    >
                                        <Ionicons name="time-outline" size={22} color="#0066CC" />
                                        <Text style={styles.headerArrivalCardMoreText}>More</Text>
                                    </TouchableOpacity>
                                </ScrollView>
                            </View>
                        ) : (
                            <View style={styles.headerArrivalsSection}>
                                <View style={styles.noArrivalsContainer}>
                                    <Ionicons name="time-outline" size={20} color="#888" />
                                    <Text style={styles.noArrivalsText}>Real-time data not available</Text>
                                </View>
                            </View>
                        )}
                    </View>
                }
            >
                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator color="#0066CC" />
                    </View>
                ) : (
                    <ScrollView style={styles.stopsList}>
                        {stops.map((stop, index) => (
                            <View key={stop.stopNo} style={styles.stopItem}>
                                <View style={styles.stopTimeline}>
                                    <View style={styles.timelineLine} />
                                    <View style={styles.timelineDot} />
                                </View>
                                <View style={styles.stopContent}>
                                    <Text style={styles.stopNameText}>{stop.stopName}</Text>
                                    <Text style={styles.stopIdText}>#{stop.stopNo}</Text>
                                </View>
                            </View>
                        ))}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                )}
            </DraggableBottomSheet>

            <DayPickerModal
                visible={showDayPicker}
                routeNo={routeNo}
                routeName={routeName}
                onSave={handleSaveRoutine}
                onClose={() => setShowDayPicker(false)}
            />

            {/* All Departures Modal */}
            <Modal
                visible={showAllDepartures}
                animationType="slide"
                transparent={false}
                onRequestClose={() => setShowAllDepartures(false)}
            >
                <View style={styles.departuresModal}>
                    {/* Header */}
                    <View style={styles.departuresHeader}>
                        <View style={styles.departuresHeaderLeft}>
                            <Text style={styles.departuresRouteNo}>{routeNo}</Text>
                            <View style={styles.departuresHeaderInfo}>
                                <View style={styles.departuresDestRow}>
                                    <Ionicons name="navigate" size={16} color="#0066CC" />
                                    <Text style={styles.departuresDestText}>{routeName}</Text>
                                </View>
                                <Text style={styles.departuresStopText}>
                                    {targetStop?.stopName || 'Loading...'}
                                </Text>
                            </View>
                        </View>
                        <TouchableOpacity
                            style={styles.departuresCloseBtn}
                            onPress={() => setShowAllDepartures(false)}
                        >
                            <Ionicons name="close-circle" size={32} color="#0066CC" />
                        </TouchableOpacity>
                    </View>

                    {/* Departures List */}
                    <ScrollView style={styles.departuresList}>
                        {upcomingArrivals.map((arrival, idx) => {
                            const arrivalDate = new Date(arrival.estimatedTime);
                            const timeStr = arrivalDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                            const etaMs = arrivalDate.getTime() - Date.now();
                            const etaMinutes = Math.max(0, Math.round(etaMs / 60000));
                            const isScheduled = arrival.tripId?.startsWith('scheduled');
                            const isLast = idx === upcomingArrivals.length - 1;

                            return (
                                <View
                                    key={`departure-${idx}`}
                                    style={[
                                        styles.departureRow,
                                        idx === 0 && styles.departureRowFirst
                                    ]}
                                >
                                    <View style={styles.departureTimeContainer}>
                                        <Text style={styles.departureTime}>{timeStr}</Text>
                                        {isScheduled && (
                                            <Ionicons name="time-outline" size={14} color="#888" style={{ marginLeft: 6 }} />
                                        )}
                                    </View>
                                    <Text style={styles.departureStop}>
                                        {targetStop?.stopName || 'Stop'}
                                    </Text>
                                    <View style={styles.departureEtaContainer}>
                                        {etaMinutes <= 60 && (
                                            <Text style={styles.departureEta}>{etaMinutes} min</Text>
                                        )}
                                        {isLast && (
                                            <View style={styles.departureLastBadge}>
                                                <Text style={styles.departureLastText}>LAST</Text>
                                            </View>
                                        )}
                                        {arrival.status === 'DELAYED' && (
                                            <Text style={styles.departureDelay}>+{Math.round(arrival.delay)}</Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}



const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    mapContainer: {
        ...StyleSheet.absoluteFillObject,
    },
    map: {
        width: '100%',
        height: '100%',
    },
    // ...
    sheetContainer: {
        flex: 0.3, // List takes 30%
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        marginTop: -20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 5,
        elevation: 10,
    },
    // ...
    sheetHeader: {
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    dragHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#e0e0e0',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
    },
    routeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    routeBadge: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginRight: 12,
    },
    routeBadgeText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    routeInfo: {
        flex: 1,
    },
    routeName: {
        fontSize: 18,
        fontWeight: '700',
        color: '#333',
        marginBottom: 2,
    },
    routeSubtext: {
        fontSize: 14,
        color: '#888',
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    actionContextButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0F9FF',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        gap: 6,
    },
    actionContextText: {
        color: '#0066CC',
        fontWeight: '600',
    },
    goButton: {
        backgroundColor: '#34C759', // Apple Green
        paddingVertical: 10,
        paddingHorizontal: 32,
        borderRadius: 8,
        shadowColor: '#34C759',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 4,
    },
    disabledButton: {
        backgroundColor: '#ccc',
        shadowOpacity: 0,
    },
    goButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stopsList: {
        flex: 1,
        paddingHorizontal: 16,
    },
    stopItem: {
        flexDirection: 'row',
        height: 60,
    },
    stopTimeline: {
        width: 30,
        alignItems: 'center',
    },
    timelineLine: {
        width: 2,
        flex: 1,
        backgroundColor: '#e0e0e0',
    },
    timelineDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#0066CC',
        position: 'absolute',
        top: 25,
        borderWidth: 2,
        borderColor: '#fff',
    },
    stopContent: {
        flex: 1,
        justifyContent: 'center',
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
        paddingLeft: 8,
    },
    stopNameText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    stopIdText: {
        fontSize: 12,
        color: '#999',
    },
    stopMarker: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#0066CC',
    },
    majorStopMarker: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 3,
        backgroundColor: '#fff',
    },
    boardingStopMarker: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 4,
        borderColor: '#00C853', // Green for highlight
        backgroundColor: '#fff',
    },
    userMarker: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'rgba(0, 122, 255, 0.3)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    userMarkerDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#007AFF', // iOS Blue
        borderWidth: 2,
        borderColor: '#fff',
    },
    busMarkerContainer: {
        alignItems: 'center',
    },
    busEtaBadge: {
        backgroundColor: '#00BFA5',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        marginBottom: 2,
        borderWidth: 2,
        borderColor: 'white',
        shadowColor: 'black',
        shadowOpacity: 0.3,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
        minWidth: 28,
        alignItems: 'center',
    },
    busEtaText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '700',
    },
    busMarker: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    busDetailsPanel: {
        position: 'absolute',
        bottom: 180,
        left: 16,
        right: 16,
        backgroundColor: '#1a2744',
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
    },
    busDetailsPanelClose: {
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
    },
    busDetailsPanelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    busDetailsPanelDestination: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    busDetailsPanelMain: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    busDetailsStopsAway: {
        color: '#fff',
        fontSize: 28,
        fontWeight: '700',
    },
    busDetailsEtaContainer: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    busDetailsEtaNumber: {
        color: '#fff',
        fontSize: 36,
        fontWeight: '700',
    },
    busDetailsEtaUnit: {
        color: '#aaa',
        fontSize: 16,
        marginLeft: 4,
    },
    busDetailsNextStop: {
        color: '#ccc',
        fontSize: 14,
        marginBottom: 12,
    },
    busDetailsSpeed: {
        color: '#4CAF50',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
    },
    busDetailsScheduled: {
        color: '#78A7E8',
        fontSize: 14,
        marginBottom: 8,
        fontWeight: '500',
    },
    busDetailsFooter: {
        color: '#888',
        fontSize: 12,
        borderTopWidth: 1,
        borderTopColor: '#333',
        paddingTop: 12,
    },
    busDetailsDraggable: {
        backgroundColor: '#1a2744',
        zIndex: 100,
    },
    busDetailsDragHeader: {
        paddingTop: 8,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    busDetailsDragHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#555',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 12,
    },
    busDetailsContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    // Upcoming Arrivals Section
    arrivalsSection: {
        marginVertical: 12,
    },
    arrivalsSectionTitle: {
        color: '#aaa',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    arrivalsScroll: {
        flexDirection: 'row',
    },
    arrivalCard: {
        backgroundColor: '#2a3a5a',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginRight: 10,
        alignItems: 'center',
        minWidth: 70,
    },
    arrivalCardSelected: {
        backgroundColor: '#0066CC',
        borderWidth: 2,
        borderColor: '#4da6ff',
    },
    arrivalCardTime: {
        color: '#fff',
        fontSize: 24,
        fontWeight: '700',
    },
    arrivalCardUnit: {
        color: '#aaa',
        fontSize: 12,
        marginTop: 2,
    },
    arrivalCardDelayBadge: {
        backgroundColor: '#ff6b6b',
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 4,
    },
    arrivalCardDelayText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '600',
    },
    // Header Arrivals Section (main route panel)
    headerArrivalsSection: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#333',
    },
    headerArrivalsSectionTitle: {
        color: '#aaa',
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    headerArrivalsScroll: {
        flexDirection: 'row',
    },
    headerArrivalsContent: {
        paddingRight: 16,
    },
    headerArrivalCard: {
        backgroundColor: '#0066CC',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginRight: 10,
        alignItems: 'center',
        minWidth: 65,
    },
    headerArrivalCardScheduled: {
        backgroundColor: '#3a4a6a',
    },
    headerArrivalCardTime: {
        color: '#fff',
        fontSize: 22,
        fontWeight: '700',
    },
    headerArrivalCardUnit: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 11,
        marginTop: 1,
    },
    headerArrivalCardBadge: {
        color: '#ffa500',
        fontSize: 9,
        fontWeight: '600',
        marginTop: 3,
    },
    headerArrivalCardDelayBadge: {
        color: '#ff6b6b',
        fontSize: 10,
        fontWeight: '600',
        marginTop: 3,
    },
    // No arrivals empty state
    noArrivalsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
    },
    noArrivalsText: {
        color: '#888',
        fontSize: 13,
        marginLeft: 8,
    },
    // More Departures Card
    headerArrivalCardMore: {
        backgroundColor: '#1a2744',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#0066CC',
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 65,
    },
    headerArrivalCardMoreText: {
        color: '#0066CC',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },
    // Full Departures Modal
    departuresModal: {
        flex: 1,
        backgroundColor: '#0d1b2a',
    },
    departuresHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingTop: 60,
        paddingHorizontal: 20,
        paddingBottom: 20,
    },
    departuresHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    departuresRouteNo: {
        color: '#0066CC',
        fontSize: 48,
        fontWeight: '800',
        marginRight: 16,
    },
    departuresHeaderInfo: {
        flex: 1,
        paddingTop: 8,
    },
    departuresDestRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    departuresDestText: {
        color: '#0066CC',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 6,
    },
    departuresStopText: {
        color: '#78A7E8',
        fontSize: 13,
    },
    departuresCloseBtn: {
        padding: 4,
    },
    departuresList: {
        flex: 1,
        paddingHorizontal: 16,
    },
    departureRow: {
        backgroundColor: '#1a2744',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 16,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    departureRowFirst: {
        borderWidth: 2,
        borderColor: '#0066CC',
    },
    departureTimeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 90,
    },
    departureTime: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    departureStop: {
        color: '#aaa',
        fontSize: 13,
        flex: 1,
        marginLeft: 12,
    },
    departureEtaContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    departureEta: {
        color: '#78A7E8',
        fontSize: 12,
        fontWeight: '600',
    },
    departureLastBadge: {
        backgroundColor: '#333',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginLeft: 8,
    },
    departureLastText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
    },
    departureDelay: {
        color: '#ff6b6b',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 8,
    },
});
