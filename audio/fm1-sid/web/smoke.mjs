// CI check of the built page (DIR = what Pages serves): its wasm boots the player firmware
// with a tune pack built the way the page builds it (the own tune, no network), makes sound
// and draws the screen.
//   node web/smoke.mjs [DIR]   (default: web/, with fm1_web.wasm copied in)
// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from "node:fs";
const dir = new URL(`${process.argv[2] || "web"}/`, `file://${process.cwd()}/`);
const { buildPack, bootImage, sidInfo } = await import(new URL("pack.js", dir));
const read = (f) => new Uint8Array(readFileSync(new URL(f, dir)));
const base = read("sidplayer.bin");
const house = read("house.sid");
const cat = JSON.parse(readFileSync(new URL("tunes.json", dir)));
const fail = (why) => { console.error(`smoke test FAILED: ${why}`); process.exit(1); };
if (!cat.picks?.length) fail("tunes.json has no picks");
if (sidInfo(house)?.kind !== "PSID") fail("house.sid is not a PSID file");
// two entries, the second first: the firmware has to find and start entry 1
const img = bootImage(base, buildPack([{ bytes: house, song: 0 }, { bytes: house, song: 1 }], 1, 0));
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("fm1_web.wasm", dir)), {});
const x = instance.exports;
const p = x.fm1_alloc(img.length);
new Uint8Array(x.memory.buffer, p, img.length).set(img);
x.fm1_boot(p, img.length, 0x02000120, 240);
let real = 0, sum = 0, n = 0;
for (let i = 0; i < 4 * 44100; i += 128) {
  real += x.fm1_render(128, 240e6 * 0.02);
  if (i > 44100) for (const v of new Float32Array(x.memory.buffer, x.fm1_out_l(), 128)) { sum += v * v; n++; }
}
const rms = Math.sqrt(sum / n);
const lcd = new Uint16Array(x.memory.buffer, x.fm1_lcd(), 240 * 240);
const colours = new Set(lcd).size;
console.log(`4 s -> ${real} audio frames, rms ${rms.toFixed(4)}, ${colours} colours on the LCD, halted ${x.fm1_halted()}`);
if (x.fm1_halted()) fail("the CPU halted");
if (real < 3 * 44100) fail("too few audio frames");
if (rms < 0.01) fail("silent (an fm1-core without the flags / carry decoding gives this)");
if (colours < 6) fail("the screen is not drawn");

// the synth mode (pack flag): silent until a key is down, then a note
{
  const img = bootImage(base, buildPack([{ bytes: house, song: 0 }], 0, 8));
  const { instance } = await WebAssembly.instantiate(readFileSync(new URL("fm1_web.wasm", dir)), {});
  const y = instance.exports;
  const q = y.fm1_alloc(img.length);
  new Uint8Array(y.memory.buffer, q, img.length).set(img);
  y.fm1_boot(q, img.length, 0x02000120, 240);
  const level = (secs) => {
    let s = 0, m = 0;
    for (let i = 0; i < secs * 44100; i += 128) {
      y.fm1_render(128, 240e6 * 0.02);
      for (const v of new Float32Array(y.memory.buffer, y.fm1_out_l(), 128)) { s += v * v; m++; }
    }
    return Math.sqrt(s / m);
  };
  const quiet = level(1);
  y.fm1_key(21, 1);                       // C4
  const note = level(0.6);
  y.fm1_key(21, 0);
  console.log(`synth: ${quiet.toFixed(4)} before a key, ${note.toFixed(4)} with C4 down`);
  if (quiet > 0.002 || note < 0.01) fail("the synth mode does not play the keys");
}
