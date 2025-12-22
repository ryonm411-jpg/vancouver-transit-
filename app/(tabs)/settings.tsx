import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NotificationService from '../../src/services/NotificationService';
import TransitMonitorService from '../../src/services/TransitMonitorService';
import LocationService from '../../src/services/LocationService';

export default function SettingsScreen() {
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [locationEnabled, setLocationEnabled] = useState(false);
    const [monitoringEnabled, setMonitoringEnabled] = useState(false);

    useEffect(() => {
        checkNotificationPermissions();
        checkMonitoringStatus();
    }, []);

    const checkNotificationPermissions = async () => {
        const hasPermission = await NotificationService.requestPermissions();
        setNotificationsEnabled(hasPermission);
    };

    const checkMonitoringStatus = async () => {
        const isRegistered = await TransitMonitorService.isTransitMonitorRegistered();
        setMonitoringEnabled(isRegistered);

        const isTracking = await LocationService.isTracking();
        setLocationEnabled(isTracking);
    };

    const handleNotificationToggle = async (value: boolean) => {
        if (value) {
            const granted = await NotificationService.requestPermissions();
            setNotificationsEnabled(granted);

            if (!granted) {
                Alert.alert(
                    'Permission Denied',
                    'Please enable notifications in your device settings to receive transit alerts.'
                );
            }
        } else {
            setNotificationsEnabled(false);
        }
    };

    const handleMonitoringToggle = async (value: boolean) => {
        if (value) {
            // Enable monitoring
            await TransitMonitorService.registerTransitMonitor();
            setMonitoringEnabled(true);

            Alert.alert(
                'Monitoring Enabled',
                'Your transit routines will now be monitored for delays. You\'ll receive notifications when delays are detected.'
            );
        } else {
            // Disable monitoring
            await TransitMonitorService.unregisterTransitMonitor();
            setMonitoringEnabled(false);

            Alert.alert(
                'Monitoring Disabled',
                'Transit monitoring has been turned off. You won\'t receive delay notifications.'
            );
        }
    };

    const handleTestNotification = async () => {
        await NotificationService.sendDelayAlert('99', 8);
        Alert.alert('Test Sent', 'Check your notifications!');
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notifications</Text>

                <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>Push Notifications</Text>
                        <Text style={styles.settingDescription}>
                            Receive alerts about delays and route changes
                        </Text>
                    </View>
                    <Switch
                        value={notificationsEnabled}
                        onValueChange={handleNotificationToggle}
                        trackColor={{ false: '#ccc', true: '#0066CC' }}
                    />
                </View>

                <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>Transit Monitoring</Text>
                        <Text style={styles.settingDescription}>
                            Automatically check for delays on your routines
                        </Text>
                    </View>
                    <Switch
                        value={monitoringEnabled}
                        onValueChange={handleMonitoringToggle}
                        trackColor={{ false: '#ccc', true: '#0066CC' }}
                        disabled={!notificationsEnabled}
                    />
                </View>

                {__DEV__ && (
                    <TouchableOpacity style={styles.testButton} onPress={handleTestNotification}>
                        <Text style={styles.testButtonText}>Send Test Notification</Text>
                    </TouchableOpacity>
                )}
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Location</Text>

                <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>Location Tracking</Text>
                        <Text style={styles.settingDescription}>
                            Help improve transit tracking (optional)
                        </Text>
                    </View>
                    <Switch
                        value={locationEnabled}
                        onValueChange={async (value) => {
                            if (value) {
                                const granted = await LocationService.requestPermissions();
                                if (granted) {
                                    await LocationService.startTracking();
                                    setLocationEnabled(true);
                                    Alert.alert('Tracking Enabled', 'Thank you for helping improve transit accuracy!');
                                } else {
                                    Alert.alert('Permission Denied', 'Location permission is required for this feature.');
                                    setLocationEnabled(false);
                                }
                            } else {
                                await LocationService.stopTracking();
                                setLocationEnabled(false);
                            }
                        }}
                        trackColor={{ false: '#ccc', true: '#0066CC' }}
                    />
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>About</Text>

                <TouchableOpacity style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>TransLink API Key</Text>
                        <Text style={styles.settingDescription}>Configure API access</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>Privacy Policy</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#999" />
                </TouchableOpacity>

                <View style={styles.settingRow}>
                    <View style={styles.settingInfo}>
                        <Text style={styles.settingLabel}>Version</Text>
                        <Text style={styles.settingDescription}>1.0.0</Text>
                    </View>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Status</Text>
                <View style={styles.statusCard}>
                    <View style={styles.statusRow}>
                        <Text style={styles.statusLabel}>Notifications:</Text>
                        <Text style={[styles.statusValue, notificationsEnabled && styles.statusValueActive]}>
                            {notificationsEnabled ? 'Enabled' : 'Disabled'}
                        </Text>
                    </View>
                    <View style={styles.statusRow}>
                        <Text style={styles.statusLabel}>Monitoring:</Text>
                        <Text style={[styles.statusValue, monitoringEnabled && styles.statusValueActive]}>
                            {monitoringEnabled ? 'Active' : 'Inactive'}
                        </Text>
                    </View>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    section: {
        backgroundColor: '#fff',
        marginTop: 20,
        paddingVertical: 8,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#666',
        textTransform: 'uppercase',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#f5f5f5',
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    settingInfo: {
        flex: 1,
    },
    settingLabel: {
        fontSize: 16,
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 13,
        color: '#999',
    },
    testButton: {
        margin: 16,
        padding: 12,
        backgroundColor: '#0066CC',
        borderRadius: 8,
        alignItems: 'center',
    },
    testButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
    statusCard: {
        padding: 16,
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
    },
    statusLabel: {
        fontSize: 15,
        color: '#666',
    },
    statusValue: {
        fontSize: 15,
        fontWeight: '600',
        color: '#999',
    },
    statusValueActive: {
        color: '#0066CC',
    },
});
