import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import RoutineService from '../../src/services/RoutineService';
import { Routine } from '../../src/models/types';

export default function RoutinesScreen() {
    const router = useRouter();
    const [routines, setRoutines] = useState<Routine[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // TODO: Replace with actual user ID from authentication
    const userId = 'demo-user';

    const loadRoutines = async () => {
        try {
            const userRoutines = await RoutineService.getUserRoutines(userId);
            setRoutines(userRoutines);
        } catch (error) {
            console.error('Error loading routines:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadRoutines();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        loadRoutines();
    };

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {loading ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateText}>Loading routines...</Text>
                    </View>
                ) : routines.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="calendar-outline" size={64} color="#ccc" />
                        <Text style={styles.emptyStateText}>No routines created</Text>
                        <Text style={styles.emptyStateSubText}>
                            Create a routine to track your daily or weekly transit schedule
                        </Text>
                    </View>
                ) : (
                    <View style={styles.routinesList}>
                        {routines.map(routine => (
                            <TouchableOpacity
                                key={routine.id}
                                style={[styles.routineCard, !routine.active && styles.routineCardInactive]}
                                onPress={() => {
                                    // TODO: Navigate to routine detail/edit
                                    console.log('Edit routine:', routine.id);
                                }}
                            >
                                <View style={styles.routineHeader}>
                                    <View>
                                        <Text style={styles.routineName}>{routine.name}</Text>
                                        <Text style={styles.routineFrequency}>
                                            {routine.frequency === 'daily' ? 'Daily' : 'Weekly'}
                                            {routine.active ? ' • Active' : ' • Inactive'}
                                        </Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={20} color="#999" />
                                </View>
                                <Text style={styles.segmentCount}>
                                    {routine.segments.length} segment{routine.segments.length !== 1 ? 's' : ''}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </ScrollView>

            <TouchableOpacity
                style={styles.fab}
                onPress={() => router.push('/create-routine')}
            >
                <Ionicons name="add" size={32} color="#fff" />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    scrollView: {
        flex: 1,
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
    routinesList: {
        padding: 16,
    },
    routineCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    routineCardInactive: {
        opacity: 0.6,
    },
    routineHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    routineName: {
        fontSize: 17,
        fontWeight: '600',
        color: '#333',
    },
    routineFrequency: {
        fontSize: 13,
        color: '#666',
        marginTop: 4,
    },
    segmentCount: {
        fontSize: 13,
        color: '#0066CC',
    },
    fab: {
        position: 'absolute',
        right: 20,
        bottom: 20,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
    },
});
