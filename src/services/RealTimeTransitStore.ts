/**
 * RealTimeTransitStore
 * 
 * Centralized store for GTFS-Realtime data with TTL-based caching.
 * Fetches data once per refresh cycle and provides cached access to all consumers.
 */

import axios from 'axios';
import { translinkConfig } from '../config/config';
import { GtfsParser, ServiceAlert } from '../utils/GtfsParser';
import { TripUpdate, VehiclePosition } from '../types/transit';

// Cache TTL in milliseconds (20 seconds)
const CACHE_TTL_MS = 20000;

// Maximum ETA change per refresh cycle (in minutes)
const MAX_ETA_CHANGE_PER_CYCLE = 1;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export interface ETAHistoryEntry {
    minutes: number;
    source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE';
    timestamp: number;
}

export interface SmoothedETAResult {
    minutes: number | null;
    rawMinutes: number | null;
    smoothed: boolean;
    source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE' | 'NONE';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

class RealTimeTransitStore {
    private gtfsRtUrl: string;

    // Cache maps
    private tripUpdatesCache: Map<string, CacheEntry<TripUpdate[]>> = new Map();
    private vehiclePositionsCache: Map<string, CacheEntry<VehiclePosition[]>> = new Map();
    private serviceAlertsCache: CacheEntry<ServiceAlert[]> | null = null;

    // ETA history for smoothing (key: routeId:stopId)
    private etaHistory: Map<string, ETAHistoryEntry> = new Map();

    constructor() {
        this.gtfsRtUrl = translinkConfig.gtfsRtUrl;
        console.log('[RealTimeTransitStore] Initialized with TTL:', CACHE_TTL_MS / 1000, 'seconds');
    }

    /**
     * Check if a cache entry is still valid
     */
    private isCacheValid<T>(entry: CacheEntry<T> | null | undefined): boolean {
        if (!entry) return false;
        return (Date.now() - entry.timestamp) < CACHE_TTL_MS;
    }

    /**
     * Get trip updates for a specific route and stop
     * Uses cached data if available and not stale
     */
    async getTripUpdate(routeId: string, stopId: string): Promise<TripUpdate[]> {
        const cacheKey = `${routeId}:${stopId}`;
        const cached = this.tripUpdatesCache.get(cacheKey);

        if (this.isCacheValid(cached)) {
            console.log(`[RealTimeTransitStore] CACHE HIT - TripUpdates for ${cacheKey}`);
            return cached!.data;
        }

        console.log(`[RealTimeTransitStore] CACHE MISS - Fetching TripUpdates for ${cacheKey}`);

        try {
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsrealtime`, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            const allUpdates = GtfsParser.parseTripUpdates(response.data, routeId, stopId);

            // Cache the result
            this.tripUpdatesCache.set(cacheKey, {
                data: allUpdates,
                timestamp: Date.now()
            });

            console.log(`[RealTimeTransitStore] Cached ${allUpdates.length} TripUpdates for ${cacheKey}`);
            return allUpdates;
        } catch (error) {
            console.error(`[RealTimeTransitStore] Error fetching TripUpdates for ${cacheKey}:`, error);
            return [];
        }
    }

    /**
     * Get vehicle positions for a specific route
     * Uses cached data if available and not stale
     */
    async getVehiclesForRoute(routeId: string): Promise<VehiclePosition[]> {
        const cached = this.vehiclePositionsCache.get(routeId);

        if (this.isCacheValid(cached)) {
            console.log(`[RealTimeTransitStore] CACHE HIT - VehiclePositions for route ${routeId}`);
            return cached!.data;
        }

        console.log(`[RealTimeTransitStore] CACHE MISS - Fetching VehiclePositions for route ${routeId}`);

        try {
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsposition`, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            const positions = GtfsParser.parseVehiclePositions(response.data, routeId);

            // Cache the result
            this.vehiclePositionsCache.set(routeId, {
                data: positions,
                timestamp: Date.now()
            });

            console.log(`[RealTimeTransitStore] Cached ${positions.length} VehiclePositions for route ${routeId}`);
            return positions;
        } catch (error) {
            console.error(`[RealTimeTransitStore] Error fetching VehiclePositions for route ${routeId}:`, error);
            return [];
        }
    }

    /**
     * Get all vehicle positions (no route filter)
     * Useful for the transit map showing all nearby buses
     */
    async getAllVehiclePositions(): Promise<VehiclePosition[]> {
        const cacheKey = '__ALL__';
        const cached = this.vehiclePositionsCache.get(cacheKey);

        if (this.isCacheValid(cached)) {
            console.log(`[RealTimeTransitStore] CACHE HIT - All VehiclePositions`);
            return cached!.data;
        }

        console.log(`[RealTimeTransitStore] CACHE MISS - Fetching all VehiclePositions`);

        try {
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsposition`, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            const positions = GtfsParser.parseVehiclePositions(response.data);

            // Cache the result
            this.vehiclePositionsCache.set(cacheKey, {
                data: positions,
                timestamp: Date.now()
            });

            console.log(`[RealTimeTransitStore] Cached ${positions.length} total VehiclePositions`);
            return positions;
        } catch (error) {
            console.error(`[RealTimeTransitStore] Error fetching all VehiclePositions:`, error);
            return [];
        }
    }

    /**
     * Get service alerts
     * Uses cached data if available and not stale
     */
    async getServiceAlerts(): Promise<ServiceAlert[]> {
        if (this.isCacheValid(this.serviceAlertsCache)) {
            console.log(`[RealTimeTransitStore] CACHE HIT - ServiceAlerts`);
            return this.serviceAlertsCache!.data;
        }

        console.log(`[RealTimeTransitStore] CACHE MISS - Fetching ServiceAlerts`);

        try {
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsalerts`, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            const alerts = GtfsParser.parseServiceAlerts(response.data);

            // Cache the result
            this.serviceAlertsCache = {
                data: alerts,
                timestamp: Date.now()
            };

            console.log(`[RealTimeTransitStore] Cached ${alerts.length} ServiceAlerts`);
            return alerts;
        } catch (error) {
            console.error(`[RealTimeTransitStore] Error fetching ServiceAlerts:`, error);
            return [];
        }
    }

    /**
     * Get smoothed ETA for a specific route at a stop
     * Limits ETA changes to ±1 minute per refresh unless TripUpdate changes
     * TripUpdate data always overrides smoothing immediately
     */
    async getSmoothedETA(routeId: string, stopId: string): Promise<SmoothedETAResult> {
        const cacheKey = `${routeId}:${stopId}`;

        // Priority 1: Try to get TripUpdate data (most accurate)
        const tripUpdates = await this.getTripUpdate(routeId, stopId);

        if (tripUpdates.length > 0) {
            const update = tripUpdates[0];
            const estimatedDate = new Date(update.estimatedTime);
            const rawMinutes = Math.max(0, Math.round((estimatedDate.getTime() - Date.now()) / 60000));

            // TripUpdate overrides smoothing - update history immediately
            this.etaHistory.set(cacheKey, {
                minutes: rawMinutes,
                source: 'TRIP_UPDATE',
                timestamp: Date.now()
            });

            console.log(`[RealTimeTransitStore] TripUpdate ETA for ${cacheKey}: ${rawMinutes}m (no smoothing applied)`);

            return {
                minutes: rawMinutes,
                rawMinutes: rawMinutes,
                smoothed: false,
                source: 'TRIP_UPDATE',
                confidence: 'HIGH'
            };
        }

        // Priority 2: VehiclePosition extrapolation
        const vehicles = await this.getVehiclesForRoute(routeId);

        if (vehicles.length > 0) {
            // Get stop location for distance calculation
            const { getStopById } = require('../data/stops');
            const stop = getStopById(stopId);

            if (stop) {
                // Find closest vehicle to stop
                let closestVehicle = vehicles[0];
                let closestDist = Infinity;

                for (const v of vehicles) {
                    const dist = Math.pow(v.latitude - stop.lat, 2) + Math.pow(v.longitude - stop.lon, 2);
                    if (dist < closestDist) {
                        closestDist = dist;
                        closestVehicle = v;
                    }
                }

                // Calculate distance in km using Haversine approximation
                const R = 6371; // Earth's radius in km
                const dLat = (stop.lat - closestVehicle.latitude) * Math.PI / 180;
                const dLon = (stop.lon - closestVehicle.longitude) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(closestVehicle.latitude * Math.PI / 180) * Math.cos(stop.lat * Math.PI / 180) *
                    Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distKm = R * c;

                // Estimate arrival based on distance and speed (default 25 km/h)
                const speedKmH = closestVehicle.speed > 5 && closestVehicle.speed < 80 ? closestVehicle.speed * 3.6 : 25;
                const rawMinutes = Math.max(1, Math.round((distKm / speedKmH) * 60));

                // Apply smoothing
                const prevEntry = this.etaHistory.get(cacheKey);
                let smoothedMinutes = rawMinutes;
                let wasSmoothed = false;

                if (prevEntry && prevEntry.source !== 'TRIP_UPDATE') {
                    const diff = rawMinutes - prevEntry.minutes;

                    if (Math.abs(diff) > MAX_ETA_CHANGE_PER_CYCLE) {
                        // Limit change to ±1 minute
                        smoothedMinutes = prevEntry.minutes + (diff > 0 ? MAX_ETA_CHANGE_PER_CYCLE : -MAX_ETA_CHANGE_PER_CYCLE);
                        smoothedMinutes = Math.max(0, smoothedMinutes); // Don't go negative
                        wasSmoothed = true;
                        console.log(`[RealTimeTransitStore] Smoothed ETA for ${cacheKey}: ${prevEntry.minutes}m -> ${smoothedMinutes}m (raw: ${rawMinutes}m)`);
                    }
                }

                // Update history
                this.etaHistory.set(cacheKey, {
                    minutes: smoothedMinutes,
                    source: 'VEHICLE_POSITION',
                    timestamp: Date.now()
                });

                return {
                    minutes: smoothedMinutes,
                    rawMinutes: rawMinutes,
                    smoothed: wasSmoothed,
                    source: 'VEHICLE_POSITION',
                    confidence: 'MEDIUM'
                };
            }
        }

        // Priority 3: No real-time data
        console.log(`[RealTimeTransitStore] No ETA data for ${cacheKey}`);
        return {
            minutes: null,
            rawMinutes: null,
            smoothed: false,
            source: 'NONE',
            confidence: 'LOW'
        };
    }

    /**
     * Force refresh all caches
     * Call this when you want to ensure fresh data
     */
    invalidateCache(): void {
        console.log('[RealTimeTransitStore] Invalidating all caches');
        this.tripUpdatesCache.clear();
        this.vehiclePositionsCache.clear();
        this.serviceAlertsCache = null;
        this.etaHistory.clear();
    }

    /**
     * Get cache statistics for debugging
     */
    getCacheStats(): { tripUpdates: number; vehiclePositions: number; alerts: boolean; etaHistory: number } {
        return {
            tripUpdates: this.tripUpdatesCache.size,
            vehiclePositions: this.vehiclePositionsCache.size,
            alerts: this.serviceAlertsCache !== null,
            etaHistory: this.etaHistory.size
        };
    }

    /**
     * Get ETA history entry for testing/debugging
     */
    getETAHistory(routeId: string, stopId: string): ETAHistoryEntry | undefined {
        return this.etaHistory.get(`${routeId}:${stopId}`);
    }

    /**
     * Clear only ETA history (useful for testing)
     */
    clearETAHistory(): void {
        this.etaHistory.clear();
    }
}

// Export singleton instance
export default new RealTimeTransitStore();
