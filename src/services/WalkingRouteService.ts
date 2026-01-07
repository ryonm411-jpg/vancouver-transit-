/**
 * WalkingRouteService
 * 
 * Provides walking directions using OpenRouteService API.
 * Features:
 * - Polyline decoding from OpenRouteService format
 * - Route caching per stopId + coarse user location
 * - 25m movement threshold for recalculation
 * - Fallback to straight line on error/offline
 */

import axios from 'axios';
import { openRouteServiceConfig } from '../config/config';

export interface WalkingRoute {
    coordinates: { latitude: number; longitude: number }[];
    distanceMeters: number;
    durationSeconds: number;
    isActualRoute: boolean; // false if using fallback straight line
}

interface CachedRoute {
    route: WalkingRoute;
    userLat: number;
    userLon: number;
    timestamp: number;
}

// Cache TTL in milliseconds (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

class WalkingRouteService {
    private routeCache: Map<string, CachedRoute> = new Map();

    /**
     * Decode Google-style polyline encoding
     * OpenRouteService uses this format for geometry
     */
    private decodePolyline(encoded: string, precision: number = 5): { latitude: number; longitude: number }[] {
        const coordinates: { latitude: number; longitude: number }[] = [];
        let index = 0;
        let lat = 0;
        let lon = 0;
        const factor = Math.pow(10, precision);

        while (index < encoded.length) {
            let shift = 0;
            let result = 0;
            let byte: number;

            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);

            const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += deltaLat;

            shift = 0;
            result = 0;

            do {
                byte = encoded.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);

            const deltaLon = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lon += deltaLon;

            coordinates.push({
                latitude: lat / factor,
                longitude: lon / factor
            });
        }

        return coordinates;
    }

    /**
     * Calculate distance between two points in meters (Haversine)
     */
    private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Create a straight line fallback route
     */
    private createFallbackRoute(
        userLat: number,
        userLon: number,
        destLat: number,
        destLon: number
    ): WalkingRoute {
        const distance = this.calculateDistance(userLat, userLon, destLat, destLon);
        // Estimate walking time at 5 km/h (1.4 m/s)
        const duration = distance / 1.4;

        return {
            coordinates: [
                { latitude: userLat, longitude: userLon },
                { latitude: destLat, longitude: destLon }
            ],
            distanceMeters: Math.round(distance),
            durationSeconds: Math.round(duration),
            isActualRoute: false
        };
    }

    /**
     * Generate cache key from stopId and coarse user location
     * Coarse location is rounded to ~10m precision to enable caching
     */
    private getCacheKey(stopId: string, userLat: number, userLon: number): string {
        const coarseLat = Math.round(userLat * 10000) / 10000; // ~10m precision
        const coarseLon = Math.round(userLon * 10000) / 10000;
        return `${stopId}:${coarseLat}:${coarseLon}`;
    }

    /**
     * Check if cached route is still valid
     */
    private isCacheValid(cached: CachedRoute, userLat: number, userLon: number): boolean {
        // Check if cache is expired
        if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
            return false;
        }

        // Check if user has moved more than threshold
        const distance = this.calculateDistance(
            cached.userLat,
            cached.userLon,
            userLat,
            userLon
        );

        return distance <= openRouteServiceConfig.movementThreshold;
    }

    /**
     * Get walking route from user location to destination
     * Uses caching and fallback to straight line on error
     */
    async getWalkingRoute(
        userLat: number,
        userLon: number,
        destLat: number,
        destLon: number,
        stopId: string
    ): Promise<WalkingRoute> {
        // Check cache first
        const cacheKey = this.getCacheKey(stopId, userLat, userLon);
        const cached = this.routeCache.get(cacheKey);

        if (cached && this.isCacheValid(cached, userLat, userLon)) {
            console.log(`[WalkingRoute] CACHE HIT for stop ${stopId}`);
            return cached.route;
        }

        // Check if API key is available
        if (!openRouteServiceConfig.apiKey) {
            console.log('[WalkingRoute] No API key, using fallback straight line');
            return this.createFallbackRoute(userLat, userLon, destLat, destLon);
        }

        try {
            console.log(`[WalkingRoute] Fetching route for stop ${stopId}...`);
            console.log(`[WalkingRoute] API Key prefix: ${openRouteServiceConfig.apiKey.substring(0, 8)}...`);

            // ORS V2 requires POST with Authorization header
            const response = await axios.post(
                `${openRouteServiceConfig.baseUrl}/v2/directions/foot-walking`,
                {
                    // Coordinates must be [longitude, latitude] order
                    coordinates: [
                        [userLon, userLat],
                        [destLon, destLat]
                    ]
                },
                {
                    headers: {
                        'Authorization': openRouteServiceConfig.apiKey,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, application/geo+json'
                    },
                    timeout: 5000
                }
            );

            const data = response.data;
            console.log(`[WalkingRoute] Response received, routes: ${data.routes?.length || 0}`);

            if (data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const geometry = route.geometry;
                const summary = route.summary;

                // Decode polyline geometry (ORS uses encoded polyline format)
                let coordinates: { latitude: number; longitude: number }[];

                if (typeof geometry === 'string') {
                    // Encoded polyline format - decode it
                    coordinates = this.decodePolyline(geometry);
                    console.log(`[WalkingRoute] Decoded ${coordinates.length} points from polyline`);
                    if (coordinates.length > 0) {
                        console.log(`[WalkingRoute] Start: (${coordinates[0].latitude.toFixed(5)}, ${coordinates[0].longitude.toFixed(5)})`);
                        console.log(`[WalkingRoute] End: (${coordinates[coordinates.length - 1].latitude.toFixed(5)}, ${coordinates[coordinates.length - 1].longitude.toFixed(5)})`);
                        console.log(`[WalkingRoute] Expected end: (${destLat.toFixed(5)}, ${destLon.toFixed(5)})`);
                    }
                } else if (geometry.coordinates) {
                    // GeoJSON format
                    coordinates = geometry.coordinates.map((coord: [number, number]) => ({
                        latitude: coord[1],
                        longitude: coord[0]
                    }));
                } else {
                    console.warn('[WalkingRoute] Unexpected geometry format');
                    return this.createFallbackRoute(userLat, userLon, destLat, destLon);
                }

                const walkingRoute: WalkingRoute = {
                    coordinates: coordinates,
                    distanceMeters: Math.round(summary.distance),
                    durationSeconds: Math.round(summary.duration),
                    isActualRoute: true
                };

                // Fix visual gaps: Prepend start and append end points if they differ significantly
                // This connects the snapped road point to the actual user/stop location
                if (coordinates.length > 0) {
                    const first = coordinates[0];
                    const last = coordinates[coordinates.length - 1];

                    // Check start gap (threshold ~5 meters)
                    if (this.calculateDistance(userLat, userLon, first.latitude, first.longitude) > 0.005) {
                        walkingRoute.coordinates.unshift({ latitude: userLat, longitude: userLon });
                    }

                    // Check end gap
                    if (this.calculateDistance(destLat, destLon, last.latitude, last.longitude) > 0.005) {
                        walkingRoute.coordinates.push({ latitude: destLat, longitude: destLon });
                    }
                }

                // Cache the result
                this.routeCache.set(cacheKey, {
                    route: walkingRoute,
                    userLat,
                    userLon,
                    timestamp: Date.now()
                });

                console.log(`[WalkingRoute] Got route: ${walkingRoute.distanceMeters}m, ${Math.round(walkingRoute.durationSeconds / 60)}min, ${coordinates.length} points`);
                return walkingRoute;
            }

            // No routes returned
            console.warn('[WalkingRoute] No routes returned');
            return this.createFallbackRoute(userLat, userLon, destLat, destLon);

        } catch (error: any) {
            console.warn('[WalkingRoute] API error, using fallback:', error.message);
            if (error.response) {
                console.warn('[WalkingRoute] Response status:', error.response.status);
                console.warn('[WalkingRoute] Response data:', JSON.stringify(error.response.data));
            }
            return this.createFallbackRoute(userLat, userLon, destLat, destLon);
        }
    }

    /**
     * Clear all cached routes
     */
    clearCache(): void {
        this.routeCache.clear();
        console.log('[WalkingRoute] Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number } {
        return { size: this.routeCache.size };
    }

    /**
     * Find the nearest stop by WALKING DISTANCE (not Euclidean).
     * Pre-filters to N nearest by Euclidean, then queries ORS for actual walking distances.
     * 
     * @param userLat User's latitude
     * @param userLon User's longitude
     * @param stops Array of candidate stops with lat/lon/id
     * @param maxCandidates Maximum stops to query ORS for (default 5)
     * @returns The stop with shortest walking distance, or null if no stops
     */
    async getNearestWalkableStop<T extends { latitude: number; longitude: number; stopId: string }>(
        userLat: number,
        userLon: number,
        stops: T[],
        maxCandidates: number = 5
    ): Promise<{ stop: T; walkingDistance: number; isActualRoute: boolean } | null> {
        if (!stops.length) return null;

        // STEP 1: Pre-filter to N nearest by Euclidean distance (fast)
        const withEuclidean = stops.map(stop => ({
            stop,
            euclideanDist: this.calculateDistance(userLat, userLon, stop.latitude, stop.longitude)
        }));
        withEuclidean.sort((a, b) => a.euclideanDist - b.euclideanDist);
        const candidates = withEuclidean.slice(0, maxCandidates);

        console.log(`[WalkingRoute] Finding nearest walkable stop from ${stops.length} stops (checking top ${candidates.length})`);

        // STEP 2: If closest is <100m, use Euclidean directly (too close to matter)
        if (candidates[0].euclideanDist < 100) {
            console.log(`[WalkingRoute] Closest stop <100m, using Euclidean: ${candidates[0].stop.stopId}`);
            return {
                stop: candidates[0].stop,
                walkingDistance: candidates[0].euclideanDist,
                isActualRoute: false
            };
        }

        // STEP 3: Query ORS for walking distances in parallel
        const walkingPromises = candidates.map(async ({ stop, euclideanDist }) => {
            try {
                const route = await this.getWalkingRoute(
                    userLat, userLon,
                    stop.latitude, stop.longitude,
                    stop.stopId
                );
                return {
                    stop,
                    walkingDistance: route.distanceMeters,
                    isActualRoute: route.isActualRoute
                };
            } catch (err) {
                // Fallback: assume road is 1.3x straight-line distance
                console.warn(`[WalkingRoute] ORS failed for ${stop.stopId}, using heuristic`);
                return {
                    stop,
                    walkingDistance: euclideanDist * 1.3,
                    isActualRoute: false
                };
            }
        });

        const results = await Promise.all(walkingPromises);

        // STEP 4: Find the one with shortest walking distance
        results.sort((a, b) => a.walkingDistance - b.walkingDistance);
        const nearest = results[0];

        console.log(`[WalkingRoute] Nearest walkable: ${nearest.stop.stopId} (${Math.round(nearest.walkingDistance)}m, actual: ${nearest.isActualRoute})`);
        return nearest;
    }
}

// Export singleton instance
export default new WalkingRouteService();
