#!/usr/bin/env node
// Embed GT2 driver binary + metadata into a JS ES module
// Usage: node embed-driver.js [driver/gt2_driver.bin] [driver/gt2_driver.meta.json]
// Output: driver/gt2-driver-data.js

const fs = require('fs');
const path = require('path');

const binPath = process.argv[2] || 'driver/gt2_driver.bin';
const metaPath = process.argv[3] || 'driver/gt2_driver.meta.json';
const outPath = process.argv[4] || 'driver/gt2-driver-data.js';

const bin = fs.readFileSync(binPath);
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const b64 = bin.toString('base64');

const js = `// Auto-generated GT2 driver binary + metadata
// Binary: ${bin.length} bytes, base: $${meta.base.toString(16).toUpperCase()}
// Init: $${meta.init.toString(16).toUpperCase()}, Play: $${meta.play.toString(16).toUpperCase()}
// Generated: ${new Date().toISOString()}

const DRIVER_BASE64 = '${b64}';

export const DRIVER_META = ${JSON.stringify(meta, null, 2)};

/**
 * Get a fresh copy of the driver binary as Uint8Array.
 * Callers can patch table data directly into the returned array.
 */
export function getDriverTemplate() {
    const raw = atob(DRIVER_BASE64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        arr[i] = raw.charCodeAt(i);
    }
    return arr;
}
`;

fs.writeFileSync(outPath, js);
console.log(`Generated ${outPath} (${js.length} chars, binary ${bin.length} bytes)`);
