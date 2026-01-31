/**
 * GeocodingService - Unified search for destinations
 * Combines local GTFS stops with OpenRouteService geocoding
 */

import axios from 'axios';
import { openRouteServiceConfig } from '../config/config';
import { STOPS, GtfsStop } from '../data/stops';
import { ROUTES, GtfsRoute } from '../data/routes';

// ============================================================================
// INTENT-AWARE RANKING WEIGHTS
// These weights control how search results are prioritized.
// Higher weights = more influence on final ranking.
// ============================================================================

/** TEXT_MATCH_WEIGHT: Points for how well the query matches the result name.
 *  - Exact match: 40 pts
 *  - Prefix match: 32 pts
 *  - Contains match: 20 pts
 */
const TEXT_MATCH_WEIGHT = 40;

/** DISTANCE_WEIGHT: Points for proximity to user location.
 *  - <500m: 30 pts (full)
 *  - <2km: 20 pts
 *  - <5km: 10 pts
 *  - >5km: 0 pts
 */
const DISTANCE_WEIGHT = 30;

/** FREQUENCY_WEIGHT: Points for high-frequency transit lines.
 *  - SkyTrain/Canada Line: 20 pts
 *  - RapidBus (R-Lines): 15 pts
 *  - B-Lines: 15 pts
 *  - Regular bus: 0 pts
 */
const FREQUENCY_WEIGHT = 20;

/** TYPE_WEIGHT: Points for transit type (rail preferred over bus).
 *  - Rail (type 1): 10 pts
 *  - Ferry (type 4): 5 pts
 *  - Bus (type 3): 0 pts
 */
const TYPE_WEIGHT = 10;

// Patterns for detecting high-frequency routes
const HIGH_FREQ_PATTERNS = ['B-Line', 'RapidBus', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

export interface SearchResult {
    type: 'stop' | 'place' | 'route';
    id: string;
    name: string;
    subtitle: string;
    lat?: number; // Routes might not have a single point
    lon?: number;
    distance?: number; // km from user
    stopCode?: string; // For stops only
    routeNumber?: string; // For routes only
    score?: number; // Relevance score (composite)
    address?: string; // e.g. "Vancouver, BC"
}

// Calculate distance between two points in km (Haversine)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Calculate distance score based on proximity to user.
 *  Smooth decay: closer = higher score.
 */
function calculateDistanceScore(distanceKm: number | undefined): number {
    if (distanceKm === undefined) return 0;
    if (distanceKm < 0.5) return DISTANCE_WEIGHT;
    if (distanceKm < 2) return DISTANCE_WEIGHT * 0.67;
    if (distanceKm < 5) return DISTANCE_WEIGHT * 0.33;
    return 0;
}

/** Calculate frequency score for routes.
 *  Uses route type and name patterns to identify high-frequency lines.
 */
function calculateFrequencyScore(route: GtfsRoute): number {
    // Rail lines (SkyTrain, Canada Line) = highest frequency
    if (route.type === 1) return FREQUENCY_WEIGHT;

    // Check for RapidBus or B-Line patterns
    const nameLower = (route.shortName + ' ' + route.longName).toLowerCase();
    if (route.shortName.startsWith('R') && /^R\d$/.test(route.shortName)) {
        return FREQUENCY_WEIGHT * 0.75; // RapidBus
    }
    if (nameLower.includes('b-line') || route.shortName === '099') {
        return FREQUENCY_WEIGHT * 0.75; // B-Lines
    }

    // Ferry = medium frequency
    if (route.type === 4) return FREQUENCY_WEIGHT * 0.5;

    return 0; // Regular bus
}

class GeocodingServiceClass {
    private static instance: GeocodingServiceClass;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastQuery: string = '';
    private cache = new Map<string, SearchResult[]>();

    private constructor() { }

    static getInstance(): GeocodingServiceClass {
        if (!GeocodingServiceClass.instance) {
            GeocodingServiceClass.instance = new GeocodingServiceClass();
        }
        return GeocodingServiceClass.instance;
    }

    /**
     * Search for destinations - combines GTFS stops and ORS geocoding
     * Debounced to prevent excessive API calls
     */
    async search(
        query: string,
        userLat?: number,
        userLon?: number,
        debounceMs: number = 250
    ): Promise<SearchResult[]> {
        return new Promise((resolve) => {
            // Clear previous timer
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            // Empty query returns empty
            if (!query || query.trim().length < 2) {
                resolve([]);
                return;
            }

            const normalizedQuery = query.trim().toLowerCase();

            // Check cache
            const cacheKey = `${normalizedQuery}:${userLat?.toFixed(3)}:${userLon?.toFixed(3)}`;
            if (this.cache.has(cacheKey)) {
                resolve(this.cache.get(cacheKey)!);
                return;
            }

            // Debounce
            this.debounceTimer = setTimeout(async () => {
                try {
                    // Search all sources in parallel
                    const [routeResults, stopResults, placeResults] = await Promise.all([
                        Promise.resolve(this.searchRoutes(normalizedQuery)), // Sync method wrapped
                        Promise.resolve(this.searchStops(normalizedQuery, userLat, userLon)),
                        this.searchPlaces(normalizedQuery, userLat, userLon)
                    ]);

                    // Combine results
                    const combined = [
                        ...routeResults.slice(0, 5),
                        ...stopResults.slice(0, 10),
                        ...placeResults.slice(0, 5)
                    ];

                    // Sort by Score (Desc) then Distance (Asc)
                    combined.sort((a, b) => {
                        const scoreA = a.score || 0;
                        const scoreB = b.score || 0;
                        if (scoreB !== scoreA) return scoreB - scoreA;

                        if (a.distance !== undefined && b.distance !== undefined) {
                            return a.distance - b.distance;
                        }
                        return 0;
                    });

                    // Limit to 10 results total as requested
                    const limited = combined.slice(0, 10);

                    // Cache result
                    this.cache.set(cacheKey, limited);

                    // Limit cache size
                    if (this.cache.size > 100) {
                        const firstKey = this.cache.keys().next().value;
                        if (firstKey) this.cache.delete(firstKey);
                    }

                    resolve(limited);
                } catch (error) {
                    console.error('[Geocoding] Search error:', error);
                    // Return local results only if ORS fails
                    const localRoutes = this.searchRoutes(normalizedQuery);
                    const localStops = this.searchStops(normalizedQuery, userLat, userLon);
                    resolve([...localRoutes, ...localStops]);
                }
            }, debounceMs);
        });
    }

    /**
     * Search local GTFS stops with INTENT-AWARE scoring
     */
    private searchStops(query: string, userLat?: number, userLon?: number): SearchResult[] {
        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        for (const stop of STOPS) {
            let textScore = 0;
            const nameLower = stop.name.toLowerCase();
            const codeLower = stop.code?.toLowerCase();
            const idLower = stop.id.toLowerCase();

            // TEXT MATCH SCORING (max TEXT_MATCH_WEIGHT pts)
            if (codeLower === lowerQuery || idLower === lowerQuery) {
                textScore = TEXT_MATCH_WEIGHT; // Exact match
            } else if (codeLower?.startsWith(lowerQuery) || idLower.startsWith(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.8; // Prefix match
            } else if (nameLower.startsWith(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.7; // Name starts with
            } else if (nameLower.includes(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.5; // Contains
            }

            if (textScore > 0) {
                const distance = (userLat && userLon)
                    ? calculateDistance(userLat, userLon, stop.lat, stop.lon)
                    : undefined;

                // DISTANCE SCORING (max DISTANCE_WEIGHT pts)
                const distanceScore = calculateDistanceScore(distance);

                // COMPOSITE SCORE
                const totalScore = textScore + distanceScore;

                results.push({
                    type: 'stop',
                    id: stop.id,
                    name: stop.name,
                    subtitle: `Stop #${stop.code || stop.id}${distance !== undefined ? ` • ${distance.toFixed(1)}km` : ''}`,
                    lat: stop.lat,
                    lon: stop.lon,
                    distance,
                    stopCode: stop.code,
                    score: totalScore
                });
            }

            if (results.length >= 20) break;
        }

        results.sort((a, b) => (b.score || 0) - (a.score || 0));
        return results;
    }

    /**
     * Search local GTFS routes with INTENT-AWARE scoring
     */
    private searchRoutes(query: string): SearchResult[] {
        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();
        const cleanQuery = lowerQuery.replace(/^0+/, '');

        for (const route of ROUTES) {
            let textScore = 0;
            const shortName = route.shortName.toLowerCase();
            const longName = route.longName.toLowerCase();

            // TEXT MATCH SCORING (max TEXT_MATCH_WEIGHT pts)
            if (shortName === lowerQuery || shortName === cleanQuery) {
                textScore = TEXT_MATCH_WEIGHT; // Exact match
            } else if (shortName.startsWith(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.8; // Prefix match
            } else if (longName.includes(` ${lowerQuery}`) || longName.startsWith(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.6; // Word match
            } else if (longName.includes(lowerQuery)) {
                textScore = TEXT_MATCH_WEIGHT * 0.4; // Contains
            }

            if (textScore > 0) {
                // FREQUENCY SCORING (max FREQUENCY_WEIGHT pts)
                const frequencyScore = calculateFrequencyScore(route);

                // TYPE SCORING (max TYPE_WEIGHT pts)
                const typeScore = route.type === 1 ? TYPE_WEIGHT : (route.type === 4 ? TYPE_WEIGHT * 0.5 : 0);

                // COMPOSITE SCORE
                const totalScore = textScore + frequencyScore + typeScore;

                results.push({
                    type: 'route',
                    id: route.id,
                    name: route.shortName ? `${route.shortName} ${route.longName}` : route.longName,
                    subtitle: `Route ${route.shortName || ''}${frequencyScore > 0 ? ' • High Frequency' : ''}`,
                    routeNumber: route.shortName,
                    score: totalScore
                });
            }

            if (results.length >= 10) break;
        }

        results.sort((a, b) => (b.score || 0) - (a.score || 0));
        return results;
    }

    /**
     * Search places using OpenRouteService Geocoding API
     */
    private async searchPlaces(
        query: string,
        userLat?: number,
        userLon?: number
    ): Promise<SearchResult[]> {
        if (!openRouteServiceConfig.apiKey) {
            console.warn('[Geocoding] No ORS API key configured');
            return [];
        }

        try {
            // Use ORS autocomplete endpoint
            const params: any = {
                text: query,
                size: 5,
                layers: 'address,locality,venue,neighbourhood',
            };

            // Add focus point if user location available
            if (userLat && userLon) {
                params['focus.point.lat'] = userLat;
                params['focus.point.lon'] = userLon;
            }

            // Limit to Vancouver area
            params['boundary.rect.min_lat'] = 49.0;
            params['boundary.rect.max_lat'] = 49.5;
            params['boundary.rect.min_lon'] = -123.3;
            params['boundary.rect.max_lon'] = -122.5;

            const response = await axios.get(
                `${openRouteServiceConfig.baseUrl}/geocode/autocomplete`,
                {
                    params,
                    headers: {
                        'Authorization': openRouteServiceConfig.apiKey,
                        'Accept': 'application/json'
                    },
                    timeout: 5000
                }
            );

            if (!response.data?.features) {
                return [];
            }

            return response.data.features.map((feature: any): SearchResult => {
                const coords = feature.geometry?.coordinates || [0, 0];
                const props = feature.properties || {};

                const distance = (userLat && userLon)
                    ? calculateDistance(userLat, userLon, coords[1], coords[0])
                    : undefined;

                return {
                    type: 'place',
                    id: props.id || `place-${Date.now()}`,
                    name: props.name || props.label || 'Unknown',
                    subtitle: props.locality || props.region || 'Vancouver',
                    lat: coords[1],
                    lon: coords[0],
                    distance,
                    score: 90 // High relevance for places to compete with stops
                };
            });
        } catch (error: any) {
            if (error.response?.status === 403) {
                console.error('[Geocoding] ORS API key invalid or quota exceeded');
            } else {
                console.error('[Geocoding] ORS API error:', error.message);
            }
            return [];
        }
    }

    /**
     * Reverse geocode - get address from coordinates
     */
    async reverseGeocode(lat: number, lon: number): Promise<SearchResult | null> {
        try {
            const response = await axios.get(
                `${openRouteServiceConfig.baseUrl}/geocode/reverse`,
                {
                    params: {
                        'point.lat': lat,
                        'point.lon': lon,
                        size: 1
                    },
                    headers: {
                        'Authorization': openRouteServiceConfig.apiKey,
                        'Accept': 'application/json'
                    },
                    timeout: 5000
                }
            );

            const feature = response.data?.features?.[0];
            if (!feature) return null;

            const props = feature.properties || {};
            return {
                type: 'place',
                id: props.id || `reverse-${Date.now()}`,
                name: props.name || props.label || 'Unknown Location',
                subtitle: props.street || props.locality || '',
                lat,
                lon
            };
        } catch (error) {
            console.error('[Geocoding] Reverse geocode error:', error);
            return null;
        }
    }

    /**
     * Clear search cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}

export default GeocodingServiceClass.getInstance();
