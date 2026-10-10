// Every firmware in web/firmwares.json still downloads and unpacks:  node web/check_firmwares.mjs
import { readFileSync } from "node:fs";
const { appFromPackage, fetchPackage } = await import(new URL("./fwsc.js", import.meta.url));
const cat = JSON.parse(readFileSync(new URL("./firmwares.json", import.meta.url)));
let bad = 0;
for (const f of cat.firmwares) {
  try {
    const { bytes, url } = await fetchPackage(f);
    const app = appFromPackage(bytes);
    const moved = url === f.package ? "" : `  (moved on: ${url})`;
    console.log(`${f.id.padEnd(13)} ${String(app.length).padStart(7)} bytes${moved}`);
  } catch (e) {
    bad++;
    console.log(`${f.id.padEnd(13)} FAILED ${e.message}`);
  }
}
process.exit(bad ? 1 : 0);
