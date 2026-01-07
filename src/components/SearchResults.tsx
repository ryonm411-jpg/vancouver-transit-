import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SectionList, SectionListData } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { SearchResult } from '@/src/services/GeocodingService';

interface SearchResultsProps {
    results: SearchResult[];
    onSelect: (result: SearchResult) => void;
    scrollEnabled?: boolean;
}

export const SearchResults: React.FC<SearchResultsProps> = ({
    results,
    onSelect,
    scrollEnabled = true,
}) => {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    const sections = useMemo(() => {
        const routes = results.filter(r => r.type === 'route');
        const stops = results.filter(r => r.type === 'stop');
        const places = results.filter(r => r.type === 'place');

        const result: SectionListData<SearchResult>[] = [];

        if (places.length > 0) {
            result.push({
                title: 'Places',
                data: places,
            });
        }

        if (routes.length > 0) {
            result.push({
                title: 'Routes',
                data: routes,
            });
        }

        if (stops.length > 0) {
            result.push({
                title: 'Transit Stops',
                data: stops,
            });
        }

        return result;
    }, [results]);

    const formatDistance = (dist?: number) => {
        if (dist === undefined) return '';
        if (dist < 1) {
            return `${Math.round(dist * 1000)} m`;
        }
        return `${dist.toFixed(1)} km`;
    };

    const renderItem = ({ item }: { item: SearchResult }) => (
        <TouchableOpacity
            style={[
                styles.itemContainer,
                { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }
            ]}
            onPress={() => onSelect(item)}
        >
            <View style={[
                styles.iconContainer,
                item.type === 'route'
                    ? { backgroundColor: '#0066CC', borderRadius: 4, width: 36, height: 24 }
                    : { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }
            ]}>
                {item.type === 'route' ? (
                    <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>{item.routeNumber}</Text>
                ) : (
                    <Ionicons
                        name={item.type === 'stop' ? 'bus' : 'location'}
                        size={24}
                        color={Colors.light.tint}
                    />
                )}
            </View>

            <View style={styles.textContainer}>
                <Text style={[
                    styles.title,
                    { color: isDark ? '#FFFFFF' : '#000000' }
                ]} numberOfLines={1}>
                    {item.name}
                </Text>
                <Text style={[
                    styles.subtitle,
                    { color: isDark ? '#8E8E93' : '#8E8E93' }
                ]} numberOfLines={1}>
                    {item.subtitle}
                </Text>
            </View>

            {item.distance !== undefined && (
                <Text style={[
                    styles.distance,
                    { color: isDark ? '#8E8E93' : '#8E8E93' }
                ]}>
                    {formatDistance(item.distance)}
                </Text>
            )}
        </TouchableOpacity>
    );

    const renderSectionHeader = ({ section: { title } }: { section: { title: string } }) => (
        <View style={[
            styles.header,
            { backgroundColor: isDark ? '#000000' : '#F2F2F7' }
        ]}>
            <Text style={[
                styles.headerTitle,
                { color: isDark ? '#8E8E93' : '#6E6E73' }
            ]}>
                {title.toUpperCase()}
            </Text>
        </View>
    );

    return (
        <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            scrollEnabled={scrollEnabled}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled={false}
        />
    );
};

const styles = StyleSheet.create({
    listContent: {
        paddingBottom: 20,
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    headerTitle: {
        fontSize: 13,
        fontWeight: '600',
    },
    itemContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#3A3A3C', // visible separator
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
        marginRight: 8,
    },
    title: {
        fontSize: 17,
        fontWeight: '500',
        marginBottom: 2,
    },
    subtitle: {
        fontSize: 15,
    },
    distance: {
        fontSize: 13,
    },
});
