import axios from 'axios';
import { translinkConfig } from '../config/config';
import { GtfsParser, ServiceAlert } from '../utils/GtfsParser';
import { ROUTES as GTFS_ROUTES, getRouteDisplayName } from '../data/routes';
import { STOPS as GTFS_STOPS, findNearbyStops, getStopById } from '../data/stops';
import { ROUTE_SHAPES, RouteShape } from '../data/routeShapes';
import { ROUTE_STOPS } from '../data/routeStops';
import RealTimeTransitStore from './RealTimeTransitStore';

// Re-export types from shared types file for backward compatibility
export { TransitRoute, TransitStop, TripUpdate, VehiclePosition } from '../types/transit';

/**
 * Structured ETA response for consistent arrival information
 * ETA and vehicle position are now decoupled:
 * - ETA comes from TripUpdate (preferred) or VehiclePosition extrapolation or Schedule
 * - Vehicle position is always fetched independently for map visualization
 */
export interface ETAResult {
    // ETA fields
    minutes: number | null;
    label: 'Arriving' | 'Due' | string;
    source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    lastUpdatedSeconds: number;
    delay?: number;
    status?: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    tripId?: string;
    scheduledTime?: string; // HH:MM format

    // Vehicle visualization fields (independent of ETA source)
    hasVehiclePosition: boolean;
    nearestVehicle?: {
        latitude: number;
        longitude: number;
        bearing: number;
        distanceKm: number;
        speed: number;
    };
}

class TransLinkService {
    private apiKey: string;
    private baseUrl: string;
    private gtfsRtUrl: string;

    constructor() {
        this.apiKey = translinkConfig.apiKey;
        this.baseUrl = translinkConfig.baseUrl;
        this.gtfsRtUrl = translinkConfig.gtfsRtUrl;


        // Initialize deterministic route lookup for parser
        // Map raw GTFS routes (id, shortName) to TransitRoute interface (routeId, routeNo)
        const mappedRoutes: TransitRoute[] = GTFS_ROUTES.map(r => ({
            routeId: r.id,
            routeNo: r.shortName,
            routeName: r.shortName ? `${r.shortName} ${r.longName}` : r.longName,
            direction: 'BOTH',
            destination: r.longName
        }));
        GtfsParser.initializeLookup(mappedRoutes);
    }

    /**
     * STATIC DATA METHODS
     * These return immutable baseline data from GTFS static files
     */

    /**
     * Get all available transit routes (Static)
     */
    async getStaticRoutes(): Promise<TransitRoute[]> {
        console.log(`[TransLink] Returning ${GTFS_ROUTES.length} routes from static GTFS data`);

        return GTFS_ROUTES.map(route => ({
            routeNo: route.shortName || route.id,
            routeId: route.id,
            routeName: route.shortName ? `${route.shortName} ${route.longName}` : route.longName,
            direction: 'BOTH',
            destination: route.longName
        })).filter(r => r.routeNo);
    }

    /**
     * Get stops for a specific route (Static)
     */
    async getStaticStopsForRoute(routeId: string, directionId: string = '0'): Promise<TransitStop[]> {
        console.log(`[TransLink] Getting static stops for route ID: ${routeId}`);

        const stopIds = ROUTE_STOPS[routeId]?.[directionId];
        if (!stopIds) {
            console.warn(`[TransLink] No stops found for route ID ${routeId} dir ${directionId}`);
            // Fallback: return sample stops if no sequence found
            // Fallback: return empty list to trigger smarter fallback logic or manual lookup?
            // Returning partial list is confusing.
            console.warn(`[TransLink] No stops definition found for ${routeId}:${directionId}.`);
            return [];
        }

        return stopIds.map(id => {
            const stop = getStopById(id);
            if (!stop) return null;
            return {
                stopNo: stop.code || stop.id,
                stopId: stop.id,
                stopName: stop.name,
                latitude: stop.lat,
                longitude: stop.lon,
                routes: [routeId] // Using ID
            };
        }).filter(s => s !== null) as TransitStop[];
    }

    /**
     * Get stops near a location (Static)
     */
    async getStaticNearbyStops(lat: number, lon: number, radiusKm: number = 0.5): Promise<TransitStop[]> {
        const nearby = findNearbyStops(lat, lon, radiusKm);
        console.log(`[TransLink] Found ${nearby.length} stops within ${radiusKm}km (static lookups)`);

        return nearby.map(stop => ({
            stopNo: stop.code || stop.id,
            stopId: stop.id,
            stopName: stop.name,
            latitude: stop.lat,
            longitude: stop.lon,
            routes: []
        }));
    }

    /**
     * Get shape (polyline) for a specific route (Static)
     */
    async getStaticRouteShape(routeId: string, directionId: string = '0'): Promise<RouteShape[]> {
        return ROUTE_SHAPES[routeId]?.[directionId] || [];
    }

    /**
     * REAL-TIME DATA METHODS
     * These return temporary overrides from GTFS-RT feeds
     */

    /**
     * Get real-time trip updates (delegates to RealTimeTransitStore for caching)
     */
    async getRealtimeTripUpdates(routeId: string, stopId: string): Promise<TripUpdate[]> {
        console.log(`[TransLink] Fetching trip updates for route ID ${routeId} at stop ID ${stopId}...`);
        return RealTimeTransitStore.getTripUpdate(routeId, stopId);
    }

    /**
     * Get real-time vehicle positions (delegates to RealTimeTransitStore for caching)
     */
    async getRealtimeVehiclePositions(routeId: string): Promise<VehiclePosition[]> {
        console.log(`[TransLink] Fetching vehicle positions for route ID ${routeId}...`);
        return RealTimeTransitStore.getVehiclesForRoute(routeId);
    }

    /**
     * Get real-time service alerts (delegates to RealTimeTransitStore for caching)
     */
    async getRealtimeServiceAlerts(): Promise<ServiceAlert[]> {
        return RealTimeTransitStore.getServiceAlerts();
    }

    /**
     * Get scheduled arrivals for a stop from TransLink RTTI API
     * This is the fallback when GTFS-RT doesn't return data
     * @param stopNo - The stop number (e.g., "51479")
     * @param routeNo - Optional route number to filter (e.g., "2", "R5")
     * @returns Array of TripUpdate-like objects with scheduled times
     */
    async getStopEstimates(stopNo: string, routeNo?: string): Promise<TripUpdate[]> {
        try {
            const params = new URLSearchParams({ count: '10', timeframe: '120' });
            if (routeNo) params.set('routeNo', routeNo);

            const url = `${this.baseUrl}/stops/${stopNo}/estimates?${params.toString()}`;
            console.log(`[TransLink] Fetching stop estimates: ${url}`);

            const response = await axios.get(url, { timeout: 10000 });

            if (response.data?.error) {
                console.warn(`[TransLink] RTTI API error: ${response.data.error}`);
                return [];
            }

            // Transform RTTI response to TripUpdate format
            // RTTI returns: [{ RouteNo, RouteName, Direction, Schedules: [{ ExpectedLeaveTime, ExpectedCountdown, ... }] }]
            const results: TripUpdate[] = [];
            const data = Array.isArray(response.data) ? response.data : [];

            for (const route of data) {
                const schedules = route.Schedules || [];
                for (const sched of schedules) {
                    results.push({
                        routeNo: route.RouteNo || routeNo || '',
                        stopNo: stopNo,
                        scheduledTime: sched.ExpectedLeaveTime || '',
                        estimatedTime: sched.ExpectedLeaveTime || '',
                        delay: 0, // RTTI estimates are already adjusted
                        status: 'SCHEDULED' as const,
                        tripId: sched.TripId || `sched-${results.length}`
                    });
                }
            }

            console.log(`[TransLink] Got ${results.length} scheduled estimates for stop ${stopNo}`);
            return results;
        } catch (error) {
            console.error(`[TransLink] getStopEstimates error:`, error);
            return [];
        }
    }

    /**
     * HYBRID Methods
     * Combined logic for UI consumption
     */

    /**
     * Get arrival status for a specific route at a stop
     * 
     * ETA SOURCE PRIORITY:
     * 1. TripUpdate arrival.delay (most accurate) → HIGH confidence
     * 2. VehiclePosition extrapolation → MEDIUM confidence
     * 3. Static schedule fallback → LOW confidence
     * 
     * VEHICLE SELECTION PRIORITY:
     * 1. Trip ID Match: If TripUpdate has trip_id, MUST match VehiclePosition with same trip_id.
     * 2. Distance Fallback: If no TripUpdate or no trip_id match, use closest vehicle.
     */
    async getArrivalsForSegment(
        routeId: string,
        stopId: string,
        options?: {
            preferredTripId?: string;    // Vehicle identity lock: prefer this tripId
            preferredVehicleId?: string; // Vehicle identity lock: prefer this vehicleId
        }
    ): Promise<ETAResult> {
        const now = Date.now();
        const stop = getStopById(stopId);
        const cacheKey = `${routeId}:${stopId}`;

        // Determind Direction based on Stop ID
        let directionId = '0';
        // Check which direction list contains this stop
        if (ROUTE_STOPS[routeId]) {
            for (const dir of Object.keys(ROUTE_STOPS[routeId])) {
                if (ROUTE_STOPS[routeId][dir].includes(stopId)) {
                    directionId = dir;
                    break;
                }
            }
        }

        // Fetch ALL necessary data in parallel
        // We need TripUpdates, VehiclePositions, RouteShape AND StaticStops (for intermediate stop counting)
        const [tripUpdateResult, vehicleResult, shapeResult, staticStopsResult] = await Promise.allSettled([
            this.getRealtimeTripUpdates(routeId, stopId),
            this.getRealtimeVehiclePositions(routeId),
            this.getStaticRouteShape(routeId, directionId),
            this.getStaticStopsForRoute(routeId, directionId)
        ]);

        const vehicles = vehicleResult.status === 'fulfilled' ? vehicleResult.value : [];
        const tripUpdates = tripUpdateResult.status === 'fulfilled' ? tripUpdateResult.value : [];
        const initialShape = shapeResult.status === 'fulfilled' ? shapeResult.value : [];
        const staticStops = staticStopsResult.status === 'fulfilled' ? staticStopsResult.value : [];
        const update = tripUpdates.length > 0 ? tripUpdates[0] : null;

        // ====================================================================
        // VEHICLE IDENTITY LOCKING: Graceful Degradation
        // ====================================================================
        // Priority order for vehicle selection:
        // 1. If caller has a locked tripId, try to find that vehicle first
        // 2. If TripUpdate provides a tripId, use that
        // 3. Fall back to closest vehicle by distance
        //
        // This ensures: TripUpdate → VehiclePosition → Schedule ETA sources
        // can change WITHOUT switching to a different physical bus.
        // ====================================================================

        let selectedVehicle: VehiclePosition | undefined;
        let vehicleLockSource: 'LOCKED_TRIP' | 'LOCKED_VEHICLE' | 'TRIP_UPDATE' | 'DISTANCE' = 'DISTANCE';

        // PRIORITY 1: Caller has a locked tripId - try to honor it
        if (options?.preferredTripId && vehicles.length > 0) {
            const lockedByTrip = vehicles.find(v => v.tripId === options.preferredTripId);
            if (lockedByTrip) {
                selectedVehicle = lockedByTrip;
                vehicleLockSource = 'LOCKED_TRIP';
                console.log(`[TransLink] 🔒 Using locked tripId: ${options.preferredTripId}`);
            }
        }

        // PRIORITY 2: Caller has a locked vehicleId (fallback if tripId not working)
        if (!selectedVehicle && options?.preferredVehicleId && vehicles.length > 0) {
            const lockedByVehicle = vehicles.find(v => v.vehicleId === options.preferredVehicleId);
            if (lockedByVehicle) {
                selectedVehicle = lockedByVehicle;
                vehicleLockSource = 'LOCKED_VEHICLE';
                console.log(`[TransLink] 🔒 Using locked vehicleId: ${options.preferredVehicleId}`);
            }
        }

        // PRIORITY 3: TripUpdate provides a tripId - use that (only if no lock)
        if (!selectedVehicle && update?.tripId && vehicles.length > 0) {
            const matches = vehicles.filter(v => v.tripId === update.tripId);
            if (matches.length > 0) {
                matches.sort((a, b) => {
                    const tA = new Date(a.timestamp).getTime();
                    const tB = new Date(b.timestamp).getTime();
                    return tB - tA; // Newest first
                });
                selectedVehicle = matches[0];
                vehicleLockSource = 'TRIP_UPDATE';
            }
        }

        // PRIORITY 4: Fallback - Closest vehicle (only if no lock and no TripUpdate match)
        if (!selectedVehicle && vehicles.length > 0 && stop) {
            let closest = vehicles[0];
            let closestDist = Infinity;
            for (const v of vehicles) {
                const dist = this.haversineDistance(v.latitude, v.longitude, stop.lat, stop.lon);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = v;
                }
            }
            selectedVehicle = closest;
            vehicleLockSource = 'DISTANCE';
            console.log(`[TransLink] 📍 Fallback: Using closest vehicle (${closestDist.toFixed(2)}km)`);
        }

        // === Step 2: process Vehicle Data for Display ===
        let hasVehiclePosition = false;
        let nearestVehicle: ETAResult['nearestVehicle'] = undefined;
        let vehicleDistKm = 0;

        if (selectedVehicle && stop) {
            // Calculate distance for Map Display (straight line is fine for "nearby" check, 
            // but for ETA we want shape distance)
            const dist = this.haversineDistance(
                selectedVehicle.latitude, selectedVehicle.longitude,
                stop.lat, stop.lon
            );
            vehicleDistKm = dist;

            hasVehiclePosition = true;
            nearestVehicle = {
                latitude: selectedVehicle.latitude,
                longitude: selectedVehicle.longitude,
                bearing: selectedVehicle.bearing || 0,
                distanceKm: dist,
                speed: selectedVehicle.speed || 0
            };
        }

        // === Step 3: Determine Final ETA ===

        // PRIORITY 1: Trip Update (High Accuracy)
        if (update) {
            const estimatedDate = new Date(update.estimatedTime);
            // Ensure we don't show negative minutes
            const minutesUntil = Math.max(0, Math.round((estimatedDate.getTime() - now) / 60000));
            const lastUpdatedSeconds = Math.round((now - estimatedDate.getTime()) / 1000);

            // Update smoothing history so fallback stays in sync
            RealTimeTransitStore.updateHistory(cacheKey, minutesUntil, 'TRIP_UPDATE');

            return {
                minutes: minutesUntil,
                label: this.formatETALabel(minutesUntil),
                source: 'TRIP_UPDATE',
                confidence: 'HIGH',
                lastUpdatedSeconds: Math.abs(lastUpdatedSeconds),
                delay: update.delay,
                status: update.status,
                hasVehiclePosition,
                nearestVehicle,
                tripId: update.tripId,
                scheduledTime: update.scheduledTime // Pass through from TripUpdate
            };
        }

        // PRIORITY 2: Vehicle Position Fallback (Medium Accuracy)
        // Only valid if we have a vehicle and a stop
        if (selectedVehicle && stop) {
            // 2a. Calculate Shape-Based Distance
            let shapeDistKm = vehicleDistKm; // Default to Haversine

            // Try Shape Distance
            if (initialShape.length > 2) {
                const computedDist = this.calculateShapeDistance(
                    selectedVehicle.latitude, selectedVehicle.longitude,
                    stop.lat, stop.lon,
                    initialShape
                );

                if (computedDist !== null) {
                    shapeDistKm = computedDist;
                    console.log(`[TransLink] Shape Dist: ${shapeDistKm.toFixed(2)}km vs Linear: ${vehicleDistKm.toFixed(2)}km`);
                }
            }

            // 2b. Calculate ETA (Improved Logic for Stopped Buses)
            let rawMinutes = 0;
            const vehicleSpeedMps = selectedVehicle.speed || 0; // m/s

            // IF Bus is effectively STOPPED (<= 0.5 m/s or ~1.8 km/h)
            if (vehicleSpeedMps <= 0.5) {
                // Heuristic: Estimate based on "Scheduled" components (Stop Count + Dwell)
                // 1. Find Stops Between Vehicle and Target
                let numIntermediateStops = 0;

                if (staticStops.length > 0) {
                    // Find index of target stop
                    const targetIndex = staticStops.findIndex(s => s.stopId === stopId);

                    // Find index of stop closest to vehicle
                    let vehicleIndex = -1;
                    let closestStopDist = Infinity;

                    staticStops.forEach((s, idx) => {
                        const d = this.haversineDistance(
                            selectedVehicle!.latitude, selectedVehicle!.longitude,
                            s.latitude, s.longitude
                        );
                        if (d < closestStopDist) {
                            closestStopDist = d;
                            vehicleIndex = idx;
                        }
                    });

                    if (targetIndex !== -1 && vehicleIndex !== -1) {
                        // Only count stops strictly BETWEEN (excluding current if stopped at it?)
                        // Simple diff is good enough proxy.
                        numIntermediateStops = Math.max(0, targetIndex - vehicleIndex);
                    }
                }

                // 2. Calculate Travel Time
                // Assume Cruise Speed of 30km/h (0.5 km/min) + 0.5 min Dwell per stop
                const driveTimeMinutes = shapeDistKm * 2.0; // 30km/h
                const dwellTimeMinutes = numIntermediateStops * 0.5;

                rawMinutes = Math.max(1, Math.round(driveTimeMinutes + dwellTimeMinutes));
                console.log(`[TransLink] Stopped Bus Logic: ${numIntermediateStops} stops, ${driveTimeMinutes.toFixed(1)}m drive + ${dwellTimeMinutes}m dwell = ${rawMinutes}m`);

            } else {
                // MOVING: Extrapolate Speed
                const vehicleSpeedKmH = vehicleSpeedMps * 3.6;
                // Cap speed to realistic bounds (5-80 km/h)
                const avgSpeedKmH = Math.max(5, Math.min(vehicleSpeedKmH, 80));
                rawMinutes = Math.max(1, Math.round((shapeDistKm / avgSpeedKmH) * 60));
            }

            // 2c. Calculate context for smarter smoothing
            // Check if vehicle is near any stop (within 100m)
            let nearStop = false;
            for (const s of staticStops) {
                const distToStop = this.haversineDistance(
                    selectedVehicle.latitude, selectedVehicle.longitude,
                    s.latitude, s.longitude
                );
                if (distToStop < 0.1) { // 100 meters
                    nearStop = true;
                    break;
                }
            }

            // 2d. Apply Enhanced Smoothing with Context
            const smoothingContext = {
                vehicleSpeed: vehicleSpeedMps,  // Current speed in m/s
                nearStop                         // Is bus near a stop?
            };
            const { minutes: smoothedMinutes } = RealTimeTransitStore.smoothValue(cacheKey, rawMinutes, smoothingContext);
            const vehicleTimestamp = selectedVehicle.timestamp ? new Date(selectedVehicle.timestamp).getTime() : now;

            console.log(`[TransLink] Fallback ETA: Raw ${rawMinutes}m → Smoothed ${smoothedMinutes}m (speed: ${vehicleSpeedMps.toFixed(1)}m/s, nearStop: ${nearStop})`);

            // Calculate approximate scheduled time (estimate arrival - delay)
            const estArrival = new Date(now + smoothedMinutes * 60000);
            const scheduledTimeStr = `${estArrival.getHours().toString().padStart(2, '0')}:${estArrival.getMinutes().toString().padStart(2, '0')}`;

            return {
                minutes: smoothedMinutes,
                label: this.formatETALabel(smoothedMinutes),
                source: 'VEHICLE_POSITION',
                confidence: 'MEDIUM',
                lastUpdatedSeconds: Math.round((now - vehicleTimestamp) / 1000),
                delay: 0,
                status: 'ON_TIME',
                hasVehiclePosition,
                nearestVehicle,
                scheduledTime: scheduledTimeStr
                // No tripId since fallback
            };
        }

        // PRIORITY 3: Schedule Fallback (Low Accuracy)
        console.log(`[TransLink] No real-time data for ${routeId}@${stopId}, using schedule fallback`);
        return {
            minutes: null,
            label: '--',
            source: 'SCHEDULE',
            confidence: 'LOW',
            lastUpdatedSeconds: 0,
            delay: 0,
            status: 'ON_TIME',
            hasVehiclePosition: false,
            nearestVehicle: undefined,
            scheduledTime: undefined
        };
    }

    /**
     * Calculate distance along the route shape between two points
     * Returns distance in KM, or null if calculation fails/points too far from shape
     */
    private calculateShapeDistance(
        p1Lat: number, p1Lon: number,
        p2Lat: number, p2Lon: number,
        shape: RouteShape[]
    ): number | null {
        if (!shape || shape.length < 2) return null;

        // Find index of closest point on shape to P1 (Vehicle)
        let i1 = -1;
        let minD1 = Infinity;
        // Find index of closest point on shape to P2 (Stop)
        let i2 = -1;
        let minD2 = Infinity;

        // Single pass search
        for (let i = 0; i < shape.length; i++) {
            const d1 = Math.pow(shape[i].lat - p1Lat, 2) + Math.pow(shape[i].lon - p1Lon, 2);
            if (d1 < minD1) { minD1 = d1; i1 = i; }

            const d2 = Math.pow(shape[i].lat - p2Lat, 2) + Math.pow(shape[i].lon - p2Lon, 2);
            if (d2 < minD2) { minD2 = d2; i2 = i; }
        }

        // Validate proximity (if points are > 1km from shape, unsafe to use shape dist)
        // 0.01 degrees approx 1km
        if (minD1 > 0.0002 || minD2 > 0.0002) {
            // ~1.5km tolerance (squared deg dist). 
            // If too far, assume wrong shape or GPS drift -> fallback to Haversine
            return null;
        }

        // If Bus is AFTER Stop implementation-wise, that's ambiguous.
        // Assuming Route Direction matches traversal.
        // If i1 > i2, Bus has passed Stop? Return 0?
        if (i1 >= i2) {
            return 0; // Bus is at or past stop
        }

        // Sum segments from i1 to i2
        let distKm = 0;
        for (let k = i1; k < i2; k++) {
            distKm += this.haversineDistance(
                shape[k].lat, shape[k].lon,
                shape[k + 1].lat, shape[k + 1].lon
            );
        }
        return distKm;
    }

    /**
     * Format ETA into simple minutes label
     * Always shows "{X} min" format
     */
    private formatETALabel(minutes: number): string {
        return `${minutes} min`;
    }

    /**
     * Haversine distance in km
     */
    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Get nearest vehicle position for a route relative to a location
     */
    async getNearestVehiclePosition(
        routeId: string,
        userLat: number,
        userLon: number
    ): Promise<VehiclePosition | null> {
        try {
            const vehicles = await this.getRealtimeVehiclePositions(routeId);
            if (!vehicles || vehicles.length === 0) return null;

            let closest: VehiclePosition | null = null;
            let minDist = Infinity;

            for (const v of vehicles) {
                if (!v.latitude || !v.longitude) continue;
                const dist = this.haversineDistance(userLat, userLon, v.latitude, v.longitude);
                if (dist < minDist) {
                    minDist = dist;
                    closest = v;
                }
            }

            return closest;
        } catch (e) {
            console.error('[TransLink] getNearestVehiclePosition error:', e);
            return null;
        }
    }

    /**
     * Find the index of the closest point on the route shape
     * Used to determine if a vehicle has passed a stop
     */
    private getClosestShapePoint(lat: number, lon: number, shape: RouteShape[]): number {
        if (!shape || shape.length === 0) return -1;

        let minD = Infinity;
        let index = -1;

        for (let i = 0; i < shape.length; i++) {
            const textPt = shape[i];
            const d = Math.pow(textPt.lat - lat, 2) + Math.pow(textPt.lon - lon, 2);
            if (d < minD) {
                minD = d;
                index = i;
            }
        }
        return index;
    }

    /* DEPRECATED ALIASES - To be removed after migration */
    async getRoutes() { return this.getStaticRoutes(); }
    async getStopsForRoute(r: string, d?: string) { return this.getStaticStopsForRoute(r, d); }
    async getNearbyStops(lat: number, lon: number, rad?: number) { return this.getStaticNearbyStops(lat, lon, rad); }
    async getRouteShape(r: string, d?: string) { return this.getStaticRouteShape(r, d); }
    async getTripUpdates(r: string, s: string) { return this.getRealtimeTripUpdates(r, s); }
    async getVehiclePositions(r: string) { return this.getRealtimeVehiclePositions(r); }
    async getServiceAlerts() { return this.getRealtimeServiceAlerts(); }

    /**
     * Calculate delay in minutes between scheduled and estimated times
     */
    calculateDelay(scheduledTime: string, estimatedTime: string): number {
        const scheduled = new Date(scheduledTime);
        const estimated = new Date(estimatedTime);
        return Math.round((estimated.getTime() - scheduled.getTime()) / 60000);
    }
}

export default new TransLinkService();

