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
 */
export interface ETAResult {
    minutes: number | null;
    label: 'Arriving' | 'Due' | string;
    source: 'TRIP_UPDATE' | 'VEHICLE_POSITION' | 'SCHEDULE';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    lastUpdatedSeconds: number;
    delay?: number;
    status?: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
}

class TransLinkService {
    private apiKey: string;
    private baseUrl: string;
    private gtfsRtUrl: string;

    constructor() {
        this.apiKey = translinkConfig.apiKey;
        this.baseUrl = translinkConfig.baseUrl;
        this.gtfsRtUrl = translinkConfig.gtfsRtUrl;
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
            return GTFS_STOPS.slice(0, 10).map(stop => ({
                stopNo: stop.code || stop.id,
                stopId: stop.id,
                stopName: stop.name,
                latitude: stop.lat,
                longitude: stop.lon,
                routes: [] // We don't know the routes here without lookup
            }));
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
     * HYBRID Methods
     * Combined logic for UI consumption
     */

    /**
     * Get arrival status for a specific route at a stop
     * PRIORITY ORDER:
     * 1. TripUpdate arrival.delay (most accurate) → HIGH confidence
     * 2. VehiclePosition extrapolation → MEDIUM confidence
     * 3. Static schedule fallback → LOW confidence
     */
    async getArrivalsForSegment(routeId: string, stopId: string): Promise<ETAResult> {
        const now = Date.now();

        // PRIORITY 1: TripUpdate (most reliable - uses stop_time_update.arrival.delay)
        try {
            const updates = await this.getRealtimeTripUpdates(routeId, stopId);
            if (updates && updates.length > 0) {
                const update = updates[0];
                const estimatedDate = new Date(update.estimatedTime);
                const minutesUntil = Math.max(0, Math.round((estimatedDate.getTime() - now) / 60000));
                const lastUpdatedSeconds = Math.round((now - estimatedDate.getTime()) / 1000);

                console.log(`[TransLink] TripUpdate found for ${routeId}@${stopId}: delay=${update.delay}m, ETA=${minutesUntil}m`);

                return {
                    minutes: minutesUntil,
                    label: this.formatETALabel(minutesUntil),
                    source: 'TRIP_UPDATE',
                    confidence: 'HIGH',
                    lastUpdatedSeconds: Math.abs(lastUpdatedSeconds),
                    delay: update.delay,
                    status: update.status
                };
            }
        } catch (e) {
            console.warn('[TransLink] TripUpdate fetch failed, trying VehiclePosition...');
        }

        // PRIORITY 2: VehiclePosition extrapolation
        try {
            const vehicles = await this.getRealtimeVehiclePositions(routeId);
            console.log(`[TransLink] Got ${vehicles.length} vehicles for route ${routeId}`);

            if (vehicles.length > 0) {
                const stop = getStopById(stopId);
                if (stop) {
                    // Find closest vehicle to stop
                    let closestVehicle = vehicles[0];
                    let closestDist = this.haversineDistance(
                        vehicles[0].latitude, vehicles[0].longitude,
                        stop.lat, stop.lon
                    );

                    for (const v of vehicles) {
                        const dist = this.haversineDistance(v.latitude, v.longitude, stop.lat, stop.lon);
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestVehicle = v;
                        }
                    }

                    // Estimate arrival based on distance and speed
                    const vehicleSpeedKmH = closestVehicle.speed > 0 ? closestVehicle.speed * 3.6 : 0;
                    const avgSpeedKmH = vehicleSpeedKmH > 5 && vehicleSpeedKmH < 80 ? vehicleSpeedKmH : 25;
                    const estimatedMinutes = Math.max(1, Math.round((closestDist / avgSpeedKmH) * 60));

                    // Calculate how old the vehicle position is
                    const vehicleTimestamp = closestVehicle.timestamp ? new Date(closestVehicle.timestamp).getTime() : now;
                    const lastUpdatedSeconds = Math.round((now - vehicleTimestamp) / 1000);

                    console.log(`[TransLink] VehiclePosition for ${routeId}: closest bus ${closestDist.toFixed(2)}km from stop, speed=${avgSpeedKmH.toFixed(0)}km/h, ETA=${estimatedMinutes}m`);

                    return {
                        minutes: estimatedMinutes,
                        label: this.formatETALabel(estimatedMinutes),
                        source: 'VEHICLE_POSITION',
                        confidence: 'MEDIUM',
                        lastUpdatedSeconds: Math.max(0, lastUpdatedSeconds),
                        delay: 0,
                        status: 'ON_TIME'
                    };
                } else {
                    console.warn(`[TransLink] Stop ${stopId} not found in GTFS data`);
                }
            }
        } catch (e) {
            console.warn('[TransLink] VehiclePosition fetch failed:', e);
        }

        // PRIORITY 3: Static schedule fallback (no real-time data available)
        console.log(`[TransLink] No real-time data for ${routeId}@${stopId}, using schedule fallback`);
        return {
            minutes: null,
            label: 'Scheduled',
            source: 'SCHEDULE',
            confidence: 'LOW',
            lastUpdatedSeconds: 0,
            delay: 0,
            status: 'ON_TIME'
        };
    }

    /**
     * Format ETA into human-readable label
     * <= 1 min: "Arriving"
     * 2 min: "Due"
     * > 2 min: "{X} min"
     */
    private formatETALabel(minutes: number): string {
        if (minutes <= 1) return 'Arriving';
        if (minutes === 2) return 'Due';
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

