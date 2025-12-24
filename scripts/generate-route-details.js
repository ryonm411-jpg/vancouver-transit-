const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'gtfs_data');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper to parse CSV line
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else current += char;
    }
    result.push(current.trim());
    return result;
}

function parseCSVHeaders(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstLine = content.indexOf('\n');
    const headerLine = content.slice(0, firstLine);
    return parseCSVLine(headerLine);
}

// Generate Route Shapes (Polyline) and Route Stops (Sequence)
function generateRouteDetails() {
    console.log('Loading trips.txt...');
    const tripsContent = fs.readFileSync(path.join(GTFS_DIR, 'trips.txt'), 'utf-8');
    const tripsLines = tripsContent.split('\n').filter(l => l.trim());
    const tripsHeaders = parseCSVLine(tripsLines[0]);

    const routeIdIdx = tripsHeaders.indexOf('route_id');
    const tripIdIdx = tripsHeaders.indexOf('trip_id');
    const shapeIdIdx = tripsHeaders.indexOf('shape_id');
    const directionIdIdx = tripsHeaders.indexOf('direction_id');
    const tripHeadsignIdx = tripsHeaders.indexOf('trip_headsign');

    // Group trips by route_id and direction_id
    // We want to pick ONE representative trip for each route/direction to show the shape and stops
    const routeTrips = {}; // route_id -> direction_id -> trip info

    for (let i = 1; i < tripsLines.length; i++) {
        const values = parseCSVLine(tripsLines[i]);
        const routeId = values[routeIdIdx];
        const tripId = values[tripIdIdx];
        const shapeId = values[shapeIdIdx];
        const directionId = values[directionIdIdx] || '0';
        const headsign = values[tripHeadsignIdx];

        if (!routeId) continue;

        if (!routeTrips[routeId]) routeTrips[routeId] = {};

        // Just take the first trip we find for this direction
        // In a perfect world we'd find the "most common" pattern
        if (!routeTrips[routeId][directionId]) {
            routeTrips[routeId][directionId] = { tripId, shapeId, headsign };
        }
    }

    console.log(`Found representative trips for ${Object.keys(routeTrips).length} routes`);

    // 1. Process Shapes
    console.log('Processing shapes.txt...');
    const shapesContent = fs.readFileSync(path.join(GTFS_DIR, 'shapes.txt'), 'utf-8');
    const shapesLines = shapesContent.split('\n').filter(l => l.trim());
    const shapesHeaders = parseCSVLine(shapesLines[0]);

    const sShapeIdIdx = shapesHeaders.indexOf('shape_id');
    const sLatIdx = shapesHeaders.indexOf('shape_pt_lat');
    const sLonIdx = shapesHeaders.indexOf('shape_pt_lon');
    const sSeqIdx = shapesHeaders.indexOf('shape_pt_sequence');

    const allShapes = {}; // shape_id -> coordinates[]

    for (let i = 1; i < shapesLines.length; i++) {
        const values = parseCSVLine(shapesLines[i]);
        const shapeId = values[sShapeIdIdx];
        const lat = parseFloat(values[sLatIdx]);
        const lon = parseFloat(values[sLonIdx]);
        const seq = parseInt(values[sSeqIdx]);

        if (!allShapes[shapeId]) allShapes[shapeId] = [];
        allShapes[shapeId].push({ lat, lon, seq });
    }

    // Sort shapes by sequence
    for (const shapeId in allShapes) {
        allShapes[shapeId].sort((a, b) => a.seq - b.seq);
        allShapes[shapeId] = allShapes[shapeId].map(p => ({ lat: p.lat, lon: p.lon })); // remove seq
    }

    // 2. Process Stop Times
    console.log('Processing stop_times.txt (this may take a while)...');
    const stopTimesContent = fs.readFileSync(path.join(GTFS_DIR, 'stop_times.txt'), 'utf-8');
    const stopTimesLines = stopTimesContent.split('\n').filter(l => l.trim());
    const stHeaders = parseCSVLine(stopTimesLines[0]);

    const stTripIdIdx = stHeaders.indexOf('trip_id');
    const stStopIdIdx = stHeaders.indexOf('stop_id');
    const stSeqIdx = stHeaders.indexOf('stop_sequence');

    // Build a map of trip_id -> stop_ids[]
    // But ONLY for the representative trips we identified!
    const tripStops = {}; // trip_id -> { stopId, seq }[]
    const neededTripIds = new Set();

    Object.values(routeTrips).forEach(directions => {
        Object.values(directions).forEach(trip => {
            neededTripIds.add(trip.tripId);
        });
    });

    console.log(`Extracting stops for ${neededTripIds.size} representative trips...`);

    for (let i = 1; i < stopTimesLines.length; i++) {
        const values = parseCSVLine(stopTimesLines[i]);
        const tripId = values[stTripIdIdx];

        if (neededTripIds.has(tripId)) {
            const stopId = values[stStopIdIdx];
            const seq = parseInt(values[stSeqIdx]);

            if (!tripStops[tripId]) tripStops[tripId] = [];
            tripStops[tripId].push({ stopId, seq });
        }
    }

    // Sort stop times
    for (const tripId in tripStops) {
        tripStops[tripId].sort((a, b) => a.seq - b.seq);
    }

    // 3. Output Data
    const outputShapes = {}; // route_id -> direction -> coordinates[]
    const outputStops = {}; // route_id -> direction -> stop_ids[]

    Object.keys(routeTrips).forEach(routeId => {
        const directions = routeTrips[routeId];
        outputShapes[routeId] = {};
        outputStops[routeId] = {};

        Object.keys(directions).forEach(dirId => {
            const { tripId, shapeId } = directions[dirId];

            if (shapeId && allShapes[shapeId]) {
                outputShapes[routeId][dirId] = allShapes[shapeId];
            }

            if (tripStops[tripId]) {
                outputStops[routeId][dirId] = tripStops[tripId].map(s => s.stopId);
            }
        });
    });

    // Write file
    const outputContent = `// Auto-generated from GTFS data - DO NOT EDIT
// Generated: ${new Date().toISOString()}

export interface RouteShape {
    lat: number;
    lon: number;
}

// route_id -> direction_id -> coordinates[]
export const ROUTE_SHAPES: Record<string, Record<string, RouteShape[]>> = ${JSON.stringify(outputShapes, null, 2)};
`;

    const outputStopsContent = `// Auto-generated from GTFS data - DO NOT EDIT
// Generated: ${new Date().toISOString()}

// route_id -> direction_id -> stop_ids[]
export const ROUTE_STOPS: Record<string, Record<string, string[]>> = ${JSON.stringify(outputStops, null, 2)};
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'routeShapes.ts'), outputContent);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'routeStops.ts'), outputStopsContent);

    console.log('Generated routeShapes.ts and routeStops.ts');
}

generateRouteDetails();
