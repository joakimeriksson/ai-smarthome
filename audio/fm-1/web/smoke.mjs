// CI check of a built page (web/build.sh DIR): its wasm boots Felucca, fetched from its author's
// site, from the whole package like the page does, and makes audio frames and a screen.
//   node web/smoke.mjs [web/dist] [package.fwsc]   (a local package instead, e.g. M-VAVE's)
import { readFileSync } from "node:fs";
const dir = new URL(`${process.argv[2] || "web/dist"}/`, `file://${process.cwd()}/`);
const { fetchPackage } = await import(new URL("fwsc.js", dir));
const cat = JSON.parse(readFileSync(new URL("firmwares.json", dir)));
const local = process.argv[3];
const { bytes, url } = local ? { bytes: new Uint8Array(readFileSync(local)), url: local }
  : await fetchPackage(cat.firmwares.find((f) => f.id === "felucca"));
const { jitImports } = await import(new URL("jit.js", dir));
let x;
const { instance } = await WebAssembly.instantiate(readFileSync(new URL("fm1_web.wasm", dir)), { env: jitImports(() => x) });
x = instance.exports;
x.fm1_jit(1, 16);   // as the page runs it: hot code compiled
const p = x.fm1_alloc(bytes.length);
new Uint8Array(x.memory.buffer, p, bytes.length).set(bytes);
if (x.fm1_boot_fwsc(p, bytes.length, 0, 0, 100) !== 0) {
  console.error(`${url}: not an FM-1 update package`);
  process.exit(1);
}
const app = bytes;
let real = 0;
for (let n = 0; n < 3 * 44100; n += 128) real += x.fm1_render(128, 50_000_000);
const lcd = new Uint16Array(x.memory.buffer, x.fm1_lcd(), 240 * 240);
const lit = lcd.reduce((n, v) => n + (v ? 1 : 0), 0);
console.log(`${url}: ${app.length} bytes of package; 3 s -> ${real} audio frames, ${lit} lit pixels, halted ${x.fm1_halted()}`);
if (x.fm1_halted() || real < 2 * 44100 || lit < 1000) {
  console.error("smoke test FAILED");
  process.exit(1);
}
