#!/usr/bin/env node
// regdiff.js - Compare two SID register dump files (JSON lines, as produced by
// tools/gt2-refdump/gt2dump, tools/worklet-dump.js and tools/sid-dump.js).
//
// Usage: node tools/regdiff.js <a.json> <b.json> [options]
//   --align auto|N     Shift b by N frames relative to a (auto: search -25..25
//                      for the offset with the fewest mismatching frames)
//   --frames N         Compare at most N aligned frames
//   --ignore r1,r2     Ignore comma-separated register numbers (decimal or $hex)
//   --max-report N     Print at most N divergent frames (default 10)
//   --quiet            Only print the summary line
//   --strict           Compare all 8 bits of every register. Default compares
//                      what SID hardware actually latches: pulse-width high
//                      registers ($03/$0a/$11) are 4-bit, filter-cutoff low
//                      ($15) is 3-bit. GT2's 6502 player stores unmasked
//                      values there; the chip ignores the upper bits.
//
// Exit code: 0 = identical (after alignment), 1 = diverged, 2 = usage/IO error.

import fs from 'node:fs';

const REG_NAMES = [
    'V1FreqLo', 'V1FreqHi', 'V1PWLo', 'V1PWHi', 'V1Ctrl', 'V1AD', 'V1SR',
    'V2FreqLo', 'V2FreqHi', 'V2PWLo', 'V2PWHi', 'V2Ctrl', 'V2AD', 'V2SR',
    'V3FreqLo', 'V3FreqHi', 'V3PWLo', 'V3PWHi', 'V3Ctrl', 'V3AD', 'V3SR',
    'FCLo', 'FCHi', 'ResFilt', 'ModeVol',
];

function hex(v) { return '$' + v.toString(16).padStart(2, '0'); }

function loadDump(file) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(2); }
    const lines = text.split('\n').filter(l => l.trim());
    let header = { source: '?', song: '?' };
    const frames = [];
    for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.regs) frames.push(obj.regs);
        else if (obj.source) header = obj;
    }
    return { header, frames };
}

function parseArgs(argv) {
    const args = { a: null, b: null, align: 'auto', frames: Infinity, ignore: new Set(), maxReport: 10, quiet: false, strict: false };
    for (let i = 2; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--align') { const v = argv[++i]; args.align = v === 'auto' ? 'auto' : parseInt(v, 10); }
        else if (t === '--frames') args.frames = parseInt(argv[++i], 10);
        else if (t === '--max-report') args.maxReport = parseInt(argv[++i], 10);
        else if (t === '--quiet') args.quiet = true;
        else if (t === '--strict') args.strict = true;
        else if (t === '--ignore') {
            for (const r of argv[++i].split(',')) {
                args.ignore.add(r.startsWith('$') ? parseInt(r.slice(1), 16) : parseInt(r, 10));
            }
        }
        else if (!args.a) args.a = t;
        else if (!args.b) args.b = t;
        else { console.error(`Unknown argument: ${t}`); process.exit(2); }
    }
    if (!args.a || !args.b) {
        console.error('Usage: node tools/regdiff.js <a.json> <b.json> [--align auto|N] [--frames N] [--ignore r,r] [--quiet]');
        process.exit(2);
    }
    return args;
}

// Hardware latch masks: SID ignores bits 4-7 of pulse-width high and
// bits 3-7 of filter-cutoff low. --strict compares all bits.
function buildMask(strict) {
    const mask = new Array(25).fill(0xFF);
    if (!strict) {
        mask[0x03] = 0x0F; mask[0x0A] = 0x0F; mask[0x11] = 0x0F;
        mask[0x15] = 0x07;
    }
    return mask;
}

// Count mismatching frames of a vs b when b is shifted by `offset`
// (offset > 0: b[i+offset] compares against a[i]).
function countMismatches(a, b, offset, ignore, limit, mask) {
    let mismatches = 0, compared = 0;
    for (let i = 0; i < a.length && compared < limit; i++) {
        const j = i + offset;
        if (j < 0 || j >= b.length) continue;
        compared++;
        const ra = a[i], rb = b[j];
        for (let r = 0; r < 25; r++) {
            if (ignore.has(r)) continue;
            if ((ra[r] & mask[r]) !== (rb[r] & mask[r])) { mismatches++; break; }
        }
    }
    return { mismatches, compared };
}

const args = parseArgs(process.argv);
const A = loadDump(args.a);
const B = loadDump(args.b);

if (A.frames.length === 0 || B.frames.length === 0) {
    console.error(`Empty dump: ${args.a}=${A.frames.length} frames, ${args.b}=${B.frames.length} frames`);
    process.exit(2);
}

const mask = buildMask(args.strict);

let offset = 0;
if (args.align === 'auto') {
    let best = { offset: 0, mismatches: Infinity };
    for (let o = -25; o <= 25; o++) {
        const { mismatches, compared } = countMismatches(A.frames, B.frames, o, args.ignore, Math.min(args.frames, 500), mask);
        if (compared > 0 && mismatches < best.mismatches) best = { offset: o, mismatches };
    }
    offset = best.offset;
} else {
    offset = args.align;
}

// Full comparison at chosen offset
const divergentFrames = [];
const regMismatchCount = new Array(25).fill(0);
let compared = 0;
for (let i = 0; i < A.frames.length && compared < args.frames; i++) {
    const j = i + offset;
    if (j < 0 || j >= B.frames.length) continue;
    compared++;
    const ra = A.frames[i], rb = B.frames[j];
    const diffRegs = [];
    for (let r = 0; r < 25; r++) {
        if (args.ignore.has(r)) continue;
        if ((ra[r] & mask[r]) !== (rb[r] & mask[r])) { diffRegs.push(r); regMismatchCount[r]++; }
    }
    if (diffRegs.length) divergentFrames.push({ i, j, diffRegs, ra, rb });
}

const label = `${A.header.source}:${A.header.song} vs ${B.header.source}:${B.header.song}`;
if (divergentFrames.length === 0) {
    console.log(`OK    ${label} — ${compared} frames identical (offset ${offset})`);
    process.exit(0);
}

console.log(`DIFF  ${label} — ${divergentFrames.length}/${compared} frames diverge (offset ${offset})`);
if (!args.quiet) {
    console.log('\nPer-register mismatch counts:');
    for (let r = 0; r < 25; r++) {
        if (regMismatchCount[r]) {
            console.log(`  ${hex(r)} ${REG_NAMES[r].padEnd(8)} ${regMismatchCount[r]} frames`);
        }
    }
    console.log(`\nFirst ${Math.min(args.maxReport, divergentFrames.length)} divergent frames:`);
    for (const d of divergentFrames.slice(0, args.maxReport)) {
        const details = d.diffRegs.map(r =>
            `${hex(r)}(${REG_NAMES[r]}): ${hex(d.ra[r])}→${hex(d.rb[r])}`).join('  ');
        console.log(`  frame ${d.i}${offset ? `/${d.j}` : ''}: ${details}`);
    }
}
process.exit(1);
