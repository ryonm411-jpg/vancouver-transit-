import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, AppState, AppStateStatus } from 'react-native';
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import TransLinkService, { VehiclePosition } from '../services/TransLinkService';

// Debug logging toggle
const DEBUG_LOGGING = __DEV__;

interface TransitMapProps {
    onBusPress?: (bus: VehiclePosition) => void;
}

export default function TransitMap({ onBusPress }: TransitMapProps) {
    const [userLocation, setUserLocation] = useState<Region | null>(null);
    const [buses, setBuses] = useState<VehiclePosition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const appState = useRef(AppState.currentState);
    const fetchInterval = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        getUserLocation();

        // AppState listener
        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (DEBUG_LOGGING) console.log(`[TransitMap] AppState: ${appState.current} -> ${nextState}`);
            appState.current = nextState;
        });

        return () => {
            subscription.remove();
            if (fetchInterval.current) clearInterval(fetchInterval.current);
        };
    }, []);

    useEffect(() => {
        if (!userLocation) return;

        fetchNearbyBuses();

        // Set up refresh interval (only runs when app is active)
        fetchInterval.current = setInterval(() => {
            if (appState.current === 'active') {
                fetchNearbyBuses();
            } else if (DEBUG_LOGGING) {
                console.log('[TransitMap] Skipping fetch - app backgrounded');
            }
        }, 15000);

        return () => {
            if (fetchInterval.current) clearInterval(fetchInterval.current);
        };
    }, [userLocation]);

    const getUserLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setError('Location permission denied');
                setLoading(false);
                return;
            }

            const location = await Location.getCurrentPositionAsync({});

            const region: Region = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
            };

            setUserLocation(region);
            setLoading(false);
        } catch (err: any) {
            console.error('[TransitMap] Error getting location:', err);
            const region: Region = {
                latitude: 49.2827,
                longitude: -123.1207,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            };
            setUserLocation(region);
            setLoading(false);
        }
    };

    const fetchNearbyBuses = async () => {
        try {
            const allVehicles = await TransLinkService.getRealtimeVehiclePositions('');

            if (!userLocation) return;

            const busesWithDistance = allVehicles
                .filter(bus => bus.latitude && bus.longitude)
                .map(bus => ({
                    ...bus,
                    distance: calculateDistance(
                        userLocation.latitude,
                        userLocation.longitude,
                        bus.latitude,
                        bus.longitude
                    )
                }))
                .sort((a, b) => a.distance - b.distance);

            const nearbyBuses = busesWithDistance.slice(0, 25);
            setBuses(nearbyBuses);
        } catch (err: any) {
            console.error('[TransitMap] Error fetching buses:', err);
        }
    };

    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    };

    const toRad = (degrees: number) => degrees * (Math.PI / 180);

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.loadingText}>Getting your location...</Text>
            </View>
        );
    }

    if (error || !userLocation) {
        return (
            <View style={styles.centerContainer}>
                <Ionicons name="location-outline" size={48} color="#ccc" />
                <Text style={styles.errorText}>{error || 'Unable to load map'}</Text>
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <MapView
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={userLocation}
                showsUserLocation
                showsMyLocationButton
                showsCompass
            >
                {buses.map((bus, index) => (
                    <Marker
                        key={`${bus.routeNo}-${index}`}
                        coordinate={{
                            latitude: bus.latitude,
                            longitude: bus.longitude,
                        }}
                        onPress={() => onBusPress?.(bus)}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.busMarker}>
                            <Ionicons name="bus" size={20} color="#fff" />
                            <Text style={styles.busNumber}>{bus.routeNo}</Text>
                        </View>
                    </Marker>
                ))}
            </MapView>

            <View style={styles.debugOverlay}>
                <Text style={styles.debugText}>Buses: {buses.length}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    map: {
        width: '100%',
        height: '100%',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#666',
    },
    errorText: {
        marginTop: 12,
        fontSize: 16,
        color: '#999',
        textAlign: 'center',
        paddingHorizontal: 40,
    },
    busMarker: {
        backgroundColor: '#0066CC',
        borderRadius: 16,
        paddingHorizontal: 8,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 5,
    },
    busNumber: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    debugOverlay: {
        position: 'absolute',
        top: 10,
        left: 10,
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: 8,
        borderRadius: 8,
    },
    debugText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
});
