import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import RoutineService from '../src/services/RoutineService';
import { RoutineSegment } from '../src/models/types';

export default function CreateRoutineScreen() {
    const router = useRouter();
    const [name, setName] = useState('');
    const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
    const [segments, setSegments] = useState<Omit<RoutineSegment, 'id'>[]>([]);
    const [saving, setSaving] = useState(false);

    const weekDays = [
        { label: 'Sun', value: 0 },
        { label: 'Mon', value: 1 },
        { label: 'Tue', value: 2 },
        { label: 'Wed', value: 3 },
        { label: 'Thu', value: 4 },
        { label: 'Fri', value: 5 },
        { label: 'Sat', value: 6 },
    ];

    const toggleDay = (day: number) => {
        if (daysOfWeek.includes(day)) {
            setDaysOfWeek(daysOfWeek.filter(d => d !== day));
        } else {
            setDaysOfWeek([...daysOfWeek, day].sort());
        }
    };

    const addSegment = () => {
        const newSegment: Omit<RoutineSegment, 'id'> = {
            sequenceOrder: segments.length,
            transitType: 'bus',
            routeNumber: '',
            stopId: '',
            stopName: '',
            scheduledTime: '08:00',
            direction: 'EAST',
            destination: '',
        };
        setSegments([...segments, newSegment]);
    };

    const updateSegment = (index: number, field: string, value: any) => {
        const updated = [...segments];
        updated[index] = { ...updated[index], [field]: value };
        setSegments(updated);
    };

    const removeSegment = (index: number) => {
        setSegments(segments.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'Please enter a routine name');
            return;
        }

        if (segments.length === 0) {
            Alert.alert('Error', 'Please add at least one transit segment');
            return;
        }

        // Validate segments
        for (const segment of segments) {
            if (!segment.routeNumber || !segment.stopName || !segment.destination) {
                Alert.alert('Error', 'Please fill in all segment details');
                return;
            }
        }

        if (frequency === 'weekly' && daysOfWeek.length === 0) {
            Alert.alert('Error', 'Please select at least one day');
            return;
        }

        setSaving(true);
        try {
            // TODO: Replace with actual user ID from authentication
            const userId = 'demo-user';

            const segmentsWithIds = segments.map((seg, idx) => ({
                ...seg,
                id: `segment-${Date.now()}-${idx}`,
                sequenceOrder: idx,
            }));

            const newRoutine = {
                userId: 'demo-user', // TODO: Replace with actual user ID from auth
                name: name.trim(),
                frequency: frequency,
                daysOfWeek: frequency === 'weekly' ? daysOfWeek : [], // Firebase doesn't accept undefined
                active: true,
                segments: segmentsWithIds,
            };
            await RoutineService.createRoutine(newRoutine);

            Alert.alert('Success', 'Routine created successfully!', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (error) {
            console.error('Error saving routine:', error);
            Alert.alert('Error', 'Failed to save routine. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#0066CC" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Create Routine</Text>
                <TouchableOpacity onPress={handleSave} disabled={saving}>
                    <Text style={[styles.saveButton, saving && styles.saveButtonDisabled]}>
                        {saving ? 'Saving...' : 'Save'}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.scrollView}>
                {/* Routine Name */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Routine Name</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g., Morning Commute"
                        value={name}
                        onChangeText={setName}
                    />
                </View>

                {/* Frequency */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Frequency</Text>
                    <View style={styles.frequencyButtons}>
                        <TouchableOpacity
                            style={[styles.frequencyButton, frequency === 'daily' && styles.frequencyButtonActive]}
                            onPress={() => setFrequency('daily')}
                        >
                            <Text style={[styles.frequencyButtonText, frequency === 'daily' && styles.frequencyButtonTextActive]}>
                                Daily
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.frequencyButton, frequency === 'weekly' && styles.frequencyButtonActive]}
                            onPress={() => setFrequency('weekly')}
                        >
                            <Text style={[styles.frequencyButtonText, frequency === 'weekly' && styles.frequencyButtonTextActive]}>
                                Weekly
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {frequency === 'weekly' && (
                        <View style={styles.daysSelector}>
                            {weekDays.map(day => (
                                <TouchableOpacity
                                    key={day.value}
                                    style={[styles.dayButton, daysOfWeek.includes(day.value) && styles.dayButtonActive]}
                                    onPress={() => toggleDay(day.value)}
                                >
                                    <Text style={[styles.dayButtonText, daysOfWeek.includes(day.value) && styles.dayButtonTextActive]}>
                                        {day.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                </View>

                {/* Transit Segments */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Transit Segments</Text>
                        <TouchableOpacity onPress={addSegment} style={styles.addSegmentButton}>
                            <Ionicons name="add-circle" size={24} color="#0066CC" />
                        </TouchableOpacity>
                    </View>

                    {segments.map((segment, index) => (
                        <View key={index} style={styles.segmentCard}>
                            <View style={styles.segmentHeader}>
                                <Text style={styles.segmentNumber}>Segment {index + 1}</Text>
                                <TouchableOpacity onPress={() => removeSegment(index)}>
                                    <Ionicons name="trash-outline" size={20} color="#ff3b30" />
                                </TouchableOpacity>
                            </View>

                            <View style={styles.inputRow}>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Route Number</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g., 99"
                                        value={segment.routeNumber}
                                        onChangeText={(text) => updateSegment(index, 'routeNumber', text)}
                                    />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Time</Text>
                                    <TextInput
                                        style={styles.input}
                                        placeholder="08:00"
                                        value={segment.scheduledTime}
                                        onChangeText={(text) => updateSegment(index, 'scheduledTime', text)}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Stop Name</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g., Broadway & Commercial"
                                    value={segment.stopName}
                                    onChangeText={(text) => updateSegment(index, 'stopName', text)}
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Destination</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="e.g., UBC"
                                    value={segment.destination}
                                    onChangeText={(text) => updateSegment(index, 'destination', text)}
                                />
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Transit Type</Text>
                                <View style={styles.transitTypeButtons}>
                                    {['bus', 'skytrain', 'seabus'].map(type => (
                                        <TouchableOpacity
                                            key={type}
                                            style={[
                                                styles.transitTypeButton,
                                                segment.transitType === type && styles.transitTypeButtonActive
                                            ]}
                                            onPress={() => updateSegment(index, 'transitType', type)}
                                        >
                                            <Text style={[
                                                styles.transitTypeButtonText,
                                                segment.transitType === type && styles.transitTypeButtonTextActive
                                            ]}>
                                                {type.charAt(0).toUpperCase() + type.slice(1)}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        </View>
                    ))}

                    {segments.length === 0 && (
                        <View style={styles.emptySegments}>
                            <Ionicons name="navigate-outline" size={48} color="#ccc" />
                            <Text style={styles.emptySegmentsText}>No segments added yet</Text>
                            <Text style={styles.emptySegmentsSubText}>Tap the + button to add a transit segment</Text>
                        </View>
                    )}
                </View>
            </ScrollView>
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
        justifyContent: 'space-between',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
    },
    saveButton: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0066CC',
    },
    saveButtonDisabled: {
        color: '#ccc',
    },
    scrollView: {
        flex: 1,
    },
    section: {
        backgroundColor: '#fff',
        padding: 16,
        marginTop: 12,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 12,
        fontSize: 15,
        backgroundColor: '#fff',
    },
    frequencyButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    frequencyButton: {
        flex: 1,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
        alignItems: 'center',
    },
    frequencyButtonActive: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    frequencyButtonText: {
        fontSize: 15,
        color: '#666',
    },
    frequencyButtonTextActive: {
        color: '#fff',
        fontWeight: '600',
    },
    daysSelector: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    dayButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#ddd',
        alignItems: 'center',
        justifyContent: 'center',
    },
    dayButtonActive: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    dayButtonText: {
        fontSize: 13,
        color: '#666',
    },
    dayButtonTextActive: {
        color: '#fff',
        fontWeight: '600',
    },
    addSegmentButton: {
        padding: 4,
    },
    segmentCard: {
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e0e0e0',
    },
    segmentHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    segmentNumber: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0066CC',
    },
    inputRow: {
        flexDirection: 'row',
        gap: 12,
    },
    inputGroup: {
        flex: 1,
        marginBottom: 12,
    },
    inputLabel: {
        fontSize: 13,
        color: '#666',
        marginBottom: 6,
    },
    transitTypeButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    transitTypeButton: {
        flex: 1,
        padding: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#ddd',
        alignItems: 'center',
    },
    transitTypeButtonActive: {
        backgroundColor: '#E6F2FF',
        borderColor: '#0066CC',
    },
    transitTypeButtonText: {
        fontSize: 13,
        color: '#666',
    },
    transitTypeButtonTextActive: {
        color: '#0066CC',
        fontWeight: '600',
    },
    emptySegments: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptySegmentsText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#999',
        marginTop: 12,
    },
    emptySegmentsSubText: {
        fontSize: 13,
        color: '#aaa',
        marginTop: 4,
    },
});
