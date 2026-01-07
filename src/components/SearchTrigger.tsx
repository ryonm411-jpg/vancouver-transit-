import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export const SearchTrigger = () => {
    const router = useRouter();

    return (
        <TouchableOpacity
            style={styles.container}
            activeOpacity={0.9}
            onPress={() => router.push('/search')}
        >
            <View style={styles.content}>
                <Ionicons name="search" size={20} color="#fff" style={styles.icon} />
                <Text style={styles.text}>Where to?</Text>
            </View>
            <TouchableOpacity style={styles.homeButton}>
                <Ionicons name="home" size={20} color="#fff" />
                <View style={styles.plusBadge}>
                    <Ionicons name="add" size={10} color="#05603A" />
                </View>
            </TouchableOpacity>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#05603A', // Green
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 10,
        // No rounded corners at bottom if attached?
        // Actually, sheet has rounded top corners.
        // We probably want this bar to fill the header area which likely has rounded corners clipping it.
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    icon: {
        marginRight: 10,
    },
    text: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '500',
    },
    homeButton: {
        position: 'relative',
        padding: 5,
    },
    plusBadge: {
        position: 'absolute',
        bottom: 0,
        right: -2,
        backgroundColor: '#fff',
        borderRadius: 6,
        width: 12,
        height: 12,
        alignItems: 'center',
        justifyContent: 'center',
    }
});
