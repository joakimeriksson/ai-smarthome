"""Convert the repo's Swedish dataset (data/swedish_raw) into a Piper training CSV.

Piper (piper1-gpl) single-speaker training wants a `|`-delimited CSV:

    <audio_filename>|<text>

with the audio files living in a single --data.audio_dir. We don't copy or
resample audio: piper's data pipeline loads via librosa at the configured
sample rate, so we just point audio_dir at the existing wavs and emit a
filtered CSV referencing the basenames.

The repo already has data/swedish_raw/speakers.csv with per-clip speaker_id,
duration and DNSMOS, which we use to (a) quality-filter and (b) optionally
restrict to a single speaker for a clean, consistent voice.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
SPEAKERS_CSV = REPO_ROOT / "data/swedish_raw/speakers.csv"
AUDIO_DIR = REPO_ROOT / "data/swedish_raw/wavs"


def load_rows():
    rows = []
    with open(SPEAKERS_CSV, newline="") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            try:
                row["duration"] = float(row["duration"])
                row["dnsmos"] = float(row["dnsmos"])
            except (ValueError, KeyError):
                continue
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser(description="Build a Piper training CSV from data/swedish_raw.")
    ap.add_argument("--min-dnsmos", type=float, default=3.5)
    ap.add_argument("--min-dur", type=float, default=1.0)
    ap.add_argument("--max-dur", type=float, default=18.0,
                    help="VITS trains best on shorter clips; cap long audiobook reads.")
    ap.add_argument("--single-speaker", default="auto",
                    help="'auto' = the speaker with the most passing clips, "
                         "'all' = keep every speaker (multi-speaker), "
                         "or a substring to match speaker_id (e.g. 'Nyckfull').")
    ap.add_argument("--out", default=str(Path(__file__).parent / "train_sv.csv"))
    args = ap.parse_args()

    rows = load_rows()
    passing = [r for r in rows
               if r["dnsmos"] >= args.min_dnsmos
               and args.min_dur <= r["duration"] <= args.max_dur]

    if not passing:
        sys.exit("No clips passed the filter; loosen --min-dnsmos / duration bounds.")

    # Decide speaker selection.
    by_speaker = defaultdict(list)
    for r in passing:
        by_speaker[r["speaker_id"]].append(r)

    mode = args.single_speaker
    if mode == "all":
        selected = passing
        chosen_desc = f"all {len(by_speaker)} speakers (multi-speaker)"
    elif mode == "auto":
        best = max(by_speaker.items(), key=lambda kv: len(kv[1]))
        selected = best[1]
        chosen_desc = f"single speaker (auto): {best[0]!r}"
    else:
        selected = [r for r in passing if mode.lower() in r["speaker_id"].lower()]
        if not selected:
            sys.exit(f"No clips matched speaker substring {mode!r}.")
        names = sorted({r["speaker_id"] for r in selected})
        chosen_desc = f"speaker match {mode!r}: {len(names)} section(s)"

    # Write CSV: basename|text  (audio_dir is data/swedish_raw/wavs)
    out_path = Path(args.out)
    n = 0
    total_sec = 0.0
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f, delimiter="|")
        for r in selected:
            name = Path(r["audio"]).name
            text = r["text"].strip()
            if not text:
                continue
            w.writerow([name, text])
            n += 1
            total_sec += r["duration"]

    print(f"selection      : {chosen_desc}")
    print(f"min_dnsmos     : {args.min_dnsmos}")
    print(f"duration_range : {args.min_dur}-{args.max_dur}s")
    print(f"clips_written  : {n}")
    print(f"total_audio    : {total_sec/60:.1f} min ({total_sec/3600:.2f} h)")
    print(f"csv            : {out_path}")
    print(f"audio_dir      : {AUDIO_DIR}")
    print(f"espeak_voice   : sv")


if __name__ == "__main__":
    main()
