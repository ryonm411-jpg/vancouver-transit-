/**
 * RoutePlanningService - Multi-modal transit route planning
 * Finds optimal routes from origin to destination using GTFS data
 */

import { STOPS, getStopById, findNearbyStops } from '../data/stops';
import { getRoutesForStop, getStopsForRoute } from '../data/stopRoutes';
import { ROUTES } from '../data/routes';
import TransLinkService from './TransLinkService';
import WalkingRouteService from './WalkingRouteService';
import TransitGraphService, { MultiTransferRoute } from './TransitGraphService';

export interface RouteLeg {
    type: 'walk' | 'transit';
    // For walking
    distanceMeters?: number;
    durationMinutes?: number;
    startLat?: number;
    startLon?: number;
    endLat?: number;
    endLon?: number;
    // For transit
    routeId?: string;
    routeNo?: string;
    routeName?: string;
    boardingStop?: {
        id: string;
        name: string;
        lat: number;
        lon: number;
    };
    alightingStop?: {
        id: string;
        name: string;
        lat: number;
        lon: number;
    };
    stopCount?: number;
    arrivalTime?: string;
    departureTime?: string;
}

export interface RouteOption {
    id: string;
    totalMinutes: number;
    walkMinutes: number;
    rideMinutes: number;
    transfers: number;
    legs: RouteLeg[];
    reliability: 'live' | 'gps' | 'scheduled';
    score: number;
    departureTime?: string;
    arrivalTime?: string;
    tags?: string[]; // Explainability tags e.g. "Fastest", "Least Walking"
}

// Calculate distance between two points in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

class RoutePlanningServiceClass {
    private static instance: RoutePlanningServiceClass;

    private constructor() { }

    static getInstance(): RoutePlanningServiceClass {
        if (!RoutePlanningServiceClass.instance) {
            RoutePlanningServiceClass.instance = new RoutePlanningServiceClass();
        }
        return RoutePlanningServiceClass.instance;
    }

    /**
     * Calculate heuristic score for a route
     * Lower is better. Base score is travel time in minutes.
     */
    private calculateRouteScore(option: RouteOption): { score: number, tags: string[] } {
        let score = option.totalMinutes;
        const tags: string[] = [];

        // 1. Transfer Friction (+5 min per transfer)
        if (option.transfers > 0) {
            score += option.transfers * 5;
        } else {
            tags.push('Direct');
        }

        // 2. Reliability Bias (-5 min bonus for live data, +5 penalty for scheduled)
        if (option.reliability === 'live') {
            score -= 5;
            tags.push('Live Data');
        } else if (option.reliability === 'scheduled') {
            score += 5;
        }

        // 3. Walking Fatigue
        // +2 min penalty for every minute over 10 mins
        // +5 min penalty for every minute over 20 mins (cumulative)
        if (option.walkMinutes > 10) {
            score += (option.walkMinutes - 10) * 2;
        }
        if (option.walkMinutes > 20) {
            score += (option.walkMinutes - 20) * 3; // Additional penalty
        } else if (option.walkMinutes < 5) {
            tags.push('Minimal Walking');
        }

        // 4. Missed Connection Risk (Heuristic)
        // If it's a transfer route with Scheduled data only, it's risky
        if (option.transfers > 0 && option.reliability === 'scheduled') {
            score += 10;
        }

        return { score: Math.round(score), tags };
    }

    /**
     * Plan routes from origin to destination
     */
    async planRoute(
        originLat: number,
        originLon: number,
        destLat: number,
        destLon: number
    ): Promise<RouteOption[]> {
        console.log(`[RoutePlanning] Planning route from (${originLat.toFixed(4)}, ${originLon.toFixed(4)}) to (${destLat.toFixed(4)}, ${destLon.toFixed(4)})`);

        try {
            // Step 1: Find stops near origin (for boarding)
            const originStops = findNearbyStops(originLat, originLon, 1.0); // 1.0km radius
            console.log(`[RoutePlanning] Found ${originStops.length} stops near origin`);

            // Step 2: Find stops near destination (for alighting)
            const destStops = findNearbyStops(destLat, destLon, 1.0); // 1.0km radius
            console.log(`[RoutePlanning] Found ${destStops.length} stops near destination`);

            if (originStops.length === 0 || destStops.length === 0) {
                console.warn('[RoutePlanning] No stops found near origin or destination');
                return [];
            }

            // Step 3: Find direct routes (no transfers)
            const directRoutes = await this.findDirectRoutes(
                originLat, originLon,
                destLat, destLon,
                originStops,
                destStops
            );
            console.log(`[RoutePlanning] Found ${directRoutes.length} direct routes`);

            // Step 4: Find 1-transfer routes if needed
            let transferRoutes: RouteOption[] = [];
            if (directRoutes.length < 3) {
                transferRoutes = await this.findTransferRoutes(
                    originLat, originLon,
                    destLat, destLon,
                    originStops,
                    destStops
                );
                console.log(`[RoutePlanning] Found ${transferRoutes.length} transfer routes`);
            }

            // Step 5: Find multi-transfer routes using graph (for complex journeys)
            let multiTransferRoutes: RouteOption[] = [];
            if (directRoutes.length + transferRoutes.length < 3) {
                multiTransferRoutes = await this.findMultiTransferRoutes(
                    originLat, originLon,
                    destLat, destLon
                );
                console.log(`[RoutePlanning] Found ${multiTransferRoutes.length} multi-transfer routes`);
            }

            // Step 6: Combine and rank
            const allRoutes = [...directRoutes, ...transferRoutes, ...multiTransferRoutes];
            allRoutes.sort((a, b) => a.score - b.score);

            // Return top 5
            return allRoutes.slice(0, 5);
        } catch (error) {
            console.error('[RoutePlanning] Error:', error);
            return [];
        }
    }

    /**
     * Find multi-transfer routes using TransitGraphService (Dijkstra-based)
     * Supports up to 3 transfers with penalty scoring
     */
    private async findMultiTransferRoutes(
        originLat: number,
        originLon: number,
        destLat: number,
        destLon: number
    ): Promise<RouteOption[]> {
        try {
            const graphRoutes = await TransitGraphService.findRoutes(
                originLat, originLon,
                destLat, destLon,
                5
            );

            // Convert MultiTransferRoute to RouteOption format
            return graphRoutes.map(gr => this.convertGraphRouteToOption(gr));
        } catch (error) {
            console.error('[RoutePlanning] Multi-transfer search error:', error);
            return [];
        }
    }

    /**
     * Convert TransitGraphService result to RouteOption format
     */
    private convertGraphRouteToOption(graphRoute: MultiTransferRoute): RouteOption {
        const legs: RouteLeg[] = graphRoute.segments.map(seg => {
            if (seg.type === 'walk') {
                return {
                    type: 'walk' as const,
                    durationMinutes: seg.travelMinutes,
                    distanceMeters: (seg.travelMinutes / 12) * 1000 // Estimate from duration
                };
            } else {
                const routeInfo = ROUTES.find(r => r.id === seg.routeId);
                return {
                    type: 'transit' as const,
                    routeId: seg.routeId,
                    routeNo: seg.routeShortName || routeInfo?.shortName || seg.routeId?.slice(-3),
                    routeName: routeInfo?.longName,
                    boardingStop: {
                        id: seg.fromStopId,
                        name: seg.fromStopName,
                        lat: 0, lon: 0 // Would need stop lookup
                    },
                    alightingStop: {
                        id: seg.toStopId,
                        name: seg.toStopName,
                        lat: 0, lon: 0
                    },
                    stopCount: seg.stopCount,
                    durationMinutes: seg.travelMinutes
                };
            }
        });

        const option: RouteOption = {
            id: graphRoute.id,
            totalMinutes: Math.round(graphRoute.totalMinutes),
            walkMinutes: Math.round(graphRoute.walkMinutes),
            rideMinutes: Math.round(graphRoute.rideMinutes),
            transfers: graphRoute.transfers,
            legs,
            reliability: graphRoute.hasRealtimeData ? 'live' : 'scheduled',
            score: graphRoute.score,
            tags: [
                ...(graphRoute.transfers === 0 ? ['Direct'] : []),
                ...(graphRoute.transfers >= 2 ? ['Multi-Transfer'] : [])
            ]
        };

        return option;
    }

    /**
     * Find direct routes (single transit leg)
     */
    private async findDirectRoutes(
        originLat: number, originLon: number,
        destLat: number, destLon: number,
        originStops: ReturnType<typeof findNearbyStops>,
        destStops: ReturnType<typeof findNearbyStops>
    ): Promise<RouteOption[]> {
        const options: RouteOption[] = [];
        const seenRoutes = new Set<string>();

        // For each origin stop, find routes that also serve a destination stop
        for (const originStop of originStops.slice(0, 10)) {
            const routeIds = getRoutesForStop(originStop.id);

            for (const routeId of routeIds) {
                if (seenRoutes.has(routeId)) continue;

                // Get stops for this route
                const routeStopIds = getStopsForRoute(routeId);
                if (!routeStopIds || routeStopIds.length === 0) continue;

                // Check if any destination stop is on this route
                for (const destStop of destStops.slice(0, 10)) {
                    const routeStopsStr = routeStopIds.map(String);
                    const originIdStr = String(originStop.id);
                    const destIdStr = String(destStop.id);

                    const originIndices: number[] = [];
                    const destIndices: number[] = [];

                    routeStopsStr.forEach((id, index) => {
                        if (id === originIdStr) originIndices.push(index);
                        if (id === destIdStr) destIndices.push(index);
                    });

                    // Both stops must be on route
                    if (originIndices.length === 0 || destIndices.length === 0) continue;

                    // Find valid pair (dest after origin) with fewest stops
                    let bestPair: { oIdx: number, dIdx: number } | null = null;
                    let minStopDiff = Infinity;

                    for (const oIdx of originIndices) {
                        for (const dIdx of destIndices) {
                            if (dIdx > oIdx) {
                                const diff = dIdx - oIdx;
                                if (diff < minStopDiff) {
                                    minStopDiff = diff;
                                    bestPair = { oIdx, dIdx };
                                }
                            }
                        }
                    }

                    if (!bestPair) {
                        // console.log(`[RoutePlanning] Skipped route ${routeId} (wrong direction/loop wrap)`);
                        continue;
                    }

                    const { oIdx: originStopIndex, dIdx: destStopIndex } = bestPair;

                    seenRoutes.add(routeId);
                    console.log(`[RoutePlanning] Found valid direct route: ${routeId} (${originStopIndex} -> ${destStopIndex}, ${minStopDiff} stops)`);

                    // Find route info
                    const routeInfo = ROUTES.find(r =>
                        r.id === routeId ||
                        String(r.id) === routeId.slice(-5) // Sometimes IDs have prefix
                    );

                    // Get ETA
                    const eta = await TransLinkService.getArrivalsForSegment(routeId, originStop.id);

                    // Calculate walking times
                    const walkToStop = calculateDistance(originLat, originLon, originStop.lat, originStop.lon) * 12; // ~5km/h walking
                    const walkFromStop = calculateDistance(destStop.lat, destStop.lon, destLat, destLon) * 12;

                    // Estimate ride time based on stop count
                    const stopCount = destStopIndex - originStopIndex;
                    const rideMinutes = Math.max(5, stopCount * 2); // ~2 min per stop

                    const totalMinutes = walkToStop + rideMinutes + walkFromStop + (eta.minutes || 0);

                    // Calculate score
                    const reliability = eta.source === 'TRIP_UPDATE' ? 'live' :
                        eta.source === 'VEHICLE_POSITION' ? 'gps' : 'scheduled';

                    const option: RouteOption = {
                        id: `direct-${routeId}-${originStop.id}-${destStop.id}`,
                        totalMinutes: Math.round(totalMinutes),
                        walkMinutes: Math.round(walkToStop + walkFromStop),
                        rideMinutes: Math.round(rideMinutes),
                        transfers: 0,
                        reliability,
                        score: 0,
                        departureTime: eta.label,
                        legs: [
                            {
                                type: 'walk',
                                distanceMeters: walkToStop * 1000 / 12,
                                durationMinutes: walkToStop,
                                startLat: originLat,
                                startLon: originLon,
                                endLat: originStop.lat,
                                endLon: originStop.lon
                            },
                            {
                                type: 'transit',
                                routeId,
                                routeNo: routeInfo?.shortName || routeId.slice(-3),
                                routeName: routeInfo?.longName || 'Route',
                                boardingStop: {
                                    id: originStop.id,
                                    name: originStop.name,
                                    lat: originStop.lat,
                                    lon: originStop.lon
                                },
                                alightingStop: {
                                    id: destStop.id,
                                    name: destStop.name,
                                    lat: destStop.lat,
                                    lon: destStop.lon
                                },
                                stopCount,
                                departureTime: eta.label,
                                durationMinutes: rideMinutes
                            },
                            {
                                type: 'walk',
                                distanceMeters: walkFromStop * 1000 / 12,
                                durationMinutes: walkFromStop,
                                startLat: destStop.lat,
                                startLon: destStop.lon,
                                endLat: destLat,
                                endLon: destLon
                            }
                        ]
                    };

                    // Apply heuristic scoring
                    const scored = this.calculateRouteScore(option);
                    option.score = scored.score;
                    option.tags = scored.tags;

                    options.push(option);

                    break; // Found a valid destination stop for this route
                }
            }

            if (options.length >= 5) break;
        }

        return options;
    }

    /**
     * Find routes with 1 transfer
     */
    private async findTransferRoutes(
        originLat: number, originLon: number,
        destLat: number, destLon: number,
        originStops: ReturnType<typeof findNearbyStops>,
        destStops: ReturnType<typeof findNearbyStops>
    ): Promise<RouteOption[]> {
        const options: RouteOption[] = [];
        const seenPairs = new Set<string>();

        // Heuristic: Limit search space for performance
        // Only consider top 3 closest stops
        const startStops = originStops.slice(0, 3);
        const endStops = destStops.slice(0, 3);

        const MAX_RESULTS = 3;

        for (const startStop of startStops) {
            const startRoutes = getRoutesForStop(startStop.id);

            for (const endStop of endStops) {
                const endRoutes = getRoutesForStop(endStop.id);

                for (const routeA of startRoutes) {
                    // Optimization: Skip if already found enough options
                    if (options.length >= MAX_RESULTS) return options;

                    const stopsA = getStopsForRoute(routeA);
                    const startIdx = stopsA.findIndex(id => id === startStop.id);
                    if (startIdx === -1) continue;

                    for (const routeB of endRoutes) {
                        if (routeA === routeB) continue; // Direct route

                        const pairKey = `${routeA}-${routeB}`;
                        if (seenPairs.has(pairKey)) continue;
                        seenPairs.add(pairKey);

                        const stopsB = getStopsForRoute(routeB);
                        // Use lastIndexOf for destination to maximize chance of finding a transfer point before it
                        // e.g. if route is Loop [Dest, ..., Transfer, ..., Dest], we want the last Dest index
                        let endIdx = -1;
                        for (let i = stopsB.length - 1; i >= 0; i--) {
                            if (stopsB[i] === endStop.id || String(stopsB[i]) === String(endStop.id)) {
                                endIdx = i;
                                break;
                            }
                        }

                        if (endIdx === -1) continue;

                        // Find valid transfer stops
                        // Stop must be AFTER start on Route A, and BEFORE end on Route B
                        const potentialTransfers = stopsA.slice(startIdx + 1).filter(id => {
                            const idxInB = stopsB.indexOf(id);
                            return idxInB !== -1 && idxInB < endIdx;
                        });

                        if (potentialTransfers.length === 0) continue;

                        // Pick the earliest transfer point (fewest stops on first leg)
                        const transferStopId = potentialTransfers[0];
                        const transferStop = getStopById(transferStopId);
                        if (!transferStop) continue;

                        try {
                            // Calculate metrics
                            const routeInfoA = ROUTES.find(r => r.id === routeA || String(r.id) === routeA.slice(-5));
                            const routeInfoB = ROUTES.find(r => r.id === routeB || String(r.id) === routeB.slice(-5));

                            // Leg 1: Walk to Start
                            const walk1Mins = calculateDistance(originLat, originLon, startStop.lat, startStop.lon) * 12; // 5km/h

                            // Leg 2: Ride Route A
                            const stopsCountA = stopsA.indexOf(transferStopId) - startIdx;
                            const ride1Mins = Math.max(3, stopsCountA * 2);

                            // Transfer buffer
                            const transferMins = 5;

                            // Leg 3: Ride Route B
                            const stopsCountB = endIdx - stopsB.indexOf(transferStopId);
                            const ride2Mins = Math.max(3, stopsCountB * 2);

                            // Leg 4: Walk to Destination
                            const walk2Mins = calculateDistance(endStop.lat, endStop.lon, destLat, destLon) * 12;

                            // Total Time
                            const totalMinutes = walk1Mins + ride1Mins + transferMins + ride2Mins + walk2Mins;

                            // ETA for Route A (start)
                            const etaA = await TransLinkService.getArrivalsForSegment(routeA, startStop.id);
                            const departureTime = etaA.label; // e.g. "5 min" or "3:45pm"

                            const option: RouteOption = {
                                id: `transfer-${routeA}-${routeB}-${startStop.id}-${transferStop.id}-${endStop.id}`,
                                totalMinutes: Math.round(totalMinutes),
                                walkMinutes: Math.round(walk1Mins + walk2Mins),
                                rideMinutes: Math.round(ride1Mins + ride2Mins),
                                transfers: 1,
                                reliability: etaA.source === 'TRIP_UPDATE' ? 'live' : 'scheduled',
                                score: 0,
                                departureTime,
                                arrivalTime: '', // Would need to calculate
                                legs: [
                                    {
                                        type: 'walk',
                                        distanceMeters: walk1Mins * 1000 / 12,
                                        durationMinutes: walk1Mins,
                                        startLat: originLat,
                                        startLon: originLon,
                                        endLat: startStop.lat,
                                        endLon: startStop.lon
                                    },
                                    {
                                        type: 'transit',
                                        routeId: routeA,
                                        routeNo: routeInfoA?.shortName || routeA,
                                        routeName: routeInfoA?.longName,
                                        boardingStop: { ...startStop },
                                        alightingStop: { ...transferStop },
                                        stopCount: stopsCountA,
                                        durationMinutes: ride1Mins,
                                        departureTime: etaA.label
                                    },
                                    {
                                        type: 'transit',
                                        routeId: routeB,
                                        routeNo: routeInfoB?.shortName || routeB,
                                        routeName: routeInfoB?.longName,
                                        boardingStop: { ...transferStop },
                                        alightingStop: { ...endStop },
                                        stopCount: stopsCountB,
                                        durationMinutes: ride2Mins,
                                    },
                                    {
                                        type: 'walk',
                                        distanceMeters: walk2Mins * 1000 / 12,
                                        durationMinutes: walk2Mins,
                                        startLat: endStop.lat,
                                        startLon: endStop.lon,
                                        endLat: destLat,
                                        endLon: destLon
                                    }
                                ]
                            };

                            // Apply heuristic scoring
                            const scored = this.calculateRouteScore(option);
                            option.score = scored.score;
                            option.tags = scored.tags;

                            options.push(option);
                        } catch (e) {
                            console.error('[RoutePlanning] Transfer calc error:', e);
                        }
                    }
                }
            }
        }

        return options;
    }

    /**
     * Calculate walking leg details using WalkingRouteService
     */
    private async calculateWalkingLeg(
        startLat: number,
        startLon: number,
        endLat: number,
        endLon: number,
        stopId: string
    ): Promise<RouteLeg> {
        try {
            const walkRoute = await WalkingRouteService.getWalkingRoute(
                startLat, startLon, endLat, endLon, stopId
            );
            return {
                type: 'walk',
                distanceMeters: walkRoute.distanceMeters,
                durationMinutes: walkRoute.durationSeconds / 60,
                startLat,
                startLon,
                endLat,
                endLon
            };
        } catch {
            // Fallback to straight-line estimate
            const distKm = calculateDistance(startLat, startLon, endLat, endLon);
            return {
                type: 'walk',
                distanceMeters: distKm * 1000,
                durationMinutes: distKm * 12, // ~5km/h
                startLat,
                startLon,
                endLat,
                endLon
            };
        }
    }
}

export default RoutePlanningServiceClass.getInstance();
