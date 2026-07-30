"""The EXT/SVD layer: Zenology's live user bank.

The whole point of these tests is the same as everywhere else in this project -
if we can take the image apart and put it back byte for byte, the model of it
is probably right. See CLAUDE.md.
"""

import zlib

import pytest

from conftest import DATA
from zencore import read_file
from zencore.container import build
from zencore.svd import (
    EXT_HDR,
    ExtRecord,
    SvdImage,
    pack_ext,
    refresh_meta,
    unpack_ext,
)

ZENOLOGY = DATA / "ZENOLOGY_User.svz"

pytestmark = pytest.mark.skipif(
    not ZENOLOGY.is_file(), reason="Zenology capture not in the corpus"
)


@pytest.fixture
def svz():
    return read_file(ZENOLOGY)


def test_ext_chunk_shape(svz):
    chunk = svz.chunk("EXT")
    assert chunk is not None
    assert chunk.variable
    assert len(chunk.records) == 1


def test_image_tiles_exactly(svz):
    image = unpack_ext(svz).image
    assert len(image) == 128
    assert image.record_size == 23168
    assert EXT_HDR + len(image) * image.record_size == len(image.pack())


def test_slots_are_named(svz):
    image = unpack_ext(svz).image
    # A factory-fresh bank: every slot is an empty init tone.
    assert image.names() == ["INITIAL TONE"] * 128


def test_image_round_trips(svz):
    ext = unpack_ext(svz)
    original = svz.chunk("EXT").records[0]
    assert ExtRecord.unpack(original).pack() == original


def test_zlib_level_reproduces_rolands_stream(svz):
    """If this breaks, Roland changed compression settings - investigate,
    do not just widen the assertion."""
    record = svz.chunk("EXT").records[0]
    raw = zlib.decompress(record[EXT_HDR:])
    assert zlib.compress(raw, 6) == record[EXT_HDR:]


def test_meta_is_crc_of_compressed_payload(svz):
    """New finding, one file only - see refresh_meta()'s docstring."""
    chunk = svz.chunk("EXT")
    _index, meta = chunk.var_meta[0]
    assert meta == zlib.crc32(chunk.records[0][EXT_HDR:]) & 0xFFFFFFFF


def test_whole_file_round_trips_through_the_svd_layer(svz):
    """Unpack to slots, repack, rebuild the .svz: bytes must be unchanged."""
    original = ZENOLOGY.read_bytes()
    ext = unpack_ext(svz)
    pack_ext(svz, ext)
    refresh_meta(svz)
    assert build(svz) == original


def test_renaming_a_slot_changes_only_that_slot(svz):
    ext = unpack_ext(svz)
    before = list(ext.image.slots)
    ext.image.set_name(0, "PROBE 01")
    assert ext.image.name(0) == "PROBE 01"
    assert ext.image.slots[1:] == before[1:]
    changed = [
        i for i, (a, b) in enumerate(zip(before[0], ext.image.slots[0])) if a != b
    ]
    # Only bytes inside the 16-byte name field at +16 may move.
    assert all(16 <= i < 32 for i in changed)


BANK = DATA / "ZENOLOGY_UserBank.svz"
USER2 = DATA / "ZENOLOGY_User2.svz"


@pytest.mark.skipif(not (BANK.is_file() and USER2.is_file()),
                    reason="populated bank not in the corpus")
def test_slot_holds_the_same_pat_record_as_an_svz_export(schema):
    """The finding that makes user-bank tones readable: a slot is 16 bytes of
    header then a complete 1632-byte PAT record - the SAME bytes the tone has
    when exported to .svz."""
    from zencore import ToneFile, Tone

    image = unpack_ext(read_file(BANK)).image
    exported = {t.name: t for t in ToneFile.open(USER2, schema).tones}

    matched = 0
    for i in range(len(image)):
        name = image.name(i)
        if name in exported:
            tone = Tone(image.tone_bytes(i), schema)
            assert tone.name == name
            assert tone.data == exported[name].data, f"slot {i} differs from export"
            matched += 1
    assert matched >= 2, f"expected to match at least 2 tones, matched {matched}"


@pytest.mark.skipif(not BANK.is_file(), reason="populated bank not in the corpus")
def test_replacing_a_tone_leaves_the_rest_of_the_slot_untouched(schema):
    from zencore import Tone

    image = unpack_ext(read_file(BANK)).image
    before = image.slots[1]
    tone = Tone(image.tone_bytes(1), schema)
    tone.name = "RENAMED"
    image.set_tone_bytes(1, tone.data)

    after = image.slots[1]
    assert len(after) == len(before)
    assert after[:16] == before[:16], "slot header must not move"
    assert after[16 + 1632:] == before[16 + 1632:], "trailing slot bytes must not move"
    assert image.name(1) == "RENAMED"


@pytest.mark.skipif(not BANK.is_file(), reason="populated bank not in the corpus")
def test_tone_record_size_is_enforced():
    image = unpack_ext(read_file(BANK)).image
    with pytest.raises(Exception):
        image.set_tone_bytes(0, b"\x00" * 100)


def test_rejects_a_corrupt_size_field(svz):
    record = bytearray(svz.chunk("EXT").records[0])
    record[8] ^= 0xFF
    with pytest.raises(Exception):
        ExtRecord.unpack(bytes(record))


def test_svd_rejects_bad_magic():
    with pytest.raises(Exception):
        SvdImage.unpack(b"NOPE" + bytes(28))
