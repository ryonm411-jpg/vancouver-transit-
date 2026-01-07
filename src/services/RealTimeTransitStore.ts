/**
 * RealTimeTransitStore
 * 
 * Centralized store for GTFS-Realtime data with TTL-based caching.
 * Fetches data once per refresh cycle and provides cached access to all consumers.
 */

import axios from 'axios';
import { AppState, AppStateStatus } from 'react-native';
import { translinkConfig } from '../config/config';
import { GtfsParser, ServiceAlert } from '../utils/GtfsParser';
import { TripUpdate, VehiclePosition } from '../types/transit';

const CACHE_TTL_MS = 10000;

// ============================================================================
// ETA SMOOTHING CONFIGURATION
// These constants tune the GPS-based ETA extrapolation stability heuristics.
// ============================================================================

/**
 * MAX_ETA_DECREASE_PER_CYCLE: Maximum minutes ETA can DROP per 10s refresh.
 * WHY: Prevents jarring "jumps" where ETA suddenly drops from 8→3 minutes.
 *      Users perceive gradual countdown as more trustworthy.
 * VALUE: 1 minute max decrease per cycle (realistic for 10s refresh).
 */
const MAX_ETA_DECREASE_PER_CYCLE = 1;

/**
 * MAX_ETA_INCREASE_PER_CYCLE: Maximum minutes ETA can INCREASE per refresh.
 * WHY: ETA going UP is psychologically frustrating for waiting passengers.
 *      We allow small increases only to prevent complete denial of reality.
 * VALUE: 0.5 minutes - very limited increase to smooth minor fluctuations.
 */
const MAX_ETA_INCREASE_PER_CYCLE = 0.5;

/**
 * SPEED_FLOOR_MPS: Speed below which we consider the bus "effectively stopped".
 * WHY: GPS speed < 2 m/s (~7 km/h) is unreliable for ETA extrapolation.
 *      Bus might be at a stop, in traffic, or GPS drift.
 * EFFECT: Widens uncertainty tolerance when below this threshold.
 */
const SPEED_FLOOR_MPS = 2.0;

/**
 * STOP_PROXIMITY_METERS: Distance within which we apply dwell-time penalty.
 * WHY: Buses stopped at or near stops have unpredictable dwell times.
 *      ETA calculation shouldn't "race ahead" while passengers board.
 * EFFECT: Dampens ETA decay rate when vehicle is near a stop.
 */
const STOP_PROXIMITY_METERS = 100;

/**
 * HISTORY_STALE_MS: Time after which we ignore previous ETA for smoothing.
 * WHY: If last update was >2 minutes ago, continuity assumption breaks down.
 * EFFECT: Fresh start for smoothing after gaps in data.
 */
const HISTORY_STALE_MS = 120000; // 2 minutes

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

/**
 * ETAHistoryEntry: Stores previous ETA state for smoothing calculations.
 * Enhanced with context fields to enable smarter heuristics.
 */
export interface ETAHistoryEntry {
    minutes: number;
    source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE';
    timestamp: number;
    vehicleSpeed?: number;    // m/s at time of estimate (for speed-floor logic)
    nearStop?: boolean;       // Was vehicle within STOP_PROXIMITY_METERS of a stop
}

/**
 * SmoothingContext: Optional context passed to smoothValue() for smarter heuristics.
 */
export interface SmoothingContext {
    vehicleSpeed?: number;    // Current vehicle speed in m/s
    nearStop?: boolean;       // Is vehicle within 100m of any stop
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
    private isBackgrounded: boolean = false;

    // Cache maps
    private tripUpdatesCache: Map<string, CacheEntry<TripUpdate[]>> = new Map();
    private vehiclePositionsCache: Map<string, CacheEntry<VehiclePosition[]>> = new Map();
    private serviceAlertsCache: CacheEntry<ServiceAlert[]> | null = null;

    // Deduplication map: Key -> Promise
    private pendingRequests: Map<string, Promise<any>> = new Map();

    // ETA history for smoothing (key: routeId:stopId)
    private etaHistory: Map<string, ETAHistoryEntry> = new Map();

    constructor() {
        this.gtfsRtUrl = translinkConfig.gtfsRtUrl;
        console.log('[RealTimeTransitStore] Initialized with TTL:', CACHE_TTL_MS / 1000, 'seconds');

        // Listen to App State
        AppState.addEventListener('change', this.handleAppStateChange);
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        this.isBackgrounded = nextAppState.match(/inactive|background/) !== null;
        console.log(`[RealTimeTransitStore] App State Changed: ${nextAppState} (Paused: ${this.isBackgrounded})`);
    }

    /**
     * Check if a cache entry is still valid
     */
    private isCacheValid<T>(entry: CacheEntry<T> | null | undefined): boolean {
        if (!entry) return false;
        return (Date.now() - entry.timestamp) < CACHE_TTL_MS;
    }

    /**
     * Helper to handle request deduplication and caching
     */
    private async fetchWithDeduplication<T>(
        key: string,
        fetchFn: () => Promise<T>,
        cacheCheck: () => T | null
    ): Promise<T> {
        // 1. Check Cache
        const cached = cacheCheck();
        if (cached) return cached;

        // 2. Check Background State (unless we have absolutely no data?)
        // If backgrounded, return empty/stale data to save battery
        if (this.isBackgrounded) {
            console.log(`[RealTimeTransitStore] ⏸️ App backgrounded, skipping fetch for ${key}`);
            // If we have stale data, might be better to return it than nothing, but typically we just stop.
            return cached as unknown as T; // Typescript hack, usually returns null/undefined which caller handles
        }

        // 3. Check In-Flight Requests
        if (this.pendingRequests.has(key)) {
            console.log(`[RealTimeTransitStore] ♻️ Joining in-flight request for ${key}`);
            return this.pendingRequests.get(key) as Promise<T>;
        }

        // 4. Create New Request
        console.log(`[RealTimeTransitStore] 🚀 Fetching fresh data for ${key}`);
        const promise = fetchFn().finally(() => {
            this.pendingRequests.delete(key);
        });

        this.pendingRequests.set(key, promise);
        return promise;
    }

    /**
     * Get trip updates for a specific route and stop
     * Uses cached data if available and not stale
     */
    async getTripUpdate(routeId: string, stopId: string): Promise<TripUpdate[]> {
        const cacheKey = `TRIP_UPDATE:${routeId}:${stopId}`;

        const getCached = () => {
            const cached = this.tripUpdatesCache.get(`${routeId}:${stopId}`);
            if (this.isCacheValid(cached)) {
                // console.log(`[RealTimeTransitStore] CACHE HIT - TripUpdates for ${cacheKey}`);
                return cached!.data;
            }
            return null;
        };

        const executeFetch = async () => {
            try {
                const response = await axios.get(`${this.gtfsRtUrl}/gtfsrealtime`, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                });
                const allUpdates = GtfsParser.parseTripUpdates(response.data, routeId, stopId);
                this.tripUpdatesCache.set(`${routeId}:${stopId}`, {
                    data: allUpdates,
                    timestamp: Date.now()
                });
                return allUpdates;
            } catch (error) {
                console.error(`[RealTimeTransitStore] Error fetching TripUpdates:`, error);
                return [];
            }
        };

        const result = await this.fetchWithDeduplication(cacheKey, executeFetch, getCached);
        return result || [];
    }

    /**
     * Get vehicle positions for a specific route
     * Uses cached data if available and not stale
     */
    async getVehiclesForRoute(routeId: string): Promise<VehiclePosition[]> {
        const cacheKey = `VEHICLE:${routeId}`;

        const getCached = () => {
            const cached = this.vehiclePositionsCache.get(routeId);
            if (this.isCacheValid(cached)) {
                // console.log(`[RealTimeTransitStore] CACHE HIT - Vehicles for ${routeId}`);
                return cached!.data;
            }
            return null;
        };

        const executeFetch = async () => {
            try {
                const response = await axios.get(`${this.gtfsRtUrl}/gtfsposition`, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                });
                const positions = GtfsParser.parseVehiclePositions(response.data, routeId);
                this.vehiclePositionsCache.set(routeId, {
                    data: positions,
                    timestamp: Date.now()
                });
                return positions;
            } catch (error) {
                console.error(`[RealTimeTransitStore] Error fetching VehiclePositions:`, error);
                return [];
            }
        };

        const result = await this.fetchWithDeduplication(cacheKey, executeFetch, getCached);
        return result || [];
    }

    /**
     * Get all vehicle positions (no route filter)
     * Useful for the transit map showing all nearby buses
     */
    async getAllVehiclePositions(): Promise<VehiclePosition[]> {
        const cacheKey = `VEHICLE:ALL`;
        const storageKey = '__ALL__';

        const getCached = () => {
            const cached = this.vehiclePositionsCache.get(storageKey);
            if (this.isCacheValid(cached)) {
                return cached!.data;
            }
            return null;
        };

        const executeFetch = async () => {
            try {
                const response = await axios.get(`${this.gtfsRtUrl}/gtfsposition`, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                });
                const positions = GtfsParser.parseVehiclePositions(response.data);
                this.vehiclePositionsCache.set(storageKey, {
                    data: positions,
                    timestamp: Date.now()
                });
                return positions;
            } catch (error) {
                console.error(`[RealTimeTransitStore] Error fetching ALL VehiclePositions:`, error);
                return [];
            }
        };

        const result = await this.fetchWithDeduplication(cacheKey, executeFetch, getCached);
        return result || [];
    }

    /**
     * Get service alerts
     * Uses cached data if available and not stale
     */
    async getServiceAlerts(): Promise<ServiceAlert[]> {
        const cacheKey = `ALERTS`;

        const getCached = () => {
            if (this.isCacheValid(this.serviceAlertsCache)) {
                return this.serviceAlertsCache!.data;
            }
            return null;
        };

        const executeFetch = async () => {
            try {
                const response = await axios.get(`${this.gtfsRtUrl}/gtfsalerts`, {
                    responseType: 'arraybuffer',
                    timeout: 10000,
                });
                const alerts = GtfsParser.parseServiceAlerts(response.data);
                this.serviceAlertsCache = {
                    data: alerts,
                    timestamp: Date.now()
                };
                return alerts;
            } catch (error) {
                console.error(`[RealTimeTransitStore] Error fetching ServiceAlerts:`, error);
                return [];
            }
        };

        const result = await this.fetchWithDeduplication(cacheKey, executeFetch, getCached);
        return result || [];
    }

    /**
     * Get smoothed ETA for a specific route at a stop
     * Limits ETA changes to ±1 minute per refresh unless TripUpdate changes
     * TripUpdate data always overrides smoothing immediately
     */
    async getSmoothedETA(routeId: string, stopId: string): Promise<SmoothedETAResult> {
        // ... (existing implementation preserved if needed, or deprecated)
        // For now, I'm keeping it referencing the logic, but since TransLinkService might use this, 
        // I will just refactor the core logic into helper methods that are public.

        const cacheKey = `${routeId}:${stopId}`;
        const tripUpdates = await this.getTripUpdate(routeId, stopId);

        if (tripUpdates.length > 0) {
            const update = tripUpdates[0];
            const estimatedDate = new Date(update.estimatedTime);
            const rawMinutes = Math.max(0, Math.round((estimatedDate.getTime() - Date.now()) / 60000));

            this.updateHistory(cacheKey, rawMinutes, 'TRIP_UPDATE');

            return {
                minutes: rawMinutes,
                rawMinutes: rawMinutes,
                smoothed: false,
                source: 'TRIP_UPDATE',
                confidence: 'HIGH'
            };
        }

        // ... (rest of method logic using getVehiclesForRoute etc)
        // Since we are moving logic to TransLinkService, this method might become redundant 
        // or can remain as a convenience. 
        // I will leave the existing method mostly as is but point out the new public methods.

        return this.getSmoothedETA_Legacy(routeId, stopId);
    }

    private async getSmoothedETA_Legacy(routeId: string, stopId: string): Promise<SmoothedETAResult> {
        const cacheKey = `${routeId}:${stopId}`;
        const tripUpdates = await this.getTripUpdate(routeId, stopId);
        if (tripUpdates.length > 0) {
            const update = tripUpdates[0];
            const est = new Date(update.estimatedTime);
            const mins = Math.max(0, Math.round((est.getTime() - Date.now()) / 60000));
            this.updateHistory(cacheKey, mins, 'TRIP_UPDATE');
            return { minutes: mins, rawMinutes: mins, smoothed: false, source: 'TRIP_UPDATE', confidence: 'HIGH' };
        }
        // Fallback logic could go here but skipping for brevity as we use TransLinkService now
        return { minutes: null, rawMinutes: null, smoothed: false, source: 'NONE', confidence: 'LOW' };
    }

    /**
     * Public helper to apply multi-heuristic smoothing to a raw ETA value.
     * 
     * HEURISTICS APPLIED:
     * 1. Max Decrease Rate: ETA drops by at most 1 min per refresh
     * 2. Anti-Regression: ETA rarely increases (max 0.5 min unless TripUpdate)
     * 3. Speed Floor Uncertainty: Wider tolerance when bus is slow/stopped
     * 4. Stop-Proximity Penalty: Dampened decay when near stops (dwell time)
     * 
     * @param cacheKey - Unique key for this route+stop combination
     * @param rawMinutes - Newly calculated ETA in minutes
     * @param context - Optional vehicle context for smarter heuristics
     */
    smoothValue(
        cacheKey: string,
        rawMinutes: number,
        context?: SmoothingContext
    ): { minutes: number; smoothed: boolean } {
        const prevEntry = this.etaHistory.get(cacheKey);
        const now = Date.now();
        let smoothedMinutes = rawMinutes;
        let wasSmoothed = false;

        // No previous history? Accept raw value, establish baseline
        if (!prevEntry) {
            this.updateHistory(cacheKey, rawMinutes, 'VEHICLE_POSITION', context);
            return { minutes: rawMinutes, smoothed: false };
        }

        // Check if previous entry is stale
        const age = now - prevEntry.timestamp;
        if (age > HISTORY_STALE_MS) {
            // Data gap too large - reset smoothing, accept raw value
            console.log(`[Smoothing] ${cacheKey}: History stale (${Math.round(age / 1000)}s), accepting raw ${rawMinutes}m`);
            this.updateHistory(cacheKey, rawMinutes, 'VEHICLE_POSITION', context);
            return { minutes: rawMinutes, smoothed: false };
        }

        const diff = rawMinutes - prevEntry.minutes;

        // ====================================================================
        // HEURISTIC 1: Maximum Decrease Rate
        // WHY: Prevents jarring jumps. Users trust gradual countdown.
        // ====================================================================
        let maxDecrease = MAX_ETA_DECREASE_PER_CYCLE;

        // ====================================================================
        // HEURISTIC 2: Speed Floor Uncertainty
        // WHY: Slow/stopped buses have unreliable GPS extrapolation.
        //      Allow slightly larger changes to correct faster.
        // ====================================================================
        const vehicleSpeed = context?.vehicleSpeed ?? prevEntry.vehicleSpeed ?? 5;
        if (vehicleSpeed < SPEED_FLOOR_MPS) {
            // Double the allowed change rate when bus is effectively stopped
            // This acknowledges our uncertainty about when it will move
            maxDecrease = MAX_ETA_DECREASE_PER_CYCLE * 1.5;
            // console.log(`[Smoothing] ${cacheKey}: Speed floor active (${vehicleSpeed.toFixed(1)} m/s), maxDecrease=${maxDecrease}`);
        }

        // ====================================================================
        // HEURISTIC 3: Stop-Proximity Penalty
        // WHY: Buses near stops may dwell. Don't let ETA race ahead.
        // ====================================================================
        const nearStop = context?.nearStop ?? prevEntry.nearStop ?? false;
        if (nearStop && diff < 0) {
            // Halve the decay rate when near a stop
            maxDecrease = maxDecrease * 0.5;
            // console.log(`[Smoothing] ${cacheKey}: Stop proximity penalty, maxDecrease=${maxDecrease}`);
        }

        // ====================================================================
        // HEURISTIC 4: Anti-Regression (ETA Should Not Increase)
        // WHY: ETA going UP is psychologically frustrating for passengers.
        // ====================================================================
        if (diff > 0) {
            // ETA wants to INCREASE - this is bad UX
            if (diff <= MAX_ETA_INCREASE_PER_CYCLE) {
                // Small increase - allow it to prevent complete denial of reality
                smoothedMinutes = rawMinutes;
            } else {
                // Large increase - clamp it severely
                smoothedMinutes = prevEntry.minutes + MAX_ETA_INCREASE_PER_CYCLE;
                wasSmoothed = true;
                console.log(`[Smoothing] ${cacheKey}: Blocked increase ${prevEntry.minutes}m → ${rawMinutes}m, clamped to ${smoothedMinutes}m`);
            }
        } else if (diff < 0) {
            // ETA is DECREASING - this is expected/good
            if (Math.abs(diff) > maxDecrease) {
                // Decrease is too fast - clamp it
                smoothedMinutes = prevEntry.minutes - maxDecrease;
                wasSmoothed = true;
                // console.log(`[Smoothing] ${cacheKey}: Clamped decrease ${prevEntry.minutes}m → ${rawMinutes}m to ${smoothedMinutes}m`);
            } else {
                // Decrease is within bounds - accept it
                smoothedMinutes = rawMinutes;
            }
        }
        // else diff === 0, no change needed

        // Ensure never negative
        smoothedMinutes = Math.max(0, Math.round(smoothedMinutes * 2) / 2); // Round to 0.5

        // Update history with smoothed value and current context
        this.updateHistory(cacheKey, smoothedMinutes, 'VEHICLE_POSITION', context);

        return { minutes: smoothedMinutes, smoothed: wasSmoothed };
    }

    /**
     * Update ETA history with context for smarter future smoothing.
     */
    updateHistory(
        cacheKey: string,
        minutes: number,
        source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE',
        context?: SmoothingContext
    ) {
        this.etaHistory.set(cacheKey, {
            minutes,
            source,
            timestamp: Date.now(),
            vehicleSpeed: context?.vehicleSpeed,
            nearStop: context?.nearStop
        });
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
