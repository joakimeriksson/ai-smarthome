// Extract app.bin from an FM-1 .fwsc update package (web/fwsc.js does the work).
//   node tools/fwsc_extract.mjs PACKAGE.fwsc OUT.bin
import { readFileSync, writeFileSync } from "node:fs";
const { appFromPackage } = await import(new URL("../web/fwsc.js", import.meta.url));
const [, , src, dst] = process.argv;
const app = appFromPackage(new Uint8Array(readFileSync(src)));
writeFileSync(dst, app);
console.log(`${src}: app.bin ${app.length} bytes -> ${dst}`);
