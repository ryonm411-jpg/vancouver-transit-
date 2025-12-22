import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Routine } from '../models/types';

interface RoutineCardProps {
    routine: Routine;
    onPress?: () => void;
    onToggle?: (active: boolean) => void;
}

export default function RoutineCard({ routine, onPress, onToggle }: RoutineCardProps) {
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
                {routine.segments.map((segment, index) => (
                    <View key={segment.id} style={styles.segment}>
                        <View style={styles.segmentIcon}>
                            <Ionicons
                                name={getTransitIcon(segment.transitType) as any}
                                size={20}
                                color="#0066CC"
                            />
                        </View>
                        <View style={styles.segmentInfo}>
                            <Text style={styles.routeNumber}>#{segment.routeNumber}</Text>
                            <Text style={styles.stopName}>{segment.stopName}</Text>
                            <Text style={styles.destination}>→ {segment.destination}</Text>
                        </View>
                        <Text style={styles.time}>{segment.scheduledTime}</Text>
                        {index < routine.segments.length - 1 && (
                            <View style={styles.connector} />
                        )}
                    </View>
                ))}
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
    routeNumber: {
        fontSize: 15,
        fontWeight: '600',
        color: '#0066CC',
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
