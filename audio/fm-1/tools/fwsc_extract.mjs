// Extract app.bin from an FM-1 .fwsc update package (the format M-VAVE's updater and the
// community web installers send), using Felucca's own package code (web/fm1pkg.js, GPL-3.0).
//   node tools/fwsc_extract.mjs PACKAGE.fwsc OUT.bin
import { readFileSync, writeFileSync } from "node:fs";
const { Package } = await import(new URL("../reference/Felucca/web/fm1pkg.js", import.meta.url));
const [, , src, dst] = process.argv;
const pkg = new Package(readFileSync(src));
if (!pkg.app) { pkg.parseUfw?.(); pkg.parseFlash?.(); }
let app = pkg.dec.slice(pkg.appOff, pkg.appOff + pkg.app.size);
let end = app.length;
while (end > 0 && app[end - 1] === 0xff) end--;     // the slot is padded with 0xFF
app = app.slice(0, end);
writeFileSync(dst, app);
console.log(`${src}: product ${JSON.stringify(pkg.product)}, app.bin ${app.length} bytes (slot ${pkg.app.size}) -> ${dst}`);
