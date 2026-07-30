#!/usr/bin/env python3
"""
svz.py - Roland ZEN-Core .svz reader/writer with lossless JSON round-trip.

Verified against SVZa v2.2 (KY019$), v3.3 (RC001), v5.4 (KY019$) files and
chunk types DIF / PAT / MDL / USP / MSP / USD. Nothing in the container is
compressed, encrypted or obfuscated.

  FILE
    0x00  char magic[4]     "SVZa"
    0x04  u8   version[2]
    0x06  char product[6]   "KY019$", "RC001\x01", ...
    0x0C  u8   pad[4]
    0x10  DirEntry[] { char id[8]; u32 offset; u32 length; }
          The directory ends where the first chunk begins.

  CHUNK, fixed-size records (DIF, PAT, MDL, USP, MSP)
    u32 count; u32 recordSize; u32 headerSize; u32 flags;
    u32 crc32[count]        <- zlib.crc32 of each record, recomputed on write
    record[count]
    Invariant: headerSize == 16 + 4*count  and  headerSize + count*recordSize == length

  CHUNK, variable-size records (USD, the raw sample payload)
    u32 count; u32 recordSize(==0); u32 headerSize; u32 flags;
    Entry[count] { u32 index; u32 offset; u32 length; u32 meta; }
    Invariant: headerSize == 16 + 16*count
    `meta` is not a CRC-32 and is carried through verbatim.

  PAT / MDL RECORD
    char name[16] (ASCII, space padded) followed by parameters. Read the
    record size from the chunk header - it is 1632 for ZEN-Core tones (PAT)
    and 2048 for model data (MDL), and other models may differ.

All integers little-endian.

Parameter naming is optional and comes from a schema JSON of the shape
    { "GROUP": [ {"id":..., "desc":..., "pos":..., "size":..., "min":..., "max":...}, ... ] }
where `pos` is an absolute byte offset into the record (this is the layout
that falls out of Roland's own editor XML). Entries without an "id" are
padding and are preserved as reserved bytes so round-trips stay exact.

CLI
    python3 svz.py info   FILE.svz
    python3 svz.py dump   FILE.svz [-s zcformat.json] [-t N]
    python3 svz.py export FILE.svz -o OUTDIR [-s zcformat.json]
    python3 svz.py build  OUTDIR -o NEW.svz
    python3 svz.py verify FILE.svz [FILE.svz ...]
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import zlib
from dataclasses import dataclass, field

MAGIC = b"SVZa"
FILE_HDR = 16
DIR_ENTRY = struct.Struct("<8sII")
CHUNK_HDR = struct.Struct("<IIII")
VAR_ENTRY = struct.Struct("<IIII")
NAME_LEN = 16
NAMED_RECORD_CHUNKS = ("PAT", "MDL")


class SvzError(Exception):
    pass


# --------------------------------------------------------------------------
# container
# --------------------------------------------------------------------------

@dataclass
class Chunk:
    id: str
    flags: int = 0
    variable: bool = False
    records: list[bytes] = field(default_factory=list)
    # variable chunks only: per-record (index, meta) carried through verbatim
    var_meta: list[tuple[int, int]] = field(default_factory=list)

    @property
    def record_size(self) -> int:
        return 0 if self.variable else (len(self.records[0]) if self.records else 0)

    @property
    def kind(self) -> str:
        return self.id[:3]

    def has_names(self) -> bool:
        return self.kind in NAMED_RECORD_CHUNKS


@dataclass
class Svz:
    version: bytes = b"\x05\x04"
    product: bytes = b"KY019$"
    pad: bytes = b"\x00\x00\x00\x00"
    chunks: list[Chunk] = field(default_factory=list)

    def chunk(self, kind: str) -> Chunk | None:
        return next((c for c in self.chunks if c.kind == kind), None)


def parse(data: bytes) -> Svz:
    if data[:4] != MAGIC:
        raise SvzError(f"not an SVZ file (magic {data[:4]!r})")

    svz = Svz(version=data[4:6], product=data[6:12], pad=data[12:16])

    entries: list[tuple[str, int, int]] = []
    off, first = FILE_HDR, len(data)
    while off + DIR_ENTRY.size <= first:
        cid, coff, clen = DIR_ENTRY.unpack_from(data, off)
        if not cid.endswith(b"ZCOR"):
            break
        entries.append((cid.decode("ascii"), coff, clen))
        first = min(first, coff)
        off += DIR_ENTRY.size
    if not entries:
        raise SvzError("no ZCOR chunks in directory")

    for cid, coff, clen in entries:
        raw = data[coff : coff + clen]
        if len(raw) != clen:
            raise SvzError(f"{cid}: truncated (want {clen}, got {len(raw)})")
        svz.chunks.append(_parse_chunk(cid, raw))
    return svz


def _parse_chunk(cid: str, raw: bytes) -> Chunk:
    count, rec_size, hdr_size, flags = CHUNK_HDR.unpack_from(raw, 0)
    chunk = Chunk(id=cid, flags=flags, variable=(rec_size == 0))

    if not chunk.variable:
        if hdr_size != 16 + 4 * count or hdr_size + count * rec_size != len(raw):
            raise SvzError(
                f"{cid}: header math failed (count={count} recSize={rec_size} "
                f"hdrSize={hdr_size} len={len(raw)})"
            )
        crcs = struct.unpack_from(f"<{count}I", raw, 16)
        for i in range(count):
            rec = raw[hdr_size + i * rec_size : hdr_size + (i + 1) * rec_size]
            got = zlib.crc32(rec) & 0xFFFFFFFF
            if got != crcs[i]:
                raise SvzError(f"{cid} record {i}: CRC {got:08x} != stored {crcs[i]:08x}")
            chunk.records.append(rec)
        return chunk

    if hdr_size != 16 + VAR_ENTRY.size * count:
        raise SvzError(f"{cid}: variable header math failed ({hdr_size})")
    for i in range(count):
        idx, off, length, meta = VAR_ENTRY.unpack_from(raw, 16 + i * VAR_ENTRY.size)
        chunk.var_meta.append((idx, meta))
        chunk.records.append(raw[off : off + length])
    return chunk


def build(svz: Svz) -> bytes:
    bodies = [_build_chunk(c) for c in svz.chunks]
    out = bytearray(MAGIC + svz.version + svz.product + svz.pad)
    cursor = FILE_HDR + DIR_ENTRY.size * len(svz.chunks)
    for chunk, body in zip(svz.chunks, bodies):
        out += DIR_ENTRY.pack(chunk.id.encode("ascii"), cursor, len(body))
        cursor += len(body)
    for body in bodies:
        out += body
    return bytes(out)


def _build_chunk(chunk: Chunk) -> bytes:
    count = len(chunk.records)

    if not chunk.variable:
        sizes = {len(r) for r in chunk.records}
        if len(sizes) > 1:
            raise SvzError(f"{chunk.id}: mixed record sizes {sorted(sizes)}")
        rec_size = sizes.pop() if sizes else 0
        out = bytearray(CHUNK_HDR.pack(count, rec_size, 16 + 4 * count, chunk.flags))
        out += struct.pack(f"<{count}I", *(zlib.crc32(r) & 0xFFFFFFFF for r in chunk.records))
        for rec in chunk.records:
            out += rec
        return bytes(out)

    hdr_size = 16 + VAR_ENTRY.size * count
    out = bytearray(CHUNK_HDR.pack(count, 0, hdr_size, chunk.flags))
    table, payload, cursor = bytearray(), bytearray(), hdr_size
    for i, rec in enumerate(chunk.records):
        idx, meta = chunk.var_meta[i] if i < len(chunk.var_meta) else (i, 0)
        table += VAR_ENTRY.pack(idx, cursor, len(rec), meta)
        payload += rec
        cursor += len(rec)
    return bytes(out + table + payload)


def read_file(path: str) -> Svz:
    with open(path, "rb") as fh:
        return parse(fh.read())


def write_file(svz: Svz, path: str) -> None:
    with open(path, "wb") as fh:
        fh.write(build(svz))


# --------------------------------------------------------------------------
# parameter schema
# --------------------------------------------------------------------------

class Schema:
    """Absolute byte-map of a tone record, grouped by parameter block."""

    def __init__(self, doc: dict):
        self.groups: dict[str, list[dict]] = {
            k: v for k, v in doc.items() if isinstance(v, list)
        }
        self.span = max(
            (p["pos"] + p["size"] for ps in self.groups.values() for p in ps), default=0
        )
        self.covered: set[int] = set()
        for params in self.groups.values():
            for p in params:
                if p.get("id"):
                    self.covered.update(range(p["pos"], p["pos"] + p["size"]))

    @classmethod
    def load(cls, path: str) -> "Schema":
        with open(path) as fh:
            return cls(json.load(fh))

    @staticmethod
    def is_text(p: dict) -> bool:
        return p.get("id") == "NAME"

    @staticmethod
    def decode(rec: bytes, p: dict):
        raw = rec[p["pos"] : p["pos"] + p["size"]]
        if Schema.is_text(p):
            return raw.decode("ascii", "replace")
        # Anything wider than a scalar is an array (e.g. LFO_n_STEP is 16
        # signed bytes) - keep it as hex so it survives untouched.
        if p["size"] > 4:
            return raw.hex()
        val = int.from_bytes(raw, "little")
        if p.get("min", 0) < 0 and val >= 1 << (8 * p["size"] - 1):
            val -= 1 << (8 * p["size"])
        return val

    @staticmethod
    def encode(value, p: dict) -> bytes:
        size = p["size"]
        if Schema.is_text(p):
            return str(value).encode("ascii", "replace")[:size].ljust(size, b" ")
        if isinstance(value, str):
            return bytes.fromhex(value).ljust(size, b"\x00")[:size]
        return int(value).to_bytes(size, "little", signed=int(value) < 0)

    def to_dict(self, rec: bytes) -> dict:
        out: dict = {"groups": {}, "reserved": {}}
        for name, params in self.groups.items():
            block = {p["id"]: self.decode(rec, p) for p in params if p.get("id")}
            if block:
                out["groups"][name] = block
        for i, b in enumerate(rec):
            if i not in self.covered and b:
                out["reserved"][str(i)] = b
        return out

    def from_dict(self, doc: dict, size: int) -> bytes:
        rec = bytearray(size)
        # Parameter ids are only unique within a group (LEVEL, PAN and friends
        # repeat across partials), so resolve group-first.
        for group, block in doc.get("groups", {}).items():
            params = self.groups.get(group)
            if params is None:
                raise SvzError(f"unknown parameter group {group!r}")
            index = {p["id"]: p for p in params if p.get("id")}
            for pid, value in block.items():
                p = index.get(pid)
                if p is None:
                    raise SvzError(f"unknown parameter {group}.{pid}")
                rec[p["pos"] : p["pos"] + p["size"]] = self.encode(value, p)
        for off, val in doc.get("reserved", {}).items():
            rec[int(off)] = val
        return bytes(rec)


# --------------------------------------------------------------------------
# JSON export / import
# --------------------------------------------------------------------------

FORMAT_TAG = "svz-json/1"


def export(path: str, outdir: str, schema: Schema | None = None) -> dict:
    svz = read_file(path)
    os.makedirs(outdir, exist_ok=True)

    doc = {
        "format": FORMAT_TAG,
        "version": list(svz.version),
        "product": svz.product.hex(),
        "pad": list(svz.pad),
        "schema": bool(schema),
        "chunks": [],
    }

    for chunk in svz.chunks:
        entry: dict = {"id": chunk.id, "flags": chunk.flags, "variable": chunk.variable}

        if chunk.variable:
            os.makedirs(os.path.join(outdir, "blobs"), exist_ok=True)
            entry["records"] = []
            for i, rec in enumerate(chunk.records):
                rel = f"blobs/{chunk.kind}_{i:04d}.bin"
                with open(os.path.join(outdir, rel), "wb") as fh:
                    fh.write(rec)
                idx, meta = chunk.var_meta[i]
                entry["records"].append({"file": rel, "index": idx, "meta": meta})
        elif schema and chunk.has_names() and chunk.record_size >= schema.span:
            entry["encoding"] = "params"
            entry["records"] = [schema.to_dict(r) for r in chunk.records]
            entry["record_size"] = chunk.record_size
        else:
            entry["encoding"] = "hex"
            entry["records"] = [r.hex() for r in chunk.records]

        doc["chunks"].append(entry)

    with open(os.path.join(outdir, "svz.json"), "w") as fh:
        json.dump(doc, fh, indent=2)
    return doc


def load(outdir: str, schema: Schema | None = None) -> Svz:
    with open(os.path.join(outdir, "svz.json")) as fh:
        doc = json.load(fh)
    if doc.get("format") != FORMAT_TAG:
        raise SvzError(f"unexpected format {doc.get('format')!r}")
    if doc.get("schema") and schema is None:
        path = os.path.join(outdir, "schema.json")
        if not os.path.exists(path):
            raise SvzError("export used a schema; pass -s or place schema.json in the dir")
        schema = Schema.load(path)

    svz = Svz(
        version=bytes(doc["version"]),
        product=bytes.fromhex(doc["product"]),
        pad=bytes(doc["pad"]),
    )
    for entry in doc["chunks"]:
        chunk = Chunk(id=entry["id"], flags=entry["flags"], variable=entry["variable"])
        for rec in entry["records"]:
            if entry["variable"]:
                with open(os.path.join(outdir, rec["file"]), "rb") as fh:
                    chunk.records.append(fh.read())
                chunk.var_meta.append((rec["index"], rec["meta"]))
            elif entry.get("encoding") == "params":
                assert schema is not None
                chunk.records.append(schema.from_dict(rec, entry["record_size"]))
            else:
                chunk.records.append(bytes.fromhex(rec))
        svz.chunks.append(chunk)
    return svz


def tone_name(rec: bytes) -> str:
    return rec[:NAME_LEN].decode("ascii", "replace").rstrip()


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def cmd_info(args) -> int:
    svz = read_file(args.file)
    print(
        f"{os.path.basename(args.file)}: SVZa v{svz.version[0]}.{svz.version[1]} "
        f"product={svz.product.decode('ascii', 'replace').strip(chr(0))!r}"
    )
    for chunk in svz.chunks:
        kind = "variable" if chunk.variable else f"{chunk.record_size} B/rec"
        total = sum(len(r) for r in chunk.records)
        print(f"  {chunk.id}  {len(chunk.records):>4} rec  {kind:>12}  {total:>10} B")
        if chunk.has_names():
            for i, rec in enumerate(chunk.records):
                print(f"        [{i}] {tone_name(rec)}")
    return 0


def cmd_dump(args) -> int:
    svz = read_file(args.file)
    schema = Schema.load(args.schema) if args.schema else None
    pat = svz.chunk("PAT")
    if pat is None:
        print("no PAT chunk", file=sys.stderr)
        return 1
    rec = pat.records[args.tone]
    print(f"# {tone_name(rec)}  ({len(rec)} bytes)")
    if schema is None:
        print(rec.hex())
        return 0
    for name, params in schema.groups.items():
        named = [p for p in params if p.get("id")]
        if not named:
            continue
        print(f"\n[{name}]")
        for p in named:
            val = schema.decode(rec, p)
            desc = p.get("desc", "")
            print(f"  {p['id']:<16} @{p['pos']:<5} {val!r:<20} {desc}")
    return 0


def cmd_export(args) -> int:
    schema = Schema.load(args.schema) if args.schema else None
    doc = export(args.file, args.output, schema)
    if schema and args.schema:
        with open(args.schema) as src, open(os.path.join(args.output, "schema.json"), "w") as dst:
            dst.write(src.read())
    n = sum(len(c["records"]) for c in doc["chunks"])
    print(f"wrote {os.path.join(args.output, 'svz.json')} ({n} records)")
    return 0


def cmd_build(args) -> int:
    schema = Schema.load(args.schema) if args.schema else None
    write_file(load(args.input, schema), args.output)
    print(f"wrote {args.output} ({os.path.getsize(args.output)} bytes)")
    return 0


def cmd_verify(args) -> int:
    rc = 0
    for path in args.files:
        with open(path, "rb") as fh:
            original = fh.read()
        try:
            rebuilt = build(parse(original))
        except SvzError as exc:
            print(f"FAIL  {os.path.basename(path)}: {exc}")
            rc = 1
            continue
        if rebuilt == original:
            print(f"OK    {os.path.basename(path)}  {len(original)} bytes byte-identical")
        else:
            rc = 1
            where = next(
                (i for i, (a, b) in enumerate(zip(original, rebuilt)) if a != b), None
            )
            print(f"FAIL  {os.path.basename(path)}  first diff at 0x{where:x}")
    return rc


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Roland ZEN-Core .svz reader/writer")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("info", help="summarise a .svz")
    p.add_argument("file")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("dump", help="print one tone's named parameters")
    p.add_argument("file")
    p.add_argument("-s", "--schema", help="zcformat.json")
    p.add_argument("-t", "--tone", type=int, default=0)
    p.set_defaults(func=cmd_dump)

    p = sub.add_parser("export", help="explode a .svz to JSON (+ blobs)")
    p.add_argument("file")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("-s", "--schema", help="zcformat.json")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("build", help="rebuild a .svz from an export directory")
    p.add_argument("input")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("-s", "--schema", help="zcformat.json")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("verify", help="check parse->build is byte-identical")
    p.add_argument("files", nargs="+")
    p.set_defaults(func=cmd_verify)

    args = ap.parse_args(argv)
    try:
        return args.func(args)
    except SvzError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:  # piping into head/less
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        raise SystemExit(0)
