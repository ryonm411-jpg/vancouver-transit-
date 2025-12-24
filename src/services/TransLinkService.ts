import axios from 'axios';
import { translinkConfig } from '../config/config';
import { GtfsParser, ServiceAlert } from '../utils/GtfsParser';
import { ROUTES as GTFS_ROUTES, getRouteDisplayName } from '../data/routes';
import { STOPS as GTFS_STOPS, findNearbyStops, getStopById } from '../data/stops';
import { ROUTE_SHAPES, RouteShape } from '../data/routeShapes';
import { ROUTE_STOPS } from '../data/routeStops';

export interface TransitRoute {
    routeNo: string;
    routeId: string; // GTFS route_id
    routeName: string;
    direction: string;
    destination: string;
}

export interface TransitStop {
    stopNo: string;
    stopId: string;  // GTFS stop_id for route lookups
    stopName: string;
    latitude: number;
    longitude: number;
    routes: string[];
}

export interface TripUpdate {
    routeNo: string;
    stopNo: string;
    scheduledTime: string;
    estimatedTime: string;
    delay: number; // in minutes
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
}

export interface VehiclePosition {
    routeNo: string;
    latitude: number;
    longitude: number;
    bearing: number;
    speed: number;
    timestamp: string;
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
     * Get all available transit routes
     * Uses real GTFS data (242 routes)
     */
    async getRoutes(): Promise<TransitRoute[]> {
        console.log(`[TransLink] Returning ${GTFS_ROUTES.length} routes from GTFS data`);

        return GTFS_ROUTES.map(route => ({
            routeNo: route.shortName || route.id,
            routeId: route.id,
            routeName: route.shortName ? `${route.shortName} ${route.longName}` : route.longName,
            direction: 'BOTH', // GTFS doesn't have direction at route level
            destination: route.longName
        })).filter(r => r.routeNo); // Filter out routes without short names (like SkyTrain)
    }

    /**
     * Get stops for a specific route
     * Uses real GTFS data with generated stop sequences
     */
    async getStopsForRoute(routeNo: string, directionId: string = '0'): Promise<TransitStop[]> {
        // Find route ID from route number (or use as is if it looks like an ID)
        const route = GTFS_ROUTES.find(r => r.shortName === routeNo || r.id === routeNo);
        if (!route) {
            console.warn(`[TransLink] Route not found: ${routeNo}`);
            return [];
        }

        const routeId = route.id;
        console.log(`[TransLink] Getting stops for route ${routeNo} (ID: ${routeId}, Dir: ${directionId})`);

        const stopIds = ROUTE_STOPS[routeId]?.[directionId];
        if (!stopIds) {
            console.warn(`[TransLink] No stops found for route ${routeId} dir ${directionId}`);
            // Fallback: return sample stops if no sequence found
            return GTFS_STOPS.slice(0, 10).map(stop => ({
                stopNo: stop.code || stop.id,
                stopId: stop.id,
                stopName: stop.name,
                latitude: stop.lat,
                longitude: stop.lon,
                routes: [routeNo]
            }));
        }

        // Map stop IDs to full stop objects
        return stopIds.map(id => {
            const stop = getStopById(id);
            if (!stop) return null;
            return {
                stopNo: stop.code || stop.id,
                stopId: stop.id,
                stopName: stop.name,
                latitude: stop.lat,
                longitude: stop.lon,
                routes: [routeNo]
            };
        }).filter(s => s !== null) as TransitStop[];
    }

    /**
     * Get shape (polyline) for a specific route
     */
    async getRouteShape(routeNo: string, directionId: string = '0'): Promise<RouteShape[]> {
        const route = GTFS_ROUTES.find(r => r.shortName === routeNo || r.id === routeNo);
        if (!route) return [];

        const routeId = route.id;
        return ROUTE_SHAPES[routeId]?.[directionId] || [];
    }

    /**
     * Get stops near a location
     * Uses real GTFS data
     */
    async getNearbyStops(lat: number, lon: number, radiusKm: number = 0.5): Promise<TransitStop[]> {
        const nearby = findNearbyStops(lat, lon, radiusKm);
        console.log(`[TransLink] Found ${nearby.length} stops within ${radiusKm}km`);

        return nearby.map(stop => ({
            stopNo: stop.code || stop.id,
            stopId: stop.id,  // Include the GTFS stop_id for route lookups
            stopName: stop.name,
            latitude: stop.lat,
            longitude: stop.lon,
            routes: [] // We now use stopRoutes.ts for this
        }));
    }

    /**
     * Get real-time trip updates (delays, cancellations)
     * Uses GTFS-RT Trip Updates feed
     */
    async getTripUpdates(routeNo: string, stopNo: string): Promise<TripUpdate[]> {
        try {
            console.log(`[TransLink] Fetching trip updates for route ${routeNo} at stop ${stopNo}...`);

            // Fetch GTFS-RT protobuf data (no API key needed)
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsrealtime`, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });

            // Parse the protobuf data and filter for our route/stop
            const allUpdates = GtfsParser.parseTripUpdates(response.data, routeNo, stopNo);
            console.log(`[TransLink] Found ${allUpdates.length} trip updates for route ${routeNo} at stop ${stopNo}`);

            return allUpdates;
        } catch (error: any) {
            console.error('[TransLink] Error fetching trip updates:', error.message);
            // Return empty array on error to prevent app crash
            return [];
        }
    }

    /**
     * Get real-time vehicle positions
     * Uses GTFS-RT Vehicle Positions feed
     */
    async getVehiclePositions(routeNo: string): Promise<VehiclePosition[]> {
        try {
            console.log(`[TransLink] Fetching vehicle positions for route ${routeNo}...`);

            // Fetch GTFS-RT protobuf data (no API key needed)
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsposition`, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });

            // Parse the protobuf data and filter for our route
            const positions = GtfsParser.parseVehiclePositions(response.data, routeNo);
            console.log(`[TransLink] Found ${positions.length} vehicle positions for route ${routeNo}`);

            return positions;
        } catch (error: any) {
            console.error('[TransLink] Error fetching vehicle positions:', error.message);
            // Return mock vehicle positions for demonstration
            console.log('[TransLink] Using mock vehicle position data');
            return [
                {
                    routeNo: '99',
                    latitude: 49.2610,
                    longitude: -123.0750,
                    bearing: 90,
                    speed: 25,
                    timestamp: new Date().toISOString()
                },
                {
                    routeNo: '99',
                    latitude: 49.2640,
                    longitude: -123.1200,
                    bearing: 90,
                    speed: 20,
                    timestamp: new Date().toISOString()
                },
                {
                    routeNo: '84',
                    latitude: 49.2630,
                    longitude: -123.2456,
                    bearing: 270,
                    speed: 30,
                    timestamp: new Date().toISOString()
                },
                {
                    routeNo: '3',
                    latitude: 49.2500,
                    longitude: -123.1100,
                    bearing: 180,
                    speed: 22,
                    timestamp: new Date().toISOString()
                },
                {
                    routeNo: '25',
                    latitude: 49.2700,
                    longitude: -123.1000,
                    bearing: 0,
                    speed: 28,
                    timestamp: new Date().toISOString()
                },
            ];
        }
    }

    /**
     * Get service alerts (disruptions, detours)
     * Uses GTFS-RT Service Alerts feed
     */
    async getServiceAlerts(): Promise<ServiceAlert[]> {
        try {
            console.log('[TransLink] Fetching service alerts...');

            // Fetch GTFS-RT protobuf data from TransLink
            const response = await axios.get(`${this.gtfsRtUrl}/gtfsalerts`, {
                responseType: 'arraybuffer',
                timeout: 10000,
            });

            // Parse the protobuf data
            const alerts = GtfsParser.parseServiceAlerts(response.data);
            console.log(`[TransLink] Found ${alerts.length} active service alerts`);

            return alerts;
        } catch (error: any) {
            console.error('[TransLink] Error fetching service alerts:', error.message);
            return [];
        }
    }

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
