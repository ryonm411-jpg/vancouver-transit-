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
    userLocation?: { latitude: number; longitude: number };
    nearbyStops?: any[];
    activeRouteShape?: any;
}

export default function TransitMap({ onBusPress, userLocation: propUserLocation, nearbyStops = [] }: TransitMapProps) {
    const [internalUserLocation, setInternalUserLocation] = useState<Region | null>(null);
    const [buses, setBuses] = useState<VehiclePosition[]>([]);
    const [loading, setLoading] = useState(!propUserLocation);
    const [error, setError] = useState<string | null>(null);

    const appState = useRef(AppState.currentState);
    const fetchInterval = useRef<NodeJS.Timeout | null>(null);

    const effectiveLocation = propUserLocation ? {
        latitude: propUserLocation.latitude,
        longitude: propUserLocation.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
    } : internalUserLocation;

    useEffect(() => {
        if (!propUserLocation) {
            getUserLocation();
        }

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
        if (!effectiveLocation) return;

        fetchNearbyBuses();

        // Set up fast refresh interval for bus positions (only runs when app is active)
        fetchInterval.current = setInterval(() => {
            if (appState.current === 'active') {
                fetchNearbyBuses();
            } else if (DEBUG_LOGGING) {
                console.log('[TransitMap] Skipping fetch - app backgrounded');
            }
        }, 10000); // 10 seconds for responsive bus tracking

        return () => {
            if (fetchInterval.current) clearInterval(fetchInterval.current);
        };
    }, [effectiveLocation?.latitude, effectiveLocation?.longitude]);

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
                latitudeDelta: 0.015,
                longitudeDelta: 0.015,
            };

            setInternalUserLocation(region);
            setLoading(false);
        } catch (err: any) {
            console.error('[TransitMap] Error getting location:', err);
            // Default to Vancouver
            const region: Region = {
                latitude: 49.2827,
                longitude: -123.1207,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            };
            setInternalUserLocation(region);
            setLoading(false);
        }
    };

    const fetchNearbyBuses = async () => {
        try {
            const allVehicles = await TransLinkService.getRealtimeVehiclePositions('');

            if (!effectiveLocation) return;

            const busesWithDistance = allVehicles
                .filter(bus => bus.latitude && bus.longitude)
                .map(bus => ({
                    ...bus,
                    distance: calculateDistance(
                        effectiveLocation.latitude,
                        effectiveLocation.longitude,
                        bus.latitude,
                        bus.longitude
                    )
                }))
                .filter(bus => bus.distance < 5.0) // Within 5km for map visibility
                .sort((a, b) => a.distance - b.distance);

            const nearbyBuses = busesWithDistance.slice(0, 50); // Show up to 50 buses
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

    if (loading && !effectiveLocation) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.loadingText}>Getting your location...</Text>
            </View>
        );
    }

    if (error && !effectiveLocation) {
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
                initialRegion={effectiveLocation as Region}
                showsUserLocation
                showsMyLocationButton
                showsCompass
            >
                {/* Nearby Stops */}
                {nearbyStops.map((stop, index) => (
                    <Marker
                        key={`stop-${stop.StopNo || stop.id}-${index}`}
                        coordinate={{
                            latitude: stop.Latitude || stop.lat,
                            longitude: stop.Longitude || stop.lon,
                        }}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.stopMarker}>
                            <Ionicons name="bus-outline" size={14} color="#000" />
                        </View>
                    </Marker>
                ))}

                {/* Buses */}
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
                <Text style={styles.debugText}>Buses: {buses.length} | Stops: {nearbyStops.length}</Text>
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
    stopMarker: {
        backgroundColor: '#fff',
        borderRadius: 10,
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#000',
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
