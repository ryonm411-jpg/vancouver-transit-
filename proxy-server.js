const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS for Expo Go
app.use(cors());
app.use(express.json());

// TransLink API configuration
const TRANSLINK_API_KEY = 'chW7YWFXZeKGiBfEJnYD';
const TRANSLINK_BASE_URL = 'https://api.translink.ca/rttiapi/v1';
const TRANSLINK_GTFS_URL = 'https://gtfs.translink.ca/v3';

// Helper for TransLink requests
const fetchTransLink = async (url, config = {}) => {
    // Try request with apikey param
    try {
        return await axios.get(url, {
            ...config,
            params: { ...config.params, apikey: TRANSLINK_API_KEY }
        });
    } catch (error) {
        // If 403, and it was a GTFS request, try with Header
        if (error.response?.status === 403) {
            console.log(`[Proxy] 403 with param, retrying with Header...`);
            return await axios.get(url, {
                ...config,
                params: config.params, // Keep original params but remove apikey if it was strictly disallowed (usually fine to keep)
                headers: {
                    ...config.headers,
                    'Authorization': `${TRANSLINK_API_KEY}` // Sometimes just the key? Or Bearer?
                    // Search result said "Bearer", let's try that if this fails? 
                    // Actually let's try passing it exactly as search result said: Authorization: Bearer <Key>
                }
            });
        }
        throw error;
    }
};

// Proxy for REST API routes
app.get('/api/routes', async (req, res) => {
    try {
        console.log('[Proxy] Fetching routes from TransLink...');
        const response = await axios.get(`${TRANSLINK_BASE_URL}/routes`, {
            params: { apikey: TRANSLINK_API_KEY },
            headers: { accept: 'application/JSON' }
        });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error fetching routes:', error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Proxy for stops by route
app.get('/api/routes/:routeNo', async (req, res) => {
    try {
        const { routeNo } = req.params;
        console.log(`[Proxy] Fetching stops for route ${routeNo}...`);
        const response = await axios.get(`${TRANSLINK_BASE_URL}/routes/${routeNo}`, {
            params: { apikey: TRANSLINK_API_KEY },
            headers: { accept: 'application/JSON' }
        });
        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error fetching stops:', error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Proxy for GTFS-RT Trip Updates
app.get('/api/gtfs/tripupdates', async (req, res) => {
    try {
        console.log('[Proxy] Fetching GTFS-RT trip updates...');
        // Try query param first
        const response = await axios.get(`${TRANSLINK_GTFS_URL}/TripUpdates`, {
            params: { apikey: TRANSLINK_API_KEY },
            responseType: 'arraybuffer'
        });
        res.set('Content-Type', 'application/octet-stream');
        res.send(response.data);
    } catch (error) {
        console.error('[Proxy] Error fetching trip updates:', error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Proxy for GTFS-RT Vehicle Positions
app.get('/api/gtfs/vehiclepositions', async (req, res) => {
    try {
        console.log('[Proxy] Fetching GTFS-RT vehicle positions...');

        // Try strict query param first as per standard docs
        const response = await axios.get(`${TRANSLINK_GTFS_URL}/VehiclePositions`, {
            params: { apikey: TRANSLINK_API_KEY },
            responseType: 'arraybuffer'
        });

        console.log('[Proxy] Success! Size:', response.data.length);
        res.set('Content-Type', 'application/octet-stream');
        res.send(response.data);
    } catch (error) {
        console.error('[Proxy] Error with param:', error.message);

        // Retry with header?
        try {
            console.log('[Proxy] Retrying with Authorization header...');
            const responseRetry = await axios.get(`${TRANSLINK_GTFS_URL}/VehiclePositions`, {
                headers: { 'Authorization': `${TRANSLINK_API_KEY}` }, // Try raw key
                responseType: 'arraybuffer'
            });
            console.log('[Proxy] Success with Header!');
            res.set('Content-Type', 'application/octet-stream');
            res.send(responseRetry.data);
            return;
        } catch (e2) {
            console.error('[Proxy] Error with header:', e2.message);
        }

        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

// Proxy for GTFS-RT Service Alerts
app.get('/api/gtfs/servicealerts', async (req, res) => {
    try {
        console.log('[Proxy] Fetching GTFS-RT service alerts...');
        const response = await axios.get(`${TRANSLINK_GTFS_URL}/ServiceAlerts`, {
            params: { apikey: TRANSLINK_API_KEY },
            responseType: 'arraybuffer'
        });
        res.set('Content-Type', 'application/octet-stream');
        res.send(response.data);
    } catch (error) {
        console.error('[Proxy] Error fetching service alerts:', error.message);
        res.status(error.response?.status || 500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚌 TransLink Proxy Server running on http://localhost:${PORT}`);
    console.log(`📡 Forwarding requests to TransLink APIs`);
});
