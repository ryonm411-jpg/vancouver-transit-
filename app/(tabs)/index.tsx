import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, AppState, AppStateStatus, Keyboard, Animated, PanResponder, Dimensions, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import TransitMap from '../../src/components/TransitMap';
import TransLinkService, { TransitRoute } from '../../src/services/TransLinkService';
import { getRoutesForStop } from '../../src/data/stopRoutes';
import { STOPS } from '../../src/data/stops';
import { ROUTES } from '../../src/data/routes';
import WalkingRouteService from '../../src/services/WalkingRouteService';
import { SearchTrigger } from '../../src/components/SearchTrigger';
import GeocodingService, { SearchResult } from '../../src/services/GeocodingService';
import { DraggableBottomSheet } from '../../src/components/DraggableBottomSheet';

// Debug logging toggle (set to false in production)
const DEBUG_LOGGING = __DEV__;

interface NearbyRoute {
    route: TransitRoute;
    stop?: any;
    nextArrival?: string;  // Uses ETAResult.label
    delay?: number;
    distance: number;
    source?: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE';
    confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
    minutes?: number | null;
    score?: number;        // Composite score (lower is better)
    isTopPick?: boolean;   // Visual highlight for best option
    lastUpdated?: number;  // Seconds since last update
    // Decoupled GPS visualization (independent of ETA source)
    hasVehiclePosition?: boolean;
    nearestVehicle?: {
        latitude: number;
        longitude: number;
        bearing: number;
        distanceKm: number;
    };
}

// Helper to format last updated time
const formatLastUpdated = (seconds?: number): string => {
    if (!seconds || seconds < 30) return '';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
};

/**
 * Calculate route score for ranking nearby routes
 * Lower score = better option
 */
const calculateRouteScore = (
    minutes: number | null | undefined,
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | undefined,
    distanceKm: number
): number => {
    // ETA component (0-40 points, null = max penalty)
    const etaScore = minutes !== null && minutes !== undefined
        ? Math.min(40, minutes * 2)  // 0 min = 0pts, 20+ min = 40pts
        : 40;  // Unknown ETA = max penalty

    // Confidence component (0-30 points)
    const confidenceScore = confidence === 'HIGH' ? 0 :
        confidence === 'MEDIUM' ? 15 : 30;

    // Distance component (0-30 points)
    const distanceScore = Math.min(30, distanceKm * 30);

    return etaScore + confidenceScore + distanceScore;
};

export default function HomeScreen() {
    const router = useRouter();
    const mapRef = useRef<any>(null);

    // Draggable Sheet Logic
    const { height: SCREEN_HEIGHT } = Dimensions.get('window');
    const SHEET_HEIGHT = SCREEN_HEIGHT * 0.45; // 45% of screen
    const COLLAPSED_HEIGHT = 80;
    const MAX_TRANSLATE_Y = SHEET_HEIGHT - COLLAPSED_HEIGHT;

    const pan = useRef(new Animated.Value(0)).current;

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return Math.abs(gestureState.dy) > 5;
            },
            onPanResponderGrant: () => {
                pan.setOffset((pan as any)._value);
                pan.setValue(0);
            },
            onPanResponderMove: Animated.event(
                [null, { dy: pan }],
                { useNativeDriver: false }
            ),
            onPanResponderRelease: (_, gestureState) => {
                pan.flattenOffset();

                if (gestureState.dy > 50 || (gestureState.vy > 0.5 && gestureState.dy > 10)) {
                    // Collapse
                    Animated.spring(pan, {
                        toValue: MAX_TRANSLATE_Y,
                        useNativeDriver: false,
                        bounciness: 4
                    }).start();
                } else {
                    // Expand
                    Animated.spring(pan, {
                        toValue: 0,
                        useNativeDriver: false,
                        bounciness: 4
                    }).start();
                }
            }
        })
    ).current;
    const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingSearch, setIsLoadingSearch] = useState(false);

    // Refs for smart refresh optimization
    const appState = useRef(AppState.currentState);
    const lastLocation = useRef<{ latitude: number; longitude: number } | null>(null);
    const userLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
    const refreshInterval = useRef<NodeJS.Timeout | null>(null);
    const lastFetchTime = useRef<number>(0);

    // Fast refresh config for real-time feel
    const REFRESH_INTERVAL_MS = 15000;  // 15 seconds between refreshes

    useEffect(() => {
        (async () => {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                console.warn('Permission to access location was denied');
                return;
            }

            let location = await Location.getCurrentPositionAsync({});
            setUserLocation(location.coords);
            lastLocation.current = location.coords;
            userLocationRef.current = location.coords;

            // Initial fetch
            fetchNearbyRoutes(location.coords.latitude, location.coords.longitude);
        })();

        // App state listener for backgrounding
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                // App came to foreground - refresh immediately
                console.log('App foregrounded, refreshing data...');
                if (userLocationRef.current) {
                    fetchNearbyRoutes(userLocationRef.current.latitude, userLocationRef.current.longitude);
                }
            }
            appState.current = nextAppState;
        });

        // Set up fast auto-refresh for real-time updates
        refreshInterval.current = setInterval(() => {
            if (appState.current === 'active' && userLocationRef.current) {
                const now = Date.now();
                // Refresh if 15s passed since last fetch
                if (now - lastFetchTime.current > REFRESH_INTERVAL_MS) {
                    console.log('[Home] Auto-refreshing nearby routes (15s interval)');
                    fetchNearbyRoutes(userLocationRef.current.latitude, userLocationRef.current.longitude);
                }
            }
        }, 5000); // Check every 5 seconds for responsiveness

        return () => {
            subscription.remove();
            if (refreshInterval.current) clearInterval(refreshInterval.current);
        };
    }, []);

    // Search Handler
    const handleSearch = async (text: string) => {
        setSearchQuery(text);
        if (text.length > 0) {
            setIsSearching(true);
            setIsLoadingSearch(true);
            try {
                // Pass user location for distance sorting
                const results = await GeocodingService.search(
                    text,
                    userLocation?.latitude,
                    userLocation?.longitude
                );
                setSearchResults(results);
            } catch (error) {
                console.error("Search failed:", error);
            } finally {
                setIsLoadingSearch(false);
            }
        } else {
            setSearchResults([]);
            setIsSearching(false);
        }
    };

    const handleClearSearch = () => {
        setSearchQuery('');
        setSearchResults([]);
        setIsSearching(false);
        Keyboard.dismiss();
    };

    const handleSelectResult = (result: SearchResult) => {
        console.log('Selected result:', result);

        if (result.type === 'route') {
            // Navigate to Route Details
            // Search result name is "99 Commercial-Broadway / UBC"
            // We can pass it as routeName
            router.push({
                pathname: "/route-details",
                params: {
                    routeId: result.id,
                    routeNo: result.routeNumber,
                    routeName: result.name,
                    // No boarding stop specified, so it will default to closest to user
                    userLat: userLocation?.latitude,
                    userLon: userLocation?.longitude
                }
            });
        } else if (result.type === 'stop') {
            // Focus map on stop + show arriving routes (by updating nearby list via location change)
            mapRef.current?.animateToRegion({
                latitude: result.lat!, // Stops always have lat/lon
                longitude: result.lon!,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005
            });
            // We could also explicitly fetch routes for this stop if we had a "Stop Details" sheet,
            // but simply moving the map will update the "Nearby" list to show this stop's routes.
        } else {
            // Place -> Route Options (Plan Trip)
            router.push({
                pathname: '/route-options',
                params: {
                    destId: result.id,
                    destName: result.name,
                    destLat: result.lat,
                    destLon: result.lon,
                    originLat: userLocation?.latitude,
                    originLon: userLocation?.longitude
                }
            });
        }

        setIsSearching(false);
        setSearchQuery('');
        setSearchResults([]);
        Keyboard.dismiss();
    };

    // Pull-to-refresh handler
    const onRefresh = useCallback(async () => {
        if (!userLocationRef.current) return;
        setRefreshing(true);
        console.log('[Home] Manual refresh triggered');
        await fetchNearbyRoutes(userLocationRef.current.latitude, userLocationRef.current.longitude);
        setRefreshing(false);
    }, []);

    const fetchNearbyRoutes = async (latitude: number, longitude: number) => {
        // Debounce if called too frequent
        const now = Date.now();
        if (now - lastFetchTime.current < 2000) return; // Min 2s between manual calls
        lastFetchTime.current = now;

        setLoading(true);
        console.log(`Fetching nearby routes for ${latitude}, ${longitude}`);

        try {
            // 1. Get raw stops near user
            const nearbyStopsRaw = await TransLinkService.getNearbyStops(latitude, longitude, 1.0);

            // 2. Group by route to avoid duplicates
            // We want to find the BEST stop for each route
            const routesMap = new Map<string, { route: any, stops: any[] }>();

            let stopsWithRoutes = 0;
            for (const stop of nearbyStopsRaw) {
                // IMPORTANT: STOP_ROUTES uses stop.id (stopId), not stop.code (stopNo)
                if (!stop.stopId) continue;

                const routeIds = getRoutesForStop(stop.stopId.toString()) || [];
                if (routeIds.length > 0) stopsWithRoutes++;
                for (const routeId of routeIds) {
                    const route = ROUTES.find(r => r.id === routeId);
                    if (route) {
                        if (!routesMap.has(routeId)) {
                            routesMap.set(routeId, { route, stops: [] });
                        }
                        routesMap.get(routeId)?.stops.push(stop);
                    }
                }
            }

            // 3. Process each route to find the 'best' stop using walking distance
            const processedRoutes: NearbyRoute[] = [];
            const TARGET_ROUTES = 10; // Target number of routes to display
            const MAX_CANDIDATES = 40; // Check up to this many routes to find TARGET_ROUTES valid ones

            const uniqueRoutes = Array.from(routesMap.values()).slice(0, MAX_CANDIDATES);

            for (const item of uniqueRoutes) {
                // Stop early if we have enough valid routes
                if (processedRoutes.length >= TARGET_ROUTES) {
                    console.log(`[Home] Reached target of ${TARGET_ROUTES} routes, stopping early`);
                    break;
                }

                const { route, stops } = item;

                // Find closest stop by straight line first as candidates
                stops.sort((a, b) => (a.distance || 0) - (b.distance || 0));
                const candidateStops = stops.slice(0, 3); // Take top 3 closest by straight line

                let bestStop = candidateStops[0];
                let minWalkDist = Infinity;

                // Calculate actual walking distance for candidates
                for (const stop of candidateStops) {
                    try {
                        const walkRoute = await WalkingRouteService.getWalkingRoute(
                            latitude, longitude,
                            stop.latitude, stop.longitude,
                            stop.stopNo.toString()
                        );

                        if (walkRoute.distanceMeters < minWalkDist) {
                            minWalkDist = walkRoute.distanceMeters;
                            bestStop = stop;
                        }
                    } catch (e) {
                        // Fallback to straight line * factor
                        const approxDist = (stop.distance || 0) * 1.3 * 1000;
                        if (approxDist < minWalkDist) {
                            minWalkDist = approxDist;
                            bestStop = stop;
                        }
                    }
                }

                // Get Real-time ETA for this best stop
                if (!bestStop?.stopNo) continue;

                // Pass stopId (internal ID e.g. "4011") instead of stopNo (code e.g. "53987")
                // The GTFS-RT feed uses internal IDs.
                const etaResult = await TransLinkService.getArrivalsForSegment(route.id, bestStop.stopId.toString());

                // Get Vehicle Position (independent of ETA source)
                const vehiclePosition = await TransLinkService.getNearestVehiclePosition(
                    route.id,
                    latitude,
                    longitude
                );

                const routeData: NearbyRoute = {
                    route: {
                        routeId: route.id,
                        routeNo: route.shortName,
                        routeName: route.longName,
                        direction: 'BOTH',
                        destination: route.longName
                    },
                    stop: bestStop,
                    nextArrival: etaResult.label,
                    minutes: etaResult.minutes,
                    delay: etaResult.delay,
                    distance: minWalkDist / 1000, // Store in km
                    source: etaResult.source as any,
                    confidence: etaResult.source === 'TRIP_UPDATE' ? 'HIGH' :
                        etaResult.source === 'VEHICLE_POSITION' ? 'MEDIUM' : 'LOW',
                    hasVehiclePosition: !!vehiclePosition,
                    nearestVehicle: vehiclePosition ? {
                        latitude: vehiclePosition.latitude,
                        longitude: vehiclePosition.longitude,
                        bearing: vehiclePosition.bearing || 0,
                        distanceKm: calculateDistance(latitude, longitude, vehiclePosition.latitude, vehiclePosition.longitude)
                    } : undefined
                };

                // Only include routes with real-time ETA
                if (etaResult.minutes !== null) {
                    processedRoutes.push(routeData);
                } else {
                    console.log(`[Home] Skipping ${route.shortName} - no real-time data, continuing to find more...`);
                }
            }

            // 4. Score and Sort
            // Calculate scores
            const scoredRoutes = processedRoutes.map(r => ({
                ...r,
                score: calculateRouteScore(r.minutes, r.confidence, r.distance)
            }));

            // Sort by score ascending (lower is better)
            scoredRoutes.sort((a, b) => (a.score || 999) - (b.score || 999));

            setNearbyRoutes(scoredRoutes);
        } catch (error) {
            console.error('Error fetching nearby routes:', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate distance helper for vehicle
    const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371; // Radius of the earth in km
        const dLat = deg2rad(lat2 - lat1);
        const dLon = deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; // Distance in km
        return d;
    };

    const deg2rad = (deg: number) => {
        return deg * (Math.PI / 180);
    };

    return (
        <View style={styles.container}>
            {/* Map Background */}
            <View style={styles.mapContainer}>
                {userLocation && (
                    <TransitMap
                        userLocation={userLocation}
                        nearbyStops={nearbyRoutes.map(r => r.stop).filter(Boolean)}
                        activeRouteShape={null}
                    />
                )}
            </View>



            {/* Content Layer - box-none allows touches to pass through to map */}
            <View style={styles.contentLayer} pointerEvents="box-none">
                {/* Nearby Routes Sheet */}
                <DraggableBottomSheet
                    header={<SearchTrigger />}
                >
                    {loading && nearbyRoutes.length === 0 ? (
                        <View style={styles.loaderContainer}>
                            <ActivityIndicator size="large" color="#007AFF" />
                        </View>
                    ) : (
                        <ScrollView
                            style={styles.routesList}
                            contentContainerStyle={{ paddingBottom: 100 }}
                            showsVerticalScrollIndicator={false}
                            refreshControl={
                                <RefreshControl
                                    refreshing={refreshing}
                                    onRefresh={onRefresh}
                                    tintColor="#007AFF"
                                    colors={['#007AFF']}
                                    title="Updating arrivals..."
                                    titleColor="#8E8E93"
                                />
                            }
                        >
                            {nearbyRoutes.map((route, index) => (
                                <TouchableOpacity
                                    key={`${route.route.routeId}-${index}`}
                                    style={styles.routeCard}
                                    onPress={() => {
                                        router.push({
                                            pathname: "/route-details",
                                            params: {
                                                routeId: route.route.routeId,
                                                routeNo: route.route.routeNo,
                                                routeName: route.route.routeName,
                                                boardingStopId: route.stop?.stopNo,
                                                userLat: userLocation?.latitude,
                                                userLon: userLocation?.longitude
                                            }
                                        });
                                    }}
                                >

                                    <View style={styles.routeHeader}>
                                        <View style={styles.routeBadge}>
                                            <Text style={styles.routeNumber}>{route.route.routeNo}</Text>
                                        </View>
                                        <View style={styles.routeInfo}>
                                            <Text style={styles.routeDestination} numberOfLines={1}>
                                                To {route.route.destination?.split('To ')[1] || route.route.destination}
                                            </Text>
                                            <Text style={styles.stopName} numberOfLines={1}>
                                                {route.stop?.stopName}
                                            </Text>
                                        </View>
                                        <View style={styles.etaContainer}>
                                            <Text style={[
                                                styles.etaTime,
                                                route.isTopPick && styles.topPickArrival
                                            ]}>
                                                {route.nextArrival || 'Now'}
                                            </Text>
                                            {route.source === 'TRIP_UPDATE' && (
                                                <View style={styles.liveIndicator}>
                                                    <Ionicons name="pulse" size={12} color="#34C759" />
                                                </View>
                                            )}
                                        </View>
                                    </View>

                                    <View style={styles.routeFooter}>
                                        <View style={styles.footerItem}>
                                            <Ionicons name="walk" size={14} color="#8E8E93" />
                                            <Text style={styles.footerText}>
                                                {Math.round(route.distance * 1000)}m
                                            </Text>
                                        </View>
                                        {route.hasVehiclePosition && (
                                            <View style={styles.footerItem}>
                                                <Ionicons name="bus" size={14} color="#0A84FF" />
                                                <Text style={[styles.footerText, { color: '#0A84FF' }]}>
                                                    GPS Active
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}
                </DraggableBottomSheet>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    mapContainer: {
        ...StyleSheet.absoluteFillObject,
    },
    searchContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 40,
        left: 0,
        right: 0,
        zIndex: 10,
    },
    contentLayer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 110 : 100, // Below search bar
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        justifyContent: 'flex-end',  // Push sheet to bottom
    },
    resultsContainer: {
        flex: 1,
        backgroundColor: '#fff',
        marginHorizontal: 16,
        borderRadius: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 10,
        overflow: 'hidden',
        maxHeight: '80%',
    },
    sheetContainer: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        // maxHeight: '40%',  // Removed for draggable logic
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        paddingTop: 8,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f2f2f7',
    },
    sheetHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#E5E5EA',
        borderRadius: 2,
        position: 'absolute',
        top: 8,
        left: '50%',
        marginLeft: -20,
    },
    sheetTitle: {
        fontSize: 20,
        fontWeight: '700',
        flex: 1,
        marginTop: 12,
    },
    routesList: {
        padding: 16,
    },
    loaderContainer: {
        padding: 40,
        alignItems: 'center',
    },
    routeCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#F2F2F7',
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
        elevation: 2,
    },
    topPickCard: {
        borderColor: '#FFD700',
        borderWidth: 2,
        backgroundColor: '#FFFBF0',
    },
    topPickBadge: {
        position: 'absolute',
        top: -10,
        left: 16,
        backgroundColor: '#FFD700',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        zIndex: 1,
    },
    topPickText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#000',
    },
    routeHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    routeBadge: {
        backgroundColor: '#0066CC',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginRight: 12,
        minWidth: 50,
        alignItems: 'center',
    },
    routeNumber: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    routeInfo: {
        flex: 1,
    },
    routeDestination: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    stopName: {
        fontSize: 12,
        color: '#8E8E93',
    },
    etaContainer: {
        alignItems: 'flex-end',
    },
    etaTime: {
        fontSize: 20,
        fontWeight: '700',
        color: '#34C759',
    },
    topPickArrival: {
        fontSize: 24,
        color: '#000',
    },
    liveIndicator: {
        marginTop: 4,
    },
    routeFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    footerItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    footerText: {
        fontSize: 12,
        color: '#8E8E93',
        marginLeft: 4,
    },
});
