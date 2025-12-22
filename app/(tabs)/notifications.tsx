import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NotificationHistoryService from '../../src/services/NotificationHistoryService';
import { UserNotification } from '../../src/models/types';
import { useAuth } from '../../src/contexts/AuthContext';

export default function NotificationsScreen() {
    const { userId } = useAuth();
    const [notifications, setNotifications] = useState<UserNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadNotifications = async () => {
        if (!userId) return;

        try {
            const userNotifications = await NotificationHistoryService.getUserNotifications(userId);
            setNotifications(userNotifications);
        } catch (error) {
            console.error('Error loading notifications:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadNotifications();
    }, [userId]);

    const onRefresh = () => {
        setRefreshing(true);
        loadNotifications();
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'DELAY_ALERT':
                return { name: 'alert-circle', color: '#ff3b30' };
            case 'BOARDING_REMINDER':
                return { name: 'time', color: '#0066CC' };
            case 'ROUTE_SUGGESTION':
                return { name: 'bulb', color: '#ff9500' };
            case 'CHECK_IN_PROMPT':
                return { name: 'location', color: '#34c759' };
            default:
                return { name: 'notifications', color: '#999' };
        }
    };

    const formatTime = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        return date.toLocaleDateString();
    };

    return (
        <ScrollView
            style={styles.container}
            refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
        >
            {loading ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>Loading notifications...</Text>
                </View>
            ) : notifications.length === 0 ? (
                <View style={styles.emptyState}>
                    <Ionicons name="notifications-outline" size={64} color="#ccc" />
                    <Text style={styles.emptyStateText}>No notifications</Text>
                    <Text style={styles.emptyStateSubText}>
                        You'll receive notifications about delays and route suggestions here
                    </Text>
                </View>
            ) : (
                <View style={styles.notificationsList}>
                    {notifications.map((notification) => {
                        const icon = getNotificationIcon(notification.type);
                        return (
                            <TouchableOpacity
                                key={notification.id}
                                style={[styles.notificationCard, !notification.read && styles.notificationCardUnread]}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: `${icon.color}15` }]}>
                                    <Ionicons name={icon.name as any} size={24} color={icon.color} />
                                </View>
                                <View style={styles.notificationContent}>
                                    <Text style={styles.notificationMessage}>{notification.message}</Text>
                                    {notification.metadata?.routeNo && (
                                        <Text style={styles.notificationMeta}>Route #{notification.metadata.routeNo}</Text>
                                    )}
                                    <Text style={styles.notificationTime}>
                                        {formatTime(notification.createdAt)}
                                    </Text>
                                </View>
                                {!notification.read && <View style={styles.unreadDot} />}
                            </TouchableOpacity>
                        );
                    })}
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 100,
    },
    emptyStateText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#999',
        marginTop: 16,
    },
    emptyStateSubText: {
        fontSize: 14,
        color: '#aaa',
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 40,
    },
    notificationsList: {
        paddingVertical: 8,
    },
    notificationCard: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        padding: 16,
        marginHorizontal: 16,
        marginVertical: 4,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    notificationCardUnread: {
        borderLeftWidth: 3,
        borderLeftColor: '#0066CC',
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    notificationContent: {
        flex: 1,
    },
    notificationMessage: {
        fontSize: 15,
        color: '#333',
        marginBottom: 4,
    },
    notificationMeta: {
        fontSize: 13,
        color: '#0066CC',
        marginBottom: 4,
    },
    notificationTime: {
        fontSize: 12,
        color: '#999',
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#0066CC',
        marginLeft: 8,
    },
});
