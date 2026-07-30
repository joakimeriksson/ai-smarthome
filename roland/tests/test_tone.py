"""The load / save / create / modify surface an editor UI would use."""

import pytest

from zencore import Schema, ToneFile, jsonio, parse, read_file
from zencore.tone import PCM_TONE_SIZE, Tone


def test_open_and_save_unchanged(svz_path, schema, tmp_path):
    tf = ToneFile.open(svz_path, schema)
    out = tmp_path / "out.svz"
    tf.save(out)
    assert out.read_bytes() == svz_path.read_bytes()


def test_rename_survives_a_save(svz_path, schema, tmp_path):
    tf = ToneFile.open(svz_path, schema)
    if not tf.tones:
        pytest.skip("no tones")
    tf.tones[0].name = "Renamed"
    out = tmp_path / "out.svz"
    tf.save(out)
    assert ToneFile.open(out, schema).tones[0].name == "Renamed"


def test_name_is_truncated_and_padded(schema):
    tone = Tone.init(schema)
    tone.name = "A" * 40
    assert len(tone.data[:16]) == 16
    assert tone.name == "A" * 16


def test_parameter_edit_is_localised(svz_path, schema):
    """Setting one parameter must not disturb any other byte."""
    tf = ToneFile.open(svz_path, schema)
    if not tf.tones:
        pytest.skip("no tones")
    tone = tf.tones[0]
    before = tone.data
    p = schema.param("PCMT_CMN", "LEVEL")
    tone.set("PCMT_CMN", "LEVEL", 99)
    after = tone.data
    changed = {i for i, (a, b) in enumerate(zip(before, after)) if a != b}
    assert changed <= set(range(p.pos, p.end))
    assert tone.get("PCMT_CMN", "LEVEL") == 99


def test_item_access(svz_path, schema):
    tf = ToneFile.open(svz_path, schema)
    if not tf.tones:
        pytest.skip("no tones")
    tone = tf.tones[0]
    tone["PCMT_CMN", "LEVEL"] = 42
    assert tone["PCMT_CMN", "LEVEL"] == 42


def test_create_produces_a_parseable_file(schema, tmp_path):
    tf = ToneFile.create(tones=3, schema=schema)
    out = tmp_path / "new.svz"
    tf.save(out)

    reloaded = ToneFile.open(out, schema)
    assert len(reloaded.tones) == 3
    assert reloaded.tones[0].name == "Init 1"
    assert len(reloaded.tones[0]) == PCM_TONE_SIZE
    # and it round-trips like any other file
    raw = out.read_bytes()
    from zencore import build

    assert build(parse(raw)) == raw


def test_created_tone_respects_schema_ranges(schema):
    """An init tone built from the schema's own defaults should be in range."""
    tone = Tone.init(schema)
    assert tone.out_of_range() == []


def test_json_roundtrip_with_schema(svz_path, schema, tmp_path):
    jsonio.export(svz_path, tmp_path / "j", schema)
    out = tmp_path / "rebuilt.svz"
    jsonio.build_from(tmp_path / "j", out, schema)
    assert out.read_bytes() == svz_path.read_bytes()


def test_json_roundtrip_without_schema(svz_path, tmp_path):
    jsonio.export(svz_path, tmp_path / "j", None)
    out = tmp_path / "rebuilt.svz"
    jsonio.build_from(tmp_path / "j", out, None)
    assert out.read_bytes() == svz_path.read_bytes()


def test_non_pat_chunks_are_preserved(svz_path, schema, tmp_path):
    """MDL and friends must survive a tone edit untouched."""
    original = read_file(svz_path)
    tf = ToneFile.open(svz_path, schema)
    if tf.tones:
        tf.tones[0].name = "Touched"
    out = tmp_path / "out.svz"
    tf.save(out)
    rebuilt = read_file(out)

    for a, b in zip(original.chunks, rebuilt.chunks):
        assert a.id == b.id
        if a.kind != "PAT":
            assert a.records == b.records
