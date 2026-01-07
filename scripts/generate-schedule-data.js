/**
 * Generate Simplified Schedule Data from GTFS
 * 
 * Reads stop_times.txt, trips.txt, and calendar files to create a smaller
 * schedule file with the next ~10 departures per route+stop+direction.
 * 
 * Run with: node scripts/generate-schedule-data.js
 */

const fs = require('fs');
const path = require('path');

const GTFS_DIR = path.join(__dirname, '..', 'gtfs_data');
const OUTPUT_DIR = path.join(__dirname, '..', 'src', 'data');

// Configuration
const MAX_DEPARTURES_PER_STOP = 10;  // Max departures to keep per route+stop+direction
const HOURS_TO_INCLUDE = 24;          // How many hours of schedule to include

console.log('=== GTFS Schedule Generator ===\n');

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

// Parse CSV file with streaming for large files
function parseCSVStream(filePath, processRow, batchSize = 10000) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const headers = parseCSVLine(lines[0]);

    let processed = 0;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((header, idx) => {
            obj[header] = values[idx] || '';
        });

        processRow(obj);
        processed++;

        if (processed % batchSize === 0) {
            console.log(`  Processed ${processed.toLocaleString()} rows...`);
        }
    }

    return processed;
}

// Parse time string (HH:MM:SS) to minutes since midnight
// GTFS can have times > 24:00:00 for trips that extend past midnight
function parseTime(timeStr) {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 60 + m + (s / 60);
}

// Format minutes to HH:MM
function formatTime(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// Get today's day of week
function getTodayService() {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = new Date();
    return days[today.getDay()];
}

// Get today's date as YYYYMMDD
function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function generateSchedule() {
    // Step 1: Load calendar.txt to find active service IDs for today
    console.log('Step 1: Loading calendar.txt...');
    const todayService = getTodayService();
    const todayDate = getTodayDate();
    console.log(`  Today is ${todayService}, date: ${todayDate}`);

    const activeServiceIds = new Set();

    // Regular calendar
    const calendarPath = path.join(GTFS_DIR, 'calendar.txt');
    if (fs.existsSync(calendarPath)) {
        const calendarContent = fs.readFileSync(calendarPath, 'utf-8');
        const calendarLines = calendarContent.split('\n');
        const headers = parseCSVLine(calendarLines[0]);

        for (let i = 1; i < calendarLines.length; i++) {
            const line = calendarLines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((h, idx) => row[h] = values[idx] || '');

            // Check if service runs today (day of week)
            if (row[todayService] === '1') {
                // Be lenient with date range: allow services ending up to 2 days ago
                // or starting up to 2 days from now (handles schedule transitions)
                const startDate = parseInt(row.start_date);
                const endDate = parseInt(row.end_date);
                const today = parseInt(todayDate);

                // Allow if: (start <= today+2) AND (end >= today-2)
                if (startDate <= today + 2 && endDate >= today - 2) {
                    activeServiceIds.add(row.service_id);
                }
            }
        }
    }

    // Calendar dates (exceptions)
    const calendarDatesPath = path.join(GTFS_DIR, 'calendar_dates.txt');
    if (fs.existsSync(calendarDatesPath)) {
        const content = fs.readFileSync(calendarDatesPath, 'utf-8');
        const lines = content.split('\n');
        const headers = parseCSVLine(lines[0]);

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const row = {};
            headers.forEach((h, idx) => row[h] = values[idx] || '');

            if (row.date === todayDate) {
                if (row.exception_type === '1') {
                    activeServiceIds.add(row.service_id);  // Service added
                } else if (row.exception_type === '2') {
                    activeServiceIds.delete(row.service_id);  // Service removed
                }
            }
        }
    }

    console.log(`  Found ${activeServiceIds.size} active service IDs for today`);

    // Step 1.5: Load routes.txt to map route_id -> route_short_name
    console.log('\nStep 1.5: Loading routes.txt for shortName mapping...');
    const routeIdToShortName = new Map();  // route_id -> shortName

    const routesPath = path.join(GTFS_DIR, 'routes.txt');
    if (fs.existsSync(routesPath)) {
        const routesContent = fs.readFileSync(routesPath, 'utf-8');
        const routesLines = routesContent.split('\n');
        const routeHeaders = parseCSVLine(routesLines[0]);

        for (let i = 1; i < routesLines.length; i++) {
            const line = routesLines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);
            const row = {};
            routeHeaders.forEach((h, idx) => row[h] = values[idx] || '');

            if (row.route_id && row.route_short_name) {
                routeIdToShortName.set(row.route_id, row.route_short_name);
            }
        }
    }
    console.log(`  Loaded ${routeIdToShortName.size} route shortName mappings`);

    // Debug: show first few mappings
    let count = 0;
    for (const [routeId, shortName] of routeIdToShortName.entries()) {
        if (count < 5) {
            console.log(`    Sample mapping: route_id="${routeId}" -> shortName="${shortName}"`);
            count++;
        }
    }

    // Step 2: Load trips.txt to map trip_id -> route_id, direction_id
    console.log('\nStep 2: Loading trips.txt...');
    const tripInfo = new Map();  // trip_id -> { route_id, direction_id, service_id }
    let firstTrip = true;

    parseCSVStream(path.join(GTFS_DIR, 'trips.txt'), (row) => {
        if (firstTrip) {
            console.log('  DEBUG first row keys:', Object.keys(row).join(', '));
            console.log('  DEBUG first row route_id:', row.route_id);
            console.log('  DEBUG first row trip_id:', row.trip_id);
            console.log('  DEBUG first row service_id:', row.service_id);
            firstTrip = false;
        }
        if (activeServiceIds.has(row.service_id)) {
            tripInfo.set(row.trip_id, {
                route_id: row.route_id,
                direction_id: row.direction_id || '0',
                service_id: row.service_id
            });
        }
    });

    console.log(`  Loaded ${tripInfo.size.toLocaleString()} active trips for today`);

    // Step 3: Process stop_times.txt
    console.log('\nStep 3: Processing stop_times.txt (this may take a while)...');

    // Get current time in minutes
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const maxMinutes = currentMinutes + (HOURS_TO_INCLUDE * 60);

    // Storage: Map<route_id:stop_id:direction_id, Array<{time, trip_id}>>
    const schedules = new Map();

    let totalRows = 0;
    let matchedRows = 0;

    parseCSVStream(path.join(GTFS_DIR, 'stop_times.txt'), (row) => {
        totalRows++;

        const trip = tripInfo.get(row.trip_id);
        if (!trip) return;  // Trip not active today

        const departureMinutes = parseTime(row.departure_time);
        if (departureMinutes === null) return;

        // Only include future departures within time window
        if (departureMinutes < currentMinutes || departureMinutes > maxMinutes) return;

        const key = `${trip.route_id}:${row.stop_id}:${trip.direction_id}`;

        if (!schedules.has(key)) {
            schedules.set(key, []);
        }

        const arr = schedules.get(key);

        // Only keep if we need more or this is earlier than existing
        if (arr.length < MAX_DEPARTURES_PER_STOP) {
            arr.push({
                time: departureMinutes,
                timeStr: formatTime(departureMinutes),
                trip_id: row.trip_id
            });
            arr.sort((a, b) => a.time - b.time);
            matchedRows++;
        } else if (departureMinutes < arr[arr.length - 1].time) {
            arr.pop();
            arr.push({
                time: departureMinutes,
                timeStr: formatTime(departureMinutes),
                trip_id: row.trip_id
            });
            arr.sort((a, b) => a.time - b.time);
            matchedRows++;
        }
    }, 50000);

    console.log(`  Processed ${totalRows.toLocaleString()} stop_time rows`);
    console.log(`  Found ${matchedRows.toLocaleString()} relevant departures`);
    console.log(`  Created ${schedules.size.toLocaleString()} route+stop+direction combinations`);

    // Step 4: Generate output file
    console.log('\nStep 4: Generating TypeScript output...');

    // Convert to simpler format for output
    const scheduleData = {};
    for (const [key, departures] of schedules) {
        const [routeId, stopId, directionId] = key.split(':');

        // Use route short name as key if available, otherwise use routeId
        const shortName = routeIdToShortName.get(routeId);
        const scheduleKey = shortName || routeId;

        if (!scheduleData[scheduleKey]) {
            scheduleData[scheduleKey] = {};
        }
        if (!scheduleData[scheduleKey][stopId]) {
            scheduleData[scheduleKey][stopId] = {};
        }

        scheduleData[scheduleKey][stopId][directionId] = departures.map(d => d.timeStr);
    }

    const generatedAt = new Date().toISOString();

    console.log(`  Created schedule data keyed by route short names (e.g., "2", "R5")`);

    const output = `// Auto-generated GTFS Schedule Data - DO NOT EDIT
// Generated: ${generatedAt}
// Valid for: ${getTodayDate()} (next ${HOURS_TO_INCLUDE} hours from generation time)
// Format: scheduleData[routeId][stopId][directionId] = ["HH:MM", ...]

export const SCHEDULE_GENERATED_AT = "${generatedAt}";
export const SCHEDULE_VALID_DATE = "${getTodayDate()}";

export type ScheduleData = Record<string, Record<string, Record<string, string[]>>>;

export const SCHEDULE_DATA: ScheduleData = ${JSON.stringify(scheduleData, null, 2)};

/**
 * Get scheduled departures for a route at a stop
 * Note: Schedule is now keyed by route SHORT NAME (e.g., "2", "R5", "99"), not route_id
 * @param routeNo - Route short name (e.g., "2", "R5")
 * @param stopId - GTFS stop_id or stop_code
 * @param directionId - Direction (0 or 1), defaults to "0"
 * @returns Array of departure times as "HH:MM" strings, or empty array
 */
export function getScheduledDepartures(
    routeId: string, 
    stopId: string, 
    directionId: string = "0"
): string[] {
    return SCHEDULE_DATA[routeId]?.[stopId]?.[directionId] || [];
}

/**
 * Get next scheduled departures that are in the future
 * @param routeId - GTFS route_id  
 * @param stopId - GTFS stop_id
 * @param directionId - Direction (0 or 1)
 * @param maxResults - Maximum results to return
 * @returns Array of departure times as "HH:MM" strings
 */
export function getUpcomingDepartures(
    routeId: string,
    stopId: string,
    directionId: string = "0",
    maxResults: number = 5
): string[] {
    const departures = getScheduledDepartures(routeId, stopId, directionId);
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    return departures
        .filter(timeStr => {
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m > currentMinutes;
        })
        .slice(0, maxResults);
}
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'scheduleData.ts'), output);

    // Calculate file size
    const stats = fs.statSync(path.join(OUTPUT_DIR, 'scheduleData.ts'));
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`\n✅ Generated scheduleData.ts (${sizeMB} MB)`);
    console.log(`   Contains ${Object.keys(scheduleData).length} routes`);
    console.log(`   Valid for ${HOURS_TO_INCLUDE} hours from now`);
}

generateSchedule().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
