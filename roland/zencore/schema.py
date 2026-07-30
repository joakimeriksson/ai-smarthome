"""Parameter schema for ZEN-Core tone records.

The schema is a JSON document extracted from Roland's own editor XML
(see tools/xml_to_schema.py). Shape::

    { "GROUP_NAME": [ {"id":.., "desc":.., "pos":.., "size":.., "min":.., "max":.., "init":..}, ... ] }

``pos`` is an ABSOLUTE byte offset into the tone record, not group-relative.
The groups tile the record contiguously; for a PCM tone the last group ends
at exactly 1632. Entries without an ``id`` are padding.

Parameter ids are only unique WITHIN a group (LEVEL, PAN and friends repeat
across partials), so every lookup must be group-scoped.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

NAME_ID = "NAME"

#: Search order for the schema file when none is given explicitly.
_CANDIDATES = (
    "zcformat.json",
    "../zcformat.json",
    "data/zcformat.json",
)


def find_schema_path(start: str | os.PathLike | None = None) -> Path:
    """Locate zcformat.json. Honours $ZENCORE_SCHEMA first."""
    env = os.environ.get("ZENCORE_SCHEMA")
    if env:
        return Path(env)
    roots = [Path(start) if start else Path.cwd(), Path(__file__).resolve().parent]
    for root in roots:
        for rel in _CANDIDATES:
            candidate = (root / rel).resolve()
            if candidate.is_file():
                return candidate
    raise FileNotFoundError(
        "zcformat.json not found; pass a path or set $ZENCORE_SCHEMA"
    )


class Param(dict):
    """One schema entry. A dict subclass so raw JSON stays usable."""

    @property
    def id(self) -> str | None:
        return self.get("id")

    @property
    def pos(self) -> int:
        return self["pos"]

    @property
    def size(self) -> int:
        return self["size"]

    @property
    def signed(self) -> bool:
        return self.get("min", 0) < 0

    @property
    def is_text(self) -> bool:
        return self.get("id") == NAME_ID

    @property
    def is_array(self) -> bool:
        """Wider than a scalar, e.g. LFO_n_STEP is 16 signed bytes."""
        return not self.is_text and self.size > 4

    @property
    def end(self) -> int:
        return self.pos + self.size

    @property
    def values(self) -> list[str] | None:
        """Enum labels from ``desc_val``, or None if this is not an enum.

        ``desc_val`` is used for two different things in Roland's XML: real
        enumerations ("OFF, LPF, BPF, ...") and prose ranges ("0 - 16383",
        "32 - 127 [ASCII]"). Only the first is usable, and the test for it is
        that the label count exactly covers min..max - anything else is prose
        or an incomplete list, and guessing would mislabel values.
        """
        raw = self.get("desc_val")
        lo, hi = self.get("min"), self.get("max")
        if not raw or lo is None or hi is None:
            return None
        labels = [s.strip() for s in raw.split(",")]
        if len(labels) < 2 or len(labels) != hi - lo + 1:
            return None
        return labels

    def label(self, value: int) -> str | None:
        """Human label for a value, or None when this parameter is not an enum."""
        labels = self.values
        if labels is None:
            return None
        index = value - self.get("min", 0)
        return labels[index] if 0 <= index < len(labels) else None


class Schema:
    """Absolute byte-map of a tone record."""

    def __init__(self, doc: dict):
        self.groups: dict[str, list[Param]] = {
            name: [Param(p) for p in params]
            for name, params in doc.items()
            if isinstance(params, list)
        }
        self._index: dict[str, dict[str, Param]] = {
            name: {p.id: p for p in params if p.id}
            for name, params in self.groups.items()
        }
        self.span = max(
            (p.end for params in self.groups.values() for p in params), default=0
        )
        self.named_bytes: set[int] = set()
        for params in self.groups.values():
            for p in params:
                if p.id:
                    self.named_bytes.update(range(p.pos, p.end))

    @classmethod
    def load(cls, path: str | os.PathLike | None = None) -> "Schema":
        path = Path(path) if path else find_schema_path()
        with open(path) as fh:
            return cls(json.load(fh))

    # -- lookup ------------------------------------------------------------

    def param(self, group: str, pid: str) -> Param:
        try:
            return self._index[group][pid]
        except KeyError:
            raise KeyError(f"no such parameter {group}.{pid}") from None

    def has(self, group: str, pid: str) -> bool:
        return pid in self._index.get(group, {})

    def iter_named(self):
        """Yield (group, Param) for every named parameter, in file order."""
        for group, params in self.groups.items():
            for p in params:
                if p.id:
                    yield group, p

    # -- codec -------------------------------------------------------------

    @staticmethod
    def decode(rec: bytes, p: Param):
        raw = rec[p.pos : p.end]
        if p.is_text:
            return raw.decode("ascii", "replace")
        if p.is_array:
            return raw.hex()
        val = int.from_bytes(raw, "little")
        if p.signed and val >= 1 << (8 * p.size - 1):
            val -= 1 << (8 * p.size)
        return val

    @staticmethod
    def encode(value, p: Param) -> bytes:
        if p.is_text:
            return str(value).encode("ascii", "replace")[: p.size].ljust(p.size, b" ")
        if isinstance(value, str):
            return bytes.fromhex(value).ljust(p.size, b"\x00")[: p.size]
        val = int(value)
        return val.to_bytes(p.size, "little", signed=val < 0)

    # -- whole-record conversion ------------------------------------------

    def to_dict(self, rec: bytes) -> dict:
        """Record -> {"groups": {...}, "reserved": {...}}, losslessly.

        ``reserved`` carries every non-zero byte no named parameter covers,
        so from_dict() can reproduce the record exactly.
        """
        out: dict = {"groups": {}, "reserved": {}}
        for group, params in self.groups.items():
            block = {p.id: self.decode(rec, p) for p in params if p.id}
            if block:
                out["groups"][group] = block
        for i, byte in enumerate(rec):
            if i not in self.named_bytes and byte:
                out["reserved"][str(i)] = byte
        return out

    def from_dict(self, doc: dict, size: int) -> bytes:
        rec = bytearray(size)
        for group, block in doc.get("groups", {}).items():
            if group not in self._index:
                raise KeyError(f"unknown parameter group {group!r}")
            for pid, value in block.items():
                p = self.param(group, pid)
                rec[p.pos : p.end] = self.encode(value, p)
        for off, val in doc.get("reserved", {}).items():
            rec[int(off)] = val
        return bytes(rec)

    # -- synthesis ---------------------------------------------------------

    def init_record(self, size: int | None = None) -> bytes:
        """Build a record from the schema's per-parameter ``init`` values.

        NOTE: this is synthesised, not captured from hardware. It parses and
        round-trips, but has never been loaded into a synth. See CLAUDE.md.
        """
        size = size or self.span
        rec = bytearray(size)
        for _group, p in self.iter_named():
            init = p.get("init", 0)
            if p.is_text:
                # `init` for NAME is a fill character code (32 = space).
                rec[p.pos : p.end] = bytes([init]) * p.size
            elif p.is_array:
                rec[p.pos : p.end] = bytes([init & 0xFF]) * p.size
            else:
                rec[p.pos : p.end] = self.encode(init, p)
        return bytes(rec)
