import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, SafeAreaView, Keyboard, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { SearchResults } from '@/src/components/SearchResults';
import GeocodingService, { SearchResult } from '@/src/services/GeocodingService';
import * as Location from 'expo-location';

export default function SearchScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const isDark = true;

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<TextInput>(null);

    // User location state
    const [userLat, setUserLat] = useState<number | null>(null);
    const [userLon, setUserLon] = useState<number | null>(null);

    useEffect(() => {
        // Auto-focus input on mount
        setTimeout(() => inputRef.current?.focus(), 100);

        // Fetch user location
        (async () => {
            try {
                const { status } = await Location.requestForegroundPermissionsAsync();
                if (status === 'granted') {
                    const location = await Location.getCurrentPositionAsync({});
                    setUserLat(location.coords.latitude);
                    setUserLon(location.coords.longitude);
                    console.log('[Search] Got user location:', location.coords.latitude, location.coords.longitude);
                }
            } catch (err) {
                console.warn('[Search] Location error:', err);
            }
        })();
    }, []);

    const handleSearch = async (text: string) => {
        setQuery(text);
        if (text.length < 2) {
            setResults([]);
            return;
        }

        setLoading(true);
        try {
            // Use actual user location if available, fallback to downtown Vancouver
            const lat = userLat ?? 49.2827;
            const lon = userLon ?? -123.1207;
            const results = await GeocodingService.search(text, lat, lon);
            setResults(results);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSelect = (result: SearchResult) => {
        // Use actual user location if available, fallback to downtown Vancouver
        const lat = userLat ?? 49.2827;
        const lon = userLon ?? -123.1207;

        // DIRECT NAVIGATION based on result type
        if (result.type === 'route') {
            console.log('[Search] Selected Route:', result.routeNumber, 'at user location:', lat, lon);
            router.push({
                pathname: "/route-details",
                params: {
                    routeId: result.id,
                    routeNo: result.routeNumber || result.name.split(' ')[0],
                    routeName: result.name,
                    userLat: String(lat),
                    userLon: String(lon),
                    // No boardingStopId known yet, route-details will auto-detect nearest
                }
            });
            return;
        }

        if (result.type === 'stop') {
            // If it's a stop, maybe we want to see arrivals at that stop?
            // Or plan a trip TO that stop?
            // For now, let's treat it as a destination for trip planning (Route Options)
            // UNLESS we have a dedicated Stop Details screen.
            // Let's stick to Trip Planning for stops/places to be safe.
        }

        router.push({
            pathname: "/route-options",
            params: {
                destId: result.id,
                destName: result.name,
                destLat: result.lat,
                destLon: result.lon,
                originLat: String(lat),
                originLon: String(lon)
            }
        });
    };

    return (
        <View style={[styles.container, { backgroundColor: '#1C1C1E' }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.searchBar}>
                    <Ionicons name="search" size={20} color="#8E8E93" style={styles.searchIcon} />
                    <TextInput
                        ref={inputRef}
                        style={styles.input}
                        placeholder="Line or destination"
                        placeholderTextColor="#8E8E93"
                        value={query}
                        onChangeText={handleSearch}
                        returnKeyType="search"
                    />
                    {query.length > 0 && (
                        <TouchableOpacity onPress={() => handleSearch('')}>
                            <Ionicons name="close-circle" size={18} color="#8E8E93" />
                        </TouchableOpacity>
                    )}
                </View>
                <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}>
                    <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
            </View>

            {/* List Options (only if no query) */}
            {query.length === 0 && (
                <ScrollView style={styles.content}>
                    <OptionItem icon="map" label="Choose on map" />
                    <OptionItem icon="home" label="Set home" />
                    <OptionItem icon="briefcase" label="Set work" />
                    <OptionItem icon="calendar" label="Show upcoming events" />

                    <Text style={styles.sectionTitle}>RECENT</Text>
                    {/* Mock Recent */}
                    <RecentItem label="1338 Borthwick Rd" sublabel="Upper Lynn" />
                    <RecentItem label="Metrotown Station" sublabel="Burnaby" />
                </ScrollView>
            )}

            {/* Search Results */}
            {query.length > 0 && (
                <View style={styles.resultsContainer}>
                    <SearchResults
                        results={results}
                        onSelect={handleSelect}
                        loading={loading}
                    />
                </View>
            )}
        </View>
    );
}

const OptionItem = ({ icon, label }: { icon: any, label: string }) => (
    <TouchableOpacity style={styles.optionItem}>
        <View style={styles.iconContainer}>
            <Ionicons name={icon} size={24} color="#FFF" />
        </View>
        <Text style={styles.optionLabel}>{label}</Text>
        <Ionicons name="chevron-forward" size={20} color="#545458" />
    </TouchableOpacity>
);

const RecentItem = ({ label, sublabel }: { label: string, sublabel: string }) => (
    <TouchableOpacity style={styles.recentItem}>
        <View style={[styles.iconContainer, { backgroundColor: 'transparent' }]}>
            <Ionicons name="location" size={24} color="#FFF" />
        </View>
        <View style={styles.recentText}>
            <Text style={styles.recentLabel}>{label}</Text>
            <Text style={styles.recentSublabel}>{sublabel}</Text>
        </View>
        <TouchableOpacity>
            <Ionicons name="ellipsis-horizontal" size={20} color="#8E8E93" />
        </TouchableOpacity>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        paddingTop: Platform.OS === 'ios' ? 60 : 20, // Modal presentation usually has header, but we are making custom?
        // If presentation: modal, we might want to hide default header or customize.
        backgroundColor: '#05603A', // Green header from image 2? 
        // Image 2 shows "Line or destination" input inside a green-ish header?
        // Actually Image 2 shows the header is Green ("Line or destination" + Sort icon). 
        // Wait, Image 2 header is "Line or destination" text? No, it looks like a Search Bar in the navigation bar.
        // I'll stick to a Green Header container.
    },
    searchBar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)', // Semi-transparent based on green
        borderRadius: 8,
        paddingHorizontal: 10,
        height: 40,
    },
    searchIcon: {
        marginRight: 8,
        color: '#E0E0E0',
    },
    input: {
        flex: 1,
        color: '#FFF',
        fontSize: 16,
    },
    cancelButton: {
        marginLeft: 12,
    },
    cancelText: {
        color: '#FFF',
        fontSize: 16,
    },
    content: {
        flex: 1,
    },
    optionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#2C2C2E',
    },
    iconContainer: {
        width: 30,
        alignItems: 'center',
        marginRight: 16,
    },
    optionLabel: {
        flex: 1,
        color: '#FFF',
        fontSize: 16,
        fontWeight: '600',
    },
    sectionTitle: {
        color: '#8E8E93',
        fontSize: 13,
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 16,
    },
    recentItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    recentText: {
        flex: 1,
    },
    recentLabel: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '500',
    },
    recentSublabel: {
        color: '#8E8E93',
        fontSize: 14,
    },
    resultsContainer: {
        flex: 1,
        backgroundColor: '#1C1C1E',
        padding: 16,
    }
});
