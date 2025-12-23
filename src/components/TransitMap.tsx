import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import MapView, { Marker, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import TransLinkService, { VehiclePosition } from '../services/TransLinkService';

interface TransitMapProps {
    onBusPress?: (bus: VehiclePosition) => void;
}

export default function TransitMap({ onBusPress }: TransitMapProps) {
    const [userLocation, setUserLocation] = useState<Region | null>(null);
    const [buses, setBuses] = useState<VehiclePosition[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getUserLocation();
    }, []);

    useEffect(() => {
        if (!userLocation) return;

        // Fetch buses initially
        fetchNearbyBuses();

        // Refresh every 15 seconds
        const interval = setInterval(fetchNearbyBuses, 15000);
        return () => clearInterval(interval);
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

            // For demo purposes, center on Vancouver where mock buses are
            // In production, use actual user location
            const region: Region = {
                latitude: 49.2827, // Vancouver downtown
                longitude: -123.1207,
                latitudeDelta: 0.15, // Wider zoom to see all mock buses
                longitudeDelta: 0.15,
            };

            setUserLocation(region);
            setLoading(false);
        } catch (err: any) {
            console.error('[TransitMap] Error getting location:', err);
            // Fallback to Vancouver if location fails
            const region: Region = {
                latitude: 49.2827,
                longitude: -123.1207,
                latitudeDelta: 0.15,
                longitudeDelta: 0.15,
            };
            setUserLocation(region);
            setLoading(false);
        }
    };

    const fetchNearbyBuses = async () => {
        try {
            console.log('[TransitMap] Fetching nearby buses...');

            // Get all vehicle positions (TransLink doesn't filter by location on server)
            const allVehicles = await TransLinkService.getVehiclePositions('');

            if (!userLocation) return;

            // For mock data, show all buses (don't filter by distance)
            // For real data, filter to buses within ~10km
            const nearbyBuses = allVehicles.length > 0 && allVehicles.length <= 10
                ? allVehicles // Likely mock data (small set), show all
                : allVehicles.filter(bus => {
                    if (!bus.latitude || !bus.longitude) return false;
                    const distance = calculateDistance(
                        userLocation.latitude,
                        userLocation.longitude,
                        bus.latitude,
                        bus.longitude
                    );
                    return distance < 10; // 10km radius for real data
                });

            console.log(`[TransitMap] Found ${nearbyBuses.length} nearby buses`);
            setBuses(nearbyBuses);
        } catch (err: any) {
            console.error('[TransitMap] Error fetching buses:', err);
        }
    };

    // Haversine formula for distance calculation
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371; // Earth radius in km
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
                {/* Bus markers */}
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

            {/* Debug overlay */}
            <View style={styles.debugOverlay}>
                <Text style={styles.debugText}>Buses loaded: {buses.length}</Text>
                {buses.length > 0 && (
                    <Text style={styles.debugText}>
                        Routes: {buses.map(b => b.routeNo).join(', ')}
                    </Text>
                )}
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
