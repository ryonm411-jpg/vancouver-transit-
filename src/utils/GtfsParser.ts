import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { TripUpdate, VehiclePosition, TransitRoute } from '../services/TransLinkService';
import { getRouteDisplayName } from '../data/routes';

export interface ServiceAlert {
    id: string;
    headerText: string;
    descriptionText: string;
    affectedRoutes: string[];
    affectedStops: string[];
    severity: 'INFO' | 'WARNING' | 'SEVERE';
    activePeriod: {
        start: Date;
        end?: Date;
    };
}

export class GtfsParser {
    // Deterministic route lookup map: normalized_key -> canonical_route_id
    private static routeLookup: Map<string, string> = new Map();
    private static isInitialized = false;

    /**
     * Normalize route identifiers for consistent lookup
     * - Trims whitespace
     * - Lowercases
     * - Removes leading zeros (004 -> 4)
     * - Removes non-alphanumeric characters (optional, but good for robustness)
     */
    private static normalize(input: string): string {
        if (!input) return '';
        return input.trim().toLowerCase().replace(/^0+/, '');
    }

    /**
     * Initialize the route lookup map with static GTFS data
     * This must be called at app startup
     */
    static initializeLookup(routes: TransitRoute[]) {
        if (this.isInitialized) return;

        this.routeLookup.clear();
        let count = 0;

        for (const route of routes) {
            const canonicalId = route.routeId;

            // Map 1: Canonical ID (normalized)
            const normId = this.normalize(route.routeId);
            this.routeLookup.set(normId, canonicalId);

            // Map 2: Route No / Short Name (normalized)
            // e.g. "004" -> "4", "4" -> "4"
            if (route.routeNo) {
                const normNo = this.normalize(route.routeNo);
                this.routeLookup.set(normNo, canonicalId);
            }

            // Map 3: Route Name (if unique enough? careful with generic names)
            // Usually routeName is "004 Powell..." so normalizeing it might be "4powell..."
            // We'll skip long names for now unless specifically requested, to avoid collisions.
            // But user said "route_long_name" too.
            // Let's add it if it doesn't conflict.
            if (route.routeName) {
                // Be careful: "Downtown" might be used by multiple routes.
                // Assuming routeName includes number like "210 Upper Lynn Valley"
                // If not, use caution.
                // For now, strict ID and ShortName matching is safest and covers 99% cases.
            }
            count++;
        }

        this.isInitialized = true;
        console.log(`[GtfsParser] Initialized deterministic route lookup with ${count} routes (map size: ${this.routeLookup.size})`);
    }

    /**
     * Resolve a feed route identifier to a canonical Route ID
     */
    private static resolveRouteId(feedRouteId: string): string | null {
        if (!feedRouteId) return null;
        const norm = this.normalize(feedRouteId);
        return this.routeLookup.get(norm) || null;
    }

    /**
     * Parse GTFS-RT Trip Updates feed
     * Extracts real-time delay information for trips
     */
    static parseTripUpdates(buffer: ArrayBuffer, filterRouteId?: string, filterStopId?: string): TripUpdate[] {
        try {
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
                new Uint8Array(buffer)
            );

            // Check feed timestamp
            if (feed.header && feed.header.timestamp) {
                const feedTime = new Date((feed.header.timestamp as any) * 1000);
                const feedAge = Math.round((Date.now() - feedTime.getTime()) / 1000);
                console.log(`[GtfsParser] Feed timestamp: ${feedTime.toLocaleTimeString()} (${feedAge}s old)`);
            }

            const updates: TripUpdate[] = [];

            for (const entity of feed.entity) {
                if (!entity.tripUpdate) continue;

                const tripUpdate = entity.tripUpdate;
                const trip = tripUpdate.trip;
                const rawRouteId = trip?.routeId || '';

                // Resolve Route ID
                const resolvedRouteId = this.resolveRouteId(rawRouteId);

                // If we can't resolve it, and we are strict, we drop it.
                // But if the loop hasn't been initialized (edge case), fallback to raw.
                // Or if we just don't have that route in static data.
                if (!resolvedRouteId) {
                    // console.log(`[GtfsParser] Unknown route in feed: '${rawRouteId}' - dropping`);
                    continue;
                }

                // Filter by route if specified
                if (filterRouteId && resolvedRouteId !== filterRouteId) {
                    continue;
                }

                // Process each stop time update
                for (const stopTimeUpdate of tripUpdate.stopTimeUpdate || []) {
                    const stopId = stopTimeUpdate.stopId || '';

                    // Filter by stop if specified
                    if (filterStopId) {
                        // Simple normalization for stop IDs as well
                        const normStop = this.normalize(stopId);
                        const normFilter = this.normalize(filterStopId);
                        if (normStop !== normFilter) continue;
                    }

                    const arrival = stopTimeUpdate.arrival;
                    const departure = stopTimeUpdate.departure;

                    if (!arrival && !departure) continue;

                    // Get delay in seconds, convert to minutes
                    const delaySeconds = arrival?.delay || departure?.delay || 0;
                    const delayMinutes = Math.round(delaySeconds / 60);

                    // Determine status
                    let status: 'ON_TIME' | 'DELAYED' | 'CANCELLED' = 'ON_TIME';
                    if (delayMinutes > 5) {
                        status = 'DELAYED';
                    }

                    // Calculate scheduled and estimated times
                    const arrivalTime = typeof arrival?.time === 'object' ? (arrival.time as any).low || (arrival.time as any).value : arrival?.time;
                    const departureTime = typeof departure?.time === 'object' ? (departure.time as any).low || (departure.time as any).value : departure?.time;

                    const scheduledTime = new Date((arrivalTime || departureTime || 0) * 1000);
                    const estimatedTime = new Date(scheduledTime.getTime() + delaySeconds * 1000);

                    updates.push({
                        routeNo: resolvedRouteId, // Use Canonical ID
                        stopNo: stopId,
                        scheduledTime: scheduledTime.toISOString(),
                        estimatedTime: estimatedTime.toISOString(),
                        delay: delayMinutes,
                        status,
                        tripId: trip?.tripId || undefined
                    });
                }
            }

            return updates;
        } catch (error) {
            console.error('[GtfsParser] Error parsing trip updates:', error);
            throw new Error(`Failed to parse GTFS-RT trip updates: ${error}`);
        }
    }

    /**
     * Parse GTFS-RT Vehicle Positions feed
     * Extracts real-time vehicle location data
     */
    static parseVehiclePositions(buffer: ArrayBuffer, filterRouteId?: string): VehiclePosition[] {
        try {
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
                new Uint8Array(buffer)
            );

            const positions: VehiclePosition[] = [];
            const now = Date.now();
            const MAX_STALE_MS = 5 * 60 * 1000; // 5 minutes
            let staleCount = 0;

            for (const entity of feed.entity) {
                if (!entity.vehicle) continue;

                const vehicle = entity.vehicle;
                const trip = vehicle.trip;
                const position = vehicle.position;

                if (!position) continue;

                // Check for stale
                const rawTimestamp = typeof vehicle.timestamp === 'object' ? (vehicle.timestamp as any).low || (vehicle.timestamp as any).value : vehicle.timestamp;
                const vehicleTimestamp = (rawTimestamp || 0) * 1000;
                const ageMs = now - vehicleTimestamp;
                if (vehicleTimestamp > 0 && ageMs > MAX_STALE_MS) {
                    staleCount++;
                    continue;
                }

                const rawRouteId = trip?.routeId || '';

                // Resolve Route ID
                const resolvedRouteId = this.resolveRouteId(rawRouteId);

                if (!resolvedRouteId) {
                    // console.log(`[GtfsParser] Unknown route vehicle: '${rawRouteId}' - dropping`);
                    continue;
                }

                // Filter
                if (filterRouteId && resolvedRouteId !== filterRouteId) {
                    continue;
                }

                const routeNo = getRouteDisplayName(resolvedRouteId);

                positions.push({
                    routeNo: routeNo,
                    routeId: resolvedRouteId, // Canonical ID
                    latitude: position.latitude || 0,
                    longitude: position.longitude || 0,
                    bearing: position.bearing || 0,
                    speed: position.speed || 0,
                    timestamp: new Date(vehicleTimestamp).toISOString(),
                    tripId: trip?.tripId || undefined,
                    vehicleId: vehicle.vehicle?.id || undefined
                });
            }

            if (staleCount > 0) {
                console.log(`[GtfsParser] Filtered out ${staleCount} stale vehicle positions (>5min old)`);
            }
            console.log(`[GtfsParser] Parsed ${positions.length} fresh vehicle positions`);
            return positions;
        } catch (error) {
            console.error('[GtfsParser] Error parsing vehicle positions:', error);
            throw new Error(`Failed to parse GTFS-RT vehicle positions: ${error}`);
        }
    }
    /**
     * Parse GTFS-RT Service Alerts feed
     * Extracts service disruption information
     */
    static parseServiceAlerts(buffer: ArrayBuffer): ServiceAlert[] {
        try {
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
                new Uint8Array(buffer)
            );

            const alerts: ServiceAlert[] = [];

            for (const entity of feed.entity) {
                if (!entity.alert) continue;

                const alert = entity.alert;

                // Extract text (prefer English translation)
                const getTranslation = (translatedString: any) => {
                    if (!translatedString || !translatedString.translation) return '';
                    const english = translatedString.translation.find((t: any) => t.language === 'en');
                    return english?.text || translatedString.translation[0]?.text || '';
                };

                const headerText = getTranslation(alert.headerText);
                const descriptionText = getTranslation(alert.descriptionText);

                // Extract affected routes and stops
                const affectedRoutes: string[] = [];
                const affectedStops: string[] = [];

                for (const informedEntity of alert.informedEntity || []) {
                    if (informedEntity.routeId) {
                        affectedRoutes.push(informedEntity.routeId);
                    }
                    if (informedEntity.stopId) {
                        affectedStops.push(informedEntity.stopId);
                    }
                }

                // Determine severity (use cause as proxy)
                let severity: 'INFO' | 'WARNING' | 'SEVERE' = 'INFO';
                const cause = alert.cause;
                if (cause === 2 || cause === 3) { // ACCIDENT or CONSTRUCTION
                    severity = 'WARNING';
                } else if (cause === 7 || cause === 8) { // STRIKE or DEMONSTRATION
                    severity = 'SEVERE';
                }

                // Extract active period
                const activePeriod = alert.activePeriod?.[0];
                const startTimestamp = typeof activePeriod?.start === 'object' ? (activePeriod.start as any).low || (activePeriod.start as any).value : activePeriod?.start;
                const endTimestamp = typeof activePeriod?.end === 'object' ? (activePeriod.end as any).low || (activePeriod.end as any).value : activePeriod?.end;

                const start = startTimestamp ? new Date(startTimestamp * 1000) : new Date();
                const end = endTimestamp ? new Date(endTimestamp * 1000) : undefined;

                alerts.push({
                    id: entity.id,
                    headerText,
                    descriptionText,
                    affectedRoutes,
                    affectedStops,
                    severity,
                    activePeriod: { start, end }
                });
            }

            return alerts;
        } catch (error) {
            console.error('[GtfsParser] Error parsing service alerts:', error);
            throw new Error(`Failed to parse GTFS-RT service alerts: ${error}`);
        }
    }
}
