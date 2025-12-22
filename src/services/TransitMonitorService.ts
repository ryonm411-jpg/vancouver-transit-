import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import NotificationService from './NotificationService';
import RoutineService from './RoutineService';
import TransLinkService from './TransLinkService';
import RouteOptimizationService from './RouteOptimizationService';
import { appConfig } from '../config/config';
import { Routine } from '../models/types';

const TRANSIT_MONITOR_TASK = 'TRANSIT_MONITOR_TASK';

/**
 * Background task to monitor transit schedules and detect delays
 */
TaskManager.defineTask(TRANSIT_MONITOR_TASK, async () => {
    try {
        console.log('[TransitMonitor] Running background check...');

        // Get current time
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;
        const currentDay = now.getDay();

        // TODO: Get actual user ID from auth
        const userId = 'demo-user';

        // Get active routines
        const routines = await RoutineService.getActiveRoutines(userId);

        // Check each routine
        for (const routine of routines) {
            // Check if routine is scheduled for today
            if (!isRoutineScheduledToday(routine, currentDay)) {
                continue;
            }

            // Check each segment
            for (const segment of routine.segments) {
                const [segmentHour, segmentMinute] = segment.scheduledTime.split(':').map(Number);
                const segmentTime = segmentHour * 60 + segmentMinute;

                // Check if we should monitor this segment (within monitoring window)
                const timeUntilDeparture = segmentTime - currentTime;

                // Monitor 15 minutes before departure
                if (timeUntilDeparture > 0 && timeUntilDeparture <= 15) {
                    await checkForDelays(routine, segment);
                }

                // Send boarding reminder
                if (timeUntilDeparture === appConfig.boardingReminderTime) {
                    await NotificationService.sendBoardingReminder(
                        segment.routeNumber,
                        timeUntilDeparture,
                        routine.id
                    );
                }
            }
        }

        return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
        console.error('[TransitMonitor] Error:', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

/**
 * Check if routine is scheduled for today
 */
function isRoutineScheduledToday(routine: Routine, currentDay: number): boolean {
    if (routine.frequency === 'daily') {
        return true;
    }

    if (routine.frequency === 'weekly' && routine.daysOfWeek) {
        return routine.daysOfWeek.includes(currentDay);
    }

    return false;
}

/**
 * Check for delays on a specific segment
 */
async function checkForDelays(routine: Routine, segment: any) {
    try {
        // Fetch real-time trip updates from TransLink
        const tripUpdates = await TransLinkService.getTripUpdates(
            segment.routeNumber,
            segment.stopId
        );

        // Check for delays
        for (const update of tripUpdates) {
            if (update.delay >= appConfig.delayThreshold) {
                // Send delay notification
                await NotificationService.sendDelayAlert(
                    segment.routeNumber,
                    update.delay,
                    routine.id
                );

                console.log(`[TransitMonitor] Delay detected: Route ${segment.routeNumber}, ${update.delay} minutes`);

                // Check for alternative routes
                try {
                    const suggestion = await RouteOptimizationService.findAlternativeRoutes(
                        segment.routeNumber,
                        segment.destination,
                        update.delay
                    );

                    if (suggestion) {
                        await NotificationService.sendRouteSuggestion(
                            suggestion.originalRoute,
                            suggestion.alternativeRoute,
                            suggestion.timeSavings,
                            routine.id
                        );
                        console.log(`[TransitMonitor] Route suggestion sent: Take ${suggestion.alternativeRoute} to save ${suggestion.timeSavings} mins`);
                    }
                } catch (optError) {
                    console.error('[TransitMonitor] Error finding alternatives:', optError);
                }
            }
        }
    } catch (error) {
        console.error('[TransitMonitor] Error checking delays:', error);
    }
}

/**
 * Register background task
 */
export async function registerTransitMonitor() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(TRANSIT_MONITOR_TASK);

        if (!isRegistered) {
            await BackgroundFetch.registerTaskAsync(TRANSIT_MONITOR_TASK, {
                minimumInterval: appConfig.transitMonitorInterval, // 2 minutes
                stopOnTerminate: false,
                startOnBoot: true,
            });

            console.log('[TransitMonitor] Background task registered');
        }
    } catch (error) {
        console.error('[TransitMonitor] Error registering task:', error);
    }
}

/**
 * Unregister background task
 */
export async function unregisterTransitMonitor() {
    try {
        await TaskManager.unregisterTaskAsync(TRANSIT_MONITOR_TASK);
        console.log('[TransitMonitor] Background task unregistered');
    } catch (error) {
        console.error('[TransitMonitor] Error unregistering task:', error);
    }
}

/**
 * Check if background task is registered
 */
export async function isTransitMonitorRegistered(): Promise<boolean> {
    return await TaskManager.isTaskRegisteredAsync(TRANSIT_MONITOR_TASK);
}

export default {
    registerTransitMonitor,
    unregisterTransitMonitor,
    isTransitMonitorRegistered,
};
