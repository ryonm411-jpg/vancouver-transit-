// Debug script to inspect trips.txt structure
const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('./gtfs_data/trips.txt', 'utf-8');
const lines = content.split('\n');
const header = lines[0].split(',');
const row1 = lines[1].split(',');
const row2 = lines[2].split(',');

console.log('=== trips.txt Column Analysis ===\n');
console.log('Total columns:', header.length);
console.log('\nColumn headers:');
header.forEach((h, i) => console.log(`  [${i}] "${h}"`));

console.log('\nSample row 1 values:');
header.forEach((h, i) => console.log(`  ${h}: "${row1[i]}"`));

console.log('\nSample row 2 values:');
header.forEach((h, i) => console.log(`  ${h}: "${row2[i]}"`));
