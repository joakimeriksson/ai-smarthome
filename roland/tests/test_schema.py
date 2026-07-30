"""Facts about zcformat.json that the rest of the code relies on."""

from zencore import Schema
from zencore.tone import PCM_TONE_SIZE


def test_positions_are_absolute_and_fill_the_record(schema):
    assert schema.span == PCM_TONE_SIZE


def test_name_is_sixteen_bytes_at_offset_zero(schema):
    p = schema.param("PCMT_CMN", "NAME")
    assert (p.pos, p.size) == (0, 16)


def test_parameter_ids_are_not_globally_unique(schema):
    """Why every lookup must be group-scoped."""
    seen: dict[str, str] = {}
    collisions = 0
    for group, p in schema.iter_named():
        if p.id in seen and seen[p.id] != group:
            collisions += 1
        seen[p.id] = group
    assert collisions > 0


def test_groups_do_not_overlap(schema):
    owner: dict[int, tuple[str, str]] = {}
    for group, p in schema.iter_named():
        for off in range(p.pos, p.end):
            assert off not in owner, f"{group}.{p.id} overlaps {owner[off]} at {off}"
            owner[off] = (group, p.id)


def test_array_params_are_recognised(schema):
    p = schema.param("PTL_LFO_1", "LFO_1_STEP")
    assert p.is_array and p.size == 16 and not p.is_text


def test_signed_params_decode_negative(schema):
    p = schema.param("PCMT_CMN", "PAN")
    rec = bytearray(PCM_TONE_SIZE)
    rec[p.pos] = 0xF6
    assert schema.decode(bytes(rec), p) == -10
    assert schema.encode(-10, p) == b"\xf6"


def test_record_dict_roundtrip(schema, svz_path):
    from zencore import read_file

    pat = read_file(svz_path).chunk("PAT")
    if pat is None:
        return
    for rec in pat.records:
        assert schema.from_dict(schema.to_dict(rec), len(rec)) == rec


def test_init_record_has_the_right_size(schema):
    assert len(schema.init_record(PCM_TONE_SIZE)) == PCM_TONE_SIZE
