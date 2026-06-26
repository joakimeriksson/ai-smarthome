"""Synthesize Swedish speech with Chatterbox Multilingual (language_id='sv').

Default voice (no reference) or zero-shot clone from a clean reference clip.

    uv run python synth_sv.py                         # default voice, CandyTron line
    uv run python synth_sv.py --ref clean_voice.wav   # clone that voice
    uv run python synth_sv.py --text "Hej!" --out output/hej.wav
"""
from __future__ import annotations

import argparse
import os

import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

# CandyTron preview line (smart-home candy persona; "godis" is the pronunciation check)
CANDYTRON = (
    "Hej, jag är CandyTron! Idag delar jag ut godis till alla. "
    "Kom fram och sträck ut handen, så får du en godbit."
)


def main() -> None:
    ap = argparse.ArgumentParser(description="Swedish TTS via Chatterbox Multilingual.")
    ap.add_argument("--text", default=CANDYTRON)
    ap.add_argument("--ref", default=None, help="reference voice wav (zero-shot clone)")
    ap.add_argument("--lang", default="sv")
    ap.add_argument("--out", default="output/candytron_sv.wav")
    args = ap.parse_args()

    print("loading Chatterbox Multilingual on cuda ...", flush=True)
    model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")

    kw = {"language_id": args.lang}
    if args.ref:
        kw["audio_prompt_path"] = args.ref
        print(f"cloning voice from {args.ref}")
    print(f"synthesizing ({args.lang}): {args.text!r}", flush=True)
    wav = model.generate(args.text, **kw)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    ta.save(args.out, wav, model.sr)
    print(f"wrote {args.out}  ({wav.shape[-1] / model.sr:.1f}s @ {model.sr} Hz)")


if __name__ == "__main__":
    main()
