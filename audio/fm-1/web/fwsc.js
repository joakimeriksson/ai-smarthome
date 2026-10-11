// The app inside an FM-1 update package (.fwsc), for the browser and Node.
//
//   import { appFromPackage } from "./fwsc.js";
//   const app = appFromPackage(new Uint8Array(bytes));   // the app.bin the FM-1 runs from 0x02000120
//
// The format (JieLi's UFW/JLFS, as M-VAVE's updater and the community installers use it):
//   * the file starts with 20 blocks of 0x30 bytes; their first 0x2F bytes, concatenated, are
//     the UFW header (0x40 bytes, then 0x50 per entry), each scrambled with `unmask` (a
//     CRC-16/CCITT keystream from 0xFFFF). Entry type 0 is the flash image: data offset +12,
//     size +16 (offsets count the concatenated header, so + 20 skipped bytes in the file).
//   * the flash image is a JLFS directory of 32-byte heads, each unmasked on its own: offset +4,
//     size +8, flags +12, last +14, name +16. `isd_config.ini` holds the chip key;
//     `app_dir_head` (flags 0x81) starts the app area.
//   * the app area is scrambled per 32 bytes with the chip key xor (position / 4); its directory
//     lists `app.bin` (flags 0x82) relative to the area.
// Written for the emulator's web page; on 2026-10-10 it gave byte for byte the apps Felucca's
// own package code (web/fm1pkg.js, GPL-3.0, not used here) extracts, for every package in
// web/firmwares.json.

function unmask(buf, off, len, key = 0xffff) {
  for (let i = 0; i < len; i++) {
    buf[off + i] ^= key & 0xff;
    key = ((key << 1) ^ (key & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
}

function crc16(buf, off, len) {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc ^= buf[off + i] << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const name = (b, o, n) => {
  let s = "";
  for (let i = 0; i < n && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
  return s;
};
const head = (b, o) => ({ offset: u32(b, o + 4), size: u32(b, o + 8), flags: b[o + 12], last: u16(b, o + 14), name: name(b, o + 16, 16) });

// the 16-bit key the app area is scrambled with, from isd_config.ini's 32-byte blob
function chipKey(blob) {
  let sum = 0;
  for (let i = 0; i < 16; i++) sum += blob[i];
  sum &= 0xff;
  if (sum >= 0xe0) sum = 0xaa;
  else if (sum <= 0x10) sum = 0x55;
  let key = 0;
  for (let i = 0; i < 16; i++) if ((blob[16 + i] ^ blob[15 - i]) < sum) key |= 1 << i;
  return key;
}

function unscrambleArea(buf, from, len, base, key) {
  for (let i = 0; i < len; i += 32) unmask(buf, from + i, Math.min(32, len - i), key ^ ((from + i - base) >> 2));
}

export function appFromPackage(file) {
  // the UFW header, then its flash-image entry
  const hdr = new Uint8Array(20 * 0x2f);
  for (let i = 0; i < 20; i++) hdr.set(file.subarray(i * 0x30, i * 0x30 + 0x2f), i * 0x2f);
  unmask(hdr, 0, 0x40);
  if (crc16(hdr, 2, 0x3e) !== u16(hdr, 0)) throw new Error("not an FM-1 update package (.fwsc)");
  const entries = u16(hdr, 8);
  let flash = null;
  for (let k = 0; k < entries; k++) {
    const e = hdr.slice(0x40 + k * 0x50, 0x90 + k * 0x50);
    unmask(e, 0, 0x50);
    if (u16(e, 0) === 0) {
      const at = u32(e, 8) + 20 * (0x30 - 0x2f);
      flash = file.slice(at, at + u32(e, 12));
    }
  }
  if (!flash) throw new Error("no flash image in the package");

  // the JLFS directory: the chip key and where the app area starts
  unmask(flash, 0, 32);
  let key = null, area = null;
  for (let o = 32; o + 32 <= flash.length; o += 32) {
    unmask(flash, o, 32);
    const h = head(flash, o);
    if (h.name === "isd_config.ini" && crc16(flash, h.offset, 32) === u16(flash, h.offset + 32))
      key = chipKey(flash.subarray(h.offset, h.offset + 32));
    if (h.name === "app_dir_head" && h.flags === 0x81 && area === null) area = h.offset;
    if (h.last) break;
  }
  if (key === null || area === null) throw new Error("no chip key or app area in the flash image");

  // the app area: its head gives its size; unscramble it, then find app.bin
  const first = ((area + 32 + 31) & ~31) - area;
  unscrambleArea(flash, area, first, area, key);
  const size = head(flash, area).size;
  if (size > first) unscrambleArea(flash, area + first, size - first, area, key);
  for (let o = area + 32; o + 32 <= area + size; o += 32) {
    const h = head(flash, o);
    if (h.name === "app.bin" && h.flags === 0x82) {
      let end = h.size;
      while (end > 0 && flash[area + h.offset + end - 1] === 0xff) end--;   // the slot's padding
      return flash.slice(area + h.offset, area + h.offset + end);
    }
    if (h.last) break;
  }
  throw new Error("no app.bin in the app area");
}

// Fetch a catalog entry's package (web/firmwares.json): its `package` URL, or when that has
// gone (a newer version replaced it) the .fwsc its `installer` page links now, found in the
// page or the scripts it loads. Returns { bytes, url }. `fetchFn` is fetch (browser, Node 18+).
export async function fetchPackage(entry, fetchFn = fetch) {
  let r = await fetchFn(entry.package);
  if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), url: entry.package };
  if (!entry.installer) throw new Error(`${entry.package}: ${r.status}`);
  const find = (text) => [...text.matchAll(/[\w./-]+\.fwsc/g)].map((m) => m[0]).filter((n) => !/(^|\/)FM-1\.fwsc$/i.test(n));
  const page = await (await fetchFn(entry.installer)).text();
  let names = find(page), base = entry.installer;
  if (!names.length) {
    for (const src of [...page.matchAll(/src="([^"]+\.m?js)"/g)].map((m) => new URL(m[1], entry.installer).href)) {
      names = find(await (await fetchFn(src)).text());
      if (names.length) { base = src; break; }
    }
  }
  for (const n of names) {
    const url = new URL(n, base).href;
    r = await fetchFn(url);
    if (r.ok) return { bytes: new Uint8Array(await r.arrayBuffer()), url };
  }
  throw new Error(`${entry.package}: ${r.status}, and ${entry.installer} names no package that loads`);
}
