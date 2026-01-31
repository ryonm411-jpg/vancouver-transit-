import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, AppState, AppStateStatus, Dimensions, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import TripTrackingService, { TripInstruction } from '../src/services/TripTrackingService';
import TransLinkService, { VehiclePosition, TransitStop } from '../src/services/TransLinkService';
import WalkingRouteService, { WalkingRoute } from '../src/services/WalkingRouteService';
import NotificationService from '../src/services/NotificationService';
import { RouteShape } from '../src/data/routeShapes';
import { DraggableBottomSheet } from '../src/components/DraggableBottomSheet';

// Debug logging toggle
const DEBUG_LOGGING = __DEV__;

// Distance threshold for "Board now" alert (meters)
const BUS_APPROACHING_THRESHOLD = 50;
// Distance threshold for considering user has reached the stop (meters)
const AT_STOP_THRESHOLD = 30;
// Distance threshold for "arrival imminent" notification (meters)
const ARRIVAL_NOTIFICATION_DISTANCE = 500;
// ETA threshold for "arrival imminent" notification (minutes)
const ARRIVAL_NOTIFICATION_ETA = 2;
// Delay threshold for notification (minutes)
const DELAY_NOTIFICATION_THRESHOLD = 3;

export default function ActiveTripScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const mapRef = useRef<MapView>(null);

    const routeId = params.routeId as string;
    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;

    const stopId = params.stopId as string;
    const directionId = params.directionId as string;

    // Parse initial user location from params
    const initLat = params.userLat ? parseFloat(params.userLat as string) : null;
    const initLon = params.userLon ? parseFloat(params.userLon as string) : null;

    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(
        initLat && initLon ? {
            coords: {
                latitude: initLat,
                longitude: initLon,
                altitude: 0,
                accuracy: 0,
                altitudeAccuracy: 0,
                heading: 0,
                speed: 0
            },
            timestamp: Date.now()
        } as Location.LocationObject : null
    );

    const [vehiclePosition, setVehiclePosition] = useState<VehiclePosition | null>(null);
    const [targetStop, setTargetStop] = useState<TransitStop | null>(null);
    const [routeShape, setRouteShape] = useState<RouteShape[]>([]);
    const [routeStops, setRouteStops] = useState<TransitStop[]>([]);
    const [instruction, setInstruction] = useState<TripInstruction | null>(null);
    const [eta, setEta] = useState<number | null>(null);
    const [isTracking, setIsTracking] = useState(true);

    // New state for enhanced boarding experience
    const [hasReachedStop, setHasReachedStop] = useState(false);
    const [hasBoarded, setHasBoarded] = useState(false);
    const [busDistanceToStop, setBusDistanceToStop] = useState<number | null>(null);
    const [showBoardNow, setShowBoardNow] = useState(false);
    const [walkingRoute, setWalkingRoute] = useState<WalkingRoute | null>(null);
    const [scheduledTimes, setScheduledTimes] = useState<string[]>([]); // Horizontal schedule display
    const lastWalkingRouteLocation = useRef<{ lat: number; lon: number } | null>(null);

    // Refs for previous state (to detect transitions for haptics)
    const prevShowBoardNow = useRef(false);
    const prevHasReachedStop = useRef(false);

    // Notification tracking state
    const [arrivalNotified, setArrivalNotified] = useState(false);
    const [delayNotified, setDelayNotified] = useState<number | null>(null);
    const [originalScheduledTime, setOriginalScheduledTime] = useState<Date | null>(null);

    const locationSubscription = useRef<Location.LocationSubscription | null>(null);
    const vehicleInterval = useRef<NodeJS.Timeout | null>(null);
    const appState = useRef(AppState.currentState);

    // AppState listener - pause tracking when backgrounded
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (DEBUG_LOGGING) console.log(`[ActiveTrip] AppState: ${appState.current} -> ${nextState}`);
            appState.current = nextState;
        });

        return () => subscription.remove();
    }, []);

    // Request notification permissions on mount
    useEffect(() => {
        NotificationService.requestPermissions();
    }, []);

    useEffect(() => {
        // Clear walking route cache and state on fresh trip start
        WalkingRouteService.clearCache();
        setWalkingRoute(null);
        lastWalkingRouteLocation.current = null;

        startTrip();
        return () => {
            stopTrip();
        };
    }, []);

    // Zoom effect - switches focus after boarding
    useEffect(() => {
        if (!mapRef.current || !userLocation) return;

        // After boarding, focus on user and bus
        if (hasBoarded && vehiclePosition) {
            console.log('[ActiveTrip] Zooming to user + bus (boarded mode)');
            mapRef.current.fitToCoordinates([
                { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude },
                { latitude: vehiclePosition.latitude, longitude: vehiclePosition.longitude }
            ], {
                edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
                animated: true
            });
        }
        // Before boarding, focus on user and stop
        else if (targetStop && !hasReachedStop) {
            console.log('[ActiveTrip] Zooming to user + stop (walking mode)');
            mapRef.current.fitToCoordinates([
                { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude },
                { latitude: targetStop.latitude, longitude: targetStop.longitude }
            ], {
                edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
                animated: true
            });
        }
        // At stop waiting for bus - don't re-zoom (freeze map)
    }, [targetStop, hasBoarded, hasReachedStop]); // Remove userLocation to prevent constant re-zooming

    // Walking route fetching
    useEffect(() => {
        if (!userLocation || !targetStop || !stopId || hasBoarded) return;

        const userLat = userLocation.coords.latitude;
        const userLon = userLocation.coords.longitude;

        // Verify targetStop has valid coordinates
        if (!targetStop.latitude || !targetStop.longitude) {
            console.error('[ActiveTrip] targetStop has invalid coordinates!', targetStop);
            return;
        }

        // Check if user has moved significantly (>25m)
        const hasMovedEnough = () => {
            if (!lastWalkingRouteLocation.current) return true;
            const dLat = Math.abs(userLat - lastWalkingRouteLocation.current.lat);
            const dLon = Math.abs(userLon - lastWalkingRouteLocation.current.lon);
            const approxDistM = Math.sqrt(dLat * dLat + dLon * dLon) * 111000;
            return approxDistM > 25;
        };

        if (hasMovedEnough()) {
            lastWalkingRouteLocation.current = { lat: userLat, lon: userLon };
            console.log(`[ActiveTrip] Walking route target: stopId=${stopId}, name=${targetStop.stopName}`);

            WalkingRouteService.getWalkingRoute(
                userLat,
                userLon,
                targetStop.latitude,
                targetStop.longitude,
                stopId
            ).then(route => {
                setWalkingRoute(route);
            }).catch(err => {
                console.warn('[ActiveTrip] Walking route error:', err);
            });
        }
    }, [userLocation, targetStop, stopId, hasBoarded]);

    // Ref for throttling zoom
    const lastZoomTime = useRef<number>(0);

    // Auto-zoom to User + Bus + Target
    useEffect(() => {
        if (!mapRef.current || !userLocation || !targetStop) return;

        const now = Date.now();
        // Only zoom if 5 seconds passed or first run
        if (now - lastZoomTime.current < 5000 && lastZoomTime.current !== 0) return;

        const coordsToFit = [
            { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude },
            { latitude: targetStop.latitude, longitude: targetStop.longitude }
        ];

        if (vehiclePosition) {
            coordsToFit.push({ latitude: vehiclePosition.latitude, longitude: vehiclePosition.longitude });
        }

        mapRef.current.fitToCoordinates(coordsToFit, {
            edgePadding: { top: 100, right: 50, bottom: 300, left: 50 }, // Bottom padding for sheet
            animated: true,
        });

        lastZoomTime.current = now;

    }, [vehiclePosition, targetStop, userLocation]);

    const startTrip = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission is required for trip tracking');
                router.back();
                return;
            }

            await loadTargetStop();
            startGPSTracking();
            startVehicleTracking();
        } catch (error) {
            console.error('[ActiveTrip] Error starting trip:', error);
            // Alert.alert('Error', 'Failed to start trip tracking');
        }
    };

    const loadTargetStop = async () => {
        try {
            let stops: TransitStop[] = [];
            let shape: RouteShape[] = [];
            let foundStop: TransitStop | undefined;

            // IF direction explicitly passed (from RouteDetails), obey it.
            if (directionId) {
                console.log(`[ActiveTrip] Using explicit direction ID: ${directionId}`);
                stops = await TransLinkService.getStaticStopsForRoute(routeId, directionId);
                shape = await TransLinkService.getStaticRouteShape(routeId, directionId);

                // Find stop in list
                foundStop = stops.find(s =>
                    String(s.stopNo) === String(stopId) ||
                    String(s.stopId) === String(stopId)
                );
            }
            // ELSE Auto-detect direction
            else {
                // Try direction 0 first
                stops = await TransLinkService.getStaticStopsForRoute(routeId, '0');
                shape = await TransLinkService.getStaticRouteShape(routeId, '0');

                // Check if boarding stop is in direction 0
                foundStop = stops.find(s =>
                    String(s.stopNo) === String(stopId) ||
                    String(s.stopId) === String(stopId)
                );

                if (!foundStop) {
                    if (DEBUG_LOGGING) console.log(`[ActiveTrip] Stop ${stopId} not in direction 0, trying direction 1...`);
                    const dir1Stops = await TransLinkService.getStaticStopsForRoute(routeId, '1');
                    const dir1Stop = dir1Stops.find(s =>
                        String(s.stopNo) === String(stopId) ||
                        String(s.stopId) === String(stopId)
                    );

                    if (dir1Stop) {
                        stops = dir1Stops;
                        shape = await TransLinkService.getStaticRouteShape(routeId, '1');
                        foundStop = dir1Stop;
                        if (DEBUG_LOGGING) console.log(`[ActiveTrip] Using direction 1 (found stop ${stopId})`);
                    }
                } else {
                    if (DEBUG_LOGGING) console.log(`[ActiveTrip] Using direction 0 (found stop ${stopId})`);
                }
            }

            setRouteShape(shape);
            setRouteStops(stops);

            // Use the stop found during direction detection
            let stop = foundStop;

            if (DEBUG_LOGGING) {
                console.log(`[ActiveTrip] Looking for stop: ${stopId}`);
                console.log(`[ActiveTrip] Found stop in route list: ${stop ? `${stop.stopName} (${stop.latitude}, ${stop.longitude})` : 'NOT FOUND'}`);
            }

            // Manual lookup fallback
            if (!stop && stopId) {
                const manualStop = require('../src/data/stops').getStopById(stopId);
                if (manualStop) {
                    stop = {
                        stopNo: manualStop.code || manualStop.id,
                        stopId: manualStop.id,
                        stopName: manualStop.name,
                        latitude: manualStop.lat,
                        longitude: manualStop.lon,
                        routes: [routeNo]
                    };
                    if (DEBUG_LOGGING) console.log(`[ActiveTrip] Using manual lookup: ${stop.stopName} (${stop.latitude}, ${stop.longitude})`);
                }
            }

            if (!stop) {
                console.warn(`[ActiveTrip] Stop ${stopId} not found, falling back to first stop!`);
            } else {
                console.log(`[ActiveTrip] Success: Direction found with ${stops.length} stops.`);
            }

            setTargetStop(stop || stops[0]);

            // Fetch scheduled times for horizontal display
            if (stop) {
                try {
                    const estimates = await TransLinkService.getStopEstimates(stop.stopNo, routeNo);
                    const times = estimates.map(e => {
                        const date = new Date(e.estimatedTime || e.scheduledTime);
                        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    }).slice(0, 10); // Limit to 10 times
                    setScheduledTimes(times);
                    console.log(`[ActiveTrip] Fetched ${times.length} scheduled times`);

                    // Capture first scheduled time for delay comparison
                    if (estimates.length > 0) {
                        const firstScheduledTime = new Date(estimates[0].scheduledTime);
                        setOriginalScheduledTime(firstScheduledTime);
                        console.log(`[ActiveTrip] Original scheduled time: ${firstScheduledTime.toLocaleTimeString()}`);
                    }
                } catch (schedErr) {
                    console.warn('[ActiveTrip] Failed to fetch schedule:', schedErr);
                }
            }
        } catch (error) {
            console.error('[ActiveTrip] Error loading stop:', error);
        }
    };

    const startGPSTracking = async () => {
        // ... (existing logic)
        // If we already have userLocation from params, we might skip initial getCurrentPositionAsync to save time?
        // But for accuracy, let's keep it.
        const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation(location);

        locationSubscription.current = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 5000,
                distanceInterval: 10,
            },
            (newLocation) => {
                setUserLocation(newLocation);
                updateTripState(newLocation);
            }
        );
    };

    const startVehicleTracking = async () => {
        updateVehiclePosition();
        vehicleInterval.current = setInterval(() => {
            // Only fetch when app is active
            if (appState.current === 'active') {
                updateVehiclePosition();
            } else if (DEBUG_LOGGING) {
                console.log('[ActiveTrip] Skipping vehicle update - app backgrounded');
            }
        }, 10000);
    };

    const updateVehiclePosition = async () => {
        try {
            const positions = await TransLinkService.getRealtimeVehiclePositions(routeId);
            if (positions.length > 0 && targetStop) {
                // Find the bus closest to the boarding stop
                let closestBus = positions[0];
                let closestDistSquared = Infinity;

                for (const bus of positions) {
                    const dist = Math.pow(bus.latitude - targetStop.latitude, 2) +
                        Math.pow(bus.longitude - targetStop.longitude, 2);
                    if (dist < closestDistSquared) {
                        closestDistSquared = dist;
                        closestBus = bus;
                    }
                }

                // Calculate actual distance in meters using Haversine
                const R = 6371000; // Earth's radius in meters
                const dLat = (targetStop.latitude - closestBus.latitude) * Math.PI / 180;
                const dLon = (targetStop.longitude - closestBus.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(closestBus.latitude * Math.PI / 180) * Math.cos(targetStop.latitude * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distMeters = R * c;

                setBusDistanceToStop(Math.round(distMeters));
                console.log(`[ActiveTrip] Bus ${distMeters.toFixed(0)}m from stop`);

                // Check if bus is approaching - trigger "Board now" alert
                const isBoardNow = distMeters < BUS_APPROACHING_THRESHOLD && hasReachedStop && !hasBoarded;

                if (isBoardNow && !prevShowBoardNow.current) {
                    // Trigger haptic feedback when transitioning to "Board now"
                    console.log('[ActiveTrip] 🚌 Bus approaching! Triggering haptic feedback');
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }

                // ARRIVAL IMMINENT NOTIFICATION
                // Trigger when bus is <=500m OR ETA<=2min (whichever first), user at stop, not boarded, not already notified
                const vehicleSpeed = (closestBus.speed || 30) / 3.6; // m/s
                const etaMinutes = Math.ceil(distMeters / vehicleSpeed / 60);

                if (!arrivalNotified && hasReachedStop && !hasBoarded) {
                    if (distMeters <= ARRIVAL_NOTIFICATION_DISTANCE || etaMinutes <= ARRIVAL_NOTIFICATION_ETA) {
                        console.log(`[ActiveTrip] 🔔 Sending arrival notification: ${etaMinutes}min, ${distMeters.toFixed(0)}m`);
                        NotificationService.sendArrivalImminent(routeNo, etaMinutes);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        setArrivalNotified(true);
                    }
                }

                // DELAY NOTIFICATION
                // Compare estimated arrival to original scheduled time (3+ min delay)
                if (originalScheduledTime && !hasBoarded) {
                    const now = Date.now();
                    const currentEstimatedArrival = new Date(now + etaMinutes * 60 * 1000);
                    const delayMs = currentEstimatedArrival.getTime() - originalScheduledTime.getTime();
                    const delayMinutes = Math.round(delayMs / 60000);

                    if (delayMinutes >= DELAY_NOTIFICATION_THRESHOLD && delayNotified !== delayMinutes) {
                        console.log(`[ActiveTrip] 🔔 Sending delay notification: ${delayMinutes}min delay`);
                        NotificationService.sendDelayNotification(
                            routeNo,
                            delayMinutes,
                            originalScheduledTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                            currentEstimatedArrival.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                        );
                        setDelayNotified(delayMinutes);
                    }
                }

                prevShowBoardNow.current = isBoardNow;
                setShowBoardNow(isBoardNow);
                setVehiclePosition(closestBus);
            } else if (positions.length > 0) {
                // If no target stop yet, just use first bus
                setVehiclePosition(positions[0]);
            }
        } catch (error) {
            console.error('[ActiveTrip] Error updating vehicle:', error);
        }
    };

    const stopTrip = () => {
        if (locationSubscription.current) {
            locationSubscription.current.remove();
        }
        if (vehicleInterval.current) {
            clearInterval(vehicleInterval.current);
        }
    };

    const handleEndTrip = () => {
        stopTrip();
        router.back();
    };

    const updateTripState = (location: Location.LocationObject) => {
        if (!targetStop) return;

        const dist = calculateDistance(
            location.coords.latitude,
            location.coords.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        // Check if user has reached the stop
        const isAtStop = dist < AT_STOP_THRESHOLD;

        if (isAtStop && !prevHasReachedStop.current) {
            // User just arrived at the stop - haptic feedback
            console.log('[ActiveTrip] 📍 User reached the stop! Triggering haptic feedback');
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setHasReachedStop(true);
        }
        prevHasReachedStop.current = isAtStop;

        // Set instruction based on state
        if (showBoardNow) {
            setInstruction({
                type: 'board',
                message: `🚌 BOARD NOW - Bus ${routeNo}`,
                distance: busDistanceToStop || 0
            });
        } else if (isAtStop) {
            setInstruction({
                type: 'board',
                message: `Wait for ${routeNo}`,
                distance: busDistanceToStop || undefined
            });
        } else {
            setInstruction({
                type: 'walk',
                message: `Walk to ${targetStop.stopName}`,
                distance: Math.round(dist)
            });
        }

        // Approx ETA (assuming 4.8 km/h or 80 m/min)
        setEta(Math.ceil(dist / 80));
    };

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    };

    // ... 

    if (!userLocation || !targetStop) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Starting trip...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Map */}
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={{
                    latitude: userLocation.coords.latitude,
                    longitude: userLocation.coords.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }}
                showsUserLocation
                followsUserLocation={false} // Disable auto-follow so we can control zoom
            >
                {/* DEBUG: Log all polyline rendering conditions */}
                {(() => {
                    console.log(`\n========== [ActiveTrip] POLYLINE RENDER STATUS ==========`);
                    console.log(`[CONDITION CHECK]`);
                    console.log(`  - userLocation: ${userLocation ? 'present' : 'null'}`);
                    console.log(`  - targetStop: ${targetStop ? targetStop.stopName : 'null'}`);
                    console.log(`  - routeShape.length: ${routeShape.length}`);
                    console.log(`  - routeStops.length: ${routeStops.length}`);
                    console.log(`  - vehiclePosition: ${vehiclePosition ? `(${vehiclePosition.latitude.toFixed(5)}, ${vehiclePosition.longitude.toFixed(5)})` : 'null'}`);
                    console.log(`  - walkingRoute: ${walkingRoute ? `${walkingRoute.coordinates.length} coords` : 'null'}`);
                    console.log(`[EXPECTED POLYLINES]`);
                    console.log(`  - Walking path: ${walkingRoute ? '✅ SHOULD RENDER' : '❌ CONDITIONS NOT MET'}`);
                    console.log(`  - Main route (BLUE): ${(routeShape.length > 0 && targetStop && routeStops.length > 0) ? '✅ SHOULD RENDER' : '❌ CONDITIONS NOT MET'}`);
                    console.log(`  - Approach path (FAINT): ${(routeShape.length > 0 && targetStop && vehiclePosition) ? '✅ SHOULD RENDER' : '❌ CONDITIONS NOT MET'}`);
                    console.log(`============================================================\n`);
                    return null;
                })()}

                {/* Target Stop Marker (Boarding Stop - highlighted) */}
                <Marker
                    coordinate={{
                        latitude: targetStop.latitude,
                        longitude: targetStop.longitude,
                    }}
                    title={targetStop.stopName}
                    description={`Stop #${targetStop.stopNo}`}
                    zIndex={10}
                >
                    <View style={styles.stopMarker}>
                        <Ionicons name="location" size={32} color="#FF6B6B" />
                    </View>
                </Marker>

                {/* All Route Stops */}
                {/* Stops Indicators - Small White Dots */}
                {routeStops.map((stop, index) => {
                    // Skip if it's the target stop (handled separately with big marker)
                    if (stop.stopId === targetStop.stopId) return null;

                    // Calculate if stop is passed (simple index check relative to target)
                    // This is an approximation; ideally we check against bus position
                    const isPassed = false; // TODO: Implement robust passed check

                    return (
                        <Marker
                            key={`stop-${stop.stopId}`}
                            coordinate={{
                                latitude: stop.latitude,
                                longitude: stop.longitude,
                            }}
                            title={stop.stopName}
                            description={`Stop #${stop.stopNo}`}
                            anchor={{ x: 0.5, y: 0.5 }}
                            zIndex={5}
                        >
                            <View style={[
                                styles.routeStopDot,
                                isPassed && styles.passedStopDot
                            ]} />
                        </Marker>
                    );
                })}

                {/* Vehicle Marker with ETA Badge */}
                {vehiclePosition && (
                    <Marker
                        coordinate={{
                            latitude: vehiclePosition.latitude,
                            longitude: vehiclePosition.longitude,
                        }}
                        title={`Route ${routeNo}`}
                        rotation={vehiclePosition.bearing || 0}
                        zIndex={100}
                    >
                        <View style={styles.vehicleContainer}>
                            {eta !== null && (
                                <View style={styles.etaBadge}>
                                    <Text style={styles.etaText}>{eta < 1 ? '<1m' : `${eta}m`}</Text>
                                </View>
                            )}
                            <View style={styles.vehicleMarker}>
                                <Ionicons name="bus" size={20} color="#fff" />
                            </View>
                        </View>
                    </Marker>
                )}

                {/* User's Future Path (Boarding -> Destination) - Only show AFTER boarding */}
                {hasBoarded && routeShape.length > 0 && targetStop && routeStops.length > 0 && (() => {
                    console.log(`[ActiveTrip] 🛣️ MAIN ROUTE PATH (Boarding -> End):`);

                    // Log the shape info
                    console.log(`  - Route shape total points: ${routeShape.length}`);
                    console.log(`  - Route shape start: (${routeShape[0]?.lat.toFixed(5)}, ${routeShape[0]?.lon.toFixed(5)})`);
                    console.log(`  - Route shape end: (${routeShape[routeShape.length - 1]?.lat.toFixed(5)}, ${routeShape[routeShape.length - 1]?.lon.toFixed(5)})`);

                    // Reuse logic to find start index
                    let closestIndex = 0;
                    let closestDist = Infinity;
                    for (let i = 0; i < routeShape.length; i++) {
                        const dist = Math.pow(routeShape[i].lat - targetStop.latitude, 2) +
                            Math.pow(routeShape[i].lon - targetStop.longitude, 2);
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestIndex = i;
                        }
                    }

                    console.log(`  - Target stop: ${targetStop.stopName} (${targetStop.latitude.toFixed(5)}, ${targetStop.longitude.toFixed(5)})`);
                    console.log(`  - Closest shape index to stop: ${closestIndex}`);
                    console.log(`  - Shape point at closest: (${routeShape[closestIndex]?.lat.toFixed(5)}, ${routeShape[closestIndex]?.lon.toFixed(5)})`);

                    // Determine segment based on boarding stop
                    // For simplicity in this demo, showing from boarding stop to end
                    let routeSegment = routeShape.slice(closestIndex);
                    console.log(`  - Initial segment points: ${routeSegment.length} (from ${closestIndex} to end)`);

                    // FALLBACK: If segment is too short (boarding stop near end), show full route
                    if (routeSegment.length < 2) {
                        console.log(`  ⚠️ Segment too short, using full route as fallback`);
                        routeSegment = routeShape;
                    }

                    if (routeSegment.length < 2) {
                        console.log(`  ❌ Still too short, not rendering main route`);
                        return null;
                    }

                    // Log bounding box
                    const coords = routeSegment.map(p => ({ latitude: p.lat, longitude: p.lon }));
                    const lats = coords.map(c => c.latitude);
                    const lons = coords.map(c => c.longitude);
                    console.log(`  - Segment start: (${coords[0].latitude.toFixed(5)}, ${coords[0].longitude.toFixed(5)})`);
                    console.log(`  - Segment end: (${coords[coords.length - 1].latitude.toFixed(5)}, ${coords[coords.length - 1].longitude.toFixed(5)})`);
                    console.log(`  - Bounding box: lat(${Math.min(...lats).toFixed(4)} to ${Math.max(...lats).toFixed(4)}), lon(${Math.min(...lons).toFixed(4)} to ${Math.max(...lons).toFixed(4)})`);

                    console.log(`  ✅ Rendering main route polyline with ${routeSegment.length} points`);

                    return (
                        <Polyline
                            coordinates={coords}
                            strokeColor="#0066CC"
                            strokeWidth={12}
                            lineCap="round"
                            lineJoin="round"
                            zIndex={20}
                        />
                    );
                })()}

                {/* Approach Path (Bus -> Boarding) - Faint/Clear */}
                {routeShape.length > 0 && targetStop && vehiclePosition && (() => {
                    console.log(`[ActiveTrip] 🚌 APPROACH PATH (Bus -> Stop):`);
                    console.log(`  - Vehicle position: (${vehiclePosition.latitude.toFixed(5)}, ${vehiclePosition.longitude.toFixed(5)})`);

                    // Calculate bus distance to stop
                    const R = 6371000;
                    const dLat = (targetStop.latitude - vehiclePosition.latitude) * Math.PI / 180;
                    const dLon = (targetStop.longitude - vehiclePosition.longitude) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(vehiclePosition.latitude * Math.PI / 180) * Math.cos(targetStop.latitude * Math.PI / 180) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const busDistMeters = R * c;

                    console.log(`  - Bus distance to stop: ${busDistMeters.toFixed(0)}m`);

                    // Find closest point in route shape to the TARGET STOP
                    let stopShapeIndex = 0;
                    let stopClosestDist = Infinity;
                    for (let i = 0; i < routeShape.length; i++) {
                        const dist = Math.pow(routeShape[i].lat - targetStop.latitude, 2) +
                            Math.pow(routeShape[i].lon - targetStop.longitude, 2);
                        if (dist < stopClosestDist) {
                            stopClosestDist = dist;
                            stopShapeIndex = i;
                        }
                    }

                    // Find closest point in route shape to the BUS
                    let busShapeIndex = 0;
                    let busClosestDist = Infinity;
                    for (let i = 0; i < routeShape.length; i++) {
                        const dist = Math.pow(routeShape[i].lat - vehiclePosition.latitude, 2) +
                            Math.pow(routeShape[i].lon - vehiclePosition.longitude, 2);
                        if (dist < busClosestDist) {
                            busClosestDist = dist;
                            busShapeIndex = i;
                        }
                    }

                    console.log(`  - Stop shape index: ${stopShapeIndex}`);
                    console.log(`  - Bus shape index: ${busShapeIndex}`);

                    // Handle BOTH directions - slice from bus to stop, reversing if needed
                    let routeSegment: typeof routeShape;
                    if (busShapeIndex <= stopShapeIndex) {
                        routeSegment = routeShape.slice(busShapeIndex, stopShapeIndex + 1);
                        console.log(`  - Direction: normal (bus before stop)`);
                    } else {
                        routeSegment = routeShape.slice(stopShapeIndex, busShapeIndex + 1).reverse();
                        console.log(`  - Direction: reversed (bus after stop in shape)`);
                    }

                    console.log(`  - Route segment points: ${routeSegment.length}`);

                    // Prepend actual bus position
                    const segmentCoords = [
                        { latitude: vehiclePosition.latitude, longitude: vehiclePosition.longitude },
                        ...routeSegment.map(p => ({ latitude: p.lat, longitude: p.lon })),
                        { latitude: targetStop.latitude, longitude: targetStop.longitude }
                    ];

                    if (segmentCoords.length < 2) {
                        console.log(`  ❌ Segment too short, not rendering`);
                        return null;
                    }

                    console.log(`  ✅ Rendering approach polyline with ${segmentCoords.length} coords`);

                    return (
                        <Polyline
                            coordinates={segmentCoords}
                            strokeColor="#0066CC"
                            strokeWidth={8}
                            lineCap="round"
                            lineJoin="round"
                            zIndex={20}
                        />
                    );
                })()}

                {/* Walking path from user to stop (dashed) - uses real walking route if available */}
                <Polyline
                    coordinates={walkingRoute?.coordinates || [
                        {
                            latitude: userLocation.coords.latitude,
                            longitude: userLocation.coords.longitude,
                        },
                        {
                            latitude: targetStop.latitude,
                            longitude: targetStop.longitude,
                        },
                    ]}
                    strokeColor="#4CAF50"
                    strokeWidth={walkingRoute?.isActualRoute ? 5 : 4}
                    lineDashPattern={[8, 6]}
                    lineCap="round"
                    geodesic={true}
                    zIndex={25}
                />
            </MapView>

            {/* Trip Info Bottom Sheet */}
            <DraggableBottomSheet
                header={
                    <View style={styles.sheetHandle}>
                        <View style={styles.sheetHandle} />

                        {/* Route Info & Controls */}
                        <View style={styles.headerTopRow}>
                            <View style={styles.routeHeader}>
                                <View style={styles.routeBadge}>
                                    <Text style={styles.routeBadgeText}>{routeNo}</Text>
                                </View>
                                <Text style={styles.routeNameText} numberOfLines={1}>{routeName}</Text>
                            </View>
                            <TouchableOpacity style={styles.endTripButton} onPress={handleEndTrip}>
                                <Text style={styles.endTripText}>End</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Primary Instruction Banner */}
                        {instruction && (
                            <View style={[styles.instructionCard, showBoardNow && styles.boardNowCard]}>
                                <Ionicons
                                    name={
                                        instruction.type === 'walk' ? 'walk' :
                                            instruction.type === 'board' ? 'enter' :
                                                instruction.type === 'onboard' ? 'checkmark-circle' :
                                                    'exit'
                                    }
                                    size={32}
                                    color={showBoardNow ? '#fff' : '#0066CC'}
                                />
                                <View style={styles.instructionText}>
                                    <Text style={[styles.instructionMessage, showBoardNow && styles.boardNowText]}>
                                        {instruction.message}
                                    </Text>
                                    {instruction.distance && (
                                        <Text style={[styles.instructionDistance, showBoardNow && styles.boardNowText]}>
                                            {instruction.distance}m away
                                        </Text>
                                    )}
                                </View>
                                {eta !== null && !hasBoarded && (
                                    <View style={styles.miniEta}>
                                        <Text style={[styles.miniEtaValue, showBoardNow && styles.boardNowText]}>{eta}</Text>
                                        <Text style={[styles.miniEtaLabel, showBoardNow && styles.boardNowText]}>min</Text>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Horizontal Schedule Display */}
                        {scheduledTimes.length > 0 && !hasBoarded && (
                            <View style={styles.scheduleContainer}>
                                <Text style={styles.scheduleLabel}>Upcoming</Text>
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.scheduleScroll}
                                >
                                    {scheduledTimes.map((time, idx) => (
                                        <View
                                            key={`time-${idx}`}
                                            style={[
                                                styles.scheduleChip,
                                                idx === 0 && styles.scheduleChipFirst
                                            ]}
                                        >
                                            <Text style={[
                                                styles.scheduleChipText,
                                                idx === 0 && styles.scheduleChipTextFirst
                                            ]}>{time}</Text>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

                        {/* Boarding Actions */}
                        {hasReachedStop && !hasBoarded && (
                            <TouchableOpacity
                                style={styles.boardedButton}
                                onPress={() => {
                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                    setHasBoarded(true);
                                }}
                            >
                                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                                <Text style={styles.boardedButtonText}>I've Boarded</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                }
            >
                {/* Scrollable Stops List */}
                <ScrollView style={styles.stopsListContainer}>
                    <Text style={styles.sectionTitle}>Stops</Text>
                    {
                        routeStops.map((stop, index) => {
                            const isTarget = stop.stopId === targetStop?.stopId;

                            return (
                                <View key={`${stop.stopId}-${index}`} style={[styles.stopItem, isTarget && styles.targetStopItem]}>
                                    <View style={styles.stopTimeline}>
                                        <View style={[styles.timelineLine, { opacity: index === routeStops.length - 1 ? 0 : 1 }]} />
                                        <View style={[
                                            styles.timelineDot,
                                            isTarget && styles.targetTimelineDot
                                        ]} />
                                    </View>
                                    <View style={styles.stopContent}>
                                        <Text style={[styles.stopNameText, isTarget && styles.targetStopName]}>{stop.stopName}</Text>
                                        <Text style={styles.stopIdText}>#{stop.stopNo} {isTarget && !hasBoarded && '• Board Here'}</Text>
                                        {isTarget && hasBoarded && <Text style={styles.targetLabel}>My Destination</Text>}
                                    </View>
                                </View>
                            );
                        })
                    }
                    <View style={{ height: 40 }} />
                </ScrollView >
            </DraggableBottomSheet >
        </View >
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    loadingText: {
        fontSize: 18,
        color: '#666',
    },
    map: {
        flex: 1,
    },
    stopMarker: {
        alignItems: 'center',
    },
    vehicleContainer: {
        alignItems: 'center',
    },
    etaBadge: {
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
    etaText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '700',
    },
    vehicleMarker: {
        backgroundColor: '#0066CC',
        borderRadius: 20,
        padding: 6,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    routeStopDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: 'white',
        borderWidth: 1.5,
        borderColor: '#0066CC',
        shadowColor: 'black',
        shadowOpacity: 0.2,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
    },
    passedStopDot: {
        backgroundColor: '#ccc',
        borderColor: '#999',
        opacity: 0.6,
    },
    terminalStopDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
    },
    bottomSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 10,
    },
    sheetHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#ddd',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 16,
    },
    routeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 12,
    },
    routeBadge: {
        backgroundColor: '#0066CC',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginRight: 12,
    },
    routeBadgeText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '700',
    },
    routeNameText: {
        fontSize: 16,
        color: '#666',
        flex: 1,
    },
    instructionCard: {
        flexDirection: 'row',
        backgroundColor: '#E6F2FF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        alignItems: 'center',
    },
    instructionText: {
        flex: 1,
        marginLeft: 12,
    },
    instructionMessage: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    instructionDistance: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    etaCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    etaLabel: {
        fontSize: 14,
        color: '#666',
    },
    etaValue: {
        fontSize: 24,
        fontWeight: '700',
        color: '#0066CC',
    },
    endTripButton: {
        backgroundColor: '#FF6B6B',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignItems: 'center',
    },
    endTripText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginBottom: 12,
    },
    stopsListContainer: {
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 16,
        color: '#333',
    },
    stopItem: {
        flexDirection: 'row',
        height: 60,
    },
    targetStopItem: {
        height: 80,
    },
    stopTimeline: {
        width: 30,
        alignItems: 'center',
        marginRight: 10,
    },
    timelineLine: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 2,
        backgroundColor: '#E0E0E0',
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
        zIndex: 1,
    },
    targetTimelineDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#0066CC', // Highlight color
        borderColor: '#fff',
        top: 22, // Adjust for larger size
    },
    stopContent: {
        flex: 1,
        justifyContent: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    stopNameText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    stopIdText: {
        fontSize: 12,
        color: '#999',
        marginTop: 2,
    },
    targetStopName: {
        fontSize: 18, // Larger
        fontWeight: '700',
        color: '#000',
    },
    targetLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#00C853',
        marginTop: 4,
    },
    boardNowCard: {
        backgroundColor: '#FF6B6B',
    },
    miniEta: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingLeft: 12,
        borderLeftWidth: 1,
        borderLeftColor: 'rgba(0,0,0,0.1)',
        marginLeft: 8,
    },
    miniEtaValue: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0066CC',
    },
    miniEtaLabel: {
        fontSize: 10,
        color: '#666',
    },
    busDistanceCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e3f2fd',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        gap: 8,
    },
    busDistanceText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0066CC',
    },
    boardNowAlert: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FF6B6B',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        gap: 8,
        justifyContent: 'center',
    },
    boardNowText: {
        fontSize: 18,
        fontWeight: '700',
        color: '#fff',
    },
    boardedButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#00C853',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        gap: 8,
        justifyContent: 'center',
    },
    boardedButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
    },
    onBoardStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#e8f5e9',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        gap: 8,
        justifyContent: 'center',
    },
    onBoardText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#00C853',
    },
    // Horizontal Schedule Styles
    scheduleContainer: {
        marginTop: 12,
        marginBottom: 8,
    },
    scheduleLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#666',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    scheduleScroll: {
        paddingRight: 16,
    },
    scheduleChip: {
        backgroundColor: '#f0f0f0',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 16,
        marginRight: 8,
    },
    scheduleChipFirst: {
        backgroundColor: '#0066CC',
    },
    scheduleChipText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    scheduleChipTextFirst: {
        color: '#fff',
    },
});
