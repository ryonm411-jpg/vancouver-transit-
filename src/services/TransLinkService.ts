import axios from 'axios';
import { translinkConfig } from '../config/config';

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
            // TODO: Implement actual API call to TransLink
            // This is a placeholder implementation
            console.log('Fetching routes from TransLink API...');

            // Mock data for development
            return [
                { routeNo: '99', routeName: '99 B-Line', direction: 'EAST', destination: 'Commercial-Broadway Station' },
                { routeNo: '84', routeName: 'UBC/VCC-Clark Station', direction: 'WEST', destination: 'UBC' },
                { routeNo: '480', routeName: 'UBC/Bridgeport Station', direction: 'SOUTH', destination: 'Bridgeport Station' },
            ];
        } catch (error) {
            console.error('Error fetching routes:', error);
            throw error;
        }
    }

    /**
     * Get stops for a specific route
     */
    async getStopsForRoute(routeNo: string): Promise<TransitStop[]> {
        try {
            console.log(`Fetching stops for route ${routeNo}...`);

            // Mock data for development
            return [
                {
                    stopNo: '61935',
                    stopName: 'Broadway & Commercial',
                    latitude: 49.2625,
                    longitude: -123.0688,
                    routes: ['99', '9', '10']
                },
            ];
        } catch (error) {
            console.error('Error fetching stops:', error);
            throw error;
        }
    }

    /**
     * Get real-time trip updates (delays, cancellations)
     * Uses GTFS-RT Trip Updates feed
     */
    async getTripUpdates(routeNo: string, stopNo: string): Promise<TripUpdate[]> {
        try {
            console.log(`Fetching trip updates for route ${routeNo} at stop ${stopNo}...`);

            const response = await axios.get(`${this.gtfsRtUrl}/tripupdates`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                params: {
                    route: routeNo,
                    stop: stopNo,
                }
            });

            // Parse GTFS-RT protobuf data
            // TODO: Implement actual parsing logic
            // Mock data for development - Simulate a delay on route 99
            if (routeNo === '99') {
                return [{
                    routeNo: '99',
                    stopNo: stopNo,
                    scheduledTime: new Date().toISOString(),
                    estimatedTime: new Date(Date.now() + 15 * 60000).toISOString(), // 15 min delay
                    delay: 15,
                    status: 'DELAYED'
                }];
            }
            return [];
        } catch (error) {
            console.error('Error fetching trip updates:', error);
            throw error;
        }
    }

    /**
     * Get real-time vehicle positions
     * Uses GTFS-RT Vehicle Positions feed
     */
    async getVehiclePositions(routeNo: string): Promise<VehiclePosition[]> {
        try {
            console.log(`Fetching vehicle positions for route ${routeNo}...`);

            const response = await axios.get(`${this.gtfsRtUrl}/vehiclepositions`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                params: {
                    route: routeNo,
                }
            });

            // Parse GTFS-RT protobuf data
            // TODO: Implement actual parsing logic
            return [];
        } catch (error) {
            console.error('Error fetching vehicle positions:', error);
            throw error;
        }
    }

    /**
     * Get service alerts (disruptions, detours)
     * Uses GTFS-RT Service Alerts feed
     */
    async getServiceAlerts(): Promise<any[]> {
        try {
            console.log('Fetching service alerts...');

            const response = await axios.get(`${this.gtfsRtUrl}/servicealerts`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                }
            });

            // Parse GTFS-RT protobuf data
            // TODO: Implement actual parsing logic
            return [];
        } catch (error) {
            console.error('Error fetching service alerts:', error);
            throw error;
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
