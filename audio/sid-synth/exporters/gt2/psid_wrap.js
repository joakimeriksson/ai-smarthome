#!/usr/bin/env node
// Wrap a C64 PRG into a PSID v2NG file
// Usage:
//  node psid_wrap.js <in.prg> [--init 0x1000] [--play 0x1003] [--name "Title"] [--author "Author"] [--out out.sid]

const fs = require('fs');

function parseHexOrDec(s, def) {
  if (!s) return def;
  if (typeof s === 'number') return s;
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
  return parseInt(s, 10);
}

function makePSID({ loadAddr, initAddr, playAddr, name, author, released, data }) {
  // PSID v2NG header is 124 bytes (0x7C)
  const header = Buffer.alloc(124, 0);
  let p = 0;
  header.write('PSID', p, 4, 'ascii'); p += 4;
  header.writeUInt16BE(0x0002, p); p += 2;              // version 2NG
  header.writeUInt16BE(0x007C, p); p += 2;              // data offset
  header.writeUInt16BE(loadAddr || 0, p); p += 2;       // load address (0 => use first 2 bytes)
  header.writeUInt16BE(initAddr & 0xFFFF, p); p += 2;   // init address
  header.writeUInt16BE(playAddr & 0xFFFF, p); p += 2;   // play address
  header.writeUInt16BE(1, p); p += 2;                   // songs
  header.writeUInt16BE(1, p); p += 2;                   // start song
  header.writeUInt32BE(0x00000000, p); p += 4;          // speed (0 => 50 Hz)

  function writePadded(str, len) {
    const b = Buffer.from((str || '').slice(0, len - 1), 'ascii');
    const out = Buffer.alloc(len, 0);
    b.copy(out, 0);
    return out;
  }

  writePadded(name || 'SID Track', 32).copy(header, p); p += 32;
  writePadded(author || 'Unknown', 32).copy(header, p); p += 32;
  writePadded(released || new Date().getFullYear().toString(), 32).copy(header, p); p += 32;

  // Flags (2 bytes) + reserved (2 bytes) — keep zero for v2NG basic
  header.writeUInt16BE(0x0000, p); p += 2; // flags
  header.writeUInt16BE(0x0000, p); p += 2; // reserved

  return Buffer.concat([header, data]);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node psid_wrap.js <in.prg> [--init 0x1000] [--play 0x1003] [--name "Title"] [--author "Author"] [--out out.sid]');
    process.exit(1);
  }
  const inFile = args[0];
  const getArg = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const init = parseHexOrDec(getArg('--init'), 0x1000);
  const play = parseHexOrDec(getArg('--play'), 0x1003);
  const name = getArg('--name') || 'SID Export';
  const author = getArg('--author') || 'sid-synth';
  const out = getArg('--out') || (inFile.replace(/\.[^/.]+$/, '') + '.sid');

  const prg = fs.readFileSync(inFile);
  if (prg.length < 2) {
    console.error('Invalid PRG: too short');
    process.exit(1);
  }

  // Keep the PRG’s own two-byte load address in the data, and set PSID load=0.
  const sid = makePSID({ loadAddr: 0, initAddr: init, playAddr: play, name, author, data: prg });
  fs.writeFileSync(out, sid);
  console.log(`Wrote ${out} (${sid.length} bytes)`);
}

main();

