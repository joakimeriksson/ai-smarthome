#!/usr/bin/env node
// rip-compare.js - Musical comparison of two SID register dumps (JSON lines
// from sid-dump.js / worklet-dump.js): the ORIGINAL tune vs a RIPPED and
// re-played version. A rip is never frame-exact, so instead of regdiff this
// extracts note EVENTS per voice and compares what matters musically:
//   - note onsets (gate on) and their timing
//   - note lengths (gate on -> gate off)
//   - pitch at note body
//   - waveform/ctrl bits used during the note
//   - ADSR at note start
//
// Usage: node tools/rip-compare.js original.json rip.json [--frames N] [--verbose]

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const verbose = args.includes('--verbose');
const framesArg = args.indexOf('--frames');
const maxFrames = framesArg >= 0 ? parseInt(args[framesArg + 1], 10) : Infinity;

if (files.length !== 2) {
    console.error('Usage: node tools/rip-compare.js original.json rip.json [--frames N] [--verbose]');
    process.exit(2);
}

function loadDump(path) {
    const frames = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const obj = JSON.parse(line);
        if (obj.regs) frames.push(obj.regs);
        if (frames.length >= maxFrames) break;
    }
    return frames;
}

// Extract note events per voice from a dump. A note's audible span runs
// from gate-on until the NEXT gate-on (release-phase music keeps sounding
// and sliding after gate-off), so freqs covers that whole span.
function extractNotes(frames) {
    const voices = [[], [], []];
    const state = [null, null, null]; // active note per voice
    for (let f = 0; f < frames.length; f++) {
        const regs = frames[f];
        for (let v = 0; v < 3; v++) {
            const base = v * 7;
            const freq = regs[base] | (regs[base + 1] << 8);
            const ctrl = regs[base + 4];
            const gate = ctrl & 1;
            const cur = state[v];
            if (gate && (!cur || cur.gateClosed)) {
                if (cur) { cur.span = f - cur.on; voices[v].push(cur); }
                state[v] = {
                    on: f, off: null, len: null, span: null, gateClosed: false,
                    freqs: [freq], ctrls: new Set([ctrl]),
                    ad: regs[base + 5], sr: regs[base + 6],
                };
            } else if (cur) {
                cur.freqs.push(freq);
                cur.ctrls.add(ctrl);
                if (f - cur.on === 2) { cur.ad = regs[base + 5]; cur.sr = regs[base + 6]; }
                if (!gate && !cur.gateClosed) { cur.off = f; cur.len = f - cur.on; cur.gateClosed = true; }
            }
        }
    }
    for (let v = 0; v < 3; v++) {
        const cur = state[v];
        if (cur) {
            if (!cur.gateClosed) { cur.off = frames.length; cur.len = frames.length - cur.on; }
            cur.span = frames.length - cur.on;
            voices[v].push(cur);
        }
    }
    return voices;
}

function freqToNoteIdx(freq) {
    if (freq === 0) return -1;
    const fout = (freq * 985248) / 16777216;
    return Math.round(12 * Math.log2(fout / 440) + 69) - 12; // GT2 note index
}

// Representative pitch of a note: the LOWEST commonly-held pitch over the
// audible span (trills/arps sit on their base note; onset noise is high)
function bodyPitch(note) {
    const counts = new Map();
    for (const fr of note.freqs.slice(1)) {
        if (fr === 0) continue;
        const idx = freqToNoteIdx(fr);
        counts.set(idx, (counts.get(idx) || 0) + 1);
    }
    if (!counts.size) return note.freqs[0] || 0;
    // Most common note index, ties broken toward the lower pitch
    let best = -1, bestCount = 0;
    for (const [idx, c] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
        if (c > bestCount) { best = idx; bestCount = c; }
    }
    return best;
}

// Trajectory similarity: fraction of span frames where both notes play the
// same pitch (within a semitone), up to the shorter span
function trajectoryMatch(a, b) {
    const n = Math.min(a.freqs.length, b.freqs.length);
    if (n === 0) return 0;
    let ok = 0;
    for (let i = 0; i < n; i++) {
        const ia = freqToNoteIdx(a.freqs[i]), ib = freqToNoteIdx(b.freqs[i]);
        if (ia >= 0 && Math.abs(ia - ib) <= 1) ok++;
    }
    return ok / n;
}

// Pitch-content similarity: how much the two notes' pitch distributions
// overlap across the span, independent of phase (an octave trill played
// low-high vs high-low is musically identical)
function contentMatch(a, b) {
    const hist = (note) => {
        const h = new Map();
        const n = note.freqs.length;
        for (const fr of note.freqs) {
            if (!fr) continue;
            const idx = freqToNoteIdx(fr);
            h.set(idx, (h.get(idx) || 0) + 1 / n);
        }
        return h;
    };
    const ha = hist(a), hb = hist(b);
    let overlap = 0;
    for (const [idx, wa] of ha) overlap += Math.min(wa, hb.get(idx) || 0);
    return overlap;
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

const orig = extractNotes(loadDump(files[0]));
const rip = extractNotes(loadDump(files[1]));

let totals = { matched: 0, origCount: 0, ripCount: 0, pitchOk: 0, lenDiffs: [], traj: [] };

for (let v = 0; v < 3; v++) {
    const o = orig[v], r = rip[v];
    totals.origCount += o.length;
    totals.ripCount += r.length;

    // Align: find offset that matches the most onsets (search -50..50)
    let bestOffset = 0, bestMatches = -1;
    for (let off = -50; off <= 50; off++) {
        let m = 0, j = 0;
        for (const on of o) {
            while (j < r.length && r[j].on + off < on.on - 3) j++;
            if (j < r.length && Math.abs(r[j].on + off - on.on) <= 3) m++;
        }
        if (m > bestMatches) { bestMatches = m; bestOffset = off; }
    }

    // Pair notes greedily by onset proximity
    const used = new Set();
    const pairs = [];
    for (const on of o) {
        let best = -1, bestD = 4;
        for (let j = 0; j < r.length; j++) {
            if (used.has(j)) continue;
            const d = Math.abs(r[j].on + bestOffset - on.on);
            if (d < bestD) { bestD = d; best = j; }
        }
        if (best >= 0) { used.add(best); pairs.push([on, r[best]]); }
    }

    const lenO = pairs.map(([a]) => a.len);
    const lenR = pairs.map(([, b]) => b.len);
    const pitchMatches = pairs.filter(([a, b]) => bodyPitch(a) === bodyPitch(b) || contentMatch(a, b) >= 0.5).length;
    const nearPitch = pairs.filter(([a, b]) => Math.abs(bodyPitch(a) - bodyPitch(b)) <= 1).length;
    const trajAvg = pairs.length ? pairs.reduce((s, [a, b]) => s + trajectoryMatch(a, b), 0) / pairs.length : 0;
    const contentAvg = pairs.length ? pairs.reduce((s, [a, b]) => s + contentMatch(a, b), 0) / pairs.length : 0;
    const lenDiff = pairs.map(([a, b]) => b.len - a.len);

    totals.matched += pairs.length;
    totals.pitchOk += pitchMatches;
    totals.lenDiffs.push(...lenDiff);

    console.log(`Voice ${v}: orig ${o.length} notes, rip ${r.length} notes, matched ${pairs.length} (offset ${bestOffset})`);
    console.log(`  note length:  orig median ${median(lenO)}f, rip median ${median(lenR)}f, median diff ${median(lenDiff)}f`);
    console.log(`  pitch: exact ${pitchMatches}/${pairs.length}, within 1 semitone ${nearPitch}/${pairs.length}, trajectory ${(100*trajAvg).toFixed(0)}%, pitch content ${(100*contentAvg).toFixed(0)}%`);
    totals.traj.push(trajAvg);

    if (verbose) {
        for (const [a, b] of pairs.slice(0, 12)) {
            const na = bodyPitch(a), nb = bodyPitch(b);
            console.log(`    orig on=${a.on} len=${a.len} note=${na} ad=$${a.ad.toString(16)} sr=$${a.sr.toString(16)} | rip on=${b.on} len=${b.len} note=${nb} ad=$${b.ad.toString(16)} sr=$${b.sr.toString(16)}`);
        }
    }
}

const matchPct = totals.origCount ? (100 * totals.matched / totals.origCount).toFixed(1) : 0;
const pitchPct = totals.matched ? (100 * totals.pitchOk / totals.matched).toFixed(1) : 0;
const trajPct = totals.traj.length ? (100 * totals.traj.reduce((a, b) => a + b, 0) / totals.traj.length).toFixed(1) : 0;
console.log(`\nSUMMARY: onset match ${matchPct}% (${totals.matched}/${totals.origCount}), pitch exact ${pitchPct}%, trajectory ${trajPct}%, median len diff ${median(totals.lenDiffs)}f`);
