"""Lossless .svz <-> JSON conversion.

Named parameters are emitted for chunks that have a schema; everything else
falls back to hex, and large variable-length records go to sidecar .bin files
so the JSON stays readable. Round-tripping any file must reproduce it byte for
byte - tests/test_roundtrip.py enforces this.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from .container import Chunk, Svz, SvzError, read_file, write_file
from .schema import Schema

FORMAT_TAG = "svz-json/1"


def export(src, outdir, schema: Schema | None = None) -> dict:
    svz = read_file(src)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    doc = {
        "format": FORMAT_TAG,
        "source": os.path.basename(str(src)),
        "version": list(svz.version),
        "product": svz.product.hex(),
        "pad": list(svz.pad),
        "schema": bool(schema),
        "chunks": [],
    }

    for chunk in svz.chunks:
        entry: dict = {"id": chunk.id, "flags": chunk.flags, "variable": chunk.variable}

        if chunk.variable:
            (outdir / "blobs").mkdir(exist_ok=True)
            entry["records"] = []
            for i, rec in enumerate(chunk.records):
                rel = f"blobs/{chunk.kind}_{i:04d}.bin"
                (outdir / rel).write_bytes(rec)
                idx, meta = chunk.var_meta[i]
                entry["records"].append({"file": rel, "index": idx, "meta": meta})
        elif schema and chunk.named and chunk.record_size >= schema.span:
            entry["encoding"] = "params"
            entry["record_size"] = chunk.record_size
            entry["records"] = [schema.to_dict(r) for r in chunk.records]
        else:
            entry["encoding"] = "hex"
            entry["records"] = [r.hex() for r in chunk.records]

        doc["chunks"].append(entry)

    (outdir / "svz.json").write_text(json.dumps(doc, indent=2))
    return doc


def load(outdir, schema: Schema | None = None) -> Svz:
    outdir = Path(outdir)
    doc = json.loads((outdir / "svz.json").read_text())
    if doc.get("format") != FORMAT_TAG:
        raise SvzError(f"unexpected format tag {doc.get('format')!r}")
    if doc.get("schema") and schema is None:
        schema = Schema.load()

    svz = Svz(
        version=bytes(doc["version"]),
        product=bytes.fromhex(doc["product"]),
        pad=bytes(doc["pad"]),
    )
    for entry in doc["chunks"]:
        chunk = Chunk(id=entry["id"], flags=entry["flags"], variable=entry["variable"])
        for rec in entry["records"]:
            if entry["variable"]:
                chunk.records.append((outdir / rec["file"]).read_bytes())
                chunk.var_meta.append((rec["index"], rec["meta"]))
            elif entry.get("encoding") == "params":
                if schema is None:
                    raise SvzError("export used a schema but none was supplied")
                chunk.records.append(schema.from_dict(rec, entry["record_size"]))
            else:
                chunk.records.append(bytes.fromhex(rec))
        svz.chunks.append(chunk)
    return svz


def build_from(outdir, dest, schema: Schema | None = None) -> None:
    write_file(load(outdir, schema), dest)
