#!/usr/bin/env node
// sid-dump.js - "play" a PSID .sid file with a 6502 emulator and dump the
// SID register shadow ($D400-$D418) after each play call, one JSON line
// per frame. The machine lives in tools/lib/psid-capture.js (shared with
// the browser SID ripper); this file is just the CLI.
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
import { parsePsid, PsidRunner } from './lib/psid-capture.js';

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
// Load + parse
// ---------------------------------------------------------------------------
let buf;
try {
  buf = new Uint8Array(readFileSync(file));
} catch (e) {
  err('sid-dump: cannot read ' + file + ': ' + e.message);
  process.exit(1);
}

let psid;
try {
  psid = parsePsid(buf);
} catch (e) {
  err('sid-dump: ' + e.message);
  // Unsupported-but-valid SID files exit 2, garbage exits 1
  process.exit(/RSID|Sidplayer|playAddress/.test(e.message) ? 2 : 1);
}

const subtune = subtuneArg !== null ? subtuneArg : Math.max(0, psid.startSong - 1);
if (subtune >= psid.songs) {
  err(`sid-dump: subtune ${subtune} out of range (file has ${psid.songs} song(s), 0-based 0..${psid.songs - 1})`);
  process.exit(1);
}

err(`sid-dump: "${psid.name}" by ${psid.author} (${psid.released})`);
err(`sid-dump: ${psid.magic} v${psid.version}, load=${hex(psid.loadAddress)}-${hex(psid.loadAddress + psid.data.length - 1)}, init=${hex(psid.initAddress)}, play=${hex(psid.playAddress)}, songs=${psid.songs}, subtune=${subtune}, frames=${frames}`);

// ---------------------------------------------------------------------------
// Run: init once, then one play call per frame
// ---------------------------------------------------------------------------
const out = [];
out.push(JSON.stringify({ source: 'sid', song: basename(file), subtune }));

const runner = new PsidRunner(psid, { subtune, warn: (m) => err('sid-dump: ' + m) });
if (!runner.initClean) {
  err('sid-dump: warning: init routine did not return cleanly');
}

for (let f = 0; f < frames; f++) {
  const regs = runner.runFrame();
  out.push(JSON.stringify({ f, regs: Array.from(regs) }));
  // Flush in chunks to keep memory bounded on huge frame counts
  if (out.length >= 1000) { process.stdout.write(out.join('\n') + '\n'); out.length = 0; }
}
if (out.length) process.stdout.write(out.join('\n') + '\n');
err('sid-dump: done (' + frames + ' frames)');
