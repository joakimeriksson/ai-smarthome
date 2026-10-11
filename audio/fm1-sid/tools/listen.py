#!/usr/bin/env python3
"""Build the listening set from build/cmp (tools/compare.sh): the same register stream on each
engine, level-matched (same RMS, peaks kept under -1 dBFS), as MP3, plus spectrograms of the
pieces where aliasing shows, and the page (tools/listen.html). Output: build/listen/

    tools/listen.py
SPDX-License-Identifier: BSD-2-Clause"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CMP = ROOT / "build" / "cmp"
OUT = ROOT / "build" / "listen"
FS = 44100

ENGINES = [
    ("own", "egen (fm1-sid)"),
    ("r016-fast", "reSID 0.16 fast"),
    ("r016-resample", "reSID 0.16 resample"),
    ("r10-resample", "reSID 1.0 resample"),
    ("rfp-resample", "reSIDfp resample"),
]
# C64 tunes from HVSC (tools/tunes.sh): their 6502 code's register stream on every engine,
# plus sidplayfp's full-C64 render (reSIDfp) as a reference ("ref", aligned to ours)
TUNES = [
    ("tune_contaxia", "Contaxia – Reyn Ouwehand, 1989", "sync 57 %, ring 96 % av tiden, cutoff ändras 24 ggr/s"),
    ("tune_thatsthe", "That's the Way It Is – Jeroen Tel, 1988", "sync 68 %, ring 68 %, cutoff 38 ggr/s"),
    ("tune_pandora", "Pandora – Rob Hubbard, 1988", "sync 46 %, ring 46 %, cutoff 55 ggr/s"),
    ("tune_killerring", "Killer-Ring – Ben Daglish, 1987", "sync 53 %, ring 21 %, cutoff 50 ggr/s"),
    ("tune_badblood", "Bad Blood – City – Reyn Ouwehand, 1990", "sync 73 %, cutoff 44 ggr/s"),
    ("tune_lightforce", "Lightforce – Rob Hubbard, 1986", "sync 29 %, cutoff 45 ggr/s"),
    ("tune_rawrecruit", "Raw Recruit – Tim Follin, 1988", "sync 22 %, cutoff 44 ggr/s"),
    ("tune_wizball7", "Wizball, låt 7 – Martin Galway, 1987", "filtret hela tiden, cutoff 198 ggr/s"),
    ("tune_wizball4", "Wizball, låt 4 – Martin Galway, 1987", "filtret hela tiden, cutoff 69 ggr/s"),
    ("tune_wizball9", "Wizball, låt 9 – Martin Galway, 1987", "ring 38 %, cutoff 47 ggr/s"),
    ("tune_wizball2", "Wizball, låt 2 – Martin Galway, 1987", "filtret hela tiden, cutoff 22 ggr/s"),
    ("tune_commando", "Commando – Rob Hubbard, 1985", "puls-lead, filtrerad bas, trummor ur brus"),
    ("tune_monty", "Monty on the Run – Rob Hubbard, 1985", "snabba arpeggion och vibrato"),
    ("tune_delta", "Delta – Rob Hubbard, 1987", "långa filtersvep"),
    ("tune_cybernoid2", "Cybernoid II – Jeroen Tel, 1988", "hårt filtrerad, mycket resonans"),
    ("tune_lastninja", "The Last Ninja – Ben Daglish, 1987", "mjuka pads genom 6581-filtret"),
    ("tune_altdisco", "Alt Disco – Jammer, 2015 (8580)", "modern låt skriven för 8580"),
]
PIECES = [
    ("song_6581", "Låt, 4 chip (6581)", "bas, ackord-arpeggio, sync-lead, trummor"),
    ("song_8580", "Låt, 4 chip (8580)", "samma registerström på 8580"),
    ("patch04_6581", "SYNC LEAD (6581)", "hard sync med tonhöjdssvep"),
    ("patch01_6581", "PWM BASS (6581)", "pulsbreddssvep genom resonant lågpass"),
    ("patch09_8580", "RESO PAD (8580)", "långsamt filtersvep, hög resonans"),
    ("patch11_6581", "BP SWEEP (6581)", "bandpass med maxresonans"),
    ("patch10_8580", "P&S ORGAN (8580)", "kombinerad vågform puls+såg"),
    ("patch10_6581", "P&S ORGAN (6581)", "kombinerad vågform puls+såg"),
    ("hichord_8580", "Ackord två oktaver upp (8580)", "höga toner: här hörs aliasing"),
    ("patch06_6581", "KICK (6581)", "vågtabell: brus, puls, triangel nedåt"),
    ("patch07_6581", "SNARE (6581)", "vågtabell: brus och puls"),
]
SPECTRO = {"hichord_8580", "patch04_6581"}
TARGET_RMS = 10 ** (-20 / 20)       # -20 dBFS
PEAK_MAX = 10 ** (-1 / 20)


def read(path):
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0


def spectrogram(x, path, w=640, h=220):
    n, hop = 2048, 512
    win = np.hanning(n)
    frames = [x[i:i + n] * win for i in range(0, len(x) - n, hop)]
    s = np.abs(np.fft.rfft(np.array(frames), axis=1)).T          # freq x time
    db = 20 * np.log10(s + 1e-9)
    db = np.clip((db - (db.max() - 60)) / 60, 0, 1) ** 1.4        # 60 dB range, darker floor
    img = np.flipud(db)
    # resample to w x h
    yi = np.linspace(0, img.shape[0] - 1, h).astype(int)
    xi = np.linspace(0, img.shape[1] - 1, w).astype(int)
    img = img[yi][:, xi]
    # a dark-to-amber map that reads in both themes
    r = np.clip(img * 1.6, 0, 1)
    g = np.clip(img * 1.2 - 0.2, 0, 1)
    b = np.clip(img * 0.6 - 0.1, 0, 1) * 0.6 + 0.08
    rgb = (np.stack([r, g, b], axis=2) * 255).astype(np.uint8)
    Image.fromarray(rgb).save(path, optimize=True)


def host_cost():
    cost, piece = {}, None
    for line in (CMP / "cost.txt").read_text().splitlines():
        if line.startswith("== "):
            piece = line[3:].strip()
        elif piece and line.strip():
            name, ms = line.split()[0], float(line.split()[1])
            cost.setdefault(name, []).append(ms)
    return {k: sum(v) / len(v) for k, v in cost.items()}


def aligned_ref(stem, n):
    """sidplayfp's render of a tune, cut to line up with ours (n samples)"""
    sys.path.insert(0, str(ROOT / "tools"))
    from refcheck import align
    ref = read(ROOT / "build" / "tunes" / f"{stem[5:]}.ref.wav")
    ours = read(CMP / f"{stem}.rfp-resample.wav")
    lag = align(ref, ours)
    y = ref[lag:lag + n]
    return np.pad(y, (0, n - len(y)))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"engines": [{"id": e, "label": l} for e, l in ENGINES], "pieces": [], "host_ms": host_cost()}
    for stem, label, note in TUNES + PIECES:
        item = {"id": stem, "label": label, "note": note, "files": {}, "spectro": {}}
        engines = list(ENGINES)
        if stem.startswith("tune_") and (ROOT / "build" / "tunes" / f"{stem[5:]}.ref.wav").exists():
            engines.append(("ref", "sidplayfp"))
        for eng, _ in engines:
            if eng == "ref":
                x = aligned_ref(stem, len(read(CMP / f"{stem}.own.wav")))
            else:
                x = read(CMP / f"{stem}.{eng}.wav")
            rms = np.sqrt(np.mean(x ** 2)) or 1e-9
            g = TARGET_RMS / rms
            if np.max(np.abs(x)) * g > PEAK_MAX:
                g = PEAK_MAX / np.max(np.abs(x))
            y = np.clip(x * g, -1, 1)
            tmp = OUT / "tmp.wav"
            with wave.open(str(tmp), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(FS)
                w.writeframes((y * 32767).astype("<i2").tobytes())
            mp3 = f"{stem}__{eng}.mp3"
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(tmp),
                            "-codec:a", "libmp3lame", "-b:a", "128k" if stem.startswith("tune_") else "160k", str(OUT / mp3)], check=True)
            item["files"][eng] = mp3
            if stem in SPECTRO:
                png = f"{stem}__{eng}.png"
                spectrogram(x, OUT / png)
                item["spectro"][eng] = png
        manifest["pieces"].append(item)
        print(f"  {stem}")
    (OUT / "tmp.wav").unlink(missing_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    (OUT / "index.html").write_text((ROOT / "tools" / "listen.html").read_text())   # the page
    print(f"{OUT}: {sum(f.stat().st_size for f in OUT.iterdir()) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
