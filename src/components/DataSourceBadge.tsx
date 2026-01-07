import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface DataSourceBadgeProps {
    source: 'live' | 'gps' | 'scheduled';
    compact?: boolean;
}

export const DataSourceBadge: React.FC<DataSourceBadgeProps> = ({ source, compact = false }) => {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    let backgroundColor;
    let textColor;
    let iconName: keyof typeof Ionicons.glyphMap;
    let label;

    switch (source) {
        case 'live':
            backgroundColor = isDark ? 'rgba(48, 209, 88, 0.2)' : 'rgba(52, 199, 89, 0.15)';
            textColor = isDark ? '#30D158' : '#248A3D';
            iconName = 'pulse';
            label = 'Live';
            break;
        case 'gps':
            backgroundColor = isDark ? 'rgba(10, 132, 255, 0.2)' : 'rgba(0, 122, 255, 0.15)';
            textColor = isDark ? '#0A84FF' : '#007AFF';
            iconName = 'radio-button-on';
            label = 'GPS';
            break;
        case 'scheduled':
        default:
            backgroundColor = isDark ? 'rgba(142, 142, 147, 0.2)' : 'rgba(142, 142, 147, 0.15)';
            textColor = isDark ? '#8E8E93' : '#636366';
            iconName = 'time';
            label = 'Scheduled';
            break;
    }

    return (
        <View style={[styles.container, { backgroundColor, paddingHorizontal: compact ? 6 : 8 }]}>
            <Ionicons name={iconName} size={12} color={textColor} style={styles.icon} />
            {!compact && (
                <Text style={[styles.text, { color: textColor }]}>
                    {label}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 6,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },
    icon: {
        marginRight: 4,
    },
    text: {
        fontSize: 12,
        fontWeight: '600',
    },
});
