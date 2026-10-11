// Speed of the WebAssembly build: [FM1_FW=image.xip.bin] node web/bench.mjs [mhz] [seconds] [out.raw]
import { readFileSync } from "node:fs";
const mhz = +(process.argv[2] || 120), secs = +(process.argv[3] || 6);
const wasm = readFileSync(new URL("../target/wasm/wasm32-unknown-unknown/release/fm1_web.wasm", import.meta.url));
const { instance } = await WebAssembly.instantiate(wasm, {});
const x = instance.exports;
const fw = readFileSync(process.env.FM1_FW || new URL("../work/felucca_xip.bin", import.meta.url));
const p = x.fm1_alloc(fw.length);
new Uint8Array(x.memory.buffer, p, fw.length).set(fw);
x.fm1_boot(p, fw.length, 0x02000120, mhz);
const out = process.argv[4] ? [] : null;   // optional: the real audio as i16 L/R to this file
const t0 = performance.now();
let frames = 0, real = 0;
while (frames < secs * 44100) {
  const have = x.fm1_render(128, 50_000_000);
  if (out && have) {
    const l = new Float32Array(x.memory.buffer, x.fm1_out_l(), have), r = new Float32Array(x.memory.buffer, x.fm1_out_r(), have);
    for (let i = 0; i < have; i++) out.push(Math.round(l[i] * 32768), Math.round(r[i] * 32768));
  }
  real += have;
  frames += 128;
  if (x.fm1_halted()) { console.log("halted at", x.fm1_ms(), "ms"); break; }
}
const wall = (performance.now() - t0) / 1000;
if (out) (await import("node:fs")).writeFileSync(process.argv[4], Buffer.from(new Int16Array(out).buffer));
const minsns = x.fm1_minsns();
console.log(`${secs} s of audio at ${mhz} MHz in ${wall.toFixed(2)} s: ${(secs / wall).toFixed(2)}x real time, ` +
  `${(minsns / wall).toFixed(0)} M instructions/s (emulated ${x.fm1_ms()} ms, ${real} real frames)`);
