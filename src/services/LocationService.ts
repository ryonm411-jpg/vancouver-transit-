import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { db } from '../config/firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { appConfig } from '../config/config';

const LOCATION_TRACKING_TASK = 'LOCATION_TRACKING_TASK';
const VEHICLE_POSITIONS_COLLECTION = 'crowdsourced_positions';

// Define the background task
TaskManager.defineTask(LOCATION_TRACKING_TASK, async ({ data, error }) => {
    if (error) {
        console.error('[LocationService] Background task error:', error);
        return;
    }

    if (data) {
        const { locations } = data as { locations: Location.LocationObject[] };
        const location = locations[0];

        if (location) {
            console.log('[LocationService] Background location:', location.coords);

            // TODO: Get active trip info from local storage or state
            // For now, we'll just log it. In a real app, we'd attach the routeNo.
            await saveLocationUpdate(location);
        }
    }
});

/**
 * Save location update to Firestore
 */
async function saveLocationUpdate(location: Location.LocationObject, routeNo?: string) {
    try {
        await addDoc(collection(db, VEHICLE_POSITIONS_COLLECTION), {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            speed: location.coords.speed,
            heading: location.coords.heading,
            accuracy: location.coords.accuracy,
            timestamp: Timestamp.fromMillis(location.timestamp),
            routeNo: routeNo || 'UNKNOWN',
            userId: 'demo-user', // TODO: Use actual user ID
            source: 'CROWDSOURCED'
        });
    } catch (error) {
        console.error('[LocationService] Error saving location:', error);
    }
}

class LocationService {
    /**
     * Request permissions for background location tracking
     */
    async requestPermissions(): Promise<boolean> {
        try {
            const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
            if (foregroundStatus !== 'granted') {
                console.log('[LocationService] Foreground permission denied');
                return false;
            }

            const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
            if (backgroundStatus !== 'granted') {
                console.log('[LocationService] Background permission denied');
                return false;
            }

            return true;
        } catch (error) {
            console.error('[LocationService] Error requesting permissions:', error);
            return false;
        }
    }

    /**
     * Start tracking location in background
     */
    async startTracking(): Promise<void> {
        try {
            const hasPermissions = await this.requestPermissions();
            if (!hasPermissions) return;

            await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, {
                accuracy: Location.Accuracy.High,
                timeInterval: appConfig.locationUpdateInterval * 1000, // Convert to ms
                distanceInterval: 50, // Update every 50 meters
                foregroundService: {
                    notificationTitle: "Transit Tracking Active",
                    notificationBody: "Sharing your location to help track buses.",
                },
            });

            console.log('[LocationService] Tracking started');
        } catch (error) {
            console.error('[LocationService] Error starting tracking:', error);
        }
    }

    /**
     * Stop tracking location
     */
    async stopTracking(): Promise<void> {
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TRACKING_TASK);
            if (isRegistered) {
                await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
                console.log('[LocationService] Tracking stopped');
            }
        } catch (error) {
            console.error('[LocationService] Error stopping tracking:', error);
        }
    }

    /**
     * Check if tracking is active
     */
    async isTracking(): Promise<boolean> {
        return await TaskManager.isTaskRegisteredAsync(LOCATION_TRACKING_TASK);
    }
}

export default new LocationService();
