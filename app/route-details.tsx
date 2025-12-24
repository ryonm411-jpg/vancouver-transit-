import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Dimensions, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import TransLinkService, { TransitStop } from '../src/services/TransLinkService';
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
    const [loading, setLoading] = useState(true);
    const [showDayPicker, setShowDayPicker] = useState(false);

    // Route params
    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;
    const userLat = params.userLat ? parseFloat(params.userLat as string) : null;
    const userLon = params.userLon ? parseFloat(params.userLon as string) : null;
    const boardingStopId = params.boardingStopId as string;

    const userId = 'demo-user'; // Placeholder

    useEffect(() => {
        loadRouteData();
    }, [routeNo]);

    const loadRouteData = async () => {
        try {
            setLoading(true);
            console.log(`[RouteDetails] Loading data for route ${routeNo}`);

            // Load stops and shape in parallel
            const [fetchedStops, fetchedShape] = await Promise.all([
                TransLinkService.getStopsForRoute(routeNo),
                TransLinkService.getRouteShape(routeNo)
            ]);

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
                routeNo,
                routeName,
                stopId: targetStop?.stopNo || boardingStopId || stops[0].stopNo,
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
                    {/* Walking Path (Dashed Line) */}
                    {(() => {
                        if (userLat && userLon && targetStop) {
                            console.log(`[RouteDetails] Drawing walking path: (${userLat},${userLon}) -> (${targetStop.latitude},${targetStop.longitude})`);
                            return (
                                <Polyline
                                    coordinates={[
                                        { latitude: userLat, longitude: userLon },
                                        { latitude: targetStop.latitude, longitude: targetStop.longitude }
                                    ]}
                                    strokeColor="#000" // Black
                                    strokeWidth={3}
                                    lineDashPattern={[10, 5]} // Longer dashes
                                    zIndex={100} // Ensure on top
                                    geodesic={true}
                                />
                            );
                        } else {
                            // console.log('[RouteDetails] Cannot draw walking path:', { userLat, userLon, targetStop: targetStop?.stopName });
                            return null;
                        }
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

                    {/* Route Polyline */}
                    {routeShape.length > 0 && (
                        <Polyline
                            coordinates={routeShape.map(p => ({ latitude: p.lat, longitude: p.lon }))}
                            strokeColor="#0066CC"
                            strokeWidth={4}
                        />
                    )}

                    {/* Stops Markers */}
                    {stops.map((stop, index) => {
                        // Highlight boarding stop
                        const isBoardingStop = stop.stopId === boardingStopId;

                        // Show first, last, Every 5th, AND the boarding stop
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
});
