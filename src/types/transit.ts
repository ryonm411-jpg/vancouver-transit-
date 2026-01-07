/**
 * Shared TypeScript interfaces for Transit services
 * Extracted to avoid circular dependencies between TransLinkService and RealTimeTransitStore
 */

export interface TransitRoute {
    routeNo: string;
    routeId: string; // GTFS route_id
    routeName: string;
    direction: string;
    destination: string;
}

export interface TransitStop {
    stopNo: string;
    stopId: string; // GTFS stop_id
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
    delay: number;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    tripId?: string;
}

export interface VehiclePosition {
    routeNo: string;
    routeId: string;
    latitude: number;
    longitude: number;
    bearing: number;
    speed: number;
    timestamp: string;
    tripId?: string;
}
