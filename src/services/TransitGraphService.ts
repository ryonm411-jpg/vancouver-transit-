/**
 * TransitGraphService - Multi-transfer route finding using GTFS graph
 * 
 * Features:
 * - Build transit graph from STOP_ROUTES and ROUTE_STOPS
 * - Modified Dijkstra for multi-transfer routing (max 3 transfers)
 * - Penalty scoring for transfers and missed connections
 * - Reliability weighting based on real-time availability
 */

import { STOP_ROUTES, getRoutesForStop, getStopsForRoute } from '../data/stopRoutes';
import { ROUTE_STOPS } from '../data/routeStops';
import { STOPS, getStopById, findNearbyStops, GtfsStop } from '../data/stops';
import { ROUTES, GtfsRoute } from '../data/routes';

// ============================================================================
// ROUTING CONFIGURATION - Tune these for optimal route ranking
// ============================================================================

/** TRANSFER_PENALTY_MINUTES: Time penalty per transfer (makes direct routes preferred) */
const TRANSFER_PENALTY_MINUTES = 8;

/** MISSED_CONNECTION_PENALTY: Penalty for tight connections (<3 min buffer) */
const MISSED_CONNECTION_PENALTY = 15;

/** MIN_TRANSFER_BUFFER: Minimum safe transfer time in minutes */
const MIN_TRANSFER_BUFFER = 3;

/** RELIABILITY_DISCOUNT: Score discount when real-time data is available */
const RELIABILITY_DISCOUNT = 0.2;

/** FREQUENCY_BONUS_PER_TPH: Score bonus per trip-per-hour (higher freq = lower score) */
const FREQUENCY_BONUS_PER_TPH = 0.5;

/** MAX_TRANSFERS: Maximum number of transfers to consider */
const MAX_TRANSFERS = 3;

/** MAX_JOURNEY_MINUTES: Maximum total journey time */
const MAX_JOURNEY_MINUTES = 120;

/** WALKING_SPEED_KMH: Average walking speed for distance calculations */
const WALKING_SPEED_KMH = 5;

/** STOP_DWELL_MINUTES: Average time per stop on a transit route */
const STOP_DWELL_MINUTES = 1.5;

// ============================================================================
// TYPES
// ============================================================================

/** Edge in the transit graph representing a single transit segment */
export interface TransitEdge {
    fromStopId: string;
    toStopId: string;
    routeId: string;
    routeShortName: string;
    travelTimeMinutes: number;  // Estimated from stop count
    stopCount: number;          // Number of stops traversed
}

/** State in Dijkstra search */
interface SearchState {
    stopId: string;
    arrivalMinutes: number;     // Time from journey start
    transfers: number;          // Number of transfers made
    path: PathSegment[];        // Segments to reach this state
    lastRouteId: string | null; // Route used to reach this stop
}

/** Segment of a multi-leg journey */
export interface PathSegment {
    type: 'walk' | 'transit';
    routeId?: string;
    routeShortName?: string;
    fromStopId: string;
    fromStopName: string;
    toStopId: string;
    toStopName: string;
    travelMinutes: number;
    stopCount?: number;
}

/** Complete multi-transfer route result */
export interface MultiTransferRoute {
    id: string;
    segments: PathSegment[];
    totalMinutes: number;
    walkMinutes: number;
    rideMinutes: number;
    transfers: number;
    score: number;              // Lower is better
    penaltyBreakdown: {
        baseTime: number;
        transferPenalty: number;
        missedConnectionRisk: number;
        reliabilityDiscount: number;
    };
    hasRealtimeData: boolean;
}

// ============================================================================
// TRANSIT GRAPH SERVICE
// ============================================================================

class TransitGraphService {
    private static instance: TransitGraphService;

    // Adjacency list: stopId -> outgoing edges
    private graph: Map<string, TransitEdge[]> = new Map();
    private graphBuilt: boolean = false;

    private constructor() { }

    static getInstance(): TransitGraphService {
        if (!TransitGraphService.instance) {
            TransitGraphService.instance = new TransitGraphService();
        }
        return TransitGraphService.instance;
    }

    /**
     * Build the transit graph from GTFS data.
     * Called lazily on first route search.
     */
    buildGraph(): void {
        if (this.graphBuilt) return;

        console.log('[TransitGraph] Building transit graph...');
        const startTime = Date.now();

        // Iterate over all routes and their stop sequences
        for (const [routeId, directions] of Object.entries(ROUTE_STOPS)) {
            const route = ROUTES.find(r => r.id === routeId);
            const routeShortName = route?.shortName || routeId;

            for (const [directionId, stopIds] of Object.entries(directions)) {
                // Create edges between consecutive stops
                for (let i = 0; i < stopIds.length - 1; i++) {
                    const fromStopId = stopIds[i];
                    const toStopId = stopIds[i + 1];

                    const edge: TransitEdge = {
                        fromStopId,
                        toStopId,
                        routeId,
                        routeShortName,
                        travelTimeMinutes: STOP_DWELL_MINUTES,
                        stopCount: 1
                    };

                    if (!this.graph.has(fromStopId)) {
                        this.graph.set(fromStopId, []);
                    }
                    this.graph.get(fromStopId)!.push(edge);
                }
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`[TransitGraph] Built graph with ${this.graph.size} nodes in ${elapsed}ms`);
        this.graphBuilt = true;
    }

    /**
     * Calculate Haversine distance between two points in km.
     */
    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Calculate route score with penalties.
     * Lower score = better route.
     */
    private calculateScore(
        route: MultiTransferRoute,
        hasRealtimeData: boolean
    ): { score: number; breakdown: MultiTransferRoute['penaltyBreakdown'] } {
        const baseTime = route.totalMinutes;
        const transferPenalty = route.transfers * TRANSFER_PENALTY_MINUTES;

        // Check for tight connections (simplified - assume 3 min buffer between legs)
        let missedConnectionRisk = 0;
        for (let i = 0; i < route.segments.length - 1; i++) {
            if (route.segments[i].type === 'transit' && route.segments[i + 1].type === 'transit') {
                // Consecutive transit legs = transfer with potential missed connection
                missedConnectionRisk += MISSED_CONNECTION_PENALTY * 0.3; // Probability-weighted
            }
        }

        // Reliability discount
        const reliabilityDiscount = hasRealtimeData ? baseTime * RELIABILITY_DISCOUNT : 0;

        const score = baseTime + transferPenalty + missedConnectionRisk - reliabilityDiscount;

        return {
            score,
            breakdown: {
                baseTime,
                transferPenalty,
                missedConnectionRisk,
                reliabilityDiscount
            }
        };
    }

    /**
     * Find multi-transfer routes using modified Dijkstra.
     * 
     * @param originLat Origin latitude
     * @param originLon Origin longitude
     * @param destLat Destination latitude
     * @param destLon Destination longitude
     * @param maxResults Maximum routes to return
     */
    async findRoutes(
        originLat: number,
        originLon: number,
        destLat: number,
        destLon: number,
        maxResults: number = 5
    ): Promise<MultiTransferRoute[]> {
        this.buildGraph();

        const startTime = Date.now();

        // Find nearby stops
        const originStops = findNearbyStops(originLat, originLon, 1.0); // 1km radius
        const destStops = findNearbyStops(destLat, destLon, 1.0);

        if (originStops.length === 0 || destStops.length === 0) {
            console.log('[TransitGraph] No nearby stops found');
            return [];
        }

        console.log(`[TransitGraph] Searching from ${originStops.length} origin stops to ${destStops.length} dest stops`);

        // Create destination stop set for fast lookup
        const destStopIds = new Set(destStops.map(s => s.id));

        // Initialize priority queue (simple array, sorted by arrival time)
        const queue: SearchState[] = [];
        const visited = new Map<string, number>(); // stopId:transfers -> best arrival time
        const results: MultiTransferRoute[] = [];

        // Seed queue with walking to each origin stop
        for (const stop of originStops.slice(0, 5)) { // Limit to top 5 closest
            const walkDist = this.haversineDistance(originLat, originLon, stop.lat, stop.lon);
            const walkMinutes = (walkDist / WALKING_SPEED_KMH) * 60;

            queue.push({
                stopId: stop.id,
                arrivalMinutes: walkMinutes,
                transfers: 0,
                path: [{
                    type: 'walk',
                    fromStopId: 'origin',
                    fromStopName: 'Your Location',
                    toStopId: stop.id,
                    toStopName: stop.name,
                    travelMinutes: walkMinutes
                }],
                lastRouteId: null
            });
        }

        // Sort queue by arrival time (min-heap simulation)
        queue.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes);

        // Dijkstra main loop
        while (queue.length > 0 && results.length < maxResults * 2) {
            const current = queue.shift()!;
            const stateKey = `${current.stopId}:${current.transfers}`;

            // Pruning: skip if we've seen a better state
            if (visited.has(stateKey) && visited.get(stateKey)! <= current.arrivalMinutes) {
                continue;
            }
            visited.set(stateKey, current.arrivalMinutes);

            // Pruning: max journey time
            if (current.arrivalMinutes > MAX_JOURNEY_MINUTES) {
                continue;
            }

            // Check if we've reached a destination stop
            if (destStopIds.has(current.stopId)) {
                const destStop = destStops.find(s => s.id === current.stopId)!;
                const finalWalkDist = this.haversineDistance(destStop.lat, destStop.lon, destLat, destLon);
                const finalWalkMinutes = (finalWalkDist / WALKING_SPEED_KMH) * 60;

                // Build result
                const segments = [
                    ...current.path,
                    {
                        type: 'walk' as const,
                        fromStopId: current.stopId,
                        fromStopName: destStop.name,
                        toStopId: 'destination',
                        toStopName: 'Destination',
                        travelMinutes: finalWalkMinutes
                    }
                ];

                const walkMinutes = segments
                    .filter(s => s.type === 'walk')
                    .reduce((sum, s) => sum + s.travelMinutes, 0);
                const rideMinutes = segments
                    .filter(s => s.type === 'transit')
                    .reduce((sum, s) => sum + s.travelMinutes, 0);

                const route: MultiTransferRoute = {
                    id: `multi-${current.stopId}-${current.transfers}-${Date.now()}`,
                    segments,
                    totalMinutes: current.arrivalMinutes + finalWalkMinutes,
                    walkMinutes,
                    rideMinutes,
                    transfers: current.transfers,
                    score: 0,
                    penaltyBreakdown: { baseTime: 0, transferPenalty: 0, missedConnectionRisk: 0, reliabilityDiscount: 0 },
                    hasRealtimeData: false // Will be updated when real-time is queried
                };

                const { score, breakdown } = this.calculateScore(route, false);
                route.score = score;
                route.penaltyBreakdown = breakdown;

                results.push(route);
                continue; // Don't expand from destination stops
            }

            // Expand: follow transit edges
            const edges = this.graph.get(current.stopId) || [];

            for (const edge of edges) {
                const isTransfer = current.lastRouteId !== null && current.lastRouteId !== edge.routeId;
                const newTransfers = isTransfer ? current.transfers + 1 : current.transfers;

                // Pruning: max transfers
                if (newTransfers > MAX_TRANSFERS) continue;

                // Add transfer buffer time
                const transferTime = isTransfer ? MIN_TRANSFER_BUFFER : 0;
                const newArrival = current.arrivalMinutes + transferTime + edge.travelTimeMinutes;

                const toStop = getStopById(edge.toStopId);
                const fromStop = getStopById(edge.fromStopId);

                const newPath: PathSegment[] = [...current.path];

                // If same route, extend the last segment
                if (!isTransfer && newPath.length > 0 && newPath[newPath.length - 1].routeId === edge.routeId) {
                    const lastSeg = newPath[newPath.length - 1];
                    lastSeg.toStopId = edge.toStopId;
                    lastSeg.toStopName = toStop?.name || edge.toStopId;
                    lastSeg.travelMinutes += edge.travelTimeMinutes;
                    lastSeg.stopCount = (lastSeg.stopCount || 0) + 1;
                } else {
                    // New transit segment
                    newPath.push({
                        type: 'transit',
                        routeId: edge.routeId,
                        routeShortName: edge.routeShortName,
                        fromStopId: edge.fromStopId,
                        fromStopName: fromStop?.name || edge.fromStopId,
                        toStopId: edge.toStopId,
                        toStopName: toStop?.name || edge.toStopId,
                        travelMinutes: edge.travelTimeMinutes,
                        stopCount: 1
                    });
                }

                queue.push({
                    stopId: edge.toStopId,
                    arrivalMinutes: newArrival,
                    transfers: newTransfers,
                    path: newPath,
                    lastRouteId: edge.routeId
                });
            }

            // Re-sort queue (inefficient but simple)
            queue.sort((a, b) => a.arrivalMinutes - b.arrivalMinutes);
        }

        // Sort results by score and deduplicate
        results.sort((a, b) => a.score - b.score);
        const uniqueResults = this.deduplicateRoutes(results);

        const elapsed = Date.now() - startTime;
        console.log(`[TransitGraph] Found ${uniqueResults.length} routes in ${elapsed}ms`);

        return uniqueResults.slice(0, maxResults);
    }

    /**
     * Remove duplicate routes (same route sequence).
     */
    private deduplicateRoutes(routes: MultiTransferRoute[]): MultiTransferRoute[] {
        const seen = new Set<string>();
        const unique: MultiTransferRoute[] = [];

        for (const route of routes) {
            const key = route.segments
                .filter(s => s.type === 'transit')
                .map(s => s.routeId)
                .join('-');

            if (!seen.has(key)) {
                seen.add(key);
                unique.push(route);
            }
        }

        return unique;
    }

    /**
     * Get graph statistics for debugging.
     */
    getGraphStats(): { nodes: number; edges: number } {
        this.buildGraph();
        let edgeCount = 0;
        for (const edges of this.graph.values()) {
            edgeCount += edges.length;
        }
        return { nodes: this.graph.size, edges: edgeCount };
    }
}

export default TransitGraphService.getInstance();
