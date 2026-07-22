#!/usr/bin/env node
// make-default-song.js - compose the tracker's built-in demo song FROM CODE.
//
// The old default was three hardcoded 16-row patterns (a C-major arpeggio, the
// same arpeggio as bass, a noise hit every other row). It used none of the
// engine: no wavetables, no arps, no PWM, no filter, no commands - so the app
// booted sounding like a beeper instead of a SID.
//
// This composes a real GT2 song deterministically (no randomness - same bytes
// every run) and deliberately drives every subsystem the tracker implements:
//   WTBL  chord arpeggios + noise drum onsets
//   PTBL  pulse-width sweeps on lead and bass
//   FTBL  the global resonant low-pass sweep
//   STBL  vibrato
//   plus tempo (Fxy), wavetable-pointer (8xy) and filter-arm (Axy) commands,
//   and order-list transposes for the key change.
//
// Usage: node tools/make-default-song.js [out.sng]        (default sids/default-song.sng)
//        node tools/make-default-song.js --js out.js      also emit an ES module
//                                                          for the app to import
import { writeSng } from '../gt2-sng-writer.js';
import { writeFileSync } from 'node:fs';

// ---------------------------------------------------------------- note helpers
// GT2 note byte: 0x60 + (octave-1)*12 + semitone   (C-4 = 0x84)
const N = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 };
const note = (name, oct) => 0x60 + (oct - 1) * 12 + N[name];
const KEYOFF = 0xBE, REST = 0xBD, EMPTY = 0;

const row = (note = EMPTY, instrument = 0, command = 0, cmdData = 0) =>
    ({ note, instrument, command, cmdData });

function pattern(len, fill) {
    const data = Array.from({ length: len }, () => row());
    if (fill) fill(data);
    return { length: len, data };
}

// ---------------------------------------------------------------- tables
// Four GT2 tables, each dual-byte (ltable/rtable). Pointers are 1-BASED.
const L = [[], [], [], []], R = [[], [], [], []];
const WTBL = 0, PTBL = 1, FTBL = 2, STBL = 3;
function push(t, l, r) { L[t].push(l & 0xFF); R[t].push(r & 0xFF); return L[t].length; }
// returns the 1-based pointer of the NEXT entry to be written
const here = (t) => L[t].length + 1;

// --- WTBL: arpeggios. A waveform entry advances every frame, so an N-entry
// loop is an N-frame arp - the classic C64 "chord from one voice".
function arp(waveform, intervals) {
    const start = here(WTBL);
    intervals.forEach(iv => push(WTBL, waveform, iv & 0x7F));
    push(WTBL, 0xFF, start);       // loop back to this table's own start
    return start;
}
const PULSE = 0x41, TRI = 0x11, SAW = 0x21, NOISE = 0x81;
const ARP_MIN = arp(PULSE, [0, 3, 7]);      // minor triad
const ARP_MAJ = arp(PULSE, [0, 4, 7]);      // major triad
const ARP_SUS = arp(PULSE, [0, 5, 7]);      // sus4 - lifts the turnaround
const ARP_MIN7 = arp(PULSE, [0, 3, 7, 10]); // minor 7th

// --- WTBL: drum onsets. Noise burst that drops in pitch, then a short tonal
// body; the trailing silent entry lets the ADSR release do the rest.
function drum(steps) {
    const start = here(WTBL);
    steps.forEach(([w, n]) => push(WTBL, w, n & 0xFF));
    push(WTBL, 0xFF, 0x00);        // 0 = stop: one-shot, not a loop
    return start;
}
// Right byte 0x81-0xFF = ABSOLUTE note (right & 0x7F), so drums keep their
// pitch no matter what note the pattern row holds - and survive order-list
// transposes, which would otherwise detune the kit.
const ABS = (n) => 0x80 | (n & 0x7F);
//                noise transient, then a tonal body that drops = the classic
//                C64 kick; ~note 40 down to ~note 22, not sub-DC
const WT_KICK = drum([[NOISE, ABS(40)], [TRI, ABS(31)], [TRI, ABS(26)], [TRI, ABS(22)]]);
const WT_SNARE = drum([[NOISE, ABS(62)], [NOISE, ABS(58)], [NOISE, ABS(54)], [NOISE, ABS(50)]]);
const WT_HAT = drum([[NOISE, ABS(84)], [NOISE, ABS(80)]]);

// --- PTBL: pulse-width sweeps. left>=0x80 sets PW ((left&0x0F)<<8 | right),
// left 0x01-0x7F modulates for N frames by signed right.
function pwm(startPW, legs) {
    const start = here(PTBL);
    push(PTBL, 0x80 | ((startPW >> 8) & 0x0F), startPW & 0xFF);
    legs.forEach(([frames, speed]) => push(PTBL, frames, speed));
    push(PTBL, 0xFF, start + 1);   // loop past the set, so the sweep is seamless
    return start;
}
const PW_LEAD = pwm(0x600, [[64, 6], [64, -6]]);   // slow shimmer
const PW_BASS = pwm(0x900, [[48, -4], [48, 4]]);   // fat, slower
const PW_STAB = pwm(0x300, [[24, 12], [24, -12]]); // narrow, nasal

// --- FTBL: the global resonant low-pass. left>=0x80 sets type|routing/res,
// left 0x00 sets cutoff, left 0x01-0x7F modulates.
const FILTER_SWEEP = (() => {
    const start = here(FTBL);
    // type = left & 0x70 (0x10 = low-pass); right = resonance<<4 | routing.
    // Routing 0b011 = voices 1+2 through the filter, drums stay dry and punchy.
    push(FTBL, 0x80 | 0x10, (0x0A << 4) | 0x03);
    push(FTBL, 0x00, 0x30);                 // cutoff
    push(FTBL, 48, +2);                     // open
    push(FTBL, 24, +3);
    push(FTBL, 48, -2);                     // close
    push(FTBL, 24, -3);
    push(FTBL, 0xFF, start + 2);            // loop the sweep, keep the settings
    return start;
})();

// --- STBL: vibrato (left = compare value, right = freq delta per frame)
const VIB_LEAD = (() => { const p = here(STBL); push(STBL, 0x08, 0x18); return p; })();
const VIB_NONE = 0;

// ---------------------------------------------------------------- instruments
// 0-based array: instruments[0] is GT2 instrument 1.
const instruments = [
    { name: 'Arp Lead',  ad: 0x0A, sr: 0xA9, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: ARP_MIN, pulse: PW_LEAD, filter: 0, speed: VIB_LEAD }, vibratoDelay: 12 },
    { name: 'PWM Bass',  ad: 0x08, sr: 0x6A, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: 0, pulse: PW_BASS, filter: 0, speed: VIB_NONE } },
    { name: 'Kick',      ad: 0x00, sr: 0x88, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_KICK, pulse: 0, filter: 0, speed: VIB_NONE } },
    { name: 'Snare',     ad: 0x00, sr: 0x9A, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_SNARE, pulse: 0, filter: 0, speed: VIB_NONE } },
    { name: 'Hat',       ad: 0x00, sr: 0x56, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_HAT, pulse: 0, filter: 0, speed: VIB_NONE } },
    { name: 'Stab',      ad: 0x02, sr: 0x8A, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: ARP_MIN7, pulse: PW_STAB, filter: 0, speed: VIB_NONE } },
];
const I_LEAD = 1, I_BASS = 2, I_KICK = 3, I_SNARE = 4, I_HAT = 5, I_STAB = 6;

// ---------------------------------------------------------------- song
// A minor, i - VI - III - VII: the C64 progression.
const CHORDS = [
    { root: 'A', oct: 3, arp: ARP_MIN, bass: ['A', 2] },
    { root: 'F', oct: 3, arp: ARP_MAJ, bass: ['F', 2] },
    { root: 'C', oct: 4, arp: ARP_MAJ, bass: ['C', 2] },
    { root: 'G', oct: 3, arp: ARP_SUS, bass: ['G', 2] },
];
const ROWS = 16;
const patterns = [];
const P = (p) => (patterns.push(p), patterns.length - 1);

// --- lead: a real melody over each chord, arp wavetable per chord shape
const LEAD_FIGURE = [           // row -> scale step offset, or null = hold
    0, null, 3, null, 7, null, 3, null,
    5, null, 3, null, 0, null, null, KEYOFF,
];
const leadPats = CHORDS.map((ch, ci) => P(pattern(ROWS, d => {
    LEAD_FIGURE.forEach((step, r) => {
        if (step === KEYOFF) { d[r] = row(KEYOFF); return; }
        if (step === null) return;
        const n = note(ch.root, ch.oct) + step;
        // 8xy points this row at THIS chord's arp table; only emit it when the
        // shape changes (re-issuing 8xy resets the table and freezes the arp)
        const armArp = (r === 0);
        d[r] = row(n, I_LEAD, armArp ? 0x08 : 0, armArp ? ch.arp : 0);
    });
})));

// --- bass: driving eighths with an octave lift on the back half
const bassPats = CHORDS.map((ch) => P(pattern(ROWS, d => {
    for (let r = 0; r < ROWS; r += 2) {
        const up = r >= 8 && (r % 4 === 2);
        d[r] = row(note(ch.bass[0], ch.bass[1]) + (up ? 12 : 0), I_BASS);
        d[r + 1] = row(KEYOFF);
    }
})));

// --- drums: kick on 1 & 3, snare on 2 & 4, hats on the off-beats
const drumPat = P(pattern(ROWS, d => {
    for (let r = 0; r < ROWS; r++) {
        if (r % 8 === 0) d[r] = row(note('C', 3), I_KICK);
        else if (r % 8 === 4) d[r] = row(note('D', 4), I_SNARE);
        else if (r % 2 === 1) d[r] = row(note('A', 5), I_HAT);
    }
}));
// fill variant: extra kick + snare roll into the turnaround
const drumFill = P(pattern(ROWS, d => {
    for (let r = 0; r < ROWS; r++) {
        if (r % 8 === 0) d[r] = row(note('C', 3), I_KICK);
        else if (r === 4) d[r] = row(note('D', 4), I_SNARE);
        else if (r >= 12) d[r] = row(note('D', 4) + (r - 12), I_SNARE);
        else if (r % 2 === 1) d[r] = row(note('A', 5), I_HAT);
    }
}));

// --- intro: bass + filter alone, so the sweep is audible before the drums hit
const introBass = P(pattern(ROWS, d => {
    for (let r = 0; r < ROWS; r += 4) { d[r] = row(note('A', 2), I_BASS); d[r + 3] = row(KEYOFF); }
}));
const introLead = P(pattern(ROWS, d => {
    d[0] = row(note('A', 4), I_LEAD, 0x08, ARP_MIN7);
    d[8] = row(note('E', 4), I_LEAD);
    d[15] = row(KEYOFF);
}));
const stabPat = P(pattern(ROWS, d => {
    d[0] = row(note('A', 4), I_STAB, 0x08, ARP_MIN7);
    d[6] = row(note('G', 4), I_STAB);
    d[10] = row(note('E', 4), I_STAB);
    d[15] = row(KEYOFF);
}));
const empty = P(pattern(ROWS, () => {}));

// Tempo (Fxy) and the one-shot filter arm (Axy) go on the very first rows.
// The filter is GLOBAL and free-running: arm it ONCE or the cycle restarts.
patterns[introBass].data[0].command = 0x0F;
patterns[introBass].data[0].cmdData = 0x06;   // 6 frames/row
patterns[introLead].data[0] = row(note('A', 4), I_LEAD, 0x0A, FILTER_SWEEP);

// Order lists. 0xE0-0xFD = transpose (0xF0 + semitones); 0xFF = end/loop.
const TRANSPOSE = (semis) => 0xF0 + semis;
const A = leadPats, B = bassPats;
const orderLists = [
    // voice 0: intro, main x2, then the same lifted +3 semitones
    [introLead, empty, ...A, ...A, TRANSPOSE(3), ...A, TRANSPOSE(0), stabPat, 0xFF],
    [introBass, introBass, ...B, ...B, TRANSPOSE(3), ...B, TRANSPOSE(0), introBass, 0xFF],
    [empty, empty, drumPat, drumPat, drumPat, drumFill, drumPat, drumPat, drumPat, drumFill,
     drumPat, drumPat, drumPat, drumFill, drumPat, 0xFF],
];

const song = {
    name: 'Neon Dojo',
    author: 'SID Tracker',
    copyright: '2026 - generated by tools/make-default-song.js',
    subtunes: [{ orderLists }],
    patterns,
    instruments,
    tables: { ltable: L, rtable: R },
};

// ---------------------------------------------------------------- output
const args = process.argv.slice(2);
const jsIdx = args.indexOf('--js');
const jsOut = jsIdx >= 0 ? args[jsIdx + 1] : null;
const out = args.filter((a, i) => !a.startsWith('--') && i !== jsIdx + 1)[0]
    || 'sids/default-song.sng';

const bytes = writeSng(song);
writeFileSync(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);
console.log(`  ${patterns.length} patterns, ${instruments.length} instruments, ` +
    `WTBL ${L[WTBL].length} / PTBL ${L[PTBL].length} / FTBL ${L[FTBL].length} / STBL ${L[STBL].length}`);

if (jsOut) {
    const js = `// GENERATED by tools/make-default-song.js - do not edit by hand.
// Regenerate with:  node tools/make-default-song.js --js default-song.js
export const DEFAULT_SONG = ${JSON.stringify(
        { name: song.name, author: song.author, orderLists, patterns, instruments,
          tables: { ltable: L, rtable: R } })};
`;
    writeFileSync(jsOut, js);
    console.log(`wrote ${jsOut} (${js.length} bytes)`);
}
