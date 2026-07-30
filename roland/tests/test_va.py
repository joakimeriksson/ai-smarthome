"""The VA view - the contract a virtual-analog synth consumes.

These tests pin the shape of that contract and the enum labelling it depends
on, because a synth reading `label` instead of `value` will silently play the
wrong waveform if the labels drift.
"""

import json

import pytest

from conftest import DATA
from zencore import Schema, ToneFile
from zencore.va import SYNTHESISED, is_va, va_patch

USER2 = DATA / "ZENOLOGY_User2.svz"

pytestmark = pytest.mark.skipif(
    not USER2.is_file(), reason="hand-built Zenology patches not in the corpus"
)


@pytest.fixture
def tones(schema):
    return ToneFile.open(USER2, schema).tones


def label_of(field):
    return field["label"] if isinstance(field, dict) else None


def test_enum_labels_come_from_the_schema(schema):
    """Nothing may hardcode these - they are Roland's own desc_val strings."""
    assert schema.param("PCMS_PTL_1", "OSC_TYPE").values == [
        "PCM", "VA", "PCM-Sync", "SuperSAW", "Noise"]
    assert schema.param("PCMS_PTL_1", "VA_FORM").values == [
        "SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"]
    assert schema.param("PCMS_PMT", "STRUCT12").values == [
        "OFF", "SYNC", "RING", "XMOD", "XMOD2"]


def test_prose_desc_val_is_not_mistaken_for_an_enum(schema):
    """'0 - 16383' is a range, not a list of 16384 labels."""
    assert schema.param("PCMT_PTL_1", "WAV_NUM_L").values is None
    assert schema.param("PCMT_CMN", "NAME").values is None


def test_label_maps_value_to_name(schema):
    p = schema.param("PCMS_PTL_1", "VA_FORM")
    assert p.label(0) == "SAW"
    assert p.label(1) == "SQR"
    assert p.label(99) is None          # out of range, not an exception


def test_pcm_tone_is_not_playable_by_a_va_synth(tones):
    """Test1 is an init tone with PCM oscillators - a VA synth cannot play it."""
    patch = va_patch(tones[0])
    assert patch["name"] == "Test1"
    assert patch["playable"] is False
    assert is_va(tones[0]) is False


def test_four_partial_sync_patch_decodes(tones):
    patch = va_patch(tones[2])
    assert patch["name"] == "Laser Sync Harp"
    assert patch["playable"] is True
    assert label_of(patch["structure"]["pair12"]) == "SYNC"
    assert label_of(patch["structure"]["pair34"]) == "SYNC"
    on = [p for p in patch["partials"] if p["on"]]
    assert len(on) == 4
    assert all(p["synthesised"] for p in on)
    assert all(label_of(p["osc"]["OSC_TYPE"]) == "VA" for p in on)


def test_mixed_patch_reports_per_partial_kind(tones):
    """JP-6 Rings ring-modulates a VA partial against PCM ones."""
    kinds = [label_of(p["osc"]["OSC_TYPE"])
             for p in va_patch(tones[1])["partials"] if p["on"]]
    assert kinds == ["VA", "PCM", "PCM"]
    assert va_patch(tones[1])["playable"] is True     # at least one VA partial


def test_stereo_pan_and_detune_survive(tones):
    """The two sync pairs are panned apart and the upper pair detuned."""
    p = va_patch(tones[2])["partials"]
    assert p[0]["amp"]["PAN"] == -25 and p[1]["amp"]["PAN"] == -25
    assert p[2]["amp"]["PAN"] == 25 and p[3]["amp"]["PAN"] == 25
    assert p[2]["pitch"]["PIT_FINE"] == -5


def test_envelopes_are_complete(tones):
    p = va_patch(tones[2])["partials"][0]
    for stage in ("T1", "T2", "T3", "T4", "L1", "L2", "L3"):
        assert stage in p["aenv"], f"amp env missing {stage}"
    for stage in ("T1", "T2", "T3", "T4", "L0", "L1", "L2", "L3", "L4"):
        assert stage in p["penv"] and stage in p["fenv"]
    assert p["penv"]["DEPTH"] == 85          # the laser swoop


def test_patch_is_json_serialisable(tones):
    """The HTTP layer hands this straight to the browser."""
    for t in tones:
        json.dumps(va_patch(t))


def test_view_never_mutates_the_tone(tones):
    before = tones[2].data
    va_patch(tones[2])
    assert tones[2].data == before


def test_synthesised_kinds_are_the_non_pcm_ones():
    assert "PCM" not in SYNTHESISED
    assert "VA" in SYNTHESISED and "SuperSAW" in SYNTHESISED
