"""Synthesize a Swedish sentence with a Piper voice and report realtime metrics.

Measures:
  - full-utterance realtime factor (generation_seconds / audio_seconds)
  - streaming time-to-first-audio-chunk (the metric that matters for "feels realtime")

Works for both the stock sv_SE-nst-medium baseline and any fine-tuned .onnx export.
"""
from __future__ import annotations

import argparse
import time
import wave
from pathlib import Path


DEFAULT_TEXT = (
    "Det här är ett svenskt test med Piper. "
    "Vi lyssnar efter uttal, rytm och hur naturlig rösten känns."
)


def synth(model_path: str, text: str, output: Path, label: str):
    from piper import PiperVoice

    output.parent.mkdir(parents=True, exist_ok=True)

    load_start = time.perf_counter()
    voice = PiperVoice.load(model_path)
    load_seconds = time.perf_counter() - load_start

    # --- streaming: time to first audio chunk ---
    stream_start = time.perf_counter()
    first_chunk_seconds = None
    total_samples = 0
    sample_rate = None
    for chunk in voice.synthesize(text):
        if first_chunk_seconds is None:
            first_chunk_seconds = time.perf_counter() - stream_start
        sample_rate = chunk.sample_rate
        total_samples += len(chunk.audio_int16_bytes) // 2  # int16 mono
    stream_total_seconds = time.perf_counter() - stream_start

    # --- full-file synth (for a saved wav to listen to) ---
    full_start = time.perf_counter()
    with wave.open(output.as_posix(), "wb") as wav_file:
        voice.synthesize_wav(text, wav_file)
    full_seconds = time.perf_counter() - full_start

    audio_seconds = total_samples / sample_rate if sample_rate else 0.0

    print(f"label={label}")
    print(f"model={model_path}")
    print(f"output={output.resolve()}")
    print(f"sample_rate={sample_rate}")
    print(f"load_seconds={load_seconds:.3f}")
    print(f"audio_seconds={audio_seconds:.3f}")
    print(f"stream_total_seconds={stream_total_seconds:.3f}")
    print(f"full_synth_seconds={full_seconds:.3f}")
    if first_chunk_seconds is not None:
        print(f"time_to_first_chunk_seconds={first_chunk_seconds:.3f}")
    if audio_seconds > 0:
        print(f"realtime_factor={full_seconds / audio_seconds:.3f}")
        print(f"stream_realtime_factor={stream_total_seconds / audio_seconds:.3f}")


def main():
    parser = argparse.ArgumentParser(description="Synthesize Swedish with a Piper voice and measure RTF.")
    parser.add_argument("--model", required=True, help="Path to the Piper .onnx voice model.")
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--output", default=None, help="Output wav path (defaults to output/<label>.wav).")
    parser.add_argument("--label", default="piper_sv")
    args = parser.parse_args()

    output = Path(args.output) if args.output else Path(__file__).parent / "output" / f"{args.label}.wav"
    synth(args.model, args.text, output, args.label)


if __name__ == "__main__":
    main()
