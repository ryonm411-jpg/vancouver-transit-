import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Routine } from '../models/types';
import TransLinkService from '../services/TransLinkService';

interface RoutineCardProps {
    routine: Routine;
    onPress?: () => void;
    onToggle?: (active: boolean) => void;
}

interface SegmentStatus {
    delay: number;
    status: 'ON_TIME' | 'DELAYED' | 'CANCELLED';
    loading: boolean;
}

export default function RoutineCard({ routine, onPress, onToggle }: RoutineCardProps) {
    const [segmentStatuses, setSegmentStatuses] = useState<{ [key: string]: SegmentStatus }>({});

    useEffect(() => {
        // Only fetch status for active routines
        if (!routine.active) return;

        const fetchStatuses = async () => {
            for (const segment of routine.segments) {
                // Set loading state
                setSegmentStatuses(prev => ({
                    ...prev,
                    [segment.id]: { delay: 0, status: 'ON_TIME', loading: true }
                }));

                try {
                    // Use centralized arrival logic from service
                    const eta = await TransLinkService.getArrivalsForSegment(
                        segment.routeNumber,
                        segment.stopId || ''
                    );

                    setSegmentStatuses(prev => ({
                        ...prev,
                        [segment.id]: {
                            delay: eta.delay || 0,
                            status: eta.status || 'ON_TIME',
                            loading: false
                        }
                    }));
                } catch (error) {
                    console.error('[RoutineCard] Error fetching arrivals:', error);
                    setSegmentStatuses(prev => ({
                        ...prev,
                        [segment.id]: { delay: 0, status: 'ON_TIME', loading: false }
                    }));
                }
            }
        };

        fetchStatuses();
    }, [routine.active, routine.segments]);

    const getFrequencyText = () => {
        if (routine.frequency === 'daily') return 'Daily';
        if (routine.frequency === 'weekly') {
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            return routine.daysOfWeek?.map(d => days[d]).join(', ') || 'Weekly';
        }
        return 'Custom';
    };

    const getTransitIcon = (type: string) => {
        switch (type) {
            case 'bus': return 'bus';
            case 'skytrain': return 'train';
            case 'seabus': return 'boat';
            default: return 'navigate';
        }
    };

    const getStatusColor = (status?: 'ON_TIME' | 'DELAYED' | 'CANCELLED') => {
        switch (status) {
            case 'ON_TIME': return '#4CAF50';
            case 'DELAYED': return '#FF9800';
            case 'CANCELLED': return '#F44336';
            default: return '#999';
        }
    };

    return (
        <TouchableOpacity
            style={[styles.card, !routine.active && styles.cardInactive]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            <View style={styles.header}>
                <View style={styles.titleRow}>
                    <Text style={styles.title}>{routine.name}</Text>
                    <TouchableOpacity
                        onPress={() => onToggle?.(!routine.active)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons
                            name={routine.active ? 'toggle' : 'toggle-outline'}
                            size={32}
                            color={routine.active ? '#0066CC' : '#ccc'}
                        />
                    </TouchableOpacity>
                </View>
                <Text style={styles.frequency}>{getFrequencyText()}</Text>
            </View>

            <View style={styles.segments}>
                {routine.segments.map((segment, index) => {
                    const segmentStatus = segmentStatuses[segment.id];

                    return (
                        <View key={segment.id} style={styles.segment}>
                            <View style={styles.segmentIcon}>
                                <Ionicons
                                    name={getTransitIcon(segment.transitType) as any}
                                    size={20}
                                    color="#0066CC"
                                />
                            </View>
                            <View style={styles.segmentInfo}>
                                <View style={styles.routeRow}>
                                    <Text style={styles.routeNumber}>#{segment.routeNumber}</Text>
                                    {routine.active && segmentStatus && (
                                        segmentStatus.loading ? (
                                            <ActivityIndicator size="small" color="#999" />
                                        ) : (
                                            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(segmentStatus.status) }]}>
                                                <Text style={styles.statusText}>
                                                    {segmentStatus.status === 'ON_TIME' ? 'ON TIME' :
                                                        segmentStatus.status === 'DELAYED' ? `+${segmentStatus.delay}m` :
                                                            'CANCELLED'}
                                                </Text>
                                            </View>
                                        )
                                    )}
                                </View>
                                <Text style={styles.stopName}>{segment.stopName}</Text>
                                <Text style={styles.destination}>→ {segment.destination}</Text>
                            </View>
                            <Text style={styles.time}>{segment.scheduledTime}</Text>
                            {index < routine.segments.length - 1 && (
                                <View style={styles.connector} />
                            )}
                        </View>
                    );
                })}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 16,
        marginVertical: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cardInactive: {
        opacity: 0.6,
    },
    header: {
        marginBottom: 12,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    titleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        flex: 1,
    },
    frequency: {
        fontSize: 13,
        color: '#666',
    },
    segments: {
        position: 'relative',
    },
    segment: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        position: 'relative',
    },
    segmentIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#E6F2FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    segmentInfo: {
        flex: 1,
    },
    routeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    routeNumber: {
        fontSize: 15,
        fontWeight: '600',
        color: '#0066CC',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#fff',
    },
    stopName: {
        fontSize: 13,
        color: '#333',
        marginTop: 2,
    },
    destination: {
        fontSize: 12,
        color: '#999',
        marginTop: 1,
    },
    time: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    connector: {
        position: 'absolute',
        left: 17,
        top: 44,
        width: 2,
        height: 24,
        backgroundColor: '#E6F2FF',
    },
});

