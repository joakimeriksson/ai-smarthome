"""The compressed SVD image carried inside an ``EXTaZCOR`` chunk.

Zenology keeps its live user bank at::

    ~/Library/Application Support/Roland Cloud/ZENOLOGY/User.bin

which is an ordinary .svz whose single EXT record wraps a deflate-compressed
SVD image::

    EXT record
      [0:32]   sub-header: product tag + u32 uncompressed size
      [32:]    zlib stream, level 6
        SVDx image
          [0:32]        header {magic, hdrSize, recordSize, count, ...}
          [32:]         count slots of recordSize bytes, 16-byte name at +16

This module is deliberately separate from container.py, which must stay free
of any knowledge of what a chunk *means*.

Byte-exactness: ``zlib.compress(data, 6)`` reproduces Roland's stream exactly
on the capture in tests/data - verified, and asserted by the test suite. If a
future capture disagrees, the level is wrong for that file; do NOT relax the
round-trip test, record the new evidence instead.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass, field

from .container import SvzError

EXT_HDR = 32
SVD_MAGIC = b"SVDx"
#: {magic, hdrSize, recordSize, count}. The remaining 16 bytes of the header
#: are not decoded and are carried through as SvdImage.tail.
SVD_HDR = struct.Struct("<4sIII")

#: Deflate level Roland used. Verified byte-exact on the Zenology capture.
ZLIB_LEVEL = 6

#: A slot is 16 bytes of undecoded header followed by a complete 1632-byte PAT
#: tone record - the SAME record an exported .svz carries. Verified: the bytes
#: at [16:1648] of slots 2 and 3 of a real bank are byte-identical to those
#: tones as exported to .svz. That is also why the name appears at +16: it is
#: the tone record's own name field at offset 0.
TONE_OFFSET = 16
TONE_SIZE = 1632

#: The name is the tone record's, so it lives at TONE_OFFSET + 0.
NAME_OFFSET = TONE_OFFSET
NAME_LEN = 16


@dataclass
class SvdImage:
    """A flat array of fixed-size slots, e.g. 128 Zenology user tones."""

    #: Bytes 16..32 of the header, meaning unknown. Carried through verbatim.
    tail: bytes = b"\x00" * 16
    record_size: int = 0
    slots: list[bytes] = field(default_factory=list)

    @classmethod
    def unpack(cls, data: bytes) -> "SvdImage":
        if data[:4] != SVD_MAGIC:
            raise SvzError(f"not an SVD image: {data[:4]!r}")
        _magic, hdr_size, record_size, count = SVD_HDR.unpack_from(data)
        if hdr_size != EXT_HDR:
            raise SvzError(f"unexpected SVD header size {hdr_size}")
        want = hdr_size + count * record_size
        if want != len(data):
            raise SvzError(
                f"SVD size mismatch: {hdr_size} + {count}*{record_size} "
                f"= {want}, image is {len(data)}"
            )
        return cls(
            tail=data[16:hdr_size],
            record_size=record_size,
            slots=[
                data[hdr_size + i * record_size : hdr_size + (i + 1) * record_size]
                for i in range(count)
            ],
        )

    def pack(self) -> bytes:
        sizes = {len(s) for s in self.slots}
        if len(sizes) > 1:
            raise SvzError(f"slots have mixed sizes {sorted(sizes)}")
        size = sizes.pop() if sizes else self.record_size
        head = SVD_HDR.pack(SVD_MAGIC, EXT_HDR, size, len(self.slots))
        return head + self.tail + b"".join(self.slots)

    # -- slot names --------------------------------------------------------

    def name(self, index: int) -> str:
        raw = self.slots[index][NAME_OFFSET : NAME_OFFSET + NAME_LEN]
        return raw.decode("ascii", "replace").rstrip()

    def set_name(self, index: int, value: str) -> None:
        raw = str(value).encode("ascii", "replace")[:NAME_LEN].ljust(NAME_LEN, b" ")
        slot = bytearray(self.slots[index])
        slot[NAME_OFFSET : NAME_OFFSET + NAME_LEN] = raw
        self.slots[index] = bytes(slot)

    def names(self) -> list[str]:
        return [self.name(i) for i in range(len(self.slots))]

    # -- tone records ------------------------------------------------------

    def tone_bytes(self, index: int) -> bytes:
        """The raw 1632-byte PAT record inside a slot."""
        slot = self.slots[index]
        if len(slot) < TONE_OFFSET + TONE_SIZE:
            raise SvzError(
                f"slot {index} is {len(slot)} bytes, too small to hold a tone")
        return slot[TONE_OFFSET:TONE_OFFSET + TONE_SIZE]

    def set_tone_bytes(self, index: int, data: bytes) -> None:
        """Replace a slot's tone record, leaving the other 21520 bytes alone.

        The rest of the slot is undecoded and is preserved verbatim, in keeping
        with the project's rule about not touching what we do not understand.
        Note that whatever those bytes mean may relate to the tone, so a slot
        edited this way is NOT known to be coherent - see CLAUDE.md.
        """
        if len(data) != TONE_SIZE:
            raise SvzError(f"tone record must be {TONE_SIZE} bytes, got {len(data)}")
        slot = bytearray(self.slots[index])
        slot[TONE_OFFSET:TONE_OFFSET + TONE_SIZE] = data
        self.slots[index] = bytes(slot)

    def __len__(self) -> int:
        return len(self.slots)

    def __repr__(self) -> str:
        return f"<SvdImage {len(self.slots)} slots x {self.record_size}B>"


@dataclass
class ExtRecord:
    """One EXT record: a 32-byte sub-header plus a compressed SVD image."""

    #: Bytes 0..8 of the sub-header (product tag). Preserved verbatim.
    tag: bytes = b"RC001\x01\x00\x00"
    #: Bytes 12..32, zero in the capture. Preserved verbatim.
    tail: bytes = b"\x00" * 20
    image: SvdImage = field(default_factory=SvdImage)

    @classmethod
    def unpack(cls, record: bytes) -> "ExtRecord":
        if len(record) < EXT_HDR:
            raise SvzError(f"EXT record too short: {len(record)} bytes")
        size = struct.unpack_from("<I", record, 8)[0]
        raw = zlib.decompress(record[EXT_HDR:])
        if len(raw) != size:
            raise SvzError(
                f"EXT size field says {size}, decompressed {len(raw)}"
            )
        return cls(
            tag=record[:8],
            tail=record[12:EXT_HDR],
            image=SvdImage.unpack(raw),
        )

    def pack(self) -> bytes:
        raw = self.image.pack()
        return (
            self.tag
            + struct.pack("<I", len(raw))
            + self.tail
            + zlib.compress(raw, ZLIB_LEVEL)
        )


def unpack_ext(svz) -> ExtRecord:
    """Pull the SVD image out of an Svz that has an EXT chunk."""
    chunk = svz.require("EXT")
    if len(chunk.records) != 1:
        raise SvzError(f"expected 1 EXT record, found {len(chunk.records)}")
    return ExtRecord.unpack(chunk.records[0])


def pack_ext(svz, ext: ExtRecord) -> None:
    """Write an ExtRecord back into an Svz, in place.

    The chunk's ``meta`` is left alone - build() does not recompute it, and on
    the Zenology capture it equals crc32 of the record past the sub-header.
    Call ``refresh_meta`` if you have changed the image.
    """
    chunk = svz.require("EXT")
    chunk.records = [ext.pack()]


def refresh_meta(svz) -> None:
    """Recompute the variable-chunk ``meta`` for the EXT record.

    On the Zenology capture ``meta == zlib.crc32(record[32:])`` - i.e. a CRC of
    the compressed stream, excluding the sub-header. This is a NEW finding from
    exactly one file; the same field on USD sample records failed a whole-record
    CRC test, so treat the rule as provisional and product-specific.
    """
    chunk = svz.require("EXT")
    chunk.var_meta = [
        (index, zlib.crc32(rec[EXT_HDR:]) & 0xFFFFFFFF)
        for (index, _old), rec in zip(chunk.var_meta, chunk.records)
    ]
