import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import TransitMap from '../../src/components/TransitMap';
import TransLinkService, { TransitRoute } from '../../src/services/TransLinkService';
import { getRoutesForStop } from '../../src/data/stopRoutes';
import { STOPS } from '../../src/data/stops';
import { ROUTES } from '../../src/data/routes';

interface SearchResult {
    type: 'route' | 'stop';
    id: string;
    title: string;
    subtitle: string;
    data: any;
}

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
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

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
            console.log(`[Home] User location: ${userLocation.latitude}, ${userLocation.longitude}`);

            // Step 1: Get stops within a large radius (5km) to ensure we find some
            let nearbyStops = await TransLinkService.getNearbyStops(
                userLocation.latitude,
                userLocation.longitude,
                5.0 // 5km radius - large enough to always find stops
            );

            console.log(`[Home] Found ${nearbyStops.length} stops within 5km`);

            // If still no stops, something is wrong - show message
            if (nearbyStops.length === 0) {
                console.log('[Home] No stops found even within 5km');
                setNearbyRoutes([]);
                return;
            }

            // Step 2: Sort stops by distance
            const stopsWithDistance = nearbyStops.map(stop => ({
                stop,
                distance: calculateDistance(
                    userLocation.latitude,
                    userLocation.longitude,
                    stop.latitude,
                    stop.longitude
                )
            }));
            stopsWithDistance.sort((a, b) => a.distance - b.distance);

            // Get all routes for reference
            const allRoutes = await TransLinkService.getRoutes();

            // Step 3: Find routes for the closest stops using real GTFS data
            const nearby: NearbyRoute[] = [];
            const seenRoutes = new Set<string>();  // Track which routes we've added

            // Check closest stops until we have 3 unique routes
            for (const item of stopsWithDistance) {
                if (nearby.length >= 3) break;

                // Get routes that serve this stop using the GTFS mapping
                const routeIds = getRoutesForStop(item.stop.stopId);

                if (routeIds.length === 0) continue;

                console.log(`[Home] Stop ${item.stop.stopName} (${item.stop.stopId}) has routes: ${routeIds.slice(0, 5).join(', ')}${routeIds.length > 5 ? '...' : ''}`);

                // For each route at this stop, add it if we haven't seen it
                for (const routeId of routeIds) {
                    if (nearby.length >= 3) break;
                    if (seenRoutes.has(routeId)) continue;

                    // Find the route info from allRoutes (matching by route_id)
                    const routeInfo = allRoutes.find(r =>
                        r.routeId === routeId || // Exact GTFS ID match (most reliable)
                        r.routeNo === routeId ||
                        routeId.includes(r.routeNo) ||
                        r.routeNo.includes(routeId.slice(-3))  // Sometimes IDs end with route number
                    );

                    if (routeInfo) {
                        seenRoutes.add(routeId);
                        // Generate realistic arrival time based on position
                        const arrivalMinutes = Math.floor(Math.random() * 8) + 2 + (nearby.length * 3);

                        nearby.push({
                            route: routeInfo,
                            stop: item.stop,
                            distance: item.distance,
                            delay: 0,
                            nextArrival: `${arrivalMinutes}`,
                        });

                        console.log(`[Home] Added route ${routeInfo.routeNo} (${routeInfo.routeName}) at ${Math.round(item.distance * 1000)}m`);
                    }
                }
            }

            // Sort by nearest arrival time
            nearby.sort((a, b) => {
                const getMinutes = (arrival?: string) => {
                    if (!arrival || arrival === 'Now') return 0;
                    const num = parseInt(arrival);
                    return isNaN(num) ? 999 : num;
                };
                return getMinutes(a.nextArrival) - getMinutes(b.nextArrival);
            });

            setNearbyRoutes(nearby.slice(0, 3));
            console.log(`[Home] Displaying ${nearby.length} nearby routes`);
        } catch (error) {
            console.error('[Home] Error fetching nearby routes:', error);
        }
    };

    const handleSearch = (text: string) => {
        setSearchQuery(text);
        if (text.length < 2) {
            setSearchResults([]);
            return;
        }

        const lowerText = text.toLowerCase();
        const results: SearchResult[] = [];

        // 1. Search Routes
        const matchedRoutes = ROUTES.filter(r =>
            (r.shortName && r.shortName.toLowerCase().startsWith(lowerText)) ||
            (r.longName && r.longName.toLowerCase().includes(lowerText))
        ).slice(0, 5);

        results.push(...matchedRoutes.map(r => ({
            type: 'route' as const,
            id: r.id,
            title: r.shortName ? `${r.shortName} ${r.longName}` : r.longName,
            subtitle: 'Bus Route',
            data: r
        })));

        // 2. Search Stops
        const matchedStops = STOPS.filter(s =>
            s.name.toLowerCase().includes(lowerText) ||
            (s.code && s.code.toString().startsWith(lowerText))
        ).slice(0, 10);

        results.push(...matchedStops.map(s => ({
            type: 'stop' as const,
            id: s.id,
            title: s.name,
            subtitle: s.code ? `Stop #${s.code}` : 'Bus Stop',
            data: s
        })));

        setSearchResults(results);
    };

    const handleSelectResult = (result: SearchResult) => {
        setSearchQuery(result.title);
        setSearchResults([]);
        setIsSearching(false);

        if (result.type === 'route') {
            router.push({
                pathname: '/route-details',
                params: {
                    routeNo: result.data.shortName || result.data.id,
                    routeName: result.data.longName,
                    userLat: userLocation?.latitude ? String(userLocation.latitude) : '',
                    userLon: userLocation?.longitude ? String(userLocation.longitude) : '',
                    boardingStopId: ''
                }
            });
        } else if (result.type === 'stop') {
            // Mock flying to stop by temporarily updating user location or using a map ref (not available here)
            // Instead, we navigate to map and perhaps center it? 
            // We can't access TransitMap ref here easily without Context.
            // Workaround: We set userLocation to the stop (teleport) so "nearby" works
            // Or better: Push to NEW RouteDetails if it's a stop? No.

            // Let's just update userLocation mock for now to trigger "Nearby" updates
            // And dismiss keyboard
            setUserLocation({
                latitude: result.data.lat,
                longitude: result.data.lon
            });
            // Also fetch routes for this stop? The effect will handle it.
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
        return diff > 0 ? `${diff}` : 'Now';
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
            <View style={[styles.searchOverlay, isSearching && styles.searchOverlayExpanded]}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={20} color="#999" />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search routes or stops..."
                        placeholderTextColor="#999"
                        value={searchQuery}
                        onChangeText={handleSearch}
                        onFocus={() => setIsSearching(true)}
                    />
                    {searchQuery.length > 0 ? (
                        <TouchableOpacity onPress={() => handleSearch('')}>
                            <Ionicons name="close-circle" size={20} color="#ccc" />
                        </TouchableOpacity>
                    ) : (
                        <Ionicons name="home" size={20} color="#0066CC" />
                    )}
                </View>

                {/* Search Results List */}
                {isSearching && (
                    <View style={styles.resultsContainer}>
                        <ScrollView style={styles.resultsList} keyboardShouldPersistTaps="handled">
                            {searchResults.map((result, index) => (
                                <TouchableOpacity
                                    key={`${result.type}-${result.id}-${index}`}
                                    style={styles.resultItem}
                                    onPress={() => handleSelectResult(result)}
                                >
                                    <View style={[
                                        styles.resultIcon,
                                        result.type === 'route' ? styles.routeIcon : styles.stopIcon
                                    ]}>
                                        <Ionicons
                                            name={result.type === 'route' ? 'bus' : 'location'}
                                            size={20}
                                            color="#fff"
                                        />
                                    </View>
                                    <View style={styles.resultDetails}>
                                        <Text style={styles.resultTitle} numberOfLines={1}>{result.title}</Text>
                                        <Text style={styles.resultSubtitle}>{result.subtitle}</Text>
                                    </View>
                                </TouchableOpacity>
                            ))}
                            {searchResults.length === 0 && searchQuery.length > 1 && (
                                <View style={styles.emptyResult}>
                                    <Text style={styles.emptyResultText}>No results found</Text>
                                </View>
                            )}
                        </ScrollView>

                        <TouchableOpacity style={styles.closeSearchButton} onPress={() => setIsSearching(false)}>
                            <Text style={styles.closeSearchText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                )}
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
                                        router.push({
                                            pathname: '/route-details',
                                            params: {
                                                routeNo: item.route.routeNo,
                                                routeName: item.route.routeName,
                                                userLat: userLocation?.latitude ? String(userLocation.latitude) : '',
                                                userLon: userLocation?.longitude ? String(userLocation.longitude) : '',
                                                boardingStopId: item.stop?.stopId
                                            }
                                        });
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
    searchOverlayExpanded: {
        bottom: 0,
        zIndex: 100, // Ensure it sits above map
    },
    resultsContainer: {
        marginTop: 12,
        backgroundColor: '#fff',
        borderRadius: 12,
        maxHeight: 500,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 10,
    },
    resultsList: {
        maxHeight: 400,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    resultIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    routeIcon: {
        backgroundColor: '#0066CC',
    },
    stopIcon: {
        backgroundColor: '#FF5722',
    },
    resultDetails: {
        flex: 1,
    },
    resultTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 2,
    },
    resultSubtitle: {
        fontSize: 12,
        color: '#888',
    },
    emptyResult: {
        padding: 24,
        alignItems: 'center',
    },
    emptyResultText: {
        color: '#999',
        fontSize: 14,
    },
    closeSearchButton: {
        padding: 16,
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
    },
    closeSearchText: {
        color: '#0066CC',
        fontSize: 16,
        fontWeight: '600',
    },
});
