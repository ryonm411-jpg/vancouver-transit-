import TransLinkService, { VehiclePosition, TransitStop } from './TransLinkService';
import * as Location from 'expo-location';

interface TripState {
    routeNo: string;
    vehiclePosition: VehiclePosition | null;
    userPosition: Location.LocationObject | null;
    nextStop: TransitStop | null;
    eta: number | null; // minutes
    distanceToStop: number | null; // meters
    isOnVehicle: boolean;
}

interface TripInstruction {
    type: 'walk' | 'board' | 'onboard' | 'exit';
    message: string;
    distance?: number;
}

class TripTrackingService {
    private static WALKING_SPEED = 1.4; // m/s (5 km/h)
    private static STOP_PROXIMITY_THRESHOLD = 200; // meters
    private static VEHICLE_PROXIMITY_THRESHOLD = 50; // meters

    /**
     * Track vehicle position for a specific route
     */
    static async trackVehicle(routeNo: string): Promise<VehiclePosition | null> {
        try {
            const vehicles = await TransLinkService.getVehiclePositions(routeNo);

            // Return first vehicle for this route
            // In production, would match by vehicle ID
            return vehicles.find(v => v.routeNo === routeNo) || null;
        } catch (error) {
            console.error('[TripTracking] Error tracking vehicle:', error);
            return null;
        }
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    static calculateDistance(
        lat1: number,
        lon1: number,
        lat2: number,
        lon2: number
    ): number {
        const R = 6371e3; // Earth radius in meters
        const φ1 = (lat1 * Math.PI) / 180;
        const φ2 = (lat2 * Math.PI) / 180;
        const Δφ = ((lat2 - lat1) * Math.PI) / 180;
        const Δλ = ((lon2 - lon1) * Math.PI) / 180;

        const a =
            Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distance in meters
    }

    /**
     * Calculate ETA to stop based on user and vehicle positions
     */
    static calculateETA(
        userPosition: Location.LocationObject,
        vehiclePosition: VehiclePosition | null,
        targetStop: TransitStop
    ): number {
        // Distance from user to stop
        const distanceToStop = this.calculateDistance(
            userPosition.coords.latitude,
            userPosition.coords.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        // If no vehicle data, estimate based on walking time only
        if (!vehiclePosition) {
            return Math.ceil(distanceToStop / this.WALKING_SPEED / 60); // minutes
        }

        // Distance from vehicle to stop
        const vehicleToStop = this.calculateDistance(
            vehiclePosition.latitude,
            vehiclePosition.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        // Vehicle speed in m/s (convert from km/h)
        const vehicleSpeed = (vehiclePosition.speed || 30) / 3.6;

        // Time for vehicle to reach stop
        const vehicleTime = vehicleToStop / vehicleSpeed;

        // Time for user to walk to stop
        const walkTime = distanceToStop / this.WALKING_SPEED;

        // Total ETA (max of walk time and vehicle time)
        return Math.ceil(Math.max(walkTime, vehicleTime) / 60); // minutes
    }

    /**
     * Get current trip instruction based on positions
     */
    static getTripInstruction(
        userPosition: Location.LocationObject,
        vehiclePosition: VehiclePosition | null,
        targetStop: TransitStop,
        routeNo: string
    ): TripInstruction {
        const distanceToStop = this.calculateDistance(
            userPosition.coords.latitude,
            userPosition.coords.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        // Check if user is on the vehicle
        if (vehiclePosition) {
            const distanceToVehicle = this.calculateDistance(
                userPosition.coords.latitude,
                userPosition.coords.longitude,
                vehiclePosition.latitude,
                vehiclePosition.longitude
            );

            if (distanceToVehicle < this.VEHICLE_PROXIMITY_THRESHOLD) {
                return {
                    type: 'onboard',
                    message: `On Route ${routeNo} - Next stop: ${targetStop.stopName}`,
                };
            }
        }

        // User approaching stop
        if (distanceToStop < this.STOP_PROXIMITY_THRESHOLD) {
            return {
                type: 'board',
                message: `Approaching ${targetStop.stopName} - Wait for Route ${routeNo}`,
                distance: Math.round(distanceToStop),
            };
        }

        // User walking to stop
        return {
            type: 'walk',
            message: `Walk to ${targetStop.stopName}`,
            distance: Math.round(distanceToStop),
        };
    }

    /**
     * Check if user should be alerted about approaching stop
     */
    static shouldAlertApproachingStop(
        userPosition: Location.LocationObject,
        targetStop: TransitStop
    ): boolean {
        const distance = this.calculateDistance(
            userPosition.coords.latitude,
            userPosition.coords.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        return distance < this.STOP_PROXIMITY_THRESHOLD;
    }

    /**
     * Check if vehicle is approaching stop
     */
    static shouldAlertVehicleArriving(
        vehiclePosition: VehiclePosition | null,
        targetStop: TransitStop
    ): boolean {
        if (!vehiclePosition) return false;

        const distance = this.calculateDistance(
            vehiclePosition.latitude,
            vehiclePosition.longitude,
            targetStop.latitude,
            targetStop.longitude
        );

        // Alert if vehicle is within 500m
        return distance < 500;
    }
}

export default TripTrackingService;
export type { TripState, TripInstruction };
