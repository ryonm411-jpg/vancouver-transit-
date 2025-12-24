import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import TripTrackingService, { TripInstruction } from '../src/services/TripTrackingService';
import TransLinkService, { VehiclePosition, TransitStop } from '../src/services/TransLinkService';

export default function ActiveTripScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const mapRef = useRef<MapView>(null);

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
    const [instruction, setInstruction] = useState<TripInstruction | null>(null);
    const [eta, setEta] = useState<number | null>(null);
    const [isTracking, setIsTracking] = useState(true);

    const locationSubscription = useRef<Location.LocationSubscription | null>(null);
    const vehicleInterval = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        startTrip();
        return () => {
            stopTrip();
        };
    }, []);

    // Zoom effect
    useEffect(() => {
        if (mapRef.current && userLocation && targetStop) {
            console.log('[ActiveTrip] Zooming to segment');
            mapRef.current.fitToCoordinates([
                { latitude: userLocation.coords.latitude, longitude: userLocation.coords.longitude },
                { latitude: targetStop.latitude, longitude: targetStop.longitude }
            ], {
                edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
                animated: true
            });
        }
    }, [targetStop, userLocation]); // Trigger when these change

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
            const stops = await TransLinkService.getStopsForRoute(routeNo);
            let stop = stops.find(s => s.stopNo === stopId || s.stopId === stopId);

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
                }
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

    // ... (rest of functions: startVehicleTracking, updateTripState, stopTrip, handleEndTrip)

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
                {/* Target Stop Marker */}
                <Marker
                    coordinate={{
                        latitude: targetStop.latitude,
                        longitude: targetStop.longitude,
                    }}
                    title={targetStop.stopName}
                    description={`Stop #${targetStop.stopNo}`}
                >
                    <View style={styles.stopMarker}>
                        <Ionicons name="location" size={32} color="#FF6B6B" />
                    </View>
                </Marker>

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

                {/* Route line from user to stop */}
                <Polyline
                    coordinates={[
                        {
                            latitude: userLocation.coords.latitude,
                            longitude: userLocation.coords.longitude,
                        },
                        {
                            latitude: targetStop.latitude,
                            longitude: targetStop.longitude,
                        },
                    ]}
                    strokeColor="#000" // Black dashed
                    strokeWidth={3}
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
                {eta !== null && (
                    <View style={styles.etaCard}>
                        <Text style={styles.etaLabel}>Estimated Arrival</Text>
                        <Text style={styles.etaValue}>{eta} min</Text>
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
});
