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
// REST API (api.translink.ca) is deprecated - using mock data for routes/stops
// GTFS-RT is at gtfsapi.translink.ca (no API key needed)

// Production API URL - Deployed on Render
const PRODUCTION_API_URL = 'https://vancouver-transit.onrender.com';

export const translinkConfig = {
    apiKey: "chW7YWFXZeKGiBfEJnYD", // Not used for GTFS-RT
    baseUrl: __DEV__
        ? "http://192.168.1.85:3001/api"
        : `${PRODUCTION_API_URL}/api`,
    gtfsRtUrl: __DEV__
        ? "http://192.168.1.85:3001/gtfs"
        : `${PRODUCTION_API_URL}/gtfs`
};

// App Configuration
export const appConfig = {
    delayThreshold: 5, // minutes - minimum delay to trigger notification
    timeSavingsThreshold: 10, // minutes - minimum time savings to suggest alternative route
    boardingReminderTime: 5, // minutes - how early to remind user to board
    locationUpdateInterval: 60, // seconds - how often to send location updates
    transitMonitorInterval: 120, // seconds - how often to check for delays
};

// OpenRouteService Configuration (for walking directions)
// Get a free API key at: https://openrouteservice.org/dev/#/signup
export const openRouteServiceConfig = {
    // Using raw base64 token format
    apiKey: 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImFjNmM2ZmU0YmRlZjRkMGY5ZjlkOTQ4ZmNmMTQ5NjRmIiwiaCI6Im11cm11cjY0In0=',
    baseUrl: 'https://api.openrouteservice.org',
    movementThreshold: 25, // meters - recalculate if user moves more than this
};
