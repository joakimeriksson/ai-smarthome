"""SVZ container: the chunked wrapper around ZEN-Core records.

This module knows nothing about what a tone *means* - it only reads and
writes the container, preserving every byte it does not understand. See
docs/FORMAT.md for the layout and for which fields are verified vs guessed.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

MAGIC = b"SVZa"
FILE_HDR = 16
DIR_ENTRY = struct.Struct("<8sII")
CHUNK_HDR = struct.Struct("<IIII")
VAR_ENTRY = struct.Struct("<IIII")

#: Chunk kinds whose records begin with a 16-byte ASCII name.
NAMED_CHUNKS = ("PAT", "MDL")


class SvzError(Exception):
    """Raised when a file violates a documented format invariant."""


@dataclass
class Chunk:
    """One ``xxxaZCOR`` chunk.

    ``records`` holds raw record bytes. CRCs are never stored - they are
    recomputed on write, so mutating a record can never desync a checksum.
    """

    id: str
    flags: int = 0
    variable: bool = False
    records: list[bytes] = field(default_factory=list)
    #: variable chunks only: per-record ``(index, meta)``, carried verbatim.
    var_meta: list[tuple[int, int]] = field(default_factory=list)

    @property
    def kind(self) -> str:
        """Three-letter kind, e.g. ``PAT``."""
        return self.id[:3]

    @property
    def record_size(self) -> int:
        if self.variable:
            return 0
        return len(self.records[0]) if self.records else 0

    @property
    def named(self) -> bool:
        return self.kind in NAMED_CHUNKS

    def crcs(self) -> list[int]:
        return [zlib.crc32(r) & 0xFFFFFFFF for r in self.records]


@dataclass
class Svz:
    """A parsed .svz file."""

    version: bytes = b"\x02\x02"
    product: bytes = b"KY019$"
    pad: bytes = b"\x00\x00\x00\x00"
    chunks: list[Chunk] = field(default_factory=list)

    def chunk(self, kind: str) -> Chunk | None:
        """First chunk of the given three-letter kind, or None."""
        return next((c for c in self.chunks if c.kind == kind), None)

    def require(self, kind: str) -> Chunk:
        chunk = self.chunk(kind)
        if chunk is None:
            raise SvzError(f"file has no {kind} chunk")
        return chunk

    @property
    def product_name(self) -> str:
        return self.product.decode("ascii", "replace").rstrip("\x00")


# ---------------------------------------------------------------------------
# read
# ---------------------------------------------------------------------------

def parse(data: bytes) -> Svz:
    """Parse .svz bytes. Raises SvzError on any invariant violation."""
    if data[:4] != MAGIC:
        raise SvzError(f"not an SVZ file (magic {data[:4]!r})")

    svz = Svz(version=data[4:6], product=data[6:12], pad=data[12:16])

    # The directory has no count field; it ends where the first chunk begins.
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
            raise SvzError(f"{cid}: truncated (want {clen} bytes, got {len(raw)})")
        svz.chunks.append(_parse_chunk(cid, raw))
    return svz


def _parse_chunk(cid: str, raw: bytes) -> Chunk:
    count, rec_size, hdr_size, flags = CHUNK_HDR.unpack_from(raw, 0)
    chunk = Chunk(id=cid, flags=flags, variable=(rec_size == 0))

    if not chunk.variable:
        if hdr_size != 16 + 4 * count:
            raise SvzError(
                f"{cid}: headerSize {hdr_size} != 16 + 4*{count}; layout not understood"
            )
        if hdr_size + count * rec_size != len(raw):
            raise SvzError(
                f"{cid}: {count} x {rec_size} + {hdr_size} != chunk length {len(raw)}"
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
        raise SvzError(
            f"{cid}: variable headerSize {hdr_size} != 16 + 16*{count}; layout not understood"
        )
    for i in range(count):
        idx, off, length, meta = VAR_ENTRY.unpack_from(raw, 16 + i * VAR_ENTRY.size)
        # `meta` is NOT a CRC-32 - verified against real sample data. Opaque.
        chunk.var_meta.append((idx, meta))
        chunk.records.append(raw[off : off + length])
    return chunk


def read_file(path) -> Svz:
    with open(path, "rb") as fh:
        return parse(fh.read())


# ---------------------------------------------------------------------------
# write
# ---------------------------------------------------------------------------

def build(svz: Svz) -> bytes:
    """Serialise. Directory offsets and all CRCs are regenerated."""
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
        out += struct.pack(f"<{count}I", *chunk.crcs())
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


def write_file(svz: Svz, path) -> None:
    with open(path, "wb") as fh:
        fh.write(build(svz))
