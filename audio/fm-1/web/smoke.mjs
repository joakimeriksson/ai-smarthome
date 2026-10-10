// CI check of a built page (web/build.sh DIR): its wasm boots Felucca, fetched from its author's
// site and unpacked like the page does, and makes audio frames and a screen.
//   node web/smoke.mjs [web/dist]
import { readFileSync } from "node:fs";
const dir = new URL(`${process.argv[2] || "web/dist"}/`, `file://${process.cwd()}/`);
const { appFromPackage, fetchPackage } = await import(new URL("fwsc.js", dir));
const cat = JSON.parse(readFileSync(new URL("firmwares.json", dir)));
const fw = cat.firmwares.find((f) => f.id === "felucca");
const { bytes, url } = await fetchPackage(fw);
const app = appFromPackage(bytes);
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("fm1_web.wasm", dir)), {});
const x = instance.exports;
const p = x.fm1_alloc(0x120 + app.length);
new Uint8Array(x.memory.buffer, p, 0x120 + app.length).fill(0).set(app, 0x120);
x.fm1_boot(p, 0x120 + app.length, 0x02000120, 100);
let real = 0;
for (let n = 0; n < 3 * 44100; n += 128) real += x.fm1_render(128, 50_000_000);
const lcd = new Uint16Array(x.memory.buffer, x.fm1_lcd(), 240 * 240);
const lit = lcd.reduce((n, v) => n + (v ? 1 : 0), 0);
console.log(`${url}: ${app.length} bytes; 3 s -> ${real} audio frames, ${lit} lit pixels, halted ${x.fm1_halted()}`);
if (x.fm1_halted() || real < 2 * 44100 || lit < 1000) {
  console.error("smoke test FAILED");
  process.exit(1);
}
