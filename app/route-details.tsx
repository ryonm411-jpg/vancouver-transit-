import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Dimensions, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import TransLinkService, { TransitStop, VehiclePosition } from '../src/services/TransLinkService';
import WalkingRouteService, { WalkingRoute } from '../src/services/WalkingRouteService';
import { RouteShape } from '../src/data/routeShapes';
import RoutineService from '../src/services/RoutineService';
import DayPickerModal from '../src/components/DayPickerModal';

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
    const [showDayPicker, setShowDayPicker] = useState(false);
    const vehicleInterval = useRef<NodeJS.Timeout | null>(null);
    const lastUserLocation = useRef<{ lat: number; lon: number } | null>(null);

    // Route params
    const routeId = params.routeId as string;
    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;
    const userLat = params.userLat ? parseFloat(params.userLat as string) : null;
    const userLon = params.userLon ? parseFloat(params.userLon as string) : null;
    const boardingStopId = params.boardingStopId as string;

    const userId = 'demo-user'; // Placeholder

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
                    console.log(`[RouteDetails] Using direction 1 (found stop ${boardingStopId})`);
                } else {
                    console.warn(`[RouteDetails] Stop ${boardingStopId} not found in either direction!`);
                }
            } else {
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
        // Try to find in loaded stops
        let stop = stops.find(s => s.stopId === boardingStopId);

        // If not found in route stops (e.g. variant), fetch it directly
        if (!stop && boardingStopId) {
            const manualStop = require('../src/data/stops').getStopById(boardingStopId);
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
        if (stop) {
            console.log(`[RouteDetails] Found target stop: ${stop.stopName} (${stop.stopId})`);
        } else {
            console.log(`[RouteDetails] Target stop not found for ID: ${boardingStopId}. Fallback to ${stops[0]?.stopId}`);
        }
        setTargetStop(stop || stops[0] || null);
    }, [stops, boardingStopId]);

    // Real-time vehicle tracking
    useEffect(() => {
        if (!routeId) return;

        const fetchVehicles = async () => {
            try {
                const positions = await TransLinkService.getRealtimeVehiclePositions(routeId);
                console.log(`[RouteDetails] Got ${positions.length} vehicles for route ${routeNo}`);
                setVehiclePositions(positions);
            } catch (error) {
                console.error('[RouteDetails] Error fetching vehicles:', error);
            }
        };

        // Initial fetch
        fetchVehicles();

        // Set up 10-second refresh
        vehicleInterval.current = setInterval(fetchVehicles, 10000);

        // Cleanup on unmount
        return () => {
            if (vehicleInterval.current) {
                clearInterval(vehicleInterval.current);
            }
        };
    }, [routeId]);

    // Walking route fetching
    useEffect(() => {
        console.log(`[RouteDetails] Walking route effect - userLat=${userLat}, userLon=${userLon}, targetStop=${targetStop?.stopName}, boardingStopId=${boardingStopId}`);

        if (!userLat || !userLon || !targetStop || !boardingStopId) {
            console.log('[RouteDetails] Walking route: missing required params');
            return;
        }

        // Check if user has moved significantly (>25m)
        const hasMovedEnough = () => {
            if (!lastUserLocation.current) return true;
            const dLat = Math.abs(userLat - lastUserLocation.current.lat);
            const dLon = Math.abs(userLon - lastUserLocation.current.lon);
            const approxDistM = Math.sqrt(dLat * dLat + dLon * dLon) * 111000; // rough meters
            return approxDistM > 25;
        };

        if (hasMovedEnough()) {
            lastUserLocation.current = { lat: userLat, lon: userLon };
            console.log(`[RouteDetails] Fetching walking route to ${targetStop.stopName} (${targetStop.latitude}, ${targetStop.longitude})...`);

            // Fetch walking route (non-blocking)
            WalkingRouteService.getWalkingRoute(
                userLat,
                userLon,
                targetStop.latitude,
                targetStop.longitude,
                boardingStopId
            ).then(route => {
                setWalkingRoute(route);
                console.log(`[RouteDetails] Walking route received: ${route.distanceMeters}m, ${route.coordinates.length} points, actual=${route.isActualRoute}`);
            }).catch(err => {
                console.warn('[RouteDetails] Walking route error:', err);
                // Keep previous route or null (straight line fallback in render)
            });
        } else {
            console.log('[RouteDetails] Walking route: user has not moved enough');
        }
    }, [userLat, userLon, targetStop, boardingStopId]);
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
                userLat: userLat ? String(userLat) : '',
                userLon: userLon ? String(userLon) : ''
            }
        });
    };

    useEffect(() => {
        console.log('[RouteDetails] Zoom Effect Triggered. Refs:', {
            hasMap: !!mapRef.current,
            hasTarget: !!targetStop,
            userLat,
            userLon
        });

        if (mapRef.current && targetStop && userLat && userLon) {
            console.log('[RouteDetails] EXECUTING Zoom to walking segment');
            mapRef.current.fitToCoordinates([
                { latitude: userLat, longitude: userLon },
                { latitude: targetStop.latitude, longitude: targetStop.longitude }
            ], {
                edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
                animated: true
            });
        }
    }, [targetStop, userLat, userLon]);

    return (
        <View style={styles.container}>
            {/* Map Section (Top) */}
            <View style={styles.mapContainer}>
                <MapView
                    ref={mapRef}
                    style={styles.map}
                    provider={PROVIDER_GOOGLE}
                    initialRegion={{
                        latitude: 49.2827,
                        longitude: -123.1207,
                        latitudeDelta: 0.1,
                        longitudeDelta: 0.1,
                    }}
                >
                    {/* Walking Path (Dashed Line) - Uses real route or straight line fallback */}
                    {(() => {
                        if (userLat && userLon && targetStop) {
                            // Use walking route if available, otherwise straight line fallback
                            const coordinates = walkingRoute?.coordinates || [
                                { latitude: userLat, longitude: userLon },
                                { latitude: targetStop.latitude, longitude: targetStop.longitude }
                            ];

                            console.log(`[RouteDetails] Polyline: ${coordinates.length} points, isActual=${walkingRoute?.isActualRoute ?? false}`);

                            return (
                                <Polyline
                                    coordinates={coordinates}
                                    strokeColor="#333" // Dark gray
                                    strokeWidth={walkingRoute?.isActualRoute ? 4 : 3}
                                    lineDashPattern={[10, 5]} // Dashed
                                    zIndex={100}
                                    geodesic={true}
                                />
                            );
                        }
                        return null;
                    })()}

                    {/* User Location Marker */}
                    {userLat && userLon && (
                        <Marker
                            coordinate={{ latitude: userLat, longitude: userLon }}
                            title="You"
                            zIndex={999}
                        >
                            <View style={styles.userMarker}>
                                <View style={styles.userMarkerDot} />
                            </View>
                        </Marker>
                    )}

                    {/* Route Polyline - only show from boarding stop onwards */}
                    {routeShape.length > 0 && targetStop && stops.length > 0 && (() => {
                        // Find the closest point in route shape to the boarding stop
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
                        console.log(`[RouteDetails] Looking for boardingStopId=${boardingStopId} in ${stops.length} stops`);
                        if (stops.length > 0) {
                            console.log(`[RouteDetails] First stop sample: id=${stops[0].stopId}, no=${stops[0].stopNo}`);
                        }
                        const boardingStopIndex = stops.findIndex(s =>
                            String(s.stopId) === String(boardingStopId) ||
                            String(s.stopNo) === String(boardingStopId)
                        );
                        console.log(`[RouteDetails] boardingStopIndex=${boardingStopIndex}`);
                        const totalStops = stops.length;

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
                            console.log(`[RouteDetails] Bus route: stop not in list, showing ${routeSegment.length} points`);
                        } else if (boardingStopIndex < totalStops / 2) {
                            // Boarding early in route - show from boarding stop to end
                            routeSegment = routeShape.slice(closestIndex);
                            console.log(`[RouteDetails] Bus route: boarding at stop ${boardingStopIndex + 1}/${totalStops}, showing ${routeSegment.length} points`);
                        } else {
                            // Boarding late in route - show from start to boarding stop
                            routeSegment = routeShape.slice(0, closestIndex + 1);
                            console.log(`[RouteDetails] Bus route: boarding at stop ${boardingStopIndex + 1}/${totalStops}, showing ${routeSegment.length} points`);
                        }

                        if (routeSegment.length < 2) return null;

                        return (
                            <Polyline
                                coordinates={routeSegment.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                                strokeColor="#0066CC"
                                strokeWidth={4}
                            />
                        );
                    })()}

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

                    {/* Real-time Bus Markers */}
                    {vehiclePositions.map((vehicle, index) => (
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
                        >
                            <View style={styles.busMarker}>
                                <Ionicons name="bus" size={18} color="#fff" />
                            </View>
                        </Marker>
                    ))}
                </MapView>

                {/* Back Button Overlay */}
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
            </View>

            {/* Bottom Sheet Section */}
            <View style={styles.sheetContainer}>
                <View style={styles.sheetHeader}>
                    <View style={styles.dragHandle} />
                    <View style={styles.routeHeader}>
                        <View style={styles.routeBadge}>
                            <Ionicons name="bus" size={20} color="#fff" />
                            <Text style={styles.routeBadgeText}>{routeNo}</Text>
                        </View>
                        <View style={styles.routeInfo}>
                            <Text style={styles.routeName} numberOfLines={1}>{routeName}</Text>
                            <Text style={styles.routeSubtext}>{stops.length} stops • 28 min</Text>
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
                </View>

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
            </View>

            <DayPickerModal
                visible={showDayPicker}
                routeNo={routeNo}
                routeName={routeName}
                onSave={handleSaveRoutine}
                onClose={() => setShowDayPicker(false)}
            />
        </View>
    );
}



const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    mapContainer: {
        flex: 0.7, // Map takes 70% of screen
        position: 'relative',
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
});
