import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../src/config/firebase'; // Initialize Firebase
import { AuthProvider } from '../src/contexts/AuthContext';

export default function RootLayout() {
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
                </Stack>
            </AuthProvider>
        </SafeAreaProvider>
    );
}
