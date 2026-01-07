import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TextInput,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    SafeAreaView,
    Keyboard,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import GeocodingService, { SearchResult } from '@/src/services/GeocodingService';

interface OriginSearchModalProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (location: { lat: number; lon: number; name: string }) => void;
    currentLocation?: { lat: number; lon: number };
}

export function OriginSearchModal({ visible, onClose, onSelect, currentLocation }: OriginSearchModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<TextInput>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (visible) {
            setTimeout(() => inputRef.current?.focus(), 100);
        } else {
            setQuery('');
            setResults([]);
        }
    }, [visible]);

    const handleSearch = (text: string) => {
        setQuery(text);

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        if (text.length < 2) {
            setResults([]);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const searchResults = await GeocodingService.search(
                    text,
                    currentLocation?.lat,
                    currentLocation?.lon
                );
                // Filter to only include places with coordinates (not routes)
                setResults(searchResults.filter(r => r.lat && r.lon && r.type !== 'route').slice(0, 8));
            } catch (error) {
                console.error('[OriginSearch] Error:', error);
            } finally {
                setLoading(false);
            }
        }, 300);
    };

    const handleSelectMyLocation = () => {
        if (currentLocation) {
            onSelect({
                lat: currentLocation.lat,
                lon: currentLocation.lon,
                name: 'My Location'
            });
        }
        onClose();
    };

    const handleSelectResult = (result: SearchResult) => {
        console.log(`[OriginModal] 📍 Selected: "${result.name}" coords: lat=${result.lat}, lon=${result.lon}`);
        Keyboard.dismiss();
        onSelect({
            lat: Number(result.lat),
            lon: Number(result.lon),
            name: result.name
        });
        onClose();
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView style={styles.container}>
                <KeyboardAvoidingView
                    style={styles.keyboardView}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Starting Point</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close-circle-outline" size={28} color="#8E8E93" />
                        </TouchableOpacity>
                    </View>

                    {/* Search Bar */}
                    <View style={styles.searchContainer}>
                        <Ionicons name="search" size={20} color="#8E8E93" />
                        <TextInput
                            ref={inputRef}
                            style={styles.searchInput}
                            placeholder="Search for a location"
                            placeholderTextColor="#8E8E93"
                            value={query}
                            onChangeText={handleSearch}
                            returnKeyType="search"
                            clearButtonMode="while-editing"
                        />
                        {loading && <ActivityIndicator size="small" color={Colors.light.tint} />}
                    </View>

                    {/* My Location Option - Always visible */}
                    <TouchableOpacity style={styles.myLocationRow} onPress={handleSelectMyLocation}>
                        <View style={styles.myLocationIcon}>
                            <Ionicons name="navigate" size={20} color="#FFF" />
                        </View>
                        <View style={styles.myLocationText}>
                            <Text style={styles.myLocationTitle}>My Location</Text>
                            <Text style={styles.myLocationSubtitle}>Use current GPS location</Text>
                        </View>
                    </TouchableOpacity>

                    {/* Search Results */}
                    <FlatList
                        data={results}
                        keyExtractor={(item, index) => item.id || `result-${index}`}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={styles.resultRow}
                                onPress={() => handleSelectResult(item)}
                            >
                                <View style={styles.resultIcon}>
                                    <Ionicons
                                        name={item.type === 'stop' ? 'bus' : 'location'}
                                        size={20}
                                        color="#8E8E93"
                                    />
                                </View>
                                <View style={styles.resultText}>
                                    <Text style={styles.resultTitle} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                    {item.address && (
                                        <Text style={styles.resultSubtitle} numberOfLines={1}>
                                            {item.address}
                                        </Text>
                                    )}
                                </View>
                            </TouchableOpacity>
                        )}
                        ListEmptyComponent={
                            query.length >= 2 && !loading ? (
                                <View style={styles.emptyContainer}>
                                    <Text style={styles.emptyText}>
                                        No results found
                                    </Text>
                                </View>
                            ) : null
                        }
                    />
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1C1C1E',
    },
    keyboardView: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#3A3A3C',
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFF',
    },
    closeButton: {
        padding: 4,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2C2C2E',
        borderRadius: 10,
        marginHorizontal: 16,
        marginVertical: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#FFF',
        marginLeft: 8,
    },
    myLocationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#3A3A3C',
    },
    myLocationIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: Colors.light.tint,
        alignItems: 'center',
        justifyContent: 'center',
    },
    myLocationText: {
        marginLeft: 12,
    },
    myLocationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFF',
    },
    myLocationSubtitle: {
        fontSize: 13,
        color: '#8E8E93',
        marginTop: 2,
    },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#3A3A3C',
    },
    resultIcon: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#2C2C2E',
        alignItems: 'center',
        justifyContent: 'center',
    },
    resultText: {
        flex: 1,
        marginLeft: 12,
    },
    resultTitle: {
        fontSize: 16,
        color: '#FFF',
    },
    resultSubtitle: {
        fontSize: 13,
        color: '#8E8E93',
        marginTop: 2,
    },
    emptyContainer: {
        padding: 20,
        alignItems: 'center',
    },
    emptyText: {
        color: '#8E8E93',
        fontSize: 15,
    },
});
