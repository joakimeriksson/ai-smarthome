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
import { generateArpeggio, generatePWM, generateFilterSweep, generateVibrato,
         generateDrum, generateSustain, WAVEFORMS } from '../table-generators.js';
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

// The byte-level table layout lives in ../table-generators.js - the SAME pure
// module the browser table editor drives, so the traps (delay = value+1 frames,
// jump targets are absolute 1-based pointers, routing belongs in the FTBL right
// byte, drums need absolute notes) are encoded once instead of twice.
function emit(t, result) {
    const start = here(t);
    result.entries.forEach(e => push(t, e.left, e.right));
    return start;
}
/** generators take startPos as a 0-BASED array index; here() is 1-based */
const at = (t) => L[t].length;

const PULSE = WAVEFORMS.pulse, TRI = WAVEFORMS.triangle, NOISE = WAVEFORMS.noise;

// --- WTBL: arpeggios. One waveform entry per chord tone = one frame each, so
// an N-tone loop is an N-frame arp - the classic C64 "chord from one voice".
const arp = (chord) =>
    emit(WTBL, generateArpeggio({ chord, waveform: PULSE, stepFrames: 1, startPos: at(WTBL) }));
const ARP_MIN  = arp([0, 3, 7]);       // minor triad
const ARP_MAJ  = arp([0, 4, 7]);       // major triad
const ARP_SUS  = arp([0, 5, 7]);       // sus4 - lifts the turnaround
const ARP_MIN7 = arp([0, 3, 7, 10]);   // minor 7th

// --- WTBL: plain sustained instruments. WITHOUT this an instrument never has
// its pitch set in real GT2 (frequency is written only inside WAVEEXEC, which
// runs only if the instrument HAS a wavetable) - the lead and bass sounded
// correct in the browser engine and were dead silent on real hardware and in
// the exported .SID. `make verify` now covers this song, which is how it was
// caught. Both are pulse, so one table serves both.
const WT_SUSTAIN = emit(WTBL, generateSustain({ waveform: PULSE, startPos: at(WTBL) }));

// --- WTBL: drum onsets (one-shot, absolute notes so the kit survives the
// order-list transposes)
const WT_KICK  = emit(WTBL, generateDrum({ kind: 'kick' }));
const WT_SNARE = emit(WTBL, generateDrum({ kind: 'snare' }));
const WT_HAT   = emit(WTBL, generateDrum({ kind: 'hat' }));

// --- PTBL: pulse-width sweeps, seamless triangles that keep the PW value
// across the loop
const PW_LEAD = emit(PTBL, generatePWM({ center: 0x6C0, depth: 384, rate: 64, startPos: at(PTBL) }));
const PW_BASS = emit(PTBL, generatePWM({ center: 0x960, depth: 192, rate: 48, startPos: at(PTBL) }));
const PW_STAB = emit(PTBL, generatePWM({ center: 0x390, depth: 288, rate: 24, startPos: at(PTBL) }));

// --- FTBL: the global resonant low-pass. Routing 0b011 = voices 1+2 through
// the filter, so the drums stay dry and punchy.
const FILTER_SWEEP = emit(FTBL, generateFilterSweep({
    mode: 'lowpass', resonance: 10, routing: 0b011,
    low: 0x30, high: 0xC0, rate: 48, startPos: at(FTBL),
}));

// --- STBL: vibrato (parameter slot, not a program - one entry, no jump)
const VIB_LEAD = emit(STBL, generateVibrato({ periodFrames: 8, depth: 96 }));
const VIB_NONE = 0;

// ---------------------------------------------------------------- instruments
// Timbres measured from Hubbard's own tunes (Commando + Monty on the Run) with
// tools/sid-dump.js: all three voices are PULSE, never triangle/saw; noise only
// for drums. Fast attack, short decay, mid sustain, medium release. The bass
// runs a NARROW pulse (~$180 = thin and buzzy so it cuts through) while lead and
// arp sit wide (~$800-$B40). Commando uses no filter at all - the SID's filter
// varied between chips, so Hubbard largely avoided it.
// INSTRUMENT 1 MUST NOT HAVE VIBRATO. GT2's 6502 player initialises every
// channel to instrument 1, so a never-gated channel carrying a vibrato
// instrument wiggles its (inaudible) frequency register - a real player-vs-
// editor quirk that shows up as a register diff against gplay.c. The lead
// rests through the 4-bar intro, so it hit exactly that case; the bass (no
// vibrato) leads the list instead. Same rule as tests/make-test-songs.js.
const instruments = [
    { name: 'Hub Bass',  ad: 0x08, sr: 0x59, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: WT_SUSTAIN, pulse: PW_BASS, filter: 0, speed: VIB_NONE } },
    { name: 'Hub Lead',  ad: 0x06, sr: 0x4B, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: WT_SUSTAIN, pulse: PW_LEAD, filter: 0, speed: VIB_LEAD }, vibratoDelay: 14 },
    { name: 'Arp Chord', ad: 0x06, sr: 0x4B, firstWave: PULSE, gateTimer: 0x02,
      tables: { wave: ARP_MIN, pulse: PW_STAB, filter: 0, speed: VIB_NONE } },
    { name: 'Kick',      ad: 0x00, sr: 0x88, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_KICK, pulse: 0, filter: 0, speed: VIB_NONE } },
    { name: 'Snare',     ad: 0x00, sr: 0x9A, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_SNARE, pulse: 0, filter: 0, speed: VIB_NONE } },
    { name: 'Hat',       ad: 0x00, sr: 0x56, firstWave: NOISE, gateTimer: 0x02,
      tables: { wave: WT_HAT, pulse: 0, filter: 0, speed: VIB_NONE } },
];
const I_BASS = 1, I_LEAD = 2, I_ARP = 3, I_KICK = 4, I_SNARE = 5, I_HAT = 6;

// ---------------------------------------------------------------- song
// ORIGINAL music written in Hubbard's idiom - his techniques and timbres, not
// his notes. The idiom, measured from Monty on the Run: melody notes held ~48
// frames riding on a 1-FRAME arpeggio shimmer (Monty's voice 2 changes pitch on
// 1404 frames at 1-frame gaps), over a relentless eighth-note pulse bass.
//
// A natural minor with a harmonic-minor V (E major) in the last bar - the
// "heroic" lift Hubbard reached for constantly.
const ROWS = 16;                 // one bar of sixteenths
const SPEED = 4;                 // 4 frames/row -> driving, ~187 BPM feel

// bar -> { chord tones for the arp, bass root, arp table }
const BARS = [
    { arp: ARP_MIN, bass: ['A', 2], deg: ['A', 3] },   // Am
    { arp: ARP_MIN, bass: ['A', 2], deg: ['A', 3] },   // Am
    { arp: ARP_MAJ, bass: ['F', 2], deg: ['F', 3] },   // F
    { arp: ARP_MAJ, bass: ['G', 2], deg: ['G', 3] },   // G
    { arp: ARP_MIN, bass: ['A', 2], deg: ['A', 3] },   // Am
    { arp: ARP_MIN, bass: ['A', 2], deg: ['A', 3] },   // Am
    { arp: ARP_MAJ, bass: ['G', 2], deg: ['G', 3] },   // G
    { arp: ARP_MAJ, bass: ['E', 3], deg: ['E', 3] },   // E  (harmonic-minor V)
];

// The hook: [row, note, octave, length]. Long notes with syncopated answers.
const HOOK = [
    [[0, 'A', 4, 8], [8, 'C', 5, 4], [12, 'B', 4, 4]],
    [[0, 'A', 4, 6], [6, 'E', 5, 6], [12, 'D', 5, 4]],
    [[0, 'C', 5, 8], [8, 'A', 4, 8]],
    [[0, 'B', 4, 4], [4, 'D', 5, 4], [8, 'G', 4, 8]],
    [[0, 'E', 5, 8], [8, 'C', 5, 4], [12, 'A', 4, 4]],
    [[0, 'A', 5, 8], [8, 'G', 5, 4], [12, 'E', 5, 4]],
    [[0, 'D', 5, 8], [8, 'B', 4, 8]],
    [[0, 'E', 5, 4], [4, 'Gs', 5, 4], [8, 'B', 5, 8]],
];

const patterns = [];
const P = (p) => (patterns.push(p), patterns.length - 1);

// --- voice 0: the lead hook
const leadPats = HOOK.map(bar => P(pattern(ROWS, d => {
    bar.forEach(([r, name, oct, len]) => {
        d[r] = row(note(name, oct), I_LEAD);
        if (r + len < ROWS) d[r + len] = row(KEYOFF);
    });
})));

// --- voice 1: relentless eighth-note bass, root with octave kicks on the
// off-beats and a fifth to lead back round
const bassPats = BARS.map(b => P(pattern(ROWS, d => {
    const root = note(b.bass[0], b.bass[1]);
    const FIG = [0, null, 12, null, 0, null, 0, null, 0, null, 12, null, 0, null, 7, null];
    FIG.forEach((iv, r) => {
        if (iv === null) { d[r] = row(KEYOFF); return; }
        d[r] = row(root + iv, I_BASS);
    });
})));

// --- voice 2: 1-frame arp shimmer, interrupted by kick and snare. The arp
// wavetable LOOPS, so one trigger sustains the chord until the next note - the
// drums simply steal the voice for a few frames, exactly as Hubbard did with
// only three channels to spend.
const arpPats = BARS.map(b => P(pattern(ROWS, d => {
    const c = note(b.deg[0], b.deg[1]);
    d[0]  = row(note('C', 3), I_KICK);
    d[2]  = row(c, I_ARP, 0x08, b.arp);     // 8xy selects THIS chord's arp table
    d[6]  = row(note('A', 5), I_HAT);
    d[8]  = row(note('D', 4), I_SNARE);
    d[10] = row(c, I_ARP, 0x08, b.arp);
    d[14] = row(note('A', 5), I_HAT);
})));

// --- a four-bar intro: bass and arp only, so the groove arrives before the hook
const introBass = P(pattern(ROWS, d => {
    const root = note('A', 2);
    for (let r = 0; r < ROWS; r += 2) { d[r] = row(root + (r % 8 === 4 ? 12 : 0), I_BASS); d[r + 1] = row(KEYOFF); }
}));
const introArp = P(pattern(ROWS, d => {
    d[0] = row(note('C', 3), I_KICK);
    d[2] = row(note('A', 3), I_ARP, 0x08, ARP_MIN7);
    d[8] = row(note('D', 4), I_SNARE);
    d[10] = row(note('A', 3), I_ARP, 0x08, ARP_MIN7);
}));
const empty = P(pattern(ROWS, () => {}));

// Tempo goes on the first row that plays. The filter stays OUT of the way -
// Commando uses none - but arm one gentle sweep so the feature is demoed.
patterns[introBass].data[0].command = 0x0F;
patterns[introBass].data[0].cmdData = SPEED;
patterns[introArp].data[0] = row(note('C', 3), I_KICK, 0x0A, FILTER_SWEEP);

// Order-list transpose byte: 0xE0-0xFD, value = 0xF0 + signed semitones
const TRANSPOSE = (semis) => 0xF0 + semis;

const A = leadPats, B = bassPats, C = arpPats;
const orderLists = [
    // lead rests through the intro, then the hook twice, second time up a fourth
    [empty, empty, empty, empty, ...A, TRANSPOSE(5), ...A, TRANSPOSE(0), 0xFF],
    [introBass, introBass, introBass, introBass, ...B, TRANSPOSE(5), ...B, TRANSPOSE(0), 0xFF],
    [introArp, introArp, introArp, introArp, ...C, TRANSPOSE(5), ...C, TRANSPOSE(0), 0xFF],
];

const song = {
    name: 'Hubbard Drive',
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
