#!/usr/bin/env node
// resave-sng.js - Round-trip a .sng through the JS parser + writer.
//
//   node tools/resave-sng.js in.sng out.sng
//
// Loads in.sng with gt2-sng-parser.js, saves it with gt2-sng-writer.js.
// Used by tools/verify.sh: the resaved file is fed to the native gt2dump,
// proving real GT2 code loads our saved files and plays them identically.
// Also performs a structural round-trip check: parse(write(parse(x))) must
// deep-equal parse(x) (ignoring numFilePatterns, which may legitimately
// shrink when a file stored trailing unused patterns).

import fs from 'node:fs';
import { parseSng } from '../gt2-sng-parser.js';
import { writeSng } from '../gt2-sng-writer.js';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
    console.error('usage: resave-sng.js in.sng out.sng');
    process.exit(2);
}

// parseSng logs heavily; silence it for CLI use
const realLog = console.log;
console.log = () => {};

const first = parseSng(new Uint8Array(fs.readFileSync(inFile)));
const written = writeSng(first);
const second = parseSng(written);

console.log = realLog;

// Structural round-trip check
function strip(parsed) {
    const { header, numFilePatterns, ...rest } = parsed;
    return rest;
}
const a = JSON.stringify(strip(first));
const b = JSON.stringify(strip(second));
if (a !== b) {
    // Locate the first differing top-level key for a useful message
    const oa = strip(first), ob = strip(second);
    for (const key of Object.keys(oa)) {
        if (JSON.stringify(oa[key]) !== JSON.stringify(ob[key])) {
            console.error(`round-trip mismatch in "${key}"`);
        }
    }
    process.exit(1);
}

fs.writeFileSync(outFile, written);
console.error(`resaved ${inFile} -> ${outFile} (${written.length} bytes, round-trip OK)`);
