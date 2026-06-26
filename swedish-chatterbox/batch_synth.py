"""Mass-synthesize a Swedish dataset with one fixed Chatterbox voice (distillation
source for Kokoro). Every clip uses the SAME female reference => single consistent
speaker. Resumable (skips existing wavs); rewrites speakers.csv periodically so a
partial run is always usable.

Output (Kokoro prepare_data.py --raw <out> consumes this):
    <out>/wavs/<idx>.wav            24 kHz mono
    <out>/speakers.csv              audio|text|speaker_id|duration|dnsmos
"""
from __future__ import annotations

import argparse
import csv
import os
import random
import time

import torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS


def write_manifest(path: str, rows: list[tuple]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="|")
        w.writerow(["audio", "text", "speaker_id", "duration", "dnsmos"])
        w.writerows(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="corpus_sv.txt")
    ap.add_argument("--ref", default="refs/female_ref.wav")
    ap.add_argument("--out", default="dataset")
    ap.add_argument("--speaker", default="sv_female")
    ap.add_argument("--limit", type=int, default=0, help="0 = whole corpus")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--shuffle", action="store_true",
                    help="shuffle corpus (default: keep file order, so priority lines go first)")
    args = ap.parse_args()

    lines = [l.strip() for l in open(args.corpus, encoding="utf-8") if l.strip()]
    if args.shuffle:
        random.Random(args.seed).shuffle(lines)
    if args.limit:
        lines = lines[: args.limit]

    wavs_dir = os.path.join(args.out, "wavs")
    os.makedirs(wavs_dir, exist_ok=True)
    manifest = os.path.join(args.out, "speakers.csv")

    print("loading Chatterbox Multilingual on cuda ...", flush=True)
    model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
    sr = model.sr
    print(f"ref={args.ref}  speaker={args.speaker}  target={len(lines)} clips", flush=True)

    rows: list[tuple] = []
    t0 = time.time()
    new = 0
    audio_sec = 0.0
    for i, text in enumerate(lines):
        wid = f"{i:06d}"
        path = os.path.join(wavs_dir, f"{wid}.wav")
        if os.path.exists(path):
            dur = ta.info(path).num_frames / sr
        else:
            try:
                wav = model.generate(text, language_id="sv", audio_prompt_path=args.ref)
            except Exception as e:  # noqa: BLE001
                print(f"skip {wid}: {e}", flush=True)
                continue
            ta.save(path, wav, sr)
            dur = wav.shape[-1] / sr
            new += 1
        audio_sec += dur
        rows.append((f"wavs/{wid}.wav", text, args.speaker, f"{dur:.3f}", "4.0"))

        if new and new % 10 == 0 and not os.path.exists(path.replace(wid, f"{i+1:06d}")):
            el = time.time() - t0
            rate = new / el * 60 if el else 0
            remain = len(lines) - i - 1
            eta = remain / rate if rate else 0
            print(f"[{i+1}/{len(lines)}] +{new} new | {rate:.1f} clips/min | "
                  f"{audio_sec/3600:.2f}h audio | ETA {eta:.0f} min", flush=True)
            write_manifest(manifest, rows)

    write_manifest(manifest, rows)
    print(f"DONE: {len(rows)} clips, {audio_sec/3600:.2f}h -> {manifest}", flush=True)


if __name__ == "__main__":
    main()
