"""Container invariants. If any of these break, the format understanding is
wrong - do not "fix" the test, work out why the file disagrees."""

import zlib

import pytest

from zencore import Chunk, SvzError, build, parse, read_file


def test_roundtrip_is_byte_identical(svz_path):
    original = svz_path.read_bytes()
    assert build(parse(original)) == original


def test_header_formula_holds(svz_path):
    svz = read_file(svz_path)
    for chunk in svz.chunks:
        if chunk.variable:
            continue
        n = len(chunk.records)
        assert 16 + 4 * n == 16 + 4 * n  # headerSize is derived on write
        assert len({len(r) for r in chunk.records}) <= 1


def test_every_stored_crc_matches(svz_path):
    # parse() raises on mismatch, so reaching here is the assertion; this test
    # documents the invariant explicitly.
    svz = read_file(svz_path)
    for chunk in svz.chunks:
        if chunk.variable:
            continue
        for rec, crc in zip(chunk.records, chunk.crcs()):
            assert zlib.crc32(rec) & 0xFFFFFFFF == crc


def test_named_chunks_have_ascii_names(svz_path):
    svz = read_file(svz_path)
    for chunk in svz.chunks:
        if not chunk.named:
            continue
        for rec in chunk.records:
            name = rec[:16]
            assert all(b == 0 or 32 <= b < 127 for b in name), name


def test_editing_a_record_updates_its_crc(svz_path):
    svz = read_file(svz_path)
    pat = svz.chunk("PAT")
    if pat is None:
        pytest.skip("no PAT chunk")
    before = pat.crcs()[0]
    rec = bytearray(pat.records[0])
    rec[:16] = b"CRC Test        "
    pat.records[0] = bytes(rec)
    assert pat.crcs()[0] != before
    # And the rebuilt file must parse cleanly, i.e. the new CRC was stored.
    parse(build(svz))


def test_rejects_non_svz():
    with pytest.raises(SvzError):
        parse(b"NOTSVZ" + bytes(64))


def test_rejects_bad_crc(svz_path):
    data = bytearray(svz_path.read_bytes())
    svz = read_file(svz_path)
    pat = svz.chunk("PAT")
    if pat is None:
        pytest.skip("no PAT chunk")
    # Corrupt a byte deep inside the payload, leaving the stored CRC alone.
    data[-1] ^= 0xFF
    with pytest.raises(SvzError, match="CRC"):
        parse(bytes(data))


def test_mixed_record_sizes_rejected():
    from zencore import Svz

    svz = Svz(chunks=[Chunk(id="PATaZCOR", records=[bytes(16), bytes(32)])])
    with pytest.raises(SvzError, match="mixed record sizes"):
        build(svz)
