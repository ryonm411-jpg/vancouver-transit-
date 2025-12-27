import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, AppState, AppStateStatus } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import TripTrackingService, { TripInstruction } from '../src/services/TripTrackingService';
import TransLinkService, { VehiclePosition, TransitStop } from '../src/services/TransLinkService';
import WalkingRouteService, { WalkingRoute } from '../src/services/WalkingRouteService';
import { RouteShape } from '../src/data/routeShapes';

// Debug logging toggle
const DEBUG_LOGGING = __DEV__;

// Distance threshold for "Board now" alert (meters)
const BUS_APPROACHING_THRESHOLD = 50;
// Distance threshold for considering user has reached the stop (meters)
const AT_STOP_THRESHOLD = 30;

export default function ActiveTripScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const mapRef = useRef<MapView>(null);

    const routeId = params.routeId as string;
    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;
    const stopId = params.stopId as string;

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
    const lastWalkingRouteLocation = useRef<{ lat: number; lon: number } | null>(null);

    // Refs for previous state (to detect transitions for haptics)
    const prevShowBoardNow = useRef(false);
    const prevHasReachedStop = useRef(false);

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
            console.log(`[ActiveTrip] Target coordinates: (${targetStop.latitude}, ${targetStop.longitude})`);

            WalkingRouteService.getWalkingRoute(
                userLat,
                userLon,
                targetStop.latitude,
                targetStop.longitude,
                stopId
            ).then(route => {
                setWalkingRoute(route);
                console.log(`[ActiveTrip] Walking route received: ${route.distanceMeters}m, ${route.coordinates.length} points`);
                if (route.coordinates.length > 0) {
                    const lastPoint = route.coordinates[route.coordinates.length - 1];
                    console.log(`[ActiveTrip] Route endpoint: (${lastPoint.latitude}, ${lastPoint.longitude})`);
                }
            }).catch(err => {
                console.warn('[ActiveTrip] Walking route error:', err);
            });
        }
    }, [userLocation, targetStop, stopId, hasBoarded]);

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
            // Try direction 0 first
            let stops = await TransLinkService.getStaticStopsForRoute(routeId, '0');
            let shape = await TransLinkService.getStaticRouteShape(routeId, '0');

            // Check if boarding stop is in direction 0
            let foundStop = stops.find(s =>
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
            }

            setTargetStop(stop || stops[0]);
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
                {routeStops.map((stop, index) => {
                    // Skip the target/boarding stop (already shown above)
                    if (stop.stopId === targetStop.stopId) return null;

                    // Show every 5th stop, plus first and last
                    if (index !== 0 && index !== routeStops.length - 1 && index % 5 !== 0) return null;

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
                        >
                            <View style={[
                                styles.routeStopDot,
                                (index === 0 || index === routeStops.length - 1) && styles.terminalStopDot
                            ]} />
                        </Marker>
                    );
                })}

                {/* Vehicle Marker */}
                {vehiclePosition && (
                    <Marker
                        coordinate={{
                            latitude: vehiclePosition.latitude,
                            longitude: vehiclePosition.longitude,
                        }}
                        title={`Route ${routeNo}`}
                        rotation={vehiclePosition.bearing || 0}
                    >
                        <View style={styles.vehicleMarker}>
                            <Ionicons name="bus" size={24} color="#fff" />
                            <Text style={styles.vehicleNumber}>{routeNo}</Text>
                        </View>
                    </Marker>
                )}

                {/* Bus Route Polyline - only show from boarding stop onwards */}
                {routeShape.length > 0 && targetStop && routeStops.length > 0 && (() => {
                    // Find the closest point in route shape to boarding stop
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

                    // Determine route direction by finding where the boarding stop is in the stops list
                    // Check both stopId and stopNo for reliable matching
                    const boardingStopIndex = routeStops.findIndex(s =>
                        String(s.stopId) === String(stopId) ||
                        String(s.stopNo) === String(stopId)
                    );
                    const totalStops = routeStops.length;

                    // If user is boarding near the START of the route, show from closestIndex onwards
                    // If user is boarding near the END of the route, show from 0 to closestIndex
                    let routeSegment;
                    if (boardingStopIndex === -1) {
                        // Stop not found - determine direction by distance to route endpoints
                        const distToStart = Math.pow(routeShape[0].lat - targetStop.latitude, 2) +
                            Math.pow(routeShape[0].lon - targetStop.longitude, 2);
                        const distToEnd = Math.pow(routeShape[routeShape.length - 1].lat - targetStop.latitude, 2) +
                            Math.pow(routeShape[routeShape.length - 1].lon - targetStop.longitude, 2);

                        if (distToStart < distToEnd) {
                            routeSegment = routeShape.slice(closestIndex);
                        } else {
                            routeSegment = routeShape.slice(0, closestIndex + 1);
                        }
                        if (DEBUG_LOGGING) console.log(`[ActiveTrip] Bus route: stop not in list, showing ${routeSegment.length} points`);
                    } else if (boardingStopIndex < totalStops / 2) {
                        // Boarding early in route - show from boarding stop to end
                        routeSegment = routeShape.slice(closestIndex);
                        if (DEBUG_LOGGING) console.log(`[ActiveTrip] Bus route: boarding at stop ${boardingStopIndex + 1}/${totalStops}, showing ${routeSegment.length} points`);
                    } else {
                        // Boarding late in route - show from start to boarding stop
                        routeSegment = routeShape.slice(0, closestIndex + 1);
                        if (DEBUG_LOGGING) console.log(`[ActiveTrip] Bus route: boarding at stop ${boardingStopIndex + 1}/${totalStops}, showing ${routeSegment.length} points`);
                    }

                    if (routeSegment.length < 2) return null;

                    return (
                        <Polyline
                            coordinates={routeSegment.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                            strokeColor="#0066CC"
                            strokeWidth={5}
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
                    strokeColor="#333" // Dark gray dashed
                    strokeWidth={walkingRoute?.isActualRoute ? 4 : 3}
                    lineDashPattern={[10, 5]}
                    geodesic={true}
                />
            </MapView>

            {/* Trip Info Bottom Sheet */}
            <View style={styles.bottomSheet}>
                <View style={styles.sheetHandle} />

                {/* Route Info */}
                <View style={styles.routeHeader}>
                    <View style={styles.routeBadge}>
                        <Text style={styles.routeBadgeText}>{routeNo}</Text>
                    </View>
                    <Text style={styles.routeNameText}>{routeName}</Text>
                </View>

                {/* Instruction */}
                {instruction && (
                    <View style={styles.instructionCard}>
                        <Ionicons
                            name={
                                instruction.type === 'walk' ? 'walk' :
                                    instruction.type === 'board' ? 'enter' :
                                        instruction.type === 'onboard' ? 'checkmark-circle' :
                                            'exit'
                            }
                            size={32}
                            color="#0066CC"
                        />
                        <View style={styles.instructionText}>
                            <Text style={styles.instructionMessage}>{instruction.message}</Text>
                            {instruction.distance && (
                                <Text style={styles.instructionDistance}>
                                    {instruction.distance}m away
                                </Text>
                            )}
                        </View>
                    </View>
                )}

                {/* ETA */}
                {eta !== null && !hasBoarded && (
                    <View style={styles.etaCard}>
                        <Text style={styles.etaLabel}>Estimated Arrival</Text>
                        <Text style={styles.etaValue}>{eta} min</Text>
                    </View>
                )}

                {/* Bus Distance Info */}
                {busDistanceToStop !== null && hasReachedStop && !hasBoarded && (
                    <View style={styles.busDistanceCard}>
                        <Ionicons name="bus" size={20} color="#0066CC" />
                        <Text style={styles.busDistanceText}>
                            Bus {busDistanceToStop}m away
                        </Text>
                    </View>
                )}

                {/* Board Now Alert */}
                {showBoardNow && (
                    <View style={styles.boardNowAlert}>
                        <Ionicons name="alert-circle" size={24} color="#fff" />
                        <Text style={styles.boardNowText}>🚌 BOARD NOW!</Text>
                    </View>
                )}

                {/* I've Boarded Button */}
                {hasReachedStop && !hasBoarded && (
                    <TouchableOpacity
                        style={styles.boardedButton}
                        onPress={() => {
                            console.log('[ActiveTrip] 🎫 User marked as boarded');
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            setHasBoarded(true);
                        }}
                    >
                        <Ionicons name="checkmark-circle" size={24} color="#fff" />
                        <Text style={styles.boardedButtonText}>I've Boarded</Text>
                    </TouchableOpacity>
                )}

                {/* On Board Status */}
                {hasBoarded && (
                    <View style={styles.onBoardStatus}>
                        <Ionicons name="checkmark-circle" size={24} color="#00C853" />
                        <Text style={styles.onBoardText}>On Board - Enjoy your ride!</Text>
                    </View>
                )}

                {/* End Trip Button */}
                <TouchableOpacity style={styles.endTripButton} onPress={handleEndTrip}>
                    <Text style={styles.endTripText}>End Trip</Text>
                </TouchableOpacity>
            </View>
        </View>
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
    vehicleMarker: {
        backgroundColor: '#0066CC',
        borderRadius: 20,
        padding: 8,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    vehicleNumber: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '700',
        marginTop: 2,
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
        marginBottom: 16,
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
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
    },
    endTripText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    routeStopDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#0066CC',
    },
    terminalStopDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 3,
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
});
