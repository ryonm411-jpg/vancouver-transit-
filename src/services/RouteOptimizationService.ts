import TransLinkService, { TransitRoute } from './TransLinkService';
import { appConfig } from '../config/config';

export interface RouteSuggestion {
    originalRoute: string;
    alternativeRoute: string;
    timeSavings: number; // in minutes
    reason: string;
}

class RouteOptimizationService {
    /**
     * Find alternative routes when a delay is detected
     */
    async findAlternativeRoutes(
        originalRouteNo: string,
        destination: string,
        currentDelay: number
    ): Promise<RouteSuggestion | null> {
        try {
            // 1. Get all routes
            const allRoutes = await TransLinkService.getRoutes();

            // 2. Filter for routes going to the same destination
            const alternatives = allRoutes.filter(
                r => r.destination === destination && r.routeNo !== originalRouteNo
            );

            if (alternatives.length === 0) {
                return null;
            }

            // 3. Compare routes (simplified logic for prototype)
            // In a real app, this would use the Trip Planner API to get exact travel times
            let bestAlternative: RouteSuggestion | null = null;
            let maxSavings = 0;

            for (const alt of alternatives) {
                // Mock calculation: Assume alternative is on time (0 delay)
                // and has a similar base travel time.
                // So time savings is roughly equal to the current delay of the original route.
                // We'll subtract a small "transfer penalty" of 5 minutes.

                const estimatedSavings = currentDelay - 5; // 5 min penalty for switching

                if (estimatedSavings >= appConfig.timeSavingsThreshold) {
                    if (estimatedSavings > maxSavings) {
                        maxSavings = estimatedSavings;
                        bestAlternative = {
                            originalRoute: originalRouteNo,
                            alternativeRoute: alt.routeNo,
                            timeSavings: estimatedSavings,
                            reason: `Route ${alt.routeNo} is running on time to ${destination}`
                        };
                    }
                }
            }

            return bestAlternative;
        } catch (error) {
            console.error('Error finding alternative routes:', error);
            return null;
        }
    }
}

export default new RouteOptimizationService();
