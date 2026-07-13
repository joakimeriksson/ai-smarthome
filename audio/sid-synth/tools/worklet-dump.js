#!/usr/bin/env node
// worklet-dump.js - Run worklet/sid-processor.body.js headless under Node and
// dump SID register state once per 50Hz frame, in the same JSON-lines format
// as tools/gt2-refdump/gt2dump (the native gplay.c reference dumper).
//
// Usage: node tools/worklet-dump.js <song.sng> [--frames N] [--subtune N] [--verbose]
//
// The worklet is fed the exact same messages sequencer-gt2.js sends
// (loadPattern + start) with GT2 default tempo (6), and driven by calling
// process() with one tick-interval worth of samples per iteration.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseSng } from '../gt2-sng-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
    const args = { frames: 1500, subtune: 0, verbose: false, file: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--frames') args.frames = parseInt(argv[++i], 10);
        else if (a === '--subtune') args.subtune = parseInt(argv[++i], 10);
        else if (a === '--verbose') args.verbose = true;
        else if (!args.file) args.file = a;
        else { console.error(`Unknown argument: ${a}`); process.exit(1); }
    }
    if (!args.file) {
        console.error('Usage: node tools/worklet-dump.js <song.sng> [--frames N] [--subtune N] [--verbose]');
        process.exit(1);
    }
    return args;
}

// ---------------------------------------------------------------------------
// AudioWorklet environment stubs
// ---------------------------------------------------------------------------

// 44100/50 = 882 exactly: one process() block per PAL frame
const SAMPLE_RATE = 44100;
const TICK_SAMPLES = Math.floor(SAMPLE_RATE / 50);

function buildSandbox(verbose) {
    let registeredClass = null;

    class FakePort {
        constructor() { this.onmessage = null; }
        postMessage() { /* telemetry/step messages: ignored */ }
    }

    class AudioWorkletProcessor {
        constructor() { this.port = new FakePort(); }
    }

    // Minimal stand-in for jsSID.ReSID: the processor keeps its own register
    // shadow (this.regs) on every poke(), so the fake synth only needs to
    // accept calls and return silent buffers.
    class FakeReSID {
        constructor() { this.filter = { fc: 0, res: 0, filt: 0, vol: 0 }; }
        poke() {}
        generate(n) { return new Float32Array(n); }
        set_chip_model() {}
    }
    FakeReSID.sampling_method = { SAMPLE_FAST: 0 };

    const silent = () => {};
    const sandboxConsole = verbose
        ? { log: (...a) => console.error(...a), warn: (...a) => console.error(...a), error: (...a) => console.error(...a) }
        : { log: silent, warn: silent, error: (...a) => console.error(...a) };

    const sandbox = {
        sampleRate: SAMPLE_RATE,
        AudioWorkletProcessor,
        registerProcessor: (name, cls) => { registeredClass = cls; },
        jsSID: {
            ReSID: FakeReSID,
            chip: { clock: { PAL: 0 }, model: { MOS6581: 0, MOS8580: 1 } },
        },
        console: sandboxConsole,
    };
    vm.createContext(sandbox);
    const bodyPath = path.join(__dirname, '..', 'worklet', 'sid-processor.body.js');
    vm.runInContext(fs.readFileSync(bodyPath, 'utf8'), sandbox, { filename: bodyPath });
    if (!registeredClass) {
        console.error('worklet body did not call registerProcessor()');
        process.exit(1);
    }
    return registeredClass;
}

// ---------------------------------------------------------------------------
// Song → worklet payload (mirrors sequencer-gt2.js startWorkletPlayback)
// ---------------------------------------------------------------------------

function buildPayload(song, subtune) {
    const st = song.subtunes[subtune];
    if (!st) {
        console.error(`Subtune ${subtune} not found (song has ${song.subtunes.length})`);
        process.exit(1);
    }
    const allPatterns = song.patterns.map(pat => {
        const rows = [];
        for (let step = 0; step < pat.length; step++) {
            const r = pat.data[step];
            rows.push({
                note: r.note,
                instrument: r.instrument !== undefined ? r.instrument : 0,
                command: r.command || 0,
                cmdData: r.cmdData || 0,
            });
        }
        return rows;
    });
    return {
        allPatterns,
        orderLists: st.orderLists.map(ol => [...ol]),
        // App convention (import replace mode): instruments[N] = GT2 instrument N (1-based)
        instruments: [null, ...song.instruments],
        tables: { ltable: song.tables.ltable, rtable: song.tables.rtable },
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);
const bytes = new Uint8Array(fs.readFileSync(args.file));
// parseSng logs import diagnostics via console.log; keep stdout pure JSON
const realLog = console.log;
console.log = args.verbose ? (...a) => console.error(...a) : () => {};
const song = parseSng(bytes);
console.log = realLog;
const payload = buildPayload(song, args.subtune);

const ProcessorClass = buildSandbox(args.verbose);
const proc = new ProcessorClass();
const send = (type, p) => proc.port.onmessage({ data: { type, payload: p } });

send('init');
send('loadPattern', payload);
// Mirror main.js import behavior: apply the song's initial speed
if (song.initialSpeed > 0) {
    send('setGT2Tempo', { speed: song.initialSpeed, tempo: song.initialSpeed });
}
send('start');

console.log(JSON.stringify({
    source: 'worklet',
    song: path.basename(args.file),
    subtune: args.subtune,
}));

const outputs = [[new Float32Array(TICK_SAMPLES), new Float32Array(TICK_SAMPLES)]];
for (let f = 0; f < args.frames; f++) {
    proc.process([], outputs);
    const regs = Array.from(proc.regs.subarray(0, 0x19));
    console.log(JSON.stringify({ f, regs }));
}
