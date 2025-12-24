import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import TransLinkService, { TransitStop } from '../src/services/TransLinkService';
import RoutineService from '../src/services/RoutineService';
import DayPickerModal from '../src/components/DayPickerModal';

export default function RouteDetailsScreen() {
    const params = useLocalSearchParams();
    const router = useRouter();
    const [stops, setStops] = useState<TransitStop[]>([]);
    const [loading, setLoading] = useState(true);
    const [showDayPicker, setShowDayPicker] = useState(false);
    const [saving, setSaving] = useState(false);

    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;

    // TODO: Replace with actual user ID from auth
    const userId = 'demo-user';

    useEffect(() => {
        loadStops();
    }, [routeNo]);

    const loadStops = async () => {
        try {
            console.log(`[RouteDetails] Loading stops for route ${routeNo}`);
            const routeStops = await TransLinkService.getStopsForRoute(routeNo);
            setStops(routeStops);
        } catch (error) {
            console.error('[RouteDetails] Error loading stops:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveRoutine = async (
        routineName: string,
        frequency: 'daily' | 'weekly',
        daysOfWeek: number[]
    ) => {
        setSaving(true);
        try {
            // Use the first stop as the primary stop for the routine
            const primaryStop = stops[0];
            if (!primaryStop) {
                Alert.alert('Error', 'No stops available for this route');
                return;
            }

            const routine = {
                userId,
                name: routineName,
                frequency,
                daysOfWeek: frequency === 'weekly' ? daysOfWeek : [],
                active: true,
                segments: [{
                    id: `${routeNo}-${primaryStop.stopNo}`,
                    sequenceOrder: 0,
                    transitType: 'bus' as const,
                    routeNumber: routeNo,
                    stopId: primaryStop.stopNo,
                    stopName: primaryStop.stopName,
                    scheduledTime: '08:00', // Default time, user can edit later
                    direction: 'OUTBOUND',
                    destination: routeName,
                }],
            };

            await RoutineService.createRoutine(routine);

            setShowDayPicker(false);
            Alert.alert(
                'Success!',
                'Routine saved successfully',
                [
                    {
                        text: 'View Routines',
                        onPress: () => router.push('/(tabs)/routines')
                    },
                    {
                        text: 'OK',
                        onPress: () => router.back()
                    }
                ]
            );
        } catch (error) {
            console.error('[RouteDetails] Error saving routine:', error);
            Alert.alert('Error', 'Failed to save routine. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#333" />
                </TouchableOpacity>
                <View style={styles.headerInfo}>
                    <Text style={styles.routeNumber}>Route {routeNo}</Text>
                    <Text style={styles.routeName}>{routeName}</Text>
                </View>
            </View>

            {/* Stops List */}
            {loading ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#0066CC" />
                    <Text style={styles.loadingText}>Loading stops...</Text>
                </View>
            ) : (
                <ScrollView style={styles.stopsList}>
                    <Text style={styles.sectionTitle}>Stops on this route</Text>
                    {stops.map((stop, index) => (
                        <View key={stop.stopNo} style={styles.stopCard}>
                            <View style={styles.stopNumber}>
                                <Text style={styles.stopNumberText}>{index + 1}</Text>
                            </View>
                            <View style={styles.stopInfo}>
                                <Text style={styles.stopName}>{stop.stopName}</Text>
                                <Text style={styles.stopNo}>Stop #{stop.stopNo}</Text>
                                <Text style={styles.coordinates}>
                                    📍 {stop.latitude.toFixed(4)}, {stop.longitude.toFixed(4)}
                                </Text>
                            </View>
                            {index < stops.length - 1 && <View style={styles.connector} />}
                        </View>
                    ))}

                    {stops.length === 0 && (
                        <View style={styles.emptyState}>
                            <Ionicons name="information-circle-outline" size={48} color="#ccc" />
                            <Text style={styles.emptyText}>No stops available</Text>
                        </View>
                    )}
                </ScrollView>
            )}

            {/* Action Buttons */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.actionButton, styles.startTripButton]}
                    onPress={() => {
                        if (stops.length === 0) return;
                        router.push({
                            pathname: '/active-trip',
                            params: {
                                routeNo,
                                routeName,
                                stopId: stops[0].stopNo,
                            }
                        });
                    }}
                    disabled={stops.length === 0}
                >
                    <Ionicons name="navigate" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Start Trip</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionButton, styles.saveButton]}
                    onPress={() => setShowDayPicker(true)}
                    disabled={stops.length === 0}
                >
                    <Ionicons name="add-circle" size={24} color="#fff" />
                    <Text style={styles.actionButtonText}>Save as Routine</Text>
                </TouchableOpacity>
            </View>

            {/* Day Picker Modal */}
            <DayPickerModal
                visible={showDayPicker}
                routeNo={routeNo}
                routeName={routeName}
                onSave={handleSaveRoutine}
                onClose={() => setShowDayPicker(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    backButton: {
        marginRight: 16,
    },
    headerInfo: {
        flex: 1,
    },
    routeNumber: {
        fontSize: 24,
        fontWeight: '700',
        color: '#0066CC',
    },
    routeName: {
        fontSize: 16,
        color: '#666',
        marginTop: 2,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: '#666',
    },
    stopsList: {
        flex: 1,
        padding: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginBottom: 16,
    },
    stopCard: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        position: 'relative',
    },
    stopNumber: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#0066CC',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    stopNumberText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
    stopInfo: {
        flex: 1,
    },
    stopName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    stopNo: {
        fontSize: 14,
        color: '#666',
        marginBottom: 2,
    },
    coordinates: {
        fontSize: 12,
        color: '#999',
    },
    connector: {
        position: 'absolute',
        left: 31,
        top: 48,
        width: 2,
        height: 40,
        backgroundColor: '#E6F2FF',
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
        marginTop: 12,
    },
    footer: {
        flexDirection: 'row',
        padding: 16,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
        gap: 12,
    },
    actionButton: {
        flex: 1,
        flexDirection: 'row',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    startTripButton: {
        backgroundColor: '#00C853',
    },
    saveButton: {
        backgroundColor: '#0066CC',
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    modalOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 24,
        width: '80%',
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
    },
    closeButton: {
        backgroundColor: '#0066CC',
        borderRadius: 8,
        padding: 12,
        paddingHorizontal: 24,
    },
    closeButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
