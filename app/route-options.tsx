import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, SafeAreaView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import RoutePlanningService, { RouteOption } from '@/src/services/RoutePlanningService';
import { RouteCard } from '@/src/components/RouteCard';
import { OriginSearchModal } from '@/src/components/OriginSearchModal';

export default function RouteOptionsScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';

    const [routes, setRoutes] = useState<RouteOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Origin location state - can be customized by user
    const [showOriginModal, setShowOriginModal] = useState(false);
    const [originName, setOriginName] = useState('My Location');
    const [customOriginLat, setCustomOriginLat] = useState<number | null>(null);
    const [customOriginLon, setCustomOriginLon] = useState<number | null>(null);

    const { destId, destName, destLat, destLon, originLat, originLon } = params;

    // Use custom origin if set, otherwise use GPS-based origin from params
    const effectiveOriginLat = customOriginLat ?? Number(originLat);
    const effectiveOriginLon = customOriginLon ?? Number(originLon);

    useEffect(() => {
        loadRoutes();
    }, [destId, effectiveOriginLat, effectiveOriginLon]);

    const loadRoutes = async () => {
        if (!destLat || !destLon || isNaN(effectiveOriginLat) || isNaN(effectiveOriginLon)) {
            setError('Invalid location data');
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const plannedRoutes = await RoutePlanningService.planRoute(
                effectiveOriginLat,
                effectiveOriginLon,
                Number(destLat),
                Number(destLon)
            );

            setRoutes(plannedRoutes);
            if (plannedRoutes.length === 0) {
                setError('No transit routes found');
            }
        } catch (err) {
            console.error('Error planning route:', err);
            setError('Failed to calculate routes');
        } finally {
            setLoading(false);
        }
    };

    const handleOriginSelect = (location: { lat: number; lon: number; name: string }) => {
        console.log(`[RouteOptions] 🎯 Origin selected: "${location.name}" at (${location.lat}, ${location.lon})`);
        setOriginName(location.name);
        if (location.name === 'My Location') {
            // Reset to original GPS location
            setCustomOriginLat(null);
            setCustomOriginLon(null);
        } else {
            setCustomOriginLat(location.lat);
            setCustomOriginLon(location.lon);
        }
    };

    const handleRouteSelect = (route: RouteOption) => {
        // Find the main transit leg (first transit leg)
        const transitLeg = route.legs.find(leg => leg.type === 'transit');

        console.log(`[RouteOptions] 🚌 Route selected, transit leg:`, transitLeg?.routeNo);
        console.log(`[RouteOptions] 🗺️ Passing origin: effectiveOriginLat=${effectiveOriginLat}, effectiveOriginLon=${effectiveOriginLon}`);
        console.log(`[RouteOptions] 🗺️ customOriginLat=${customOriginLat}, customOriginLon=${customOriginLon}`);
        console.log(`[RouteOptions] 🗺️ originLat param=${originLat}, originLon param=${originLon}`);

        if (transitLeg) {
            router.push({
                pathname: "/route-details",
                params: {
                    routeId: transitLeg.routeId,
                    routeNo: transitLeg.routeNo,
                    routeName: transitLeg.routeName,
                    boardingStopId: transitLeg.boardingStop?.id,
                    userLat: String(effectiveOriginLat),
                    userLon: String(effectiveOriginLon)
                }
            });
        } else {
            console.warn('Selected route has no transit leg');
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: isDark ? '#000' : '#F2F2F7' }]}>
            <Stack.Screen
                options={{
                    headerShown: true,
                    title: "Route Options",
                    headerBackTitle: "Search",
                    headerStyle: { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' },
                    headerTintColor: Colors.light.tint,
                }}
            />

            <View style={[styles.header, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF' }]}>
                {/* Tappable origin row */}
                <TouchableOpacity
                    style={styles.locationRow}
                    onPress={() => setShowOriginModal(true)}
                    activeOpacity={0.6}
                >
                    <Ionicons name="navigate-circle" size={20} color={Colors.light.tint} />
                    <Text style={[styles.locationText, { color: isDark ? '#FFF' : '#000', flex: 1 }]} numberOfLines={1}>
                        {originName}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
                </TouchableOpacity>

                <View style={styles.connector}>
                    <View style={[styles.dots, { backgroundColor: isDark ? '#3A3A3C' : '#C7C7CC' }]} />
                </View>

                {/* Destination row (not tappable for now) */}
                <View style={styles.locationRow}>
                    <Ionicons name="location" size={20} color="#FF3B30" />
                    <Text style={[styles.locationText, { color: isDark ? '#FFF' : '#000' }]} numberOfLines={1}>{destName}</Text>
                </View>
            </View>

            {/* Origin Search Modal */}
            <OriginSearchModal
                visible={showOriginModal}
                onClose={() => setShowOriginModal(false)}
                onSelect={handleOriginSelect}
                currentLocation={{ lat: Number(originLat), lon: Number(originLon) }}
            />

            {loading ? (
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color={Colors.light.tint} />
                    <Text style={[styles.loadingText, { color: isDark ? '#8E8E93' : '#8E8E93' }]}>
                        Planning best routes...
                    </Text>
                </View>
            ) : error ? (
                <View style={styles.centerContainer}>
                    <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
                    <Text style={[styles.errorText, { color: isDark ? '#FFF' : '#000' }]}>{error}</Text>
                    <TouchableOpacity onPress={loadRoutes} style={styles.retryButton}>
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={[styles.sectionTitle, { color: isDark ? '#8E8E93' : '#6E6E73' }]}>
                        RECOMMENDED ROUTES
                    </Text>

                    {routes.map((route) => (
                        <RouteCard
                            key={route.id}
                            route={route}
                            onPress={() => handleRouteSelect(route)}
                        />
                    ))}

                    <View style={styles.footer}>
                        <Text style={[styles.footerText, { color: isDark ? '#8E8E93' : '#8E8E93' }]}>
                            Times are based on current traffic conditions
                        </Text>
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        padding: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#3A3A3C',
        elevation: 2,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
    },
    locationText: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    connector: {
        height: 16,
        marginLeft: 9,
        justifyContent: 'center',
    },
    dots: {
        width: 2,
        height: 12,
        borderRadius: 1,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
    },
    errorText: {
        marginTop: 12,
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 20,
    },
    retryButton: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: Colors.light.tint,
        borderRadius: 8,
    },
    retryText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    scrollContent: {
        padding: 16,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 12,
        marginLeft: 4,
    },
    footer: {
        marginTop: 20,
        alignItems: 'center',
        marginBottom: 20,
    },
    footerText: {
        fontSize: 12,
    },
});
