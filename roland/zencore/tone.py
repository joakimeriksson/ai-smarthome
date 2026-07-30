"""High-level tone and file objects - the API an editor UI should talk to.

    from zencore import ToneFile

    tf = ToneFile.open("User.svz")          # load
    tf.tones[0].name = "My Patch"           # modify
    tf.tones[0].set("PCMT_CMN", "LEVEL", 100)
    tf.save("out.svz")                      # save

    blank = ToneFile.create(tones=4)        # create
"""

from __future__ import annotations

import copy
from pathlib import Path

from .container import Chunk, Svz, SvzError, build, parse, read_file, write_file
from .schema import Schema

NAME_LEN = 16

#: Record size of a ZEN-Core PCM tone. Observed on every PAT chunk so far,
#: but ALWAYS prefer the value in the chunk header - other models differ.
PCM_TONE_SIZE = 1632

#: Shape of a minimal Zenology-style export, taken from a real file.
DEFAULT_VERSION = b"\x02\x02"
DEFAULT_PRODUCT = b"KY019$"
DIF_RECORD_SIZE = 32


class Tone:
    """One PAT record with named parameter access."""

    def __init__(self, data: bytes, schema: Schema | None = None):
        self._data = bytearray(data)
        self.schema = schema

    # -- raw ---------------------------------------------------------------

    @property
    def data(self) -> bytes:
        return bytes(self._data)

    def __len__(self) -> int:
        return len(self._data)

    def copy(self) -> "Tone":
        return Tone(self.data, self.schema)

    # -- name --------------------------------------------------------------

    @property
    def name(self) -> str:
        return self._data[:NAME_LEN].decode("ascii", "replace").rstrip()

    @name.setter
    def name(self, value: str) -> None:
        raw = str(value).encode("ascii", "replace")[:NAME_LEN].ljust(NAME_LEN, b" ")
        self._data[:NAME_LEN] = raw

    # -- parameters --------------------------------------------------------

    def _schema(self) -> Schema:
        if self.schema is None:
            raise SvzError("this Tone has no schema; construct it with one")
        return self.schema

    def get(self, group: str, pid: str):
        return self._schema().decode(self.data, self._schema().param(group, pid))

    def set(self, group: str, pid: str, value) -> None:
        p = self._schema().param(group, pid)
        self._data[p.pos : p.end] = self._schema().encode(value, p)

    def __getitem__(self, key: tuple[str, str]):
        return self.get(*key)

    def __setitem__(self, key: tuple[str, str], value) -> None:
        self.set(*key, value)

    # -- validation --------------------------------------------------------

    def out_of_range(self) -> list[tuple[str, str, object, int, int]]:
        """Named params whose stored value falls outside the schema's min/max.

        Informational, not fatal: real factory tones do contain values outside
        the documented range, so never reject a file on this alone.
        """
        bad = []
        schema = self._schema()
        for group, p in schema.iter_named():
            if p.is_text or p.is_array:
                continue
            val = schema.decode(self.data, p)
            lo, hi = p.get("min"), p.get("max")
            if lo is None or hi is None:
                continue
            if not (lo <= val <= hi):
                bad.append((group, p.id, val, lo, hi))
        return bad

    # -- dict conversion ---------------------------------------------------

    def to_dict(self) -> dict:
        return self._schema().to_dict(self.data)

    @classmethod
    def from_dict(cls, doc: dict, schema: Schema, size: int = PCM_TONE_SIZE) -> "Tone":
        return cls(schema.from_dict(doc, size), schema)

    @classmethod
    def init(cls, schema: Schema, size: int = PCM_TONE_SIZE, name: str = "Init Tone") -> "Tone":
        tone = cls(schema.init_record(size), schema)
        tone.name = name
        return tone

    def __repr__(self) -> str:
        return f"<Tone {self.name!r} {len(self._data)}B>"


class ToneFile:
    """A .svz file viewed as a list of tones, with everything else preserved."""

    def __init__(self, svz: Svz, schema: Schema | None = None):
        self.svz = svz
        self.schema = schema
        pat = svz.chunk("PAT")
        self.tones: list[Tone] = (
            [Tone(r, schema) for r in pat.records] if pat else []
        )

    # -- load / save -------------------------------------------------------

    @classmethod
    def open(cls, path, schema: Schema | None = None) -> "ToneFile":
        return cls(read_file(path), schema)

    @classmethod
    def loads(cls, data: bytes, schema: Schema | None = None) -> "ToneFile":
        return cls(parse(data), schema)

    def save(self, path) -> None:
        write_file(self._sync(), path)

    def dumps(self) -> bytes:
        return build(self._sync())

    def _sync(self) -> Svz:
        """Push tone edits back into the PAT chunk before serialising."""
        svz = copy.deepcopy(self.svz)
        pat = svz.chunk("PAT")
        if pat is None and self.tones:
            raise SvzError("tones present but file has no PAT chunk")
        if pat is not None:
            sizes = {len(t) for t in self.tones}
            if len(sizes) > 1:
                raise SvzError(f"tones have mixed sizes {sorted(sizes)}")
            pat.records = [t.data for t in self.tones]
        return svz

    # -- create ------------------------------------------------------------

    @classmethod
    def create(
        cls,
        tones: int = 1,
        schema: Schema | None = None,
        size: int = PCM_TONE_SIZE,
        version: bytes = DEFAULT_VERSION,
        product: bytes = DEFAULT_PRODUCT,
    ) -> "ToneFile":
        """Build a new file with `tones` init tones.

        Structured to match a real Zenology export (DIF + PAT, DIF record all
        zero). Parses and round-trips, but has NOT been accepted by hardware
        yet - see the open questions in CLAUDE.md before trusting it.
        """
        schema = schema or Schema.load()
        svz = Svz(version=version, product=product)
        svz.chunks.append(
            Chunk(id="DIFaZCOR", records=[bytes(DIF_RECORD_SIZE)])
        )
        svz.chunks.append(
            Chunk(
                id="PATaZCOR",
                records=[
                    Tone.init(schema, size, name=f"Init {i + 1}").data
                    for i in range(tones)
                ],
            )
        )
        return cls(svz, schema)

    # -- modify ------------------------------------------------------------

    def append(self, tone: Tone) -> None:
        self.tones.append(tone)

    def remove(self, index: int) -> Tone:
        return self.tones.pop(index)

    def __len__(self) -> int:
        return len(self.tones)

    def __iter__(self):
        return iter(self.tones)

    def __repr__(self) -> str:
        kinds = ",".join(c.kind for c in self.svz.chunks)
        return f"<ToneFile {len(self.tones)} tones chunks=[{kinds}]>"


def open_file(path, schema_path=None) -> ToneFile:
    """Convenience: load a .svz together with the default schema."""
    return ToneFile.open(Path(path), Schema.load(schema_path))
