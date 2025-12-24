import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface DayPickerModalProps {
    visible: boolean;
    routeNo: string;
    routeName: string;
    onSave: (routineName: string, frequency: 'daily' | 'weekly', daysOfWeek: number[]) => void;
    onClose: () => void;
}

const DAYS = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
];

export default function DayPickerModal({ visible, routeNo, routeName, onSave, onClose }: DayPickerModalProps) {
    const [routineName, setRoutineName] = useState(`Route ${routeNo} Routine`);
    const [frequency, setFrequency] = useState<'daily' | 'weekly'>('weekly');
    const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Default: Mon-Fri

    const toggleDay = (day: number) => {
        if (selectedDays.includes(day)) {
            setSelectedDays(selectedDays.filter(d => d !== day));
        } else {
            setSelectedDays([...selectedDays, day].sort());
        }
    };

    const handleSave = () => {
        if (!routineName.trim()) {
            alert('Please enter a routine name');
            return;
        }
        if (frequency === 'weekly' && selectedDays.length === 0) {
            alert('Please select at least one day');
            return;
        }
        onSave(routineName, frequency, selectedDays);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <View style={styles.modal}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Save as Routine</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close" size={24} color="#333" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.content}>
                        {/* Route Info */}
                        <View style={styles.routeInfo}>
                            <Text style={styles.routeNumber}>Route {routeNo}</Text>
                            <Text style={styles.routeNameText}>{routeName}</Text>
                        </View>

                        {/* Routine Name */}
                        <View style={styles.section}>
                            <Text style={styles.label}>Routine Name</Text>
                            <TextInput
                                style={styles.input}
                                value={routineName}
                                onChangeText={setRoutineName}
                                placeholder="e.g., Morning Commute"
                            />
                        </View>

                        {/* Frequency */}
                        <View style={styles.section}>
                            <Text style={styles.label}>Frequency</Text>
                            <View style={styles.frequencyButtons}>
                                <TouchableOpacity
                                    style={[
                                        styles.frequencyButton,
                                        frequency === 'daily' && styles.frequencyButtonActive
                                    ]}
                                    onPress={() => setFrequency('daily')}
                                >
                                    <Text style={[
                                        styles.frequencyButtonText,
                                        frequency === 'daily' && styles.frequencyButtonTextActive
                                    ]}>Daily</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[
                                        styles.frequencyButton,
                                        frequency === 'weekly' && styles.frequencyButtonActive
                                    ]}
                                    onPress={() => setFrequency('weekly')}
                                >
                                    <Text style={[
                                        styles.frequencyButtonText,
                                        frequency === 'weekly' && styles.frequencyButtonTextActive
                                    ]}>Weekly</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Days of Week */}
                        {frequency === 'weekly' && (
                            <View style={styles.section}>
                                <Text style={styles.label}>Days of Week</Text>
                                <View style={styles.daysGrid}>
                                    {DAYS.map(day => (
                                        <TouchableOpacity
                                            key={day.value}
                                            style={[
                                                styles.dayButton,
                                                selectedDays.includes(day.value) && styles.dayButtonActive
                                            ]}
                                            onPress={() => toggleDay(day.value)}
                                        >
                                            <Text style={[
                                                styles.dayButtonText,
                                                selectedDays.includes(day.value) && styles.dayButtonTextActive
                                            ]}>{day.label}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    {/* Footer */}
                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                            <Text style={styles.saveButtonText}>Save Routine</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modal: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '90%',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#333',
    },
    content: {
        padding: 20,
    },
    routeInfo: {
        backgroundColor: '#E6F2FF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
    },
    routeNumber: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0066CC',
    },
    routeNameText: {
        fontSize: 14,
        color: '#666',
        marginTop: 4,
    },
    section: {
        marginBottom: 24,
    },
    label: {
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
        fontSize: 16,
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
        fontSize: 16,
        color: '#666',
    },
    frequencyButtonTextActive: {
        color: '#fff',
        fontWeight: '600',
    },
    daysGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    dayButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
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
        fontSize: 14,
        color: '#666',
    },
    dayButtonTextActive: {
        color: '#fff',
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        padding: 20,
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
    },
    cancelButton: {
        flex: 1,
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#ddd',
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        color: '#666',
        fontWeight: '600',
    },
    saveButton: {
        flex: 1,
        padding: 16,
        borderRadius: 8,
        backgroundColor: '#0066CC',
        alignItems: 'center',
    },
    saveButtonText: {
        fontSize: 16,
        color: '#fff',
        fontWeight: '600',
    },
});
