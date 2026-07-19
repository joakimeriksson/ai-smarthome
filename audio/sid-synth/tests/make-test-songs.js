#!/usr/bin/env node
// make-test-songs.js - Generate a GTS5 .sng test corpus exercising GT2
// features that dojo.sng does not cover. One file, feature-isolating
// subtunes; every engine (gt2dump / worklet-dump / export-sid+sid-dump)
// plays the same file.
//
// Subtunes:
//   0: instrument vibrato with delay      4: KEYOFF / KEYON / REST
//   1: funktempo (EXY)                    5: transpose + repeat orderlist
//   2: portamento up/down + toneportamento
//   3: per-channel tempo (FXY with bit 7)
//
// Usage: node tests/make-test-songs.js   (writes tests/songs/features.sng)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'songs', 'features.sng');

const bytes = [];
const put = (...b) => bytes.push(...b.map(x => x & 0xFF));
const putString = (s, len) => {
    for (let i = 0; i < len; i++) put(i < s.length ? s.charCodeAt(i) : 0);
};

// Note helpers (GT2 encoding: $60 = C-0)
const N = (semitone) => 0x60 + semitone; // semitone 0..95
const REST = 0xBD, KEYOFF = 0xBE, KEYON = 0xBF, ENDPATT = 0xFF;

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
putString('GTS5', 4);
putString('Feature Tests', 32);
putString('sid-synth harness', 32);
putString('2026', 32);

// ---------------------------------------------------------------------------
// Order lists: numSubtunes, then per subtune x 3 voices:
// length byte L, then L+1 bytes (entries + $FF + restart position)
// ---------------------------------------------------------------------------
const SILENT = 1; // pattern 1 = rests
const subtunes = [
    [[0], [SILENT], [SILENT]],                 // 0: vibrato
    [[2], [SILENT], [SILENT]],                 // 1: funktempo
    [[3], [SILENT], [SILENT]],                 // 2: portamento/toneporta
    [[4], [6], [SILENT]],                      // 3: per-channel tempo (2 voices)
    [[5], [SILENT], [SILENT]],                 // 4: keyoff/keyon/rest
    [[0xF3, 0, 0xD1, 0], [SILENT], [SILENT]],  // 5: transpose +3, repeat 1 extra
    [[7], [SILENT], [8]],                      // 6: ring mod carrier (v0) + silent gate-less modulator (v2)
    [[9, 0xF3, 9, 0xF0, 9], [SILENT], [SILENT]], // 7: MID-LIST transpose (+3 then back to 0) - advance path, not start init
    [[10], [SILENT], [SILENT]],                // 8: global tempo command F03 on row 0
    [[11], [SILENT], [SILENT]],                // 9: cmd 8 wavetable overrides + delay + absolute-note entries
    [[12], [SILENT], [SILENT]],                // 10: tie notes (cmd 3 data 0) - legato without gate retrigger
];
put(subtunes.length);
for (const st of subtunes) {
    for (const voice of st) {
        const entries = [...voice, 0xFF, 0x00]; // loop to position 0
        put(entries.length - 1);
        put(...entries);
    }
}

// ---------------------------------------------------------------------------
// Instruments: count, then per instrument:
// ad, sr, waveptr, pulseptr, filtptr, vibparam(=STBL ptr), vibdelay,
// gatetimer, firstwave, name[16]
// ---------------------------------------------------------------------------
// NOTE: the vibrato instrument must NOT be instrument 1. GT2's 6502 player
// initializes every channel to instrument 1, and a never-gated channel with
// a vibrato instrument wiggles its (inaudible) frequency register — a real
// GT2 player-vs-editor quirk that would show up as a register diff.
const instruments = [
    // 1: plain sawtooth, no vibrato
    { ad: 0x22, sr: 0xA8, wave: 3, pulse: 0, filt: 0, vib: 0, vibdelay: 0, gate: 0x02, fw: 0x09, name: 'Plain' },
    // 2: triangle with instrument vibrato (STBL 1) after 20 frames
    { ad: 0x09, sr: 0x00, wave: 1, pulse: 0, filt: 0, vib: 1, vibdelay: 20, gate: 0x02, fw: 0x09, name: 'Vib' },
    // 3: ring-mod carrier: triangle + ring (osc from voice-1, i.e. voice 2)
    { ad: 0x09, sr: 0x80, wave: 5, pulse: 0, filt: 0, vib: 0, vibdelay: 0, gate: 0x02, fw: 0x09, name: 'Ring' },
    // 4: silent gate-less modulator: waveform without gate bit, envelope
    // stays silent while its oscillator drives the ring modulation
    { ad: 0x00, sr: 0x00, wave: 7, pulse: 0, filt: 0, vib: 0, vibdelay: 0, gate: 0x02, fw: 0x09, name: 'Mod' },
];
put(instruments.length);
for (const i of instruments) {
    put(i.ad, i.sr, i.wave, i.pulse, i.filt, i.vib, i.vibdelay, i.gate, i.fw);
    putString(i.name, 16);
}

// ---------------------------------------------------------------------------
// Tables: 4 x (size, left[size], right[size]) — WTBL, PTBL, FTBL, STBL
// ---------------------------------------------------------------------------
// 1: tri+gate / 3: saw+gate / 5: tri+ring+gate / 7: pulse NO gate (silent mod)
// 9: pulse+gate, delay 3, gate-off, self-loop (rip-style onset with delay)
// 13: absolute-note entry (noise at fixed pitch 60), self-loop
const WTBL_L = [0x11, 0xFF, 0x21, 0xFF, 0x15, 0xFF, 0x40, 0xFF, 0x41, 0x03, 0x40, 0xFF, 0x81, 0xFF];
const WTBL_R = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x80, 0x0B, 0x80 | 60, 0x0D];
const STBL_L = [0x02, 0x09, 0x00, 0x00]; // 1: vib cmp=2  2: funktempo 9   3: porta $0040  4: toneporta $0020
const STBL_R = [0x20, 0x06, 0x40, 0x20]; //    depth $20     right 6          lo $40          lo $20
const tables = [
    [WTBL_L, WTBL_R],
    [[], []],
    [[], []],
    [STBL_L, STBL_R],
];
for (const [l, r] of tables) {
    put(l.length);
    put(...l);
    put(...r);
}

// ---------------------------------------------------------------------------
// Patterns: count, then per pattern: rowCount (incl end marker), rows x
// (note, instrument, command, data)
// ---------------------------------------------------------------------------
function pattern(rows) {
    // rows: sparse map row -> [note, instr, cmd, data]; length 16 + end marker
    const data = [];
    for (let r = 0; r < 16; r++) {
        data.push(rows[r] || [REST, 0, 0, 0]);
    }
    data.push([ENDPATT, 0, 0, 0]);
    return data;
}

const patterns = [
    // 0: vibrato — long note, vibrato kicks in via instrument vibdelay
    pattern({ 0: [N(36), 2, 0, 0], 14: [KEYOFF, 0, 0, 0] }),
    // 1: silence
    pattern({}),
    // 2: funktempo — enable E-command (STBL 2), notes every 2 rows
    pattern({
        0: [N(36), 1, 0x0E, 2], 2: [N(40), 0, 0, 0], 4: [N(43), 0, 0, 0],
        6: [N(36), 0, 0, 0], 8: [N(40), 0, 0, 0], 10: [N(43), 0, 0, 0],
        12: [N(36), 0, 0, 0], 14: [N(48), 0, 0, 0],
    }),
    // 3: portamento up (1XY), down (2XY), toneportamento (3XY)
    pattern({
        0: [N(36), 1, 0, 0], 2: [REST, 0, 0x01, 3], 5: [REST, 0, 0x00, 0],
        6: [REST, 0, 0x02, 3], 9: [REST, 0, 0x00, 0],
        10: [N(48), 0, 0x03, 4], 14: [KEYOFF, 0, 0, 0],
    }),
    // 4: per-channel tempo 3 on this voice (F83), notes every 4 rows
    pattern({
        0: [N(36), 1, 0x0F, 0x83], 4: [N(40), 0, 0, 0],
        8: [N(43), 0, 0, 0], 12: [N(48), 0, 0, 0],
    }),
    // 5: keyoff / keyon / rest behavior
    pattern({
        0: [N(36), 1, 0, 0], 3: [KEYOFF, 0, 0, 0], 6: [KEYON, 0, 0, 0],
        9: [REST, 0, 0, 0], 12: [N(43), 0, 0, 0],
    }),
    // 6: per-channel tempo 8 on second voice (F88), notes every 2 rows
    pattern({
        0: [N(24), 1, 0x0F, 0x88], 2: [N(28), 0, 0, 0], 4: [N(31), 0, 0, 0],
        6: [N(24), 0, 0, 0], 8: [N(28), 0, 0, 0], 10: [N(31), 0, 0, 0],
        12: [N(24), 0, 0, 0], 14: [N(31), 0, 0, 0],
    }),
    // 7: ring-mod carrier notes (instrument 3, tri+ring)
    pattern({
        0: [N(48), 3, 0, 0], 4: [N(50), 0, 0, 0],
        8: [N(52), 0, 0, 0], 12: [N(48), 0, 0, 0], 14: [KEYOFF, 0, 0, 0],
    }),
    // 8: silent modulator line (instrument 4) - different rhythm so the
    // ring timbre changes within carrier notes
    pattern({
        0: [N(12), 4, 0, 0], 2: [N(19), 0, 0, 0], 4: [N(14), 0, 0, 0],
        6: [N(21), 0, 0, 0], 8: [N(16), 0, 0, 0], 10: [N(23), 0, 0, 0],
        12: [N(12), 0, 0, 0], 14: [N(24), 0, 0, 0],
    }),
    // 9: plain melody for mid-list transpose test
    pattern({
        0: [N(36), 1, 0, 0], 4: [N(40), 0, 0, 0],
        8: [N(43), 0, 0, 0], 12: [N(45), 0, 0, 0], 14: [KEYOFF, 0, 0, 0],
    }),
    // 10: global tempo command F03 on row 0 (rip-style tempo embedding)
    pattern({
        0: [N(36), 1, 0x0F, 0x03], 2: [N(40), 0, 0, 0], 4: [N(43), 0, 0, 0],
        6: [N(36), 0, 0, 0], 8: [N(40), 0, 0, 0], 10: [N(43), 0, 0, 0],
        12: [N(48), 0, 0, 0], 14: [KEYOFF, 0, 0, 0],
    }),
    // 11: cmd 8 wavetable pointer overrides: delay-onset table (ptr 9) and
    // absolute-note table (ptr 13)
    pattern({
        0: [N(36), 1, 0x08, 9], 4: [N(40), 0, 0x08, 9],
        8: [N(43), 0, 0x08, 13], 12: [N(36), 0, 0x08, 9], 14: [KEYOFF, 0, 0, 0],
    }),
    // 12: legato tie notes: first note normal, then pitch jumps via cmd 3
    // data 0 (instant toneporta) with the gate held the whole time
    pattern({
        0: [N(36), 1, 0, 0], 4: [N(43), 0, 0x03, 0],
        8: [N(40), 0, 0x03, 0], 12: [N(48), 0, 0x03, 0],
    }),
];
put(patterns.length);
for (const p of patterns) {
    put(p.length);
    for (const [note, instr, cmd, data] of p) put(note, instr, cmd, data);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(bytes));
console.log(`wrote ${OUT} (${bytes.length} bytes, ${subtunes.length} subtunes, ${patterns.length} patterns)`);
