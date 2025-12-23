import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

console.log('====== FIREBASE INITIALIZATION START ======');
console.log('[Firebase] Firebase SDK version: 9.23.0');
console.log('[Firebase] Platform: React Native');

// Initialize Firebase App
let app: FirebaseApp;
try {
    const existingApps = getApps();
    console.log('[Firebase] Existing apps count:', existingApps.length);

    if (existingApps.length === 0) {
        console.log('[Firebase] No existing apps, initializing new app...');
        app = initializeApp(firebaseConfig);
        console.log('[Firebase] ✅ New app initialized successfully');
    } else {
        console.log('[Firebase] Reusing existing app...');
        app = getApp();
        console.log('[Firebase] ✅ Existing app retrieved successfully');
    }
    console.log('[Firebase] App name:', app.name);
} catch (error: any) {
    console.error('[Firebase] ❌ FAILED to initialize app');
    console.error('[Firebase] Error:', error);
    throw error;
}

// Initialize Firestore
let db: Firestore;
try {
    console.log('[Firebase] Initializing Firestore...');
    db = getFirestore(app);
    console.log('[Firebase] ✅ Firestore initialized successfully');
} catch (error: any) {
    console.error('[Firebase] ❌ FAILED to initialize Firestore');
    console.error('[Firebase] Error:', error);
    throw error;
}

console.log('====== FIREBASE INITIALIZATION COMPLETE ======');
console.log('[Firebase] Note: Auth is not initialized (not used in this app)');

// Only export db - auth is not used in this app
export { db };
export default app;
