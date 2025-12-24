import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function ActiveTripScreenWeb() {
    const params = useLocalSearchParams();
    const router = useRouter();

    const routeNo = params.routeNo as string;
    const routeName = params.routeName as string;

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

            {/* Web Not Supported Message */}
            <View style={styles.content}>
                <Ionicons name="map-outline" size={64} color="#ccc" />
                <Text style={styles.title}>Live Trip Tracking</Text>
                <Text style={styles.message}>
                    Live trip tracking with GPS and real-time vehicle positions is only available on mobile devices.
                </Text>
                <Text style={styles.instruction}>
                    Please use the Expo Go app on iOS or Android to access this feature.
                </Text>

                <TouchableOpacity style={styles.backHomeButton} onPress={() => router.back()}>
                    <Text style={styles.backHomeText}>Back to Route Details</Text>
                </TouchableOpacity>
            </View>
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
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#333',
        marginTop: 20,
        marginBottom: 16,
    },
    message: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        marginBottom: 12,
        lineHeight: 24,
    },
    instruction: {
        fontSize: 14,
        color: '#999',
        textAlign: 'center',
        marginBottom: 32,
    },
    backHomeButton: {
        backgroundColor: '#0066CC',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 32,
    },
    backHomeText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
