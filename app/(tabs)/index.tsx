import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import RoutineCard from '../../src/components/RoutineCard';
import RoutineService from '../../src/services/RoutineService';
import { Routine } from '../../src/models/types';

export default function HomeScreen() {
    const router = useRouter();
    const [routines, setRoutines] = useState<Routine[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // TODO: Replace with actual user ID from authentication
    const userId = 'demo-user';

    const loadRoutines = async () => {
        try {
            const userRoutines = await RoutineService.getActiveRoutines(userId);
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

    const handleToggleRoutine = async (routineId: string, active: boolean) => {
        try {
            await RoutineService.toggleRoutineActive(routineId, active);
            loadRoutines();
        } catch (error) {
            console.error('Error toggling routine:', error);
        }
    };

    const getNextScheduledTime = () => {
        if (routines.length === 0) return null;

        // Get the earliest time from all active routines
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();

        let nextRoutine = null;
        let minDiff = Infinity;

        routines.forEach(routine => {
            routine.segments.forEach(segment => {
                const [hours, minutes] = segment.scheduledTime.split(':').map(Number);
                const segmentTime = hours * 60 + minutes;
                const diff = segmentTime - currentTime;

                if (diff > 0 && diff < minDiff) {
                    minDiff = diff;
                    nextRoutine = { routine, segment };
                }
            });
        });

        return nextRoutine;
    };

    const nextScheduled = getNextScheduledTime();

    return (
        <View style={styles.container}>
            <ScrollView
                style={styles.scrollView}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                <View style={styles.header}>
                    <Text style={styles.headerText}>Your Transit Routines</Text>
                    {nextScheduled && (
                        <View style={styles.nextTransitCard}>
                            <Ionicons name="time-outline" size={20} color="#0066CC" />
                            <View style={styles.nextTransitInfo}>
                                <Text style={styles.nextTransitLabel}>Next Transit</Text>
                                <Text style={styles.nextTransitText}>
                                    #{nextScheduled.segment.routeNumber} at {nextScheduled.segment.scheduledTime}
                                </Text>
                            </View>
                        </View>
                    )}
                </View>

                {loading ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateText}>Loading routines...</Text>
                    </View>
                ) : routines.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="bus-outline" size={64} color="#ccc" />
                        <Text style={styles.emptyStateText}>No routines yet</Text>
                        <Text style={styles.emptyStateSubText}>
                            Tap the button below to create your first transit routine
                        </Text>
                    </View>
                ) : (
                    <View style={styles.routinesList}>
                        {routines.map(routine => (
                            <RoutineCard
                                key={routine.id}
                                routine={routine}
                                onPress={() => {
                                    // TODO: Navigate to routine detail
                                    console.log('View routine:', routine.id);
                                }}
                                onToggle={(active) => handleToggleRoutine(routine.id, active)}
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            <TouchableOpacity
                style={styles.addButton}
                onPress={() => router.push('/create-routine')}
            >
                <Ionicons name="add-circle" size={24} color="#fff" />
                <Text style={styles.addButtonText}>Add New Routine</Text>
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
    header: {
        backgroundColor: '#fff',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 12,
    },
    nextTransitCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E6F2FF',
        padding: 12,
        borderRadius: 8,
    },
    nextTransitInfo: {
        marginLeft: 12,
    },
    nextTransitLabel: {
        fontSize: 12,
        color: '#666',
    },
    nextTransitText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#0066CC',
        marginTop: 2,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
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
        paddingVertical: 8,
    },
    addButton: {
        backgroundColor: '#0066CC',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        margin: 20,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    addButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
});
