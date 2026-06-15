"""Build StyleTTS2/Kokoro training filelists from the Swedish NST data.

Output format (one line per clip), as required by the kikiri/StyleTTS2 recipe:

    relative/path/to/audio.wav|<IPA phoneme string>|<speaker_id>

Steps per clip:
  1. resample audio to 24 kHz mono 16-bit (Kokoro's sample rate; NST/Piper was 22.05 kHz)
  2. phonemize the transcript with the Swedish G2P (neural preferred, espeak fallback)
  3. drop clips whose phonemes fall outside Kokoro's vocab (logged, not silent)
  4. write train/val filelists

Reuses the same raw data the Piper project used:
  data/swedish_raw/wavs/*.wav  +  a metadata csv of  wav_id|transcript

Run on the GPU box (where the data + neural G2P live):
    python prepare_data.py --raw data/swedish_raw --speaker sv0 --val 200
"""
from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

import soundfile as sf
import librosa

from g2p_sv import SwedishG2P, validate_against_kokoro, kokoro_vocab

KOKORO_SR = 24000


def load_metadata(raw_dir: Path) -> list[tuple[str, str]]:
    """Return [(wav_id, transcript)] from metadata.csv (id|text) or metadata.tsv."""
    for name in ("metadata.csv", "metadata.tsv", "transcripts.csv"):
        p = raw_dir / name
        if p.exists():
            delim = "\t" if p.suffix == ".tsv" else "|"
            rows = []
            with p.open(encoding="utf-8") as f:
                for row in csv.reader(f, delimiter=delim):
                    if len(row) >= 2 and row[0].strip():
                        rows.append((row[0].strip(), row[1].strip()))
            return rows
    raise FileNotFoundError(f"No metadata file found in {raw_dir}")


def main():
    ap = argparse.ArgumentParser(description="Prepare Swedish Kokoro filelists.")
    ap.add_argument("--raw", required=True, help="dir with wavs/ and metadata file")
    ap.add_argument("--out", default="data", help="output dir for filelists + wavs_24k")
    ap.add_argument("--speaker", default="sv0", help="speaker id token for the filelist")
    ap.add_argument("--val", type=int, default=200, help="held-out clips for validation")
    ap.add_argument("--g2p", default="auto", choices=["auto", "neural", "espeak"])
    ap.add_argument("--min-sec", type=float, default=1.0)
    ap.add_argument("--max-sec", type=float, default=30.0)
    args = ap.parse_args()

    raw = Path(args.raw)
    out = Path(args.out)
    wav_out = out / "wavs_24k"
    wav_out.mkdir(parents=True, exist_ok=True)

    g2p = SwedishG2P(backend=args.g2p)
    print(f"G2P backend: {g2p.backend}")

    meta = load_metadata(raw)
    print(f"{len(meta)} clips in metadata")

    lines: list[str] = []
    all_phonemes: list[str] = []
    skipped = 0
    for wav_id, text in meta:
        src = raw / "wavs" / f"{wav_id}.wav"
        if not src.exists():
            skipped += 1
            continue
        audio, sr = librosa.load(src.as_posix(), sr=KOKORO_SR, mono=True)
        dur = len(audio) / KOKORO_SR
        if not (args.min_sec <= dur <= args.max_sec):
            skipped += 1
            continue
        dst = wav_out / f"{wav_id}.wav"
        sf.write(dst.as_posix(), audio, KOKORO_SR, subtype="PCM_16")
        ph = g2p(text)
        all_phonemes.append(ph)
        rel = os.path.relpath(dst, out)
        lines.append(f"{rel}|{ph}|{args.speaker}")

    # vocab safety check across the whole corpus
    vocab = kokoro_vocab()
    misses = validate_against_kokoro(all_phonemes, vocab)
    if misses:
        print("⚠️  Out-of-vocab phoneme symbols (add to KOKORO_REMAP in g2p_sv.py):")
        for sym, n in sorted(misses.items(), key=lambda kv: -kv[1]):
            print(f"    {sym!r}: {n}")
    else:
        print("✅ All phonemes are within Kokoro's vocab.")

    val = lines[: args.val]
    train = lines[args.val :]
    (out / "train_list.txt").write_text("\n".join(train) + "\n", encoding="utf-8")
    (out / "val_list.txt").write_text("\n".join(val) + "\n", encoding="utf-8")
    print(f"wrote {len(train)} train / {len(val)} val lines  (skipped {skipped})")
    print(f"  {out/'train_list.txt'}")
    print(f"  {out/'val_list.txt'}")


if __name__ == "__main__":
    main()
