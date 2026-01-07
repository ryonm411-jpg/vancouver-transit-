import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../src/config/firebase'; // Initialize Firebase
import { AuthProvider } from '../src/contexts/AuthContext';
import NotificationService from '../src/services/NotificationService';

export default function RootLayout() {
    useEffect(() => {
        // Listen for notification interactions
        const subscription = NotificationService.addNotificationResponseListener(response => {
            const type = response.notification.request.content.data.type;

            if (type === 'CHECK_IN_PROMPT') {
                console.log('User checked in via notification');
                // In a real app, we would start tracking or log the boarding here
            }
        });

        return () => {
            subscription.remove();
        };
    }, []);

    return (
        <SafeAreaProvider>
            <AuthProvider>
                <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen
                        name="create-routine"
                        options={{
                            headerShown: false,
                            presentation: 'modal'
                        }}
                    />
                    <Stack.Screen
                        name="search"
                        options={{
                            headerShown: false,
                            presentation: 'modal'
                        }}
                    />
                </Stack>
            </AuthProvider>
        </SafeAreaProvider>
    );
}
