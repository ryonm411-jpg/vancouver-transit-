// Firebase Configuration
// Configured from Firebase Console

export const firebaseConfig = {
    apiKey: "AIzaSyBJAvA8JtEyxhg6QtYOBTMK044R15GRf7I",
    authDomain: "vancouver-transit-app.firebaseapp.com",
    projectId: "vancouver-transit-app",
    storageBucket: "vancouver-transit-app.firebasestorage.app",
    messagingSenderId: "947416424524",
    appId: "1:947416424524:web:36561b599cec6c431814e9",
    measurementId: "G-VCT70PCY20"
};

// TransLink API Configuration
// Using local proxy server to bypass Expo Go limitations
export const translinkConfig = {
    apiKey: "chW7YWFXZeKGiBfEJnYD",
    baseUrl: "http://192.168.1.85:3001/api", // Proxy server (use your computer's IP)
    gtfsRtUrl: "http://192.168.1.85:3001/api/gtfs"
};

// App Configuration
export const appConfig = {
    delayThreshold: 5, // minutes - minimum delay to trigger notification
    timeSavingsThreshold: 10, // minutes - minimum time savings to suggest alternative route
    boardingReminderTime: 5, // minutes - how early to remind user to board
    locationUpdateInterval: 60, // seconds - how often to send location updates
    transitMonitorInterval: 120, // seconds - how often to check for delays
};
