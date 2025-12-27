import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TransLinkService, { VehiclePosition } from '../services/TransLinkService';

interface TransitMapProps {
    onBusPress?: (bus: VehiclePosition) => void;
}

export default function TransitMapWeb({ onBusPress }: TransitMapProps) {
    const [buses, setBuses] = useState<VehiclePosition[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchBuses();
        const interval = setInterval(fetchBuses, 15000);
        return () => clearInterval(interval);
    }, []);

    const fetchBuses = async () => {
        try {
            const allVehicles = await TransLinkService.getRealtimeVehiclePositions('');
            setBuses(allVehicles);
            setLoading(false);
        } catch (err) {
            console.error('[TransitMapWeb] Error fetching buses:', err);
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#0066CC" />
                <Text style={styles.loadingText}>Loading transit data...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Ionicons name="bus" size={32} color="#0066CC" />
                <Text style={styles.title}>Live Transit Vehicles</Text>
            </View>

            <View style={styles.debugOverlay}>
                <Text style={styles.debugText}>Buses loaded: {buses.length}</Text>
                {buses.length > 0 && (
                    <Text style={styles.debugText}>
                        Routes: {buses.map(b => b.routeNo).join(', ')}
                    </Text>
                )}
            </View>

            <ScrollView style={styles.list}>
                {buses.map((bus, index) => (
                    <View key={`${bus.routeNo}-${index}`} style={styles.busCard}>
                        <View style={styles.busIcon}>
                            <Ionicons name="bus" size={24} color="#fff" />
                        </View>
                        <View style={styles.busInfo}>
                            <Text style={styles.routeNumber}>Route {bus.routeNo}</Text>
                            <Text style={styles.location}>
                                📍 {bus.latitude.toFixed(4)}, {bus.longitude.toFixed(4)}
                            </Text>
                            <Text style={styles.speed}>
                                Speed: {bus.speed || 0} km/h | Bearing: {bus.bearing || 0}°
                            </Text>
                        </View>
                    </View>
                ))}

                {buses.length === 0 && (
                    <View style={styles.emptyState}>
                        <Ionicons name="navigate-outline" size={48} color="#ccc" />
                        <Text style={styles.emptyText}>No buses available</Text>
                        <Text style={styles.emptySubtext}>Using mock data for demonstration</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f5f5',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#666',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        gap: 12,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#333',
    },
    debugOverlay: {
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: 12,
        margin: 16,
        borderRadius: 8,
    },
    debugText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    list: {
        flex: 1,
        padding: 16,
    },
    busCard: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    busIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    busInfo: {
        flex: 1,
    },
    routeNumber: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0066CC',
        marginBottom: 4,
    },
    location: {
        fontSize: 14,
        color: '#666',
        marginBottom: 2,
    },
    speed: {
        fontSize: 12,
        color: '#999',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#999',
        marginTop: 16,
    },
    emptySubtext: {
        fontSize: 14,
        color: '#ccc',
        marginTop: 8,
    },
});
