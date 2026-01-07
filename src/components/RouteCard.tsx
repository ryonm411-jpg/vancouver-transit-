import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { RouteOption, RouteLeg } from '@/src/services/RoutePlanningService';
import { DataSourceBadge } from './DataSourceBadge';

interface RouteCardProps {
    route: RouteOption;
    onPress: () => void;
    selected?: boolean;
}

export const RouteCard: React.FC<RouteCardProps> = ({ route, onPress, selected = false }) => {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    const renderLegIcon = (leg: RouteLeg, index: number) => {
        const isWalk = leg.type === 'walk';

        return (
            <View key={index} style={styles.legItem}>
                {index > 0 && (
                    <Ionicons
                        name="chevron-forward"
                        size={12}
                        color={isDark ? '#8E8E93' : '#C7C7CC'}
                        style={styles.legSeparator}
                    />
                )}

                <View style={[
                    styles.legIconBadge,
                    {
                        backgroundColor: isWalk
                            ? (isDark ? '#2C2C2E' : '#F2F2F7')
                            : Colors.light.tint
                    }
                ]}>
                    {isWalk ? (
                        <Ionicons name="walk" size={14} color={isDark ? '#FFFFFF' : '#000000'} />
                    ) : (
                        <Text style={styles.routeNumber}>{leg.routeNo}</Text>
                    )}
                </View>

                <Text style={[styles.legDuration, { color: isDark ? '#8E8E93' : '#636366' }]}>
                    {Math.round(leg.durationMinutes || 0)}'
                </Text>
            </View>
        );
    };

    return (
        <TouchableOpacity
            style={[
                styles.container,
                {
                    backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                    borderColor: selected ? Colors.light.tint : 'transparent',
                }
            ]}
            onPress={onPress}
            activeOpacity={0.7}
        >
            {/* Top Row: Time, Duration, Badge */}
            <View style={styles.topRow}>
                <View>
                    <Text style={[styles.departureTime, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                        {route.departureTime || 'Now'}
                    </Text>
                    <Text style={[styles.arrivalTime, { color: isDark ? '#8E8E93' : '#636366' }]}>
                        Arrival: {route.arrivalTime || 'Unknown'}
                    </Text>
                </View>

                <View style={styles.durationContainer}>
                    <Text style={[styles.totalDuration, { color: isDark ? '#FFFFFF' : '#000000' }]}>
                        {route.totalMinutes} <Text style={{ fontSize: 14, fontWeight: '400' }}>min</Text>
                    </Text>
                    <DataSourceBadge source={route.reliability} compact />
                </View>
            </View>

            {/* Middle Row: Route Visualization */}
            <View style={styles.legsContainer}>
                {route.legs.map((leg, index) => renderLegIcon(leg, index))}
            </View>

            {/* Bottom Row: Summary */}
            <View style={styles.bottomRow}>
                <Ionicons name="walk" size={14} color={isDark ? '#8E8E93' : '#8E8E93'} />
                <Text style={[styles.walkSummary, { color: isDark ? '#8E8E93' : '#8E8E93' }]}>
                    {route.walkMinutes} min walking
                </Text>
                <Text style={[styles.dot, { color: isDark ? '#8E8E93' : '#8E8E93' }]}>•</Text>
                <Text style={[styles.transfers, { color: isDark ? '#8E8E93' : '#8E8E93' }]}>
                    {route.transfers === 0 ? 'Direct' : `${route.transfers} transfer`}
                </Text>
            </View>

            {/* Explainability Tags */}
            {route.tags && route.tags.length > 0 && (
                <View style={styles.tagsContainer}>
                    {route.tags.map((tag, i) => (
                        <View key={i} style={styles.tagBadge}>
                            <Text style={styles.tagText}>{tag}</Text>
                        </View>
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 2,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    departureTime: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 2,
    },
    arrivalTime: {
        fontSize: 13,
    },
    durationContainer: {
        alignItems: 'flex-end',
    },
    totalDuration: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 4,
    },
    legsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        flexWrap: 'wrap',
    },
    legItem: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    legSeparator: {
        marginHorizontal: 4,
    },
    legIconBadge: {
        height: 24,
        minWidth: 24,
        paddingHorizontal: 6,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 4,
    },
    routeNumber: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
    },
    legDuration: {
        fontSize: 12,
        fontWeight: '500',
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    walkSummary: {
        fontSize: 13,
        marginLeft: 4,
    },
    dot: {
        marginHorizontal: 6,
    },
    transfers: {
        fontSize: 13,
    },
    tagsContainer: {
        flexDirection: 'row',
        marginTop: 10,
        flexWrap: 'wrap',
        gap: 8,
    },
    tagBadge: {
        backgroundColor: 'rgba(10, 132, 255, 0.1)', // Light blue tint
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    tagText: {
        fontSize: 11,
        color: '#0A84FF',
        fontWeight: '600',
    }
});
