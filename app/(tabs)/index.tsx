import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, TextInput, AppState, AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import TransitMap from '../../src/components/TransitMap';
import TransLinkService, { TransitRoute } from '../../src/services/TransLinkService';
import { getRoutesForStop } from '../../src/data/stopRoutes';
import { STOPS } from '../../src/data/stops';
import { ROUTES } from '../../src/data/routes';
import WalkingRouteService from '../../src/services/WalkingRouteService';

// Debug logging toggle (set to false in production)
const DEBUG_LOGGING = __DEV__;

interface SearchResult {
    type: 'route' | 'stop';
    id: string;
    title: string;
    subtitle: string;
    data: any;
}

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
 * 
 * Weights:
 * - ETA: 40% (lower minutes = better)
 * - Confidence: 30% (HIGH=0, MEDIUM=15, LOW=30)
 * - Distance: 30% (walking distance to stop)
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
    // 0m = 0pts, 500m = 15pts, 1km+ = 30pts
    const distanceScore = Math.min(30, distanceKm * 30);

    return etaScore + confidenceScore + distanceScore;
};

export default function HomeScreen() {
    const router = useRouter();
    const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
    const [loading, setLoading] = useState(true);
    const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Refs for smart refresh optimization
    const appState = useRef(AppState.currentState);
    const lastLocation = useRef<{ latitude: number; longitude: number } | null>(null);
    const refreshInterval = useRef<NodeJS.Timeout | null>(null);
    const lastFetchTime = useRef<number>(0);

    // Throttle config
    const REFRESH_INTERVAL_NORMAL = 30000;  // 30s when moving
    const REFRESH_INTERVAL_STATIONARY = 60000;  // 60s when stationary
    const STATIONARY_THRESHOLD = 0.05;  // km threshold to consider "moved"

    // Helper: check if user has moved significantly
    const hasMovedSignificantly = useCallback((newLoc: { latitude: number; longitude: number }) => {
        if (!lastLocation.current) return true;
        const dLat = Math.abs(newLoc.latitude - lastLocation.current.latitude);
        const dLon = Math.abs(newLoc.longitude - lastLocation.current.longitude);
        const approxDistKm = Math.sqrt(dLat * dLat + dLon * dLon) * 111;  // rough km
        return approxDistKm > STATIONARY_THRESHOLD;
    }, []);

    // AppState listener - pause when backgrounded
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (DEBUG_LOGGING) console.log(`[Home] AppState: ${appState.current} -> ${nextState}`);

            if (appState.current.match(/inactive|background/) && nextState === 'active') {
                // App coming to foreground - refresh immediately
                if (DEBUG_LOGGING) console.log('[Home] App foregrounded, refreshing...');
                fetchNearbyRoutes();
            }
            appState.current = nextState;
        });

        return () => subscription.remove();
    }, []);

    useEffect(() => {
        initializeLocation();
    }, []);

    useEffect(() => {
        if (userLocation) {
            // Only fetch if it's been long enough or we moved
            const now = Date.now();
            const timeSinceLastFetch = now - lastFetchTime.current;
            const moved = hasMovedSignificantly(userLocation);

            // Determine refresh interval based on movement
            const interval = moved ? REFRESH_INTERVAL_NORMAL : REFRESH_INTERVAL_STATIONARY;

            // Initial fetch or moved significantly
            if (lastFetchTime.current === 0 || (moved && timeSinceLastFetch > 5000)) {
                fetchNearbyRoutes();
                lastLocation.current = userLocation;
            }

            // Clear old interval and set new one
            if (refreshInterval.current) {
                clearInterval(refreshInterval.current);
            }

            refreshInterval.current = setInterval(() => {
                // Only refresh if app is active
                if (appState.current === 'active') {
                    if (DEBUG_LOGGING) console.log('[Home] Auto-refresh (app active)');
                    fetchNearbyRoutes();
                } else {
                    if (DEBUG_LOGGING) console.log('[Home] Skipping refresh (app backgrounded)');
                }
            }, interval);

            if (DEBUG_LOGGING) console.log(`[Home] Refresh interval set to ${interval / 1000}s`);

            return () => {
                if (refreshInterval.current) {
                    clearInterval(refreshInterval.current);
                }
            };
        }
    }, [userLocation, hasMovedSignificantly]);

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
            lastFetchTime.current = Date.now();
            if (DEBUG_LOGGING) console.log('[Home] Fetching nearby routes...');
            if (DEBUG_LOGGING) console.log(`[Home] User location: ${userLocation.latitude.toFixed(4)}, ${userLocation.longitude.toFixed(4)}`);

            // Step 1: Get stops within a large radius (5km) to ensure we find some
            let nearbyStops = await TransLinkService.getStaticNearbyStops(
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
            const allRoutes = await TransLinkService.getStaticRoutes();

            // Step 3: Build a map of routes to their candidate stops
            // We'll collect all stops that serve each route (within the first 20 closest stops)
            const routeToStops = new Map<string, { stop: typeof stopsWithDistance[0]['stop']; straightDist: number }[]>();
            const routeToInfo = new Map<string, TransitRoute>();

            // Limit to first 20 closest stops to avoid too many lookups
            const closestStops = stopsWithDistance.slice(0, 20);

            for (const item of closestStops) {
                const routeIds = getRoutesForStop(item.stop.stopId);
                if (routeIds.length === 0) continue;

                console.log(`[Home] Stop ${item.stop.stopName} (${item.stop.stopId}) has routes: ${routeIds.slice(0, 5).join(', ')}${routeIds.length > 5 ? '...' : ''}`);

                for (const routeId of routeIds) {
                    // Find route info if we haven't seen this route
                    if (!routeToInfo.has(routeId)) {
                        const info = allRoutes.find(r =>
                            r.routeId === routeId ||
                            r.routeNo === routeId ||
                            routeId.includes(r.routeNo) ||
                            r.routeNo.includes(routeId.slice(-3))
                        );
                        if (info) routeToInfo.set(routeId, info);
                    }

                    // Add this stop as a candidate for this route
                    if (!routeToStops.has(routeId)) {
                        routeToStops.set(routeId, []);
                    }
                    const candidates = routeToStops.get(routeId)!;
                    // Only keep up to 3 candidate stops per route
                    if (candidates.length < 3) {
                        candidates.push({ stop: item.stop, straightDist: item.distance });
                    }
                }
            }

            // Step 4: For each route, find the stop with shortest WALKING distance
            const nearby: NearbyRoute[] = [];

            for (const [routeId, candidates] of routeToStops.entries()) {
                if (nearby.length >= 5) break; // Get up to 5 routes
                const routeInfo = routeToInfo.get(routeId);
                if (!routeInfo) continue;

                // Calculate walking distance for each candidate stop
                let bestStop = candidates[0];
                let bestWalkingDist = Infinity;

                // If only one candidate, use it directly
                if (candidates.length === 1) {
                    bestStop = candidates[0];
                    bestWalkingDist = candidates[0].straightDist * 1000; // Approximate as straight line * 1000 for meters
                } else {
                    // Compare walking distances for multiple candidates
                    console.log(`[Home] Route ${routeInfo.routeNo}: comparing ${candidates.length} stops...`);

                    for (const candidate of candidates) {
                        try {
                            const walkRoute = await WalkingRouteService.getWalkingRoute(
                                userLocation!.latitude,
                                userLocation!.longitude,
                                candidate.stop.latitude,
                                candidate.stop.longitude,
                                candidate.stop.stopId
                            );
                            const walkingDist = walkRoute.distanceMeters;
                            console.log(`[Home]   - ${candidate.stop.stopName}: ${walkingDist}m walking`);

                            if (walkingDist < bestWalkingDist) {
                                bestWalkingDist = walkingDist;
                                bestStop = candidate;
                            }
                        } catch (err) {
                            // Fallback to straight-line distance if walking route fails
                            const fallbackDist = candidate.straightDist * 1300; // Approximate walking factor
                            if (fallbackDist < bestWalkingDist) {
                                bestWalkingDist = fallbackDist;
                                bestStop = candidate;
                            }
                        }
                    }
                }

                console.log(`[Home] Route ${routeInfo.routeNo}: best stop is ${bestStop.stop.stopName} (${Math.round(bestWalkingDist)}m walking)`);

                // Get real arrival time from TripUpdates
                const eta = await TransLinkService.getArrivalsForSegment(routeId, bestStop.stop.stopId);

                // Calculate composite score - use walking distance instead of straight-line
                const walkingDistKm = bestWalkingDist / 1000;
                const score = calculateRouteScore(eta.minutes, eta.confidence, walkingDistKm);

                nearby.push({
                    route: routeInfo,
                    stop: bestStop.stop,
                    distance: walkingDistKm, // Now this is walking distance in km
                    delay: eta.delay || 0,
                    nextArrival: eta.label,
                    source: eta.source,
                    confidence: eta.confidence,
                    minutes: eta.minutes,
                    score,
                    lastUpdated: eta.lastUpdatedSeconds,
                    hasVehiclePosition: eta.hasVehiclePosition,
                    nearestVehicle: eta.nearestVehicle,
                });

                console.log(`[Home] Route ${routeInfo.routeNo}: ${eta.label} (${eta.source}) hasGPS=${eta.hasVehiclePosition} score=${score.toFixed(1)} at stop ${bestStop.stop.stopId} (${walkingDistKm.toFixed(2)}km walking)`);
            }

            // Sort by composite score (lower is better)
            nearby.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));

            // Mark top pick
            if (nearby.length > 0) {
                nearby[0].isTopPick = true;
            }

            setNearbyRoutes(nearby.slice(0, 5));  // Show top 5
            console.log(`[Home] Displaying ${Math.min(nearby.length, 5)} nearby routes, top pick: ${nearby[0]?.route.routeNo}`);
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
                    routeId: result.data.id,
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
                                        { backgroundColor: getDelayColor(item.delay) },
                                        item.isTopPick && styles.topPickCard
                                    ]}
                                    onPress={() => {
                                        router.push({
                                            pathname: '/route-details',
                                            params: {
                                                routeId: item.route.routeId,
                                                routeNo: item.route.routeNo,
                                                routeName: item.route.routeName,
                                                userLat: userLocation?.latitude ? String(userLocation.latitude) : '',
                                                userLon: userLocation?.longitude ? String(userLocation.longitude) : '',
                                                boardingStopId: item.stop?.stopId
                                            }
                                        });
                                    }}
                                >
                                    {/* Top Pick Badge */}
                                    {item.isTopPick ? (
                                        <View style={styles.topPickBadge}>
                                            <Text style={styles.topPickText}>⭐ Best Option</Text>
                                        </View>
                                    ) : null}
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
                                        <Text style={[styles.arrivalTime, item.isTopPick && styles.topPickArrival]}>
                                            {item.nextArrival || '—'}
                                        </Text>
                                        {/* Status Badge Row */}
                                        <View style={styles.badgeRow}>
                                            {/* Real-time Status Badge */}
                                            <View style={[
                                                styles.statusBadge,
                                                item.source === 'TRIP_UPDATE' && styles.liveBadge,
                                                item.source === 'VEHICLE_POSITION' && styles.gpsBadge,
                                                item.source === 'SCHEDULE' && styles.schedBadge,
                                            ]}>
                                                <Text style={styles.statusBadgeText}>
                                                    {item.source === 'TRIP_UPDATE' ? '• Live' :
                                                        item.source === 'VEHICLE_POSITION' ? 'GPS' : 'Sched'}
                                                </Text>
                                            </View>
                                            {/* GPS indicator (shows when GPS available, even if ETA is from TripUpdate) */}
                                            {item.hasVehiclePosition && item.source === 'TRIP_UPDATE' ? (
                                                <View style={styles.gpsIndicator}>
                                                    <Ionicons name="locate" size={10} color="#fff" />
                                                </View>
                                            ) : null}
                                        </View>
                                        {/* Bus distance from stop (if GPS available) */}
                                        {item.hasVehiclePosition && item.nearestVehicle && item.nearestVehicle.distanceKm != null ? (
                                            <Text style={styles.busDistance}>
                                                🚌 {(item.nearestVehicle.distanceKm * 1000).toFixed(0)}m
                                            </Text>
                                        ) : null}
                                        {/* Last Updated (subtle) */}
                                        {item.lastUpdated && item.lastUpdated > 30 ? (
                                            <Text style={styles.lastUpdated}>
                                                {formatLastUpdated(item.lastUpdated)}
                                            </Text>
                                        ) : null}
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
    // Top Pick Styles
    topPickCard: {
        borderWidth: 2,
        borderColor: '#FFD700',
        shadowColor: '#FFD700',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
        elevation: 8,
    },
    topPickBadge: {
        position: 'absolute',
        top: -8,
        left: 12,
        backgroundColor: '#FFD700',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
        zIndex: 1,
    },
    topPickText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#333',
    },
    topPickArrival: {
        fontSize: 28,
        fontWeight: '800',
    },
    // Real-time Status Badges
    statusBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 8,
        marginTop: 4,
    },
    liveBadge: {
        backgroundColor: 'rgba(76, 175, 80, 0.9)',  // Green for live
    },
    gpsBadge: {
        backgroundColor: 'rgba(255, 193, 7, 0.9)',  // Amber for GPS
    },
    schedBadge: {
        backgroundColor: 'rgba(158, 158, 158, 0.7)',  // Gray for scheduled
    },
    statusBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#fff',
    },
    lastUpdated: {
        fontSize: 9,
        color: 'rgba(255,255,255,0.6)',
        marginTop: 2,
    },
    // Decoupled GPS visualization styles
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 4,
    },
    gpsIndicator: {
        backgroundColor: 'rgba(33, 150, 243, 0.9)',  // Blue for GPS indicator
        borderRadius: 8,
        padding: 3,
    },
    busDistance: {
        fontSize: 10,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 2,
    },
});
