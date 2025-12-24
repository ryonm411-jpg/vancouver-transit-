const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3001;

// TransLink GTFS-RT API (API key IS required)
const GTFS_RT_BASE = 'https://gtfsapi.translink.ca/v3';
const API_KEY = 'chW7YWFXZeKGiBfEJnYD';

// Enable CORS for Expo Go
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'TransLink Proxy Running' });
});

// ============================================
// GTFS-RT ROUTES (API key required)
// ============================================

// Vehicle Positions
app.get('/gtfs/gtfsposition', async (req, res) => {
    console.log('[GTFS] Fetching vehicle positions...');
    try {
        const response = await axios.get(`${GTFS_RT_BASE}/gtfsposition`, {
            params: { apikey: API_KEY },
            responseType: 'arraybuffer',
            timeout: 20000
        });
        console.log(`[GTFS] ✅ Got ${response.data.length} bytes`);
        res.set('Content-Type', 'application/x-protobuf');
        res.send(response.data);
    } catch (error) {
        console.error('[GTFS] ❌', error.response?.status || error.code, error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Trip Updates (realtime delays)
app.get('/gtfs/gtfsrealtime', async (req, res) => {
    console.log('[GTFS] Fetching trip updates...');
    try {
        const response = await axios.get(`${GTFS_RT_BASE}/gtfsrealtime`, {
            params: { apikey: API_KEY },
            responseType: 'arraybuffer',
            timeout: 20000
        });
        console.log(`[GTFS] ✅ Got ${response.data.length} bytes`);
        res.set('Content-Type', 'application/x-protobuf');
        res.send(response.data);
    } catch (error) {
        console.error('[GTFS] ❌', error.response?.status || error.code, error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Service Alerts
app.get('/gtfs/gtfsalerts', async (req, res) => {
    console.log('[GTFS] Fetching service alerts...');
    try {
        const response = await axios.get(`${GTFS_RT_BASE}/gtfsalerts`, {
            params: { apikey: API_KEY },
            responseType: 'arraybuffer',
            timeout: 20000
        });
        console.log(`[GTFS] ✅ Got ${response.data.length} bytes`);
        res.set('Content-Type', 'application/x-protobuf');
        res.send(response.data);
    } catch (error) {
        console.error('[GTFS] ❌', error.response?.status || error.code, error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('🚀 TransLink GTFS-RT Proxy Running');
    console.log(`📍 http://192.168.1.85:${PORT}`);
    console.log('='.repeat(50));

    // Test connectivity WITH API key
    console.log('\n🔍 Testing GTFS-RT connectivity (with API key)...');
    axios.get(`${GTFS_RT_BASE}/gtfsposition`, {
        params: { apikey: API_KEY },
        responseType: 'arraybuffer',
        timeout: 10000
    }).then(res => {
        console.log(`✅ GTFS-RT working! Got ${res.data.length} bytes of vehicle data`);
    }).catch(err => {
        console.log(`❌ GTFS-RT error: ${err.response?.status || err.code} - ${err.message}`);
        if (err.response?.status === 403) {
            console.log('   → API key may be invalid or not activated');
            console.log('   → Register at: https://developer.translink.ca/');
        }
    });
});
