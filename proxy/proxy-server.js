const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// TransLink GTFS-RT API
const GTFS_RT_BASE = 'https://gtfsapi.translink.ca/v3';
const API_KEY = 'chW7YWFXZeKGiBfEJnYD';

// TransLink RTTI API (REST API for stop estimates/schedules)
const RTTI_API_BASE = 'https://api.translink.ca/rttiapi/v1';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Cache TTL in milliseconds (15 seconds - matches GTFS-RT update frequency) */
const CACHE_TTL_MS = 15 * 1000;

/** Rate limit: max requests per window */
const RATE_LIMIT_MAX_REQUESTS = 60;

/** Rate limit window in milliseconds (1 minute) */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Health check interval (30 seconds) */
const HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

/** Stale cache threshold - serve stale if fresh fetch fails (5 minutes) */
const STALE_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

/**
 * Cache entry structure
 * @typedef {Object} CacheEntry
 * @property {Buffer} data - The cached protobuf data
 * @property {number} timestamp - When the data was cached
 * @property {number} size - Size in bytes
 */

/** @type {Map<string, CacheEntry>} */
const feedCache = new Map();

/**
 * Get cached feed or null if expired/missing
 * @param {string} feedName
 * @param {boolean} allowStale - If true, return stale cache up to STALE_CACHE_TTL_MS
 * @returns {CacheEntry|null}
 */
function getCached(feedName, allowStale = false) {
    const entry = feedCache.get(feedName);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    const maxAge = allowStale ? STALE_CACHE_TTL_MS : CACHE_TTL_MS;

    if (age > maxAge) {
        if (!allowStale) return null;
        // For stale, still return but log warning
        console.log(`[Cache] ⚠️ Serving STALE ${feedName} (${Math.round(age / 1000)}s old)`);
    }

    return entry;
}

/**
 * Store feed in cache
 * @param {string} feedName
 * @param {Buffer} data
 */
function setCache(feedName, data) {
    feedCache.set(feedName, {
        data,
        timestamp: Date.now(),
        size: data.length
    });
    console.log(`[Cache] 💾 Cached ${feedName} (${data.length} bytes)`);
}

// ============================================================================
// RATE LIMITING
// ============================================================================

/** @type {Map<string, {count: number, resetTime: number}>} */
const rateLimitStore = new Map();

/**
 * Rate limit middleware - limits requests per IP
 */
function rateLimiter(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = rateLimitStore.get(clientIP);

    // Reset if window expired
    if (!entry || now > entry.resetTime) {
        entry = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
        rateLimitStore.set(clientIP, entry);
    }

    entry.count++;

    // Add rate limit headers
    res.set('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    res.set('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count));
    res.set('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        console.log(`[RateLimit] ⛔ ${clientIP} exceeded limit (${entry.count}/${RATE_LIMIT_MAX_REQUESTS})`);
        return res.status(429).json({
            error: 'Too Many Requests',
            retryAfter: Math.ceil((entry.resetTime - now) / 1000)
        });
    }

    next();
}

// Clean up old rate limit entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now > entry.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, 60000);

// ============================================================================
// HEALTH CHECKS
// ============================================================================

/** Feed health status */
const feedHealth = {
    gtfsposition: { healthy: false, lastCheck: 0, lastError: null },
    gtfsrealtime: { healthy: false, lastCheck: 0, lastError: null },
    gtfsalerts: { healthy: false, lastCheck: 0, lastError: null }
};

/**
 * Check health of a single feed
 * @param {string} feedName
 */
async function checkFeedHealth(feedName) {
    try {
        const response = await axios.get(`${GTFS_RT_BASE}/${feedName}`, {
            params: { apikey: API_KEY },
            responseType: 'arraybuffer',
            timeout: 10000
        });

        feedHealth[feedName] = {
            healthy: true,
            lastCheck: Date.now(),
            lastError: null,
            size: response.data.length
        };

        // Update cache with health check data
        setCache(feedName, response.data);

        console.log(`[Health] ✅ ${feedName} OK (${response.data.length} bytes)`);
    } catch (error) {
        feedHealth[feedName] = {
            healthy: false,
            lastCheck: Date.now(),
            lastError: error.message
        };
        console.log(`[Health] ❌ ${feedName} FAILED: ${error.message}`);
    }
}

/**
 * Run health checks for all feeds
 */
async function runHealthChecks() {
    console.log('[Health] 🔍 Running feed health checks...');
    await Promise.all([
        checkFeedHealth('gtfsposition'),
        checkFeedHealth('gtfsrealtime'),
        checkFeedHealth('gtfsalerts')
    ]);
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// Request logger
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'TransLink Proxy Running',
        uptime: Math.round(process.uptime()),
        cache: {
            gtfsposition: feedCache.has('gtfsposition') ? {
                age: Date.now() - feedCache.get('gtfsposition').timestamp,
                size: feedCache.get('gtfsposition').size
            } : null,
            gtfsrealtime: feedCache.has('gtfsrealtime') ? {
                age: Date.now() - feedCache.get('gtfsrealtime').timestamp,
                size: feedCache.get('gtfsrealtime').size
            } : null,
            gtfsalerts: feedCache.has('gtfsalerts') ? {
                age: Date.now() - feedCache.get('gtfsalerts').timestamp,
                size: feedCache.get('gtfsalerts').size
            } : null
        },
        health: feedHealth
    });
});

// Detailed health endpoint
app.get('/health', (req, res) => {
    const allHealthy = Object.values(feedHealth).every(f => f.healthy);
    res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? 'healthy' : 'degraded',
        feeds: feedHealth,
        cache: {
            entries: feedCache.size,
            feeds: Array.from(feedCache.keys())
        }
    });
});

/**
 * Generic GTFS-RT feed handler with caching and fallback
 * @param {string} feedName
 */
function createFeedHandler(feedName) {
    return async (req, res) => {
        console.log(`[GTFS] Fetching ${feedName}...`);

        // Step 1: Check fresh cache
        const cached = getCached(feedName, false);
        if (cached) {
            console.log(`[GTFS] 📦 Cache HIT for ${feedName} (${cached.size} bytes)`);
            res.set('Content-Type', 'application/x-protobuf');
            res.set('X-Cache', 'HIT');
            res.set('X-Cache-Age', Date.now() - cached.timestamp);
            return res.send(cached.data);
        }

        // Step 2: Fetch from TransLink
        try {
            const response = await axios.get(`${GTFS_RT_BASE}/${feedName}`, {
                params: { apikey: API_KEY },
                responseType: 'arraybuffer',
                timeout: 20000
            });

            console.log(`[GTFS] ✅ Got ${response.data.length} bytes`);

            // Update cache
            setCache(feedName, response.data);

            // Update health
            feedHealth[feedName] = { healthy: true, lastCheck: Date.now(), lastError: null };

            res.set('Content-Type', 'application/x-protobuf');
            res.set('X-Cache', 'MISS');
            res.send(response.data);

        } catch (error) {
            console.error(`[GTFS] ❌ ${feedName} error:`, error.response?.status || error.code, error.message);

            // Update health
            feedHealth[feedName] = { healthy: false, lastCheck: Date.now(), lastError: error.message };

            // Step 3: Try stale cache as fallback
            const stale = getCached(feedName, true);
            if (stale) {
                console.log(`[GTFS] 🔄 Serving STALE ${feedName} as fallback`);
                res.set('Content-Type', 'application/x-protobuf');
                res.set('X-Cache', 'STALE');
                res.set('X-Cache-Age', Date.now() - stale.timestamp);
                res.set('X-Fallback', 'true');
                return res.send(stale.data);
            }

            // Step 4: No cache available - return error with degradation hint
            res.status(error.response?.status || 503).json({
                error: error.message,
                fallback: 'unavailable',
                hint: 'Real-time data temporarily unavailable. App should use scheduled data.'
            });
        }
    };
}

// GTFS-RT Feed Routes
app.get('/gtfs/gtfsposition', createFeedHandler('gtfsposition'));
app.get('/gtfs/gtfsrealtime', createFeedHandler('gtfsrealtime'));
app.get('/gtfs/gtfsalerts', createFeedHandler('gtfsalerts'));

// ============================================================================
// RTTI API ROUTES (TransLink REST API for schedules)
// ============================================================================

/**
 * Get stop estimates - returns scheduled arrivals for a stop
 * TransLink API: GET /rttiapi/v1/stops/{stopNo}/estimates
 */
app.get('/api/stops/:stopNo/estimates', async (req, res) => {
    const { stopNo } = req.params;
    const routeNo = req.query.routeNo;
    const count = req.query.count || 10;
    const timeframe = req.query.timeframe || 120; // minutes

    console.log(`[RTTI] Fetching estimates for stop ${stopNo}${routeNo ? ` route ${routeNo}` : ''}`);

    try {
        const params = {
            apikey: API_KEY,
            count: count,
            timeframe: timeframe
        };
        if (routeNo) params.routeNo = routeNo;

        const response = await axios.get(`${RTTI_API_BASE}/stops/${stopNo}/estimates`, {
            params,
            headers: { 'Accept': 'application/json' },
            timeout: 10000
        });

        console.log(`[RTTI] ✅ Got ${response.data?.length || 0} estimates for stop ${stopNo}`);
        res.json(response.data);
    } catch (error) {
        console.log(`[RTTI] ❌ Error fetching estimates: ${error.message}`);

        // Return empty array with error hint instead of error status
        res.json({
            error: error.message,
            estimates: [],
            hint: 'Schedule API unavailable, use GTFS-RT or bundled data'
        });
    }
});

/**
 * Get route schedules - returns schedule for a specific route
 * TransLink API: GET /rttiapi/v1/routes/{routeNo}/schedules
 */
app.get('/api/routes/:routeNo/schedules', async (req, res) => {
    const { routeNo } = req.params;
    const stopNo = req.query.stopNo;

    console.log(`[RTTI] Fetching schedule for route ${routeNo}${stopNo ? ` at stop ${stopNo}` : ''}`);

    try {
        const params = { apikey: API_KEY };
        if (stopNo) params.stopNo = stopNo;

        const response = await axios.get(`${RTTI_API_BASE}/routes/${routeNo}/schedules`, {
            params,
            headers: { 'Accept': 'application/json' },
            timeout: 10000
        });

        console.log(`[RTTI] ✅ Got schedule for route ${routeNo}`);
        res.json(response.data);
    } catch (error) {
        console.log(`[RTTI] ❌ Error fetching schedule: ${error.message}`);
        res.json({
            error: error.message,
            schedules: [],
            hint: 'Schedule API unavailable'
        });
    }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

app.listen(PORT, '0.0.0.0', async () => {
    console.log('='.repeat(50));
    console.log('🚀 TransLink GTFS-RT Proxy Running (Hardened)');
    console.log(`📍 http://192.168.1.85:${PORT}`);
    console.log('='.repeat(50));
    console.log('');
    console.log('🛡️  Hardening Features:');
    console.log(`   • Rate Limiting: ${RATE_LIMIT_MAX_REQUESTS} req/${RATE_LIMIT_WINDOW_MS / 1000}s`);
    console.log(`   • Cache TTL: ${CACHE_TTL_MS / 1000}s (stale: ${STALE_CACHE_TTL_MS / 1000}s)`);
    console.log(`   • Health Checks: Every ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);
    console.log('');

    // Initial health check
    await runHealthChecks();

    // Periodic health checks
    setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS);
});
