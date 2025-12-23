import axios from 'axios';
import { translinkConfig } from '../config/config';
import { GtfsParser, ServiceAlert } from '../utils/GtfsParser';

export interface TransitRoute {
    routeNo: string;
    routeName: string;
    direction: string;
    destination: string;
}

export interface TransitStop {
    stopNo: string;
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
     */
    async getRoutes(): Promise<TransitRoute[]> {
        try {
            console.log('[TransLink] Fetching routes from TransLink REST API...');

            const response = await axios.get(`${this.baseUrl}/routes`, {
                params: {
                    apikey: this.apiKey,
                },
                headers: {
                    accept: 'application/JSON',
                },
                timeout: 10000,
            });

            // Parse response and transform to our interface
            const routes: TransitRoute[] = [];

            for (const route of response.data) {
                // TransLink returns multiple patterns per route, take first one for simplicity
                const pattern = route.Patterns?.[0];

                routes.push({
                    routeNo: route.RouteNo,
                    routeName: route.Name || `Route ${route.RouteNo}`,
                    direction: pattern?.Direction || 'UNKNOWN',
                    destination: pattern?.Destination || route.Name,
                });
            }

            console.log(`[TransLink] Found ${routes.length} routes`);
            return routes;
        } catch (error: any) {
            console.error('[TransLink] Error fetching routes:', error.message);
            // Return mock data for demonstration
            console.log('[TransLink] Using mock route data for demonstration');
            return [
                { routeNo: '99', routeName: '99 B-Line', direction: 'EAST', destination: 'Commercial-Broadway' },
                { routeNo: '84', routeName: '84 UBC/VCC-Clark', direction: 'WEST', destination: 'UBC' },
                { routeNo: '3', routeName: '3 Main St', direction: 'SOUTH', destination: 'Marine Dr Station' },
                { routeNo: '25', routeName: '25 Brentwood Station', direction: 'NORTH', destination: 'Brentwood' },
                { routeNo: '10', routeName: '10 Hastings', direction: 'EAST', destination: 'Hastings' },
            ];
        }
    }

    /**
     * Get stops for a specific route
     */
    async getStopsForRoute(routeNo: string): Promise<TransitStop[]> {
        try {
            console.log(`[TransLink] Fetching stops for route ${routeNo}...`);

            // Get route info with stops
            const response = await axios.get(`${this.baseUrl}/routes/${routeNo}`, {
                params: {
                    apikey: this.apiKey,
                },
                headers: {
                    accept: 'application/JSON',
                },
                timeout: 10000,
            });

            const stops: TransitStop[] = [];
            const seenStops = new Set<string>();

            // Parse patterns and extract unique stops
            for (const pattern of response.data.Patterns || []) {
                for (const stop of pattern.Stops || []) {
                    // Avoid duplicates
                    if (seenStops.has(stop.StopNo)) continue;
                    seenStops.add(stop.StopNo);

                    stops.push({
                        stopNo: stop.StopNo,
                        stopName: stop.Name,
                        latitude: stop.Latitude,
                        longitude: stop.Longitude,
                        routes: [routeNo], // This stop serves at least this route
                    });
                }
            }

            console.log(`[TransLink] Found ${stops.length} stops for route ${routeNo}`);
            return stops;
        } catch (error: any) {
            console.error('[TransLink] Error fetching stops:', error.message);
            // Return mock stops for demonstration
            console.log(`[TransLink] Using mock stop data for route ${routeNo}`);
            return [
                {
                    stopNo: '61935',
                    stopName: 'Broadway & Commercial',
                    latitude: 49.2625,
                    longitude: -123.0688,
                    routes: [routeNo]
                },
                {
                    stopNo: '50123',
                    stopName: 'Main St & Broadway',
                    latitude: 49.2632,
                    longitude: -123.1005,
                    routes: [routeNo]
                },
                {
                    stopNo: '50456',
                    stopName: 'Granville & Broadway',
                    latitude: 49.2634,
                    longitude: -123.1364,
                    routes: [routeNo]
                },
            ];
        }
    }

    /**
     * Get real-time trip updates (delays, cancellations)
     * Uses GTFS-RT Trip Updates feed
     */
    async getTripUpdates(routeNo: string, stopNo: string): Promise<TripUpdate[]> {
        try {
            console.log(`[TransLink] Fetching trip updates for route ${routeNo} at stop ${stopNo}...`);

            // Fetch GTFS-RT protobuf data from TransLink
            const response = await axios.get(`${this.gtfsRtUrl}/TripUpdates`, {
                params: {
                    apikey: this.apiKey,
                },
                responseType: 'arraybuffer',
                timeout: 10000, // 10 second timeout
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

            // Fetch GTFS-RT protobuf data from TransLink
            const response = await axios.get(`${this.gtfsRtUrl}/VehiclePositions`, {
                params: {
                    apikey: this.apiKey,
                },
                responseType: 'arraybuffer',
                timeout: 10000,
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
            const response = await axios.get(`${this.gtfsRtUrl}/ServiceAlerts`, {
                params: {
                    apikey: this.apiKey,
                },
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
