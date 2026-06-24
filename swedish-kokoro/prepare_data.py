"""Build StyleTTS2/Kokoro training filelists from the Swedish TTS dataset.

Dataset: `datadriven-company/TTS-Swedish` (HF, CC0) — 40 h, 9 speakers, 24 kHz
mono, LibriVox-sourced, WhisperX-transcribed, with DNSMOS quality scores.
On disk it is `data/swedish_raw/wavs/*.wav` + `data/swedish_raw/speakers.csv`
(`audio|text|speaker_id|duration|dnsmos`) — the SAME layout the sister Piper
project (../swedish-tts) uses.

Output (one line per clip), as the kikiri/StyleTTS2 recipe requires:

    relative/path/to/audio.wav|<IPA phoneme string>|<speaker_id>

Per clip:
  1. quality filter (DNSMOS + duration)
  2. single-speaker selection (default: the speaker with the most passing clips)
  3. resample to 24 kHz mono 16-bit (already 24 kHz, so this just enforces format)
  4. phonemize the transcript (neural G2P required by default; espeak is explicit)
  5. abort if any phoneme falls outside Kokoro's vocab
  6. write train / val / OOD filelists

Run on the GPU box (where the data + neural G2P live):
    export SV_NEURAL_G2P=g2p.nst_g2p
    python prepare_data.py --raw data/swedish_raw --speaker auto --val 200 --g2p neural
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import shutil
from collections import defaultdict
from pathlib import Path

import soundfile as sf
import librosa

from g2p_sv import SwedishG2P, validate_against_kokoro, kokoro_vocab

KOKORO_SR = 24000


def load_speakers_csv(raw_dir: Path) -> list[dict]:
    """Read speakers.csv (audio|text|speaker_id|duration|dnsmos)."""
    p = raw_dir / "speakers.csv"
    if not p.exists():
        raise FileNotFoundError(
            f"{p} not found. Expected the datadriven-company/TTS-Swedish layout "
            "(wavs/ + speakers.csv). Download it on the GPU box or rsync from ../swedish-tts."
        )
    rows = []
    with p.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="|"):
            try:
                row["duration"] = float(row["duration"])
                row["dnsmos"] = float(row["dnsmos"])
            except (ValueError, KeyError, TypeError):
                continue
            rows.append(row)
    return rows


def select(rows, mode: str, min_dnsmos: float, min_sec: float, max_sec: float, all_speakers: bool):
    passing = [r for r in rows
               if r["dnsmos"] >= min_dnsmos and min_sec <= r["duration"] <= max_sec]
    by_spk = defaultdict(list)
    for r in passing:
        by_spk[r["speaker_id"]].append(r)
    if mode == "all" and not all_speakers:
        raise SystemExit("--speaker all requires --all-speakers; single-speaker training should use auto or a speaker filter.")
    if all_speakers:
        return passing, f"all {len(by_spk)} speakers (multi-speaker)"
    if mode == "auto":
        best = max(by_spk.items(), key=lambda kv: sum(x["duration"] for x in kv[1]))
        return best[1], f"single speaker (auto, most audio): {best[0]!r}"
    sel = [r for r in passing if mode.lower() in r["speaker_id"].lower()]
    return sel, f"speaker match {mode!r}: {len({r['speaker_id'] for r in sel})} section(s)"


def main():
    ap = argparse.ArgumentParser(description="Prepare Swedish Kokoro filelists.")
    ap.add_argument("--raw", required=True, help="dir with wavs/ and speakers.csv")
    ap.add_argument("--out", default="data", help="output dir for filelists + wavs_24k")
    ap.add_argument("--speaker", default="auto",
                    help="'auto' (most audio) or a speaker_id substring; use --all-speakers to allow 'all'")
    ap.add_argument("--speaker-label", default="sv0",
                    help="speaker label written to the filelist for single-speaker training")
    ap.add_argument("--all-speakers", action="store_true",
                    help="explicitly allow a multi-speaker filelist; requires config multispeaker=true")
    ap.add_argument("--val", type=int, default=200, help="held-out clips for validation")
    ap.add_argument("--g2p", default="neural", choices=["auto", "neural", "espeak"],
                    help="use neural for real training; espeak is only a pipeline smoke fallback")
    ap.add_argument("--min-dnsmos", type=float, default=3.5)
    ap.add_argument("--min-sec", type=float, default=1.0)
    ap.add_argument("--max-sec", type=float, default=12.0,
                    help="cap long audiobook reads. StyleTTS2 random-crops mels to config "
                         "max_len (~5 s at 400 frames), so very long clips mostly waste audio.")
    ap.add_argument("--max-phonemes", type=int, default=400,
                    help="drop clips whose phoneme count exceeds this (PLBERT pos-emb cap is 512)")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--refs", type=int, default=5, help="copy this many val clips to data/refs")
    args = ap.parse_args()

    raw, out = Path(args.raw), Path(args.out)
    wav_out = out / "wavs_24k"
    wav_out.mkdir(parents=True, exist_ok=True)

    g2p = SwedishG2P(backend=args.g2p)
    print(f"G2P backend: {g2p.backend}")

    rows = load_speakers_csv(raw)
    selected, desc = select(rows, args.speaker, args.min_dnsmos, args.min_sec, args.max_sec, args.all_speakers)
    if not selected:
        raise SystemExit("No clips passed selection/filter; loosen --min-dnsmos / duration / --speaker.")
    print(f"selection: {desc}  ({len(selected)} clips, "
          f"{sum(r['duration'] for r in selected)/3600:.2f} h)")

    entries: list[tuple[str, str, str]] = []
    all_phonemes: list[str] = []
    skipped = 0
    for r in selected:
        src = raw / "wavs" / Path(r["audio"]).name
        if not src.exists():
            skipped += 1
            continue
        audio, _ = librosa.load(src.as_posix(), sr=KOKORO_SR, mono=True)
        text = r["text"].strip()
        if not text:
            skipped += 1
            continue
        dst = wav_out / src.name
        sf.write(dst.as_posix(), audio, KOKORO_SR, subtype="PCM_16")
        ph = g2p(text)
        if not ph or len(ph) > args.max_phonemes:
            skipped += 1
            continue
        all_phonemes.append(ph)
        rel = os.path.relpath(dst, out)
        speaker_label = r["speaker_id"] if args.all_speakers else args.speaker_label
        entries.append((rel, ph, speaker_label))

    vocab = kokoro_vocab()
    misses = validate_against_kokoro(all_phonemes, vocab)
    if misses:
        print("⚠️  Out-of-vocab phoneme symbols (add to KOKORO_REMAP in g2p_sv.py):")
        for sym, n in sorted(misses.items(), key=lambda kv: -kv[1]):
            print(f"    {sym!r} (U+{ord(sym):04X}): {n}")
        raise SystemExit("Refusing to write filelists with out-of-vocab symbols (would NaN training).")
    print("✅ All phonemes within Kokoro's vocab.")

    if len(entries) <= args.val:
        raise SystemExit(f"Need more than --val={args.val} clips after filtering; got {len(entries)}.")

    random.Random(args.seed).shuffle(entries)
    val_entries, train_entries = entries[: args.val], entries[args.val:]
    val = [f"{rel}|{ph}|{speaker}" for rel, ph, speaker in val_entries]
    train = [f"{rel}|{ph}|{speaker}" for rel, ph, speaker in train_entries]
    (out / "train_list.txt").write_text("\n".join(train) + "\n", encoding="utf-8")
    (out / "val_list.txt").write_text("\n".join(val) + "\n", encoding="utf-8")
    (out / "OOD_texts.txt").write_text("\n".join(ph for _, ph, _ in entries) + "\n", encoding="utf-8")

    if args.refs > 0:
        refs = out / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        for rel, _, _ in val_entries[:args.refs]:
            src_ref = out / rel
            if src_ref.exists():
                shutil.copy2(src_ref, refs / src_ref.name)

    print(f"wrote {len(train)} train / {len(val)} val (skipped {skipped})")
    print(f"  {out/'train_list.txt'}\n  {out/'val_list.txt'}\n  {out/'OOD_texts.txt'} (phonemes only, Stage-2 SLM)")
    if args.refs > 0:
        print(f"  {out/'refs'} ({min(args.refs, len(val_entries))} reference clips)")


if __name__ == "__main__":
    main()
