#!/usr/bin/env node
// export-sid.js - Export a GT2 .sng file to .SID from the command line, using
// the exact same exporter the browser app uses (exporters/gt2/sid-exporter-gt2.js).
// This makes the full chain testable headlessly:
//   .sng -> parseSng -> exportSIDFile -> tools/sid-dump.js -> tools/regdiff.js
//
// ALL subtunes are exported into one multi-song .SID (PSID songs field set);
// pick the subtune at playback time (tools/sid-dump.js --subtune N).
//
// Usage: node tools/export-sid.js <song.sng> <out.sid> [--start N] [--tempo N] [--verbose]
//   --start N   1-based PSID start song (default 1)

import fs from 'node:fs';
import path from 'node:path';
import { parseSng } from '../gt2-sng-parser.js';
import { exportSIDFile } from '../exporters/gt2/sid-exporter-gt2.js';

function parseArgs(argv) {
    const args = { start: 1, tempo: null, verbose: false, in: null, out: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--start') args.start = parseInt(argv[++i], 10);
        else if (a === '--tempo') args.tempo = parseInt(argv[++i], 10);
        else if (a === '--verbose') args.verbose = true;
        else if (!args.in) args.in = a;
        else if (!args.out) args.out = a;
        else { console.error(`Unknown argument: ${a}`); process.exit(1); }
    }
    if (!args.in || !args.out) {
        console.error('Usage: node tools/export-sid.js <song.sng> <out.sid> [--start N] [--tempo N] [--verbose]');
        process.exit(1);
    }
    return args;
}

const args = parseArgs(process.argv);

// Both the parser and the exporter log diagnostics via console.log
const realLog = console.log;
console.log = args.verbose ? (...a) => console.error(...a) : () => {};

const song = parseSng(new Uint8Array(fs.readFileSync(args.in)));

// Mirror the app-side objects the exporter expects
const patternManager = {
    song: { orderLists: song.subtunes[0].orderLists },
    patterns: song.patterns,
};
const tableManager = { ltable: song.tables.ltable, rtable: song.tables.rtable };
const instruments = [null, ...song.instruments];

const sid = exportSIDFile({
    title: song.name || path.basename(args.in),
    author: song.author || '',
    instruments,
    patternManager,
    tableManager,
    tempo: args.tempo !== null ? args.tempo : (song.initialSpeed || 6),
    subtunes: song.subtunes,
    startSong: args.start,
});

console.log = realLog;
fs.writeFileSync(args.out, sid);
console.error(`wrote ${args.out} (${sid.length} bytes, ${song.subtunes.length} subtune(s))`);
