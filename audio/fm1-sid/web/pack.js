// The tune pack the player firmware reads at the end of its image (firmware/main.c,
// tools/sidpack.py): "SIDPACK1", u32 count, u32 start (bits 0-15 the first entry, bit 16 the
// own model instead of reSID, bits 17-18 the chip: 0 the tune's, 1 6581, 2 8580), then per
// entry u32 offset (from the pack), length, song (0: the tune's start song); little-endian.
// SPDX-License-Identifier: BSD-2-Clause

export const XIP_PAD = 0x120;          // the raw boot maps the image at 0x02000000 + 0x120
export const APP_SLOT = 0x8dfbc;       // what the FM-1's app slot holds

// entries: [{ bytes: Uint8Array, song }]; the same Uint8Array is stored once
export function buildPack(entries, first = 0, flags = 0) {
  const head = 16 + 12 * entries.length;
  const where = new Map();
  let size = head;
  for (const e of entries) {
    if (!where.has(e.bytes)) {
      where.set(e.bytes, size);
      size += (e.bytes.length + 3) & ~3;
    }
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("SIDPACK1"), 0);
  dv.setUint32(8, entries.length, true);
  dv.setUint32(12, (first & 0xffff) | (flags << 16), true);
  entries.forEach((e, i) => {
    dv.setUint32(16 + 12 * i, where.get(e.bytes), true);
    dv.setUint32(20 + 12 * i, e.bytes.length, true);
    dv.setUint32(24 + 12 * i, e.song || 0, true);
  });
  for (const [bytes, off] of where) out.set(bytes, off);
  return out;
}

// the image the emulator boots: XIP pad + firmware (no pack) + pack
export function bootImage(base, pack) {
  if (base.length + pack.length > APP_SLOT) throw new Error("the tunes do not fit in the FM-1's app slot");
  const img = new Uint8Array(XIP_PAD + base.length + pack.length);
  img.set(base, XIP_PAD);
  img.set(pack, XIP_PAD + base.length);
  return img;
}

const latin1 = new TextDecoder("latin1");
const str = (b, o) => { const s = latin1.decode(b.subarray(o, o + 32)); const z = s.indexOf("\0"); return (z < 0 ? s : s.slice(0, z)).trim(); };

// a .sid file's header: { kind: "PSID" | "RSID", title, author, released, songs, start, model }
export function sidInfo(b) {
  if (b.length < 0x76) return null;
  const kind = latin1.decode(b.subarray(0, 4));
  if (kind !== "PSID" && kind !== "RSID") return null;
  const be = (o) => (b[o] << 8) | b[o + 1];
  const flags = be(4) >= 2 && b.length >= 0x7c ? be(0x76) : 0;
  return { kind, title: str(b, 0x16), author: str(b, 0x36), released: str(b, 0x56),
    songs: be(14), start: be(16), model: ((flags >> 4) & 3) === 2 ? "8580" : "6581" };
}
