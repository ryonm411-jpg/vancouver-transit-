// Script to generate stop-to-route mapping from GTFS data
// Run with: node scripts/generate-stop-routes.js

const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'gtfs_data');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');

// Parse CSV line (handles quoted fields)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// Parse CSV file to array of objects
function parseCSV(filePath) {
    console.log(`Parsing ${path.basename(filePath)}...`);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const headers = parseCSVLine(lines[0]);

    return lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] || '';
        });
        return obj;
    });
}

console.log('=== Stop-to-Route Mapping Generator ===\n');

try {
    // Step 1: Parse trips.txt to get trip_id -> route_id mapping
    const trips = parseCSV(path.join(GTFS_DIR, 'trips.txt'));
    const tripToRoute = {};
    trips.forEach(trip => {
        tripToRoute[trip.trip_id] = trip.route_id;
    });
    console.log(`Loaded ${trips.length} trips`);

    // Step 2: Parse stop_times.txt to get stop_id -> trip_id relationships
    // Note: This file is very large, so we'll process it efficiently
    console.log('Processing stop_times.txt (this may take a moment)...');
    const stopTimesPath = path.join(GTFS_DIR, 'stop_times.txt');
    const stopTimesContent = fs.readFileSync(stopTimesPath, 'utf-8');
    const stopTimesLines = stopTimesContent.split('\n');
    const headers = parseCSVLine(stopTimesLines[0]);

    const tripIdIndex = headers.indexOf('trip_id');
    const stopIdIndex = headers.indexOf('stop_id');

    // Map: stop_id -> Set of route_ids
    const stopToRoutes = {};

    let processed = 0;
    for (let i = 1; i < stopTimesLines.length; i++) {
        const line = stopTimesLines[i];
        if (!line.trim()) continue;

        const values = parseCSVLine(line);
        const tripId = values[tripIdIndex];
        const stopId = values[stopIdIndex];

        if (tripId && stopId && tripToRoute[tripId]) {
            const routeId = tripToRoute[tripId];
            if (!stopToRoutes[stopId]) {
                stopToRoutes[stopId] = new Set();
            }
            stopToRoutes[stopId].add(routeId);
        }

        processed++;
        if (processed % 500000 === 0) {
            console.log(`  Processed ${processed} stop times...`);
        }
    }

    console.log(`Processed ${processed} stop times total`);
    console.log(`Found route mappings for ${Object.keys(stopToRoutes).length} stops`);

    // Step 3: Convert Sets to Arrays for JSON serialization
    const stopRoutesArray = {};
    for (const [stopId, routes] of Object.entries(stopToRoutes)) {
        stopRoutesArray[stopId] = Array.from(routes);
    }

    // Step 4: Generate TypeScript file
    const output = `// Auto-generated from GTFS stop_times.txt and trips.txt - DO NOT EDIT
// Generated: ${new Date().toISOString()}
// Total stops with route mappings: ${Object.keys(stopRoutesArray).length}

// Mapping of stop_id to array of route_ids that serve that stop
export const STOP_ROUTES: Record<string, string[]> = ${JSON.stringify(stopRoutesArray)};

// Get routes for a stop
export function getRoutesForStop(stopId: string): string[] {
    return STOP_ROUTES[stopId] || [];
}
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'stopRoutes.ts'), output);
    console.log(`\n✅ Generated stopRoutes.ts with ${Object.keys(stopRoutesArray).length} stop mappings`);

} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}
