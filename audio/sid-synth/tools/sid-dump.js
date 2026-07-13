#!/usr/bin/env node
// sid-dump.js - "play" a PSID .sid file with a 6502 emulator and dump the
// SID register shadow ($D400-$D418) after each play call, one JSON line
// per frame.
//
// Usage: node tools/sid-dump.js <file.sid> [--frames N] [--subtune N]
//
// Output (stdout, JSON lines):
//   {"source":"sid","song":"<basename>","subtune":<n>}
//   {"f":0,"regs":[...25 decimal values...]}
//   {"f":1,"regs":[...]}
//   ...
// All diagnostics go to stderr.
//
// Exit codes: 0 ok, 1 usage/parse error, 2 unsupported file (RSID,
// playAddress==0, BASIC flag).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Cpu6502 } from './lib/cpu6502.js';

const INIT_BUDGET = 1_000_000;   // instruction budget for init call
const PLAY_BUDGET = 100_000;     // instruction budget per play call
const DEFAULT_FRAMES = 500;      // 10 seconds at 50Hz

function err(msg) { process.stderr.write(msg + '\n'); }
function hex(v, w = 4) { return '$' + v.toString(16).toUpperCase().padStart(w, '0'); }

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
function usage() {
  err('Usage: node tools/sid-dump.js <file.sid> [--frames N] [--subtune N]');
  err('  --frames N    number of 50Hz frames to emit (default ' + DEFAULT_FRAMES + ')');
  err('  --subtune N   0-based subtune index (default: startSong from header)');
}

const argv = process.argv.slice(2);
let file = null;
let frames = DEFAULT_FRAMES;
let subtuneArg = null;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--frames') {
    frames = parseInt(argv[++i], 10);
    if (!Number.isInteger(frames) || frames < 1) { err('sid-dump: invalid --frames value'); process.exit(1); }
  } else if (a === '--subtune') {
    subtuneArg = parseInt(argv[++i], 10);
    if (!Number.isInteger(subtuneArg) || subtuneArg < 0) { err('sid-dump: invalid --subtune value'); process.exit(1); }
  } else if (a === '-h' || a === '--help') {
    usage(); process.exit(0);
  } else if (!file && !a.startsWith('-')) {
    file = a;
  } else {
    err('sid-dump: unknown argument: ' + a); usage(); process.exit(1);
  }
}
if (!file) { usage(); process.exit(1); }

// ---------------------------------------------------------------------------
// PSID header parsing
// ---------------------------------------------------------------------------
let buf;
try {
  buf = readFileSync(file);
} catch (e) {
  err('sid-dump: cannot read ' + file + ': ' + e.message);
  process.exit(1);
}
if (buf.length < 0x76) { err('sid-dump: file too short to be a .sid'); process.exit(1); }

const magic = buf.toString('latin1', 0, 4);
if (magic !== 'PSID' && magic !== 'RSID') {
  err('sid-dump: not a SID file (magic "' + magic + '")');
  process.exit(1);
}

const version     = buf.readUInt16BE(0x04);
const dataOffset  = buf.readUInt16BE(0x06);
let   loadAddress = buf.readUInt16BE(0x08);
let   initAddress = buf.readUInt16BE(0x0A);
const playAddress = buf.readUInt16BE(0x0C);
const songs       = buf.readUInt16BE(0x0E);
const startSong   = buf.readUInt16BE(0x10);
const name        = buf.toString('latin1', 0x16, 0x36).replace(/\0.*$/, '');
const author      = buf.toString('latin1', 0x36, 0x56).replace(/\0.*$/, '');
const released    = buf.toString('latin1', 0x56, 0x76).replace(/\0.*$/, '');
const flags       = version >= 2 && buf.length >= 0x78 ? buf.readUInt16BE(0x76) : 0;

if (magic === 'RSID') {
  err('sid-dump: RSID files require a full C64 environment (Kernal, CIA/VIC IRQs) - not supported');
  process.exit(2);
}
if (flags & 0x01) {
  err('sid-dump: MUS/Compute! Sidplayer data format not supported');
  process.exit(2);
}
if (playAddress === 0) {
  err('sid-dump: playAddress == 0 (tune installs its own IRQ handler) - not supported');
  process.exit(2);
}

// Data load
let data = buf.subarray(dataOffset);
if (loadAddress === 0) {
  if (data.length < 2) { err('sid-dump: missing embedded load address'); process.exit(1); }
  loadAddress = data[0] | (data[1] << 8);
  data = data.subarray(2);
}
if (initAddress === 0) initAddress = loadAddress; // per PSID spec
if (loadAddress + data.length > 0x10000) {
  err('sid-dump: data does not fit in 64KB (load ' + hex(loadAddress) + ', len ' + data.length + ')');
  process.exit(1);
}

const subtune = subtuneArg !== null ? subtuneArg : Math.max(0, startSong - 1);
if (subtune >= songs) {
  err(`sid-dump: subtune ${subtune} out of range (file has ${songs} song(s), 0-based 0..${songs - 1})`);
  process.exit(1);
}

err(`sid-dump: "${name}" by ${author} (${released})`);
err(`sid-dump: ${magic} v${version}, load=${hex(loadAddress)}-${hex(loadAddress + data.length - 1)}, init=${hex(initAddress)}, play=${hex(playAddress)}, songs=${songs}, subtune=${subtune}, frames=${frames}`);

// ---------------------------------------------------------------------------
// Machine: 64KB flat RAM + SID register shadow
// ---------------------------------------------------------------------------
const ram = new Uint8Array(0x10000);
const shadow = new Uint8Array(0x20);   // $D400-$D41F

ram.set(data, loadAddress);
ram[0x0000] = 0x2F; // 6510 data direction register
ram[0x0001] = 0x37; // default bank configuration

const cpu = new Cpu6502({
  read(addr) {
    addr &= 0xFFFF;
    if (addr === 0xD41B || addr === 0xD41C) return 0; // SID osc3/env3 readback
    if (addr === 0xD011 || addr === 0xD012) return 0; // VIC raster
    if (addr >= 0xDC04 && addr <= 0xDC07) return 0;   // CIA1 timer A/B
    return ram[addr];
  },
  write(addr, val) {
    addr &= 0xFFFF;
    val &= 0xFF;
    ram[addr] = val;
    if (addr >= 0xD400 && addr <= 0xD41F) shadow[addr - 0xD400] = val;
  },
  warn: err,
});

// Call a routine like JSR: fake return address on the stack, run until the
// CPU returns to the sentinel or the instruction budget is exhausted.
const SENTINEL = 0xFFFF;
function callRoutine(addr, aVal, budget, label) {
  cpu.a = aVal & 0xFF;
  cpu.x = 0;
  cpu.y = 0;
  cpu.p = 0x24;   // I set, U set
  cpu.s = 0xFF;
  cpu.halted = false;
  const ret = (SENTINEL - 1) & 0xFFFF;  // RTS pops this and adds 1 -> SENTINEL
  cpu.push(ret >> 8);
  cpu.push(ret & 0xFF);
  cpu.pc = addr;

  let n = 0;
  while (cpu.pc !== SENTINEL && !cpu.halted) {
    cpu.step();
    if (++n >= budget) {
      err(`sid-dump: ${label}: instruction budget ${budget} exceeded (pc=${hex(cpu.pc)}) - continuing anyway`);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Run: init once, then one play call per frame
// ---------------------------------------------------------------------------
const out = [];
out.push(JSON.stringify({ source: 'sid', song: basename(file), subtune }));

if (!callRoutine(initAddress, subtune, INIT_BUDGET, `init(${hex(initAddress)})`)) {
  err('sid-dump: warning: init routine did not return cleanly');
}

for (let f = 0; f < frames; f++) {
  callRoutine(playAddress, 0, PLAY_BUDGET, `play(${hex(playAddress)}) frame ${f}`);
  out.push(JSON.stringify({ f, regs: Array.from(shadow.subarray(0, 25)) }));
  // Flush in chunks to keep memory bounded on huge frame counts
  if (out.length >= 1000) { process.stdout.write(out.join('\n') + '\n'); out.length = 0; }
}
if (out.length) process.stdout.write(out.join('\n') + '\n');
err('sid-dump: done (' + frames + ' frames)');
