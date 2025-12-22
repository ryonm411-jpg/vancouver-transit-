import { db } from '../config/firebase';
import { collection, addDoc, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { UserNotification } from '../models/types';

const NOTIFICATIONS_COLLECTION = 'notifications';

class NotificationHistoryService {
    /**
     * Save a notification to history
     */
    async saveNotification(
        userId: string,
        type: 'DELAY_ALERT' | 'BOARDING_REMINDER' | 'ROUTE_SUGGESTION' | 'CHECK_IN_PROMPT',
        message: string,
        metadata?: {
            routeNo?: string;
            delay?: number;
            alternativeRoute?: string;
            routineId?: string;
        }
    ): Promise<void> {
        try {
            await addDoc(collection(db, NOTIFICATIONS_COLLECTION), {
                userId,
                type,
                message,
                metadata: metadata || {},
                read: false,
                createdAt: Timestamp.now(),
            });
        } catch (error) {
            console.error('Error saving notification:', error);
        }
    }

    /**
     * Get all notifications for a user
     */
    async getUserNotifications(userId: string): Promise<UserNotification[]> {
        try {
            const q = query(
                collection(db, NOTIFICATIONS_COLLECTION),
                where('userId', '==', userId),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            const notifications: UserNotification[] = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate(),
            } as UserNotification));

            return notifications;
        } catch (error) {
            console.error('Error getting notifications:', error);
            return [];
        }
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(userId: string): Promise<number> {
        try {
            const q = query(
                collection(db, NOTIFICATIONS_COLLECTION),
                where('userId', '==', userId),
                where('read', '==', false)
            );

            const snapshot = await getDocs(q);
            return snapshot.size;
        } catch (error) {
            console.error('Error getting unread count:', error);
            return 0;
        }
    }
}

export default new NotificationHistoryService();
