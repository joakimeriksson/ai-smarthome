"""zencore - read, write, create and modify Roland ZEN-Core .svz files.

    from zencore import ToneFile, Schema

    tf = ToneFile.open("User.svz", Schema.load())
    tf.tones[0].name = "My Patch"
    tf.save("out.svz")
"""

from .container import (
    NAMED_CHUNKS,
    Chunk,
    Svz,
    SvzError,
    build,
    parse,
    read_file,
    write_file,
)
from .jsonio import build_from, export, load
from .schema import Param, Schema, find_schema_path
from .svd import ExtRecord, SvdImage, pack_ext, refresh_meta, unpack_ext
from .tone import PCM_TONE_SIZE, Tone, ToneFile, open_file

__version__ = "0.1.0"

__all__ = [
    "Chunk",
    "ExtRecord",
    "NAMED_CHUNKS",
    "PCM_TONE_SIZE",
    "Param",
    "Schema",
    "SvdImage",
    "Svz",
    "SvzError",
    "Tone",
    "ToneFile",
    "build",
    "build_from",
    "export",
    "find_schema_path",
    "load",
    "open_file",
    "pack_ext",
    "parse",
    "read_file",
    "refresh_meta",
    "unpack_ext",
    "write_file",
]
