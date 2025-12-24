// Script to convert GTFS CSV files to TypeScript data files
// Run with: node scripts/generate-gtfs-data.js

const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'gtfs_data');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

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

// Generate routes.ts
function generateRoutes() {
    console.log('Parsing routes.txt...');
    const routes = parseCSV(path.join(GTFS_DIR, 'routes.txt'));

    const routeData = routes.map(r => ({
        id: r.route_id,
        shortName: r.route_short_name || '',
        longName: r.route_long_name || '',
        type: parseInt(r.route_type) || 3,
        color: r.route_color || '',
        textColor: r.route_text_color || ''
    })).filter(r => r.id); // Filter out empty entries

    const output = `// Auto-generated from GTFS routes.txt - DO NOT EDIT
// Generated: ${new Date().toISOString()}
// Total routes: ${routeData.length}

export interface GtfsRoute {
    id: string;
    shortName: string;
    longName: string;
    type: number; // 1=subway, 2=rail, 3=bus, 4=ferry
    color: string;
    textColor: string;
}

export const ROUTES: GtfsRoute[] = ${JSON.stringify(routeData, null, 2)};

// Lookup map for fast access by route_id
export const ROUTE_BY_ID: Record<string, GtfsRoute> = ROUTES.reduce((acc, route) => {
    acc[route.id] = route;
    return acc;
}, {} as Record<string, GtfsRoute>);

// Get route by internal ID
export function getRouteById(routeId: string): GtfsRoute | undefined {
    return ROUTE_BY_ID[routeId];
}

// Get display name for a route
export function getRouteDisplayName(routeId: string): string {
    const route = ROUTE_BY_ID[routeId];
    if (!route) return routeId;
    return route.shortName || route.longName || routeId;
}
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'routes.ts'), output);
    console.log(`Generated routes.ts with ${routeData.length} routes`);
}

// Generate stops.ts
function generateStops() {
    console.log('Parsing stops.txt...');
    const stops = parseCSV(path.join(GTFS_DIR, 'stops.txt'));

    const stopData = stops.map(s => ({
        id: s.stop_id,
        code: s.stop_code || '',
        name: s.stop_name || '',
        lat: parseFloat(s.stop_lat) || 0,
        lon: parseFloat(s.stop_lon) || 0,
        wheelchair: parseInt(s.wheelchair_boarding) || 0,
        locationType: parseInt(s.location_type) || 0,
        parentStation: s.parent_station || ''
    })).filter(s => s.id && s.lat && s.lon); // Filter valid stops with coordinates

    const output = `// Auto-generated from GTFS stops.txt - DO NOT EDIT
// Generated: ${new Date().toISOString()}
// Total stops: ${stopData.length}

export interface GtfsStop {
    id: string;
    code: string;
    name: string;
    lat: number;
    lon: number;
    wheelchair: number; // 0=unknown, 1=accessible, 2=not accessible
    locationType: number; // 0=stop, 1=station
    parentStation: string;
}

export const STOPS: GtfsStop[] = ${JSON.stringify(stopData, null, 2)};

// Lookup map for fast access by stop_id
export const STOP_BY_ID: Record<string, GtfsStop> = STOPS.reduce((acc, stop) => {
    acc[stop.id] = stop;
    return acc;
}, {} as Record<string, GtfsStop>);

// Get stop by ID
export function getStopById(stopId: string): GtfsStop | undefined {
    return STOP_BY_ID[stopId];
}

// Find stops near a location (simple bounding box, not true distance)
export function findNearbyStops(lat: number, lon: number, radiusKm: number = 0.5): GtfsStop[] {
    // Rough conversion: 1 degree lat ≈ 111km, 1 degree lon ≈ 85km at this latitude
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / 85;
    
    return STOPS.filter(stop => 
        stop.lat >= lat - latDelta && 
        stop.lat <= lat + latDelta &&
        stop.lon >= lon - lonDelta && 
        stop.lon <= lon + lonDelta
    );
}
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'stops.ts'), output);
    console.log(`Generated stops.ts with ${stopData.length} stops`);
}

// Main
console.log('=== GTFS Data Generator ===\n');

try {
    generateRoutes();
    generateStops();
    console.log('\n✅ Done! Files generated in src/data/');
} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}
