import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import TransitMap from '../../src/components/TransitMap';
import TransLinkService, { TransitRoute } from '../../src/services/TransLinkService';

interface NearbyRoute {
    route: TransitRoute;
    nextArrival?: string;
    delay?: number;
    distance: number;
}

export default function HomeScreen() {
    const router = useRouter();
    const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        initializeLocation();
    }, []);

    useEffect(() => {
        if (userLocation) {
            fetchNearbyRoutes();
        }
    }, [userLocation]);

    const initializeLocation = async () => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                console.log('[Home] Location permission denied');
                setLoading(false);
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            setUserLocation({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            });
            setLoading(false);
        } catch (error) {
            console.error('[Home] Error getting location:', error);
            setLoading(false);
        }
    };

    const fetchNearbyRoutes = async () => {
        if (!userLocation) return;

        try {
            console.log('[Home] Fetching nearby routes...');
            const allRoutes = await TransLinkService.getRoutes();
            const nearby: NearbyRoute[] = [];

            // Check a subset of popular routes for nearby stops
            const popularRoutes = allRoutes.slice(0, 10); // Limit to avoid too many API calls

            for (const route of popularRoutes) {
                try {
                    const stops = await TransLinkService.getStopsForRoute(route.routeNo);

                    // Find nearest stop
                    let nearestStop = null;
                    let minDistance = Infinity;

                    for (const stop of stops) {
                        const distance = calculateDistance(
                            userLocation.latitude,
                            userLocation.longitude,
                            stop.latitude,
                            stop.longitude
                        );
                        if (distance < minDistance) {
                            minDistance = distance;
                            nearestStop = stop;
                        }
                    }

                    // Only include routes with stops within 1km
                    if (nearestStop && minDistance < 1) {
                        // Get real-time arrival for this stop
                        const tripUpdates = await TransLinkService.getTripUpdates(
                            route.routeNo,
                            nearestStop.stopNo
                        );

                        nearby.push({
                            route,
                            distance: minDistance,
                            delay: tripUpdates[0]?.delay || 0,
                            nextArrival: tripUpdates[0] ? calculateMinutesUntil(tripUpdates[0].estimatedTime) : undefined,
                        });
                    }
                } catch (error) {
                    console.error(`[Home] Error fetching stops for route ${route.routeNo}:`, error);
                }
            }

            // Sort by distance
            nearby.sort((a, b) => a.distance - b.distance);
            setNearbyRoutes(nearby.slice(0, 5)); // Show top 5
            console.log(`[Home] Found ${nearby.length} nearby routes`);
        } catch (error) {
            console.error('[Home] Error fetching nearby routes:', error);
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

    const calculateMinutesUntil = (isoTime: string): string => {
        const now = new Date();
        const arrival = new Date(isoTime);
        const diff = Math.round((arrival.getTime() - now.getTime()) / 60000);
        return diff > 0 ? `${diff}min` : 'Now';
    };

    const getDelayColor = (delay?: number) => {
        if (!delay || delay < 3) return '#4CAF50'; // Green
        if (delay < 8) return '#FF9800'; // Orange
        return '#F44336'; // Red
    };

    return (
        <View style={styles.container}>
            {/* Map View */}
            <View style={styles.mapContainer}>
                <TransitMap />
            </View>

            {/* Search Bar Overlay */}
            <View style={styles.searchOverlay}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={20} color="#999" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Where to?"
                        placeholderTextColor="#999"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    <Ionicons name="home" size={20} color="#0066CC" />
                </View>
            </View>

            {/* Nearby Routes Bottom Sheet - Hide on web */}
            {Platform.OS !== 'web' && (
                <View style={styles.bottomSheet}>
                    <View style={styles.sheetHandle} />
                    <Text style={styles.sheetTitle}>Nearby Routes</Text>

                    {loading ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator color="#0066CC" />
                        </View>
                    ) : nearbyRoutes.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Ionicons name="navigate-outline" size={32} color="#ccc" />
                            <Text style={styles.emptyText}>No nearby routes found</Text>
                        </View>
                    ) : (
                        <ScrollView style={styles.routesList}>
                            {nearbyRoutes.map((item, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={[
                                        styles.routeCard,
                                        { backgroundColor: getDelayColor(item.delay) }
                                    ]}
                                    onPress={() => {
                                        // TODO: Navigate to route details
                                        console.log('Selected route:', item.route.routeNo);
                                    }}
                                >
                                    <View style={styles.routeInfo}>
                                        <Text style={styles.routeNumber}>{item.route.routeNo}</Text>
                                        <Text style={styles.routeDestination}>
                                            {item.route.direction} to {item.route.destination}
                                        </Text>
                                        <Text style={styles.routeStop}>
                                            {Math.round(item.distance * 1000)}m away
                                        </Text>
                                    </View>
                                    <View style={styles.arrivalInfo}>
                                        <Text style={styles.arrivalTime}>
                                            {item.nextArrival || '—'}
                                        </Text>
                                        <Text style={styles.arrivalLabel}>minutes</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    mapContainer: {
        flex: 1,
    },
    searchOverlay: {
        position: 'absolute',
        top: 50,
        left: 16,
        right: 16,
    },
    searchBar: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 5,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#333',
    },
    bottomSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 8,
        paddingBottom: 20,
        maxHeight: '40%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 10,
    },
    sheetHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#ddd',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 12,
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#333',
        paddingHorizontal: 20,
        marginBottom: 12,
    },
    loadingContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
    },
    emptyText: {
        marginTop: 8,
        fontSize: 14,
        color: '#999',
    },
    routesList: {
        paddingHorizontal: 16,
    },
    routeCard: {
        flexDirection: 'row',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        alignItems: 'center',
    },
    routeInfo: {
        flex: 1,
    },
    routeNumber: {
        fontSize: 24,
        fontWeight: '700',
        color: '#fff',
    },
    routeDestination: {
        fontSize: 14,
        color: '#fff',
        marginTop: 4,
        opacity: 0.9,
    },
    routeStop: {
        fontSize: 12,
        color: '#fff',
        marginTop: 2,
        opacity: 0.8,
    },
    arrivalInfo: {
        alignItems: 'flex-end',
    },
    arrivalTime: {
        fontSize: 32,
        fontWeight: '700',
        color: '#fff',
    },
    arrivalLabel: {
        fontSize: 12,
        color: '#fff',
        opacity: 0.9,
    },
});
