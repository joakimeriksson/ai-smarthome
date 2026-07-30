"""A virtual-analog view of a ZEN-Core tone.

The `PAT` record holds ~945 parameters, most of which describe the PCM sample
engine. A partial whose ``OSC_TYPE`` is VA / SuperSAW / Noise generates its
waveform numerically and touches no sample data at all, so a synth that only
implements the VA path needs a much smaller slice - the 86 parameters gathered
here.

This module is a *view*: it decodes, labels and groups, and never changes bytes.
It deliberately contains no synthesis and no web code, so it is safe for both
`zencore` consumers and the HTTP layer to depend on.

    from zencore import Schema, ToneFile
    from zencore.va import va_patch

    tone = ToneFile.open("User2.svz", Schema.load()).tones[2]
    patch = va_patch(tone)          # JSON-serialisable

Enum labels come from the schema (`Param.values`), which now carries Roland's
own ``desc_val`` strings - nothing here hardcodes a value list.
"""

from __future__ import annotations

#: OSC_TYPE values that synthesise rather than play a sample.
SYNTHESISED = ("VA", "SuperSAW", "Noise")

#: Envelope stages shared by the pitch and filter envelopes.
_FULL_ENV = ("T1", "T2", "T3", "T4", "L0", "L1", "L2", "L3", "L4")
#: The amp envelope has no L0/L4 - it starts and ends at silence.
_AMP_ENV = ("T1", "T2", "T3", "T4", "L1", "L2", "L3")


def _val(tone, group, pid):
    """Raw value plus its label when the parameter is an enum."""
    p = tone.schema.param(group, pid)
    raw = tone.get(group, pid)
    label = p.label(raw) if not p.is_array else None
    return {"value": raw, "label": label} if label is not None else raw


def _fields(tone, group, ids):
    return {pid: _val(tone, group, pid) for pid in ids if tone.schema.has(group, pid)}


def _env(tone, group, stages):
    e = _fields(tone, group, ("DEPTH", "VSENS") + stages)
    return {k: v for k, v in e.items() if v is not None}


def _lfo(tone, n, which):
    ids = [f"LFO_{which}_{s}" for s in
           ("FORM", "RATE", "RATE_SYNC", "RATE_NOTE", "DELAY", "FADE", "FADE_MODE",
            "KEY_TRIG", "OFST", "PIT_DEPTH", "TVF_DEPTH", "TVA_DEPTH", "PAN_DEPTH")]
    out = _fields(tone, f"PTL_LFO_{n}", ids)
    return {k.replace(f"LFO_{which}_", "").lower(): v for k, v in out.items()}


def _partial(tone, n: int) -> dict:
    P, S = f"PCMT_PTL_{n}", f"PCMS_PTL_{n}"
    osc = _fields(tone, S, ("OSC_TYPE", "VA_FORM", "PW", "PWM_DEPTH", "SSAW_DETUNE",
                            "VA_INVERT_SW", "VA_INIT_PHASE", "CLICK_TYPE", "FAT",
                            "OSC_ATT"))
    kind = osc.get("OSC_TYPE")
    kind = kind["label"] if isinstance(kind, dict) else kind
    return {
        "index": n,
        "on": bool(tone.get("PCMT_PMT", f"PMT_{n}_PTL_SW")),
        "synthesised": kind in SYNTHESISED,
        "osc": osc,
        "pitch": _fields(tone, P, ("PIT_CRS", "PIT_FINE", "PIT_KF", "PIT_RND")),
        "amp": _fields(tone, P, ("LEVEL", "PAN", "PAN_KF", "PAN_RND", "LEVEL_VSENS",
                                 "LEVEL_VCRV")),
        "filter": {
            **_fields(tone, P, ("FILTER_TYPE", "CUTOFF", "RESO", "CUTOFF_KF",
                                "CUTOFF_VSENS", "CUTOFF_VCRV", "RESO_VSENS")),
            **_fields(tone, S, ("VCF_TYPE", "FILTER_SLOPE", "HPF_CUTOFF",
                                "CUTOFF_KF_BP", "VCF_GC", "ADSR_ENV_SW")),
        },
        "penv": _env(tone, f"PTL_PENV_{n}", _FULL_ENV),
        "fenv": _env(tone, f"PTL_FENV_{n}", _FULL_ENV),
        "aenv": _env(tone, f"PTL_AENV_{n}", _AMP_ENV),
        "lfo1": _lfo(tone, n, 1),
        "lfo2": _lfo(tone, n, 2),
    }


def va_patch(tone) -> dict:
    """Everything a VA voice needs, decoded and labelled.

    Structure is reported per pair because that is how ZEN-Core models it:
    partial 1 is sync/ring/cross-modulated by partial 2, and 3 by 4. See
    docs/FORMAT.md - the master/slave direction is easy to get backwards.
    """
    partials = [_partial(tone, n) for n in range(1, 5)]
    return {
        "name": tone.name,
        "common": _fields(tone, "PCMT_CMN",
                          ("LEVEL", "PAN", "OCTAVE", "PIT_CRS", "PIT_FINE",
                           "MONO_POLY", "LEGATO_SW", "PORTA_SW", "PORTA_MODE",
                           "PORTA_TIME", "PORTA_TYPE", "BEND_RANGE_UP",
                           "BEND_RANGE_DW", "ANALOG_FEEL")),
        "voice": _fields(tone, "PCMS_CMN",
                         ("UNISON_SW", "UNISON_SIZE", "UNISON_DETN",
                          "RND_PIT_VAL", "RND_PIT_NUM", "CONDITION")),
        "structure": {
            "pair12": _val(tone, "PCMS_PMT", "STRUCT12"),
            "pair34": _val(tone, "PCMS_PMT", "STRUCT34"),
            **_fields(tone, "PCMS_PMT",
                      ("RING12_LEVEL", "RING34_LEVEL", "RING_OSC1_LEVEL",
                       "RING_OSC2_LEVEL", "RING_OSC3_LEVEL", "RING_OSC4_LEVEL",
                       "XMOD12_DEPTH", "XMOD34_DEPTH", "XMOD_OSC1_LEVEL",
                       "XMOD_OSC2_LEVEL", "PTL_PHS_LOCK")),
        },
        "partials": partials,
        "playable": any(p["on"] and p["synthesised"] for p in partials),
    }


def is_va(tone) -> bool:
    """True when at least one active partial synthesises rather than plays PCM."""
    return va_patch(tone)["playable"]
