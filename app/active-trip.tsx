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

    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;
    const stopId = params.stopId as string;

    const [userLocation, setUserLocation] = useState<Location.LocationObject | null>(null);
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

    const startTrip = async () => {
        try {
            // Request location permissions
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'Location permission is required for trip tracking');
                router.back();
                return;
            }

            // Load target stop
            await loadTargetStop();

            // Start GPS tracking
            startGPSTracking();

            // Start vehicle tracking
            startVehicleTracking();
        } catch (error) {
            console.error('[ActiveTrip] Error starting trip:', error);
            Alert.alert('Error', 'Failed to start trip tracking');
        }
    };

    const loadTargetStop = async () => {
        try {
            const stops = await TransLinkService.getStopsForRoute(routeNo);
            const stop = stops.find(s => s.stopNo === stopId) || stops[0];
            setTargetStop(stop);
        } catch (error) {
            console.error('[ActiveTrip] Error loading stop:', error);
        }
    };

    const startGPSTracking = async () => {
        // Get initial location
        const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation(location);

        // Subscribe to location updates
        locationSubscription.current = await Location.watchPositionAsync(
            {
                accuracy: Location.Accuracy.Balanced,
                timeInterval: 5000, // Update every 5 seconds
                distanceInterval: 10, // Or every 10 meters
            },
            (newLocation) => {
                setUserLocation(newLocation);
                updateTripState(newLocation);
            }
        );
    };

    const startVehicleTracking = () => {
        // Update vehicle position every 10 seconds
        vehicleInterval.current = setInterval(async () => {
            const vehicle = await TripTrackingService.trackVehicle(routeNo);
            setVehiclePosition(vehicle);
        }, 10000);

        // Initial fetch
        TripTrackingService.trackVehicle(routeNo).then(setVehiclePosition);
    };

    const updateTripState = (location: Location.LocationObject) => {
        if (!targetStop) return;

        // Update instruction
        const newInstruction = TripTrackingService.getTripInstruction(
            location,
            vehiclePosition,
            targetStop,
            routeNo
        );
        setInstruction(newInstruction);

        // Update ETA
        const newEta = TripTrackingService.calculateETA(
            location,
            vehiclePosition,
            targetStop
        );
        setEta(newEta);

        // Check for alerts
        if (TripTrackingService.shouldAlertApproachingStop(location, targetStop)) {
            // Could trigger notification here
            console.log('[ActiveTrip] Approaching stop!');
        }
    };

    const stopTrip = () => {
        setIsTracking(false);

        if (locationSubscription.current) {
            locationSubscription.current.remove();
        }

        if (vehicleInterval.current) {
            clearInterval(vehicleInterval.current);
        }
    };

    const handleEndTrip = () => {
        Alert.alert(
            'End Trip?',
            'Are you sure you want to end this trip?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'End Trip',
                    style: 'destructive',
                    onPress: () => {
                        stopTrip();
                        router.back();
                    },
                },
            ]
        );
    };

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
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                region={{
                    latitude: userLocation.coords.latitude,
                    longitude: userLocation.coords.longitude,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                }}
                showsUserLocation
                followsUserLocation
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
                    strokeColor="#0066CC"
                    strokeWidth={3}
                    lineDashPattern={[10, 5]}
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
