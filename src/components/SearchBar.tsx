import React, { useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Keyboard, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface SearchBarProps {
    value: string;
    onChangeText: (text: string) => void;
    onClear: () => void;
    onFocus?: () => void;
    placeholder?: string;
    isLoading?: boolean;
    autoFocus?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    value,
    onChangeText,
    onClear,
    onFocus,
    placeholder = "Where to?",
    isLoading = false,
    autoFocus = false,
}) => {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';
    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    }, [autoFocus]);

    return (
        <View style={[
            styles.container,
            {
                backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
                shadowColor: isDark ? '#000' : '#888',
            }
        ]}>
            <View style={[
                styles.inputContainer,
                { backgroundColor: isDark ? '#2C2C2E' : '#F2F2F7' }
            ]}>
                <Ionicons
                    name="search"
                    size={20}
                    color={isDark ? '#8E8E93' : '#8E8E93'}
                    style={styles.icon}
                />

                <TextInput
                    ref={inputRef}
                    style={[
                        styles.input,
                        { color: isDark ? '#FFFFFF' : '#000000' }
                    ]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={isDark ? '#8E8E93' : '#8E8E93'}
                    selectionColor={Colors.light.tint}
                    onFocus={onFocus}
                    clearButtonMode="never" // We implement our own
                    returnKeyType="search"
                />

                {isLoading ? (
                    <ActivityIndicator size="small" color={Colors.light.tint} style={styles.rightIcon} />
                ) : value.length > 0 ? (
                    <TouchableOpacity onPress={onClear} style={styles.rightIcon}>
                        <Ionicons
                            name="close-circle"
                            size={20}
                            color={isDark ? '#8E8E93' : '#8E8E93'}
                        />
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'transparent', // Can change to visible separator if needed
        zIndex: 10,
        elevation: 4,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        height: 44,
        paddingHorizontal: 10,
    },
    icon: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 17,
        height: '100%',
        padding: 0, // Remove default Android padding
    },
    rightIcon: {
        marginLeft: 8,
        padding: 4,
    },
});
