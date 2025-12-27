import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { TripUpdate, VehiclePosition } from '../services/TransLinkService';
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
    /**
     * Parse GTFS-RT Trip Updates feed
     * Extracts real-time delay information for trips
     */
    static parseTripUpdates(buffer: ArrayBuffer, filterRouteId?: string, filterStopId?: string): TripUpdate[] {
        try {
            const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
                new Uint8Array(buffer)
            );

            const updates: TripUpdate[] = [];

            for (const entity of feed.entity) {
                if (!entity.tripUpdate) continue;

                const tripUpdate = entity.tripUpdate;
                const trip = tripUpdate.trip;
                const routeId = trip?.routeId || '';

                // Filter by route if specified
                if (filterRouteId && routeId !== filterRouteId) continue;

                // Process each stop time update
                for (const stopTimeUpdate of tripUpdate.stopTimeUpdate || []) {
                    const stopId = stopTimeUpdate.stopId || '';

                    // Filter by stop if specified
                    if (filterStopId && stopId !== filterStopId) continue;

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
                    const scheduledTime = new Date((arrival?.time || departure?.time || 0) * 1000);
                    const estimatedTime = new Date(scheduledTime.getTime() + delaySeconds * 1000);

                    updates.push({
                        routeNo: routeId, // Using ID internally? Or should we map? The Interface says routeNo. 
                        // Let's keep routeId here or map it? 
                        // User says "Use only: route_id... UI can display friendly names"
                        // So sticking with routeId in the data object is correct!
                        stopNo: stopId,   // Same for stopId
                        scheduledTime: scheduledTime.toISOString(),
                        estimatedTime: estimatedTime.toISOString(),
                        delay: delayMinutes,
                        status
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
            let loggedOnce = false;

            for (const entity of feed.entity) {
                if (!entity.vehicle) continue;

                const vehicle = entity.vehicle;
                const trip = vehicle.trip;
                const position = vehicle.position;

                if (!position) continue;

                // Get route ID
                const routeId = trip?.routeId || '';

                // Filter by route ID first!
                if (filterRouteId && routeId !== filterRouteId) continue;

                const routeNo = getRouteDisplayName(routeId); // For UI display if needed

                // Log first entity for debugging
                if (!loggedOnce) {
                    console.log('[GtfsParser] Sample vehicle entity:', {
                        vehicleId: vehicle.vehicle?.id,
                        routeId: routeId,
                        mappedRouteNo: routeNo,
                        lat: position.latitude,
                        lon: position.longitude
                    });
                    loggedOnce = true;
                }

                positions.push({
                    routeNo: routeNo,
                    routeId: routeId,
                    // `VehiclePosition` interface has `routeNo`.
                    // I should probably change the Interface to have `routeId` too.
                    // But for now let's keep routeNo = name for Display, 
                    // but ensure filtering was done by ID.
                    latitude: position.latitude || 0,
                    longitude: position.longitude || 0,
                    bearing: position.bearing || 0,
                    speed: position.speed || 0,
                    timestamp: new Date((vehicle.timestamp || 0) * 1000).toISOString()
                });
            }

            console.log(`[GtfsParser] Parsed ${positions.length} vehicle positions`);
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
                const start = activePeriod?.start ? new Date(activePeriod.start * 1000) : new Date();
                const end = activePeriod?.end ? new Date(activePeriod.end * 1000) : undefined;

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
