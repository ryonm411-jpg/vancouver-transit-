import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification behavior
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

export type NotificationType =
    | 'DELAY_ALERT'
    | 'BOARDING_REMINDER'
    | 'ROUTE_SUGGESTION'
    | 'CHECK_IN_PROMPT';

export interface NotificationData {
    type: NotificationType;
    routineId?: string;
    routeNo?: string;
    delay?: number;
    alternativeRoute?: string;
    [key: string]: unknown;
}

class NotificationService {
    /**
     * Request notification permissions
     */
    async requestPermissions(): Promise<boolean> {
        try {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }

            if (finalStatus !== 'granted') {
                console.log('Notification permissions not granted');
                return false;
            }

            // Get push token for remote notifications
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('default', {
                    name: 'default',
                    importance: Notifications.AndroidImportance.MAX,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#0066CC',
                });
            }

            return true;
        } catch (error) {
            console.error('Error requesting notification permissions:', error);
            return false;
        }
    }

    /**
     * Send delay alert notification
     */
    async sendDelayAlert(routeNo: string, delay: number, routineId?: string): Promise<void> {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '🚌 Transit Delay',
                body: `Your #${routeNo} bus is delayed by ${delay} minutes`,
                data: {
                    type: 'DELAY_ALERT',
                    routeNo,
                    delay,
                    routineId,
                } as NotificationData,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.HIGH,
            },
            trigger: null, // Send immediately
        });
    }

    /**
     * Send boarding reminder notification
     */
    async sendBoardingReminder(routeNo: string, minutesUntilDeparture: number, routineId?: string): Promise<void> {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '⏰ Time to Board',
                body: `Your #${routeNo} bus departs in ${minutesUntilDeparture} minutes`,
                data: {
                    type: 'BOARDING_REMINDER',
                    routeNo,
                    routineId,
                } as NotificationData,
                sound: true,
            },
            trigger: null,
        });
    }

    /**
     * Send route suggestion notification
     */
    async sendRouteSuggestion(
        originalRoute: string,
        alternativeRoute: string,
        timeSavings: number,
        routineId?: string
    ): Promise<void> {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '💡 Faster Route Available',
                body: `Take #${alternativeRoute} instead of #${originalRoute} to save ${timeSavings} minutes`,
                data: {
                    type: 'ROUTE_SUGGESTION',
                    routeNo: originalRoute,
                    alternativeRoute,
                    routineId,
                } as NotificationData,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.HIGH,
            },
            trigger: null,
        });
    }

    /**
     * Send check-in prompt notification with action buttons
     */
    async sendCheckInPrompt(routeNo: string, routineId: string): Promise<void> {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: '📍 Did you board?',
                body: `Did you board the #${routeNo} bus?`,
                data: {
                    type: 'CHECK_IN_PROMPT',
                    routeNo,
                    routineId,
                } as NotificationData,
                categoryIdentifier: 'CHECK_IN',
                sound: true,
            },
            trigger: null,
        });
    }

    /**
     * Schedule a notification for a specific time
     */
    async scheduleNotification(
        title: string,
        body: string,
        triggerDate: Date,
        data?: NotificationData
    ): Promise<string> {
        const identifier = await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                data: data || {},
                sound: true,
            },
            trigger: { type: 'date', date: triggerDate } as any,
        });

        return identifier;
    }

    /**
     * Cancel a scheduled notification
     */
    async cancelNotification(identifier: string): Promise<void> {
        await Notifications.cancelScheduledNotificationAsync(identifier);
    }

    /**
     * Cancel all scheduled notifications
     */
    async cancelAllNotifications(): Promise<void> {
        await Notifications.cancelAllScheduledNotificationsAsync();
    }

    /**
     * Get all scheduled notifications
     */
    async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
        return await Notifications.getAllScheduledNotificationsAsync();
    }

    /**
     * Add notification response listener
     */
    addNotificationResponseListener(
        callback: (response: Notifications.NotificationResponse) => void
    ): Notifications.Subscription {
        return Notifications.addNotificationResponseReceivedListener(callback);
    }

    /**
     * Add notification received listener (when app is in foreground)
     */
    addNotificationReceivedListener(
        callback: (notification: Notifications.Notification) => void
    ): Notifications.Subscription {
        return Notifications.addNotificationReceivedListener(callback);
    }
}

export default new NotificationService();
