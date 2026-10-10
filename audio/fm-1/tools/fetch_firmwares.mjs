// Fetch the firmwares in web/firmwares.json into reference/firmwares/ for fm1-live --fw:
// <id>.fwsc (the package as published), <id>.app.bin (its app) and <id>.xip.bin (the app behind
// 0x120 bytes of padding, loaded at 0x02000120). Same download and unpacking as the web page.
//   node tools/fetch_firmwares.mjs [id ...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { appFromPackage, fetchPackage } = await import(new URL("../web/fwsc.js", import.meta.url));
const root = new URL("..", import.meta.url).pathname;
const cat = JSON.parse(readFileSync(root + "web/firmwares.json"));
const want = new Set(process.argv.slice(2));
mkdirSync(root + "reference/firmwares", { recursive: true });
for (const f of cat.firmwares) {
  if (want.size && !want.has(f.id)) continue;
  try {
    const { bytes, url } = await fetchPackage(f);
    const app = appFromPackage(bytes);
    const out = root + "reference/firmwares/" + f.id;
    writeFileSync(out + ".fwsc", bytes);
    writeFileSync(out + ".app.bin", app);
    const xip = new Uint8Array(0x120 + app.length);
    xip.set(app, 0x120);
    writeFileSync(out + ".xip.bin", xip);
    console.log(`${f.id.padEnd(13)} ${url.split("/").pop().padEnd(36)} app ${app.length} bytes`);
  } catch (e) {
    console.log(`${f.id.padEnd(13)} FAILED ${e.message}`);
  }
}
