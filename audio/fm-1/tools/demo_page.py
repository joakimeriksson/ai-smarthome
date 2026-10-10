#!/usr/bin/env python3
"""Build a self-contained HTML page from an fm1-emu scripted run: the LCD
snapshots (work/lcd_<ms>.bmp), the I2S output (work/demo.wav) and the
--keys script (work/demo_keys.txt), shown on a schematic FM-1 front panel
that follows the audio as it plays.

    tools/demo_page.py OUT.html
"""
import base64, io, json, re, sys, wave
from pathlib import Path
from PIL import Image

W = Path(__file__).resolve().parent.parent / "work"
out = Path(sys.argv[1])

snaps = sorted((int(m.group(1)), p) for p in W.glob("lcd_*.bmp") if (m := re.match(r"lcd_(\d+)\.bmp", p.name)))
frames = []
for t, p in snaps:
    b = io.BytesIO()
    Image.open(p).convert("RGB").save(b, "PNG", optimize=True)
    frames.append([t, "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()])

wav = (W / "demo.wav").read_bytes()
with wave.open(str(W / "demo.wav")) as w:
    wav_ms = w.getnframes() * 1000 / w.getframerate()
log = (W / "demo_run.log").read_text()
run_ms = int(re.search(r"^time (\d+) ms", log, re.M).group(1))
irqs = int(re.search(r"(\d+) interrupts", log).group(1))
insns = int(re.search(r"stopped after (\d+) instructions", log).group(1))
# the WAV holds every finished half buffer; its first sample left the DMA at:
audio_t0 = run_ms - wav_ms

# --keys items -> events (same grammar as fm1-emu parse_key_script)
BTN = ["OCTDN", "OCTUP", "FX", "SCL", "ENV", "LFO", "EDIT", "GLO", "HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC"]
events = []
for item in (W / "demo_keys.txt").read_text().strip().split(","):
    when, what, *arg = item.split(":")
    t0, t1 = (map(int, when.split("-")) if "-" in when else (int(when), None))
    if what.upper() in ("SELECT", "ALGO", "PRESET", "K1", "K2", "K3", "K4"):
        events.append({"t": t0, "kind": "enc", "id": what.upper(), "clicks": int(arg[0])})
    elif what.lower().startswith("n"):
        events.append({"t": t0, "end": t1 or t0 + 150, "kind": "note", "id": int(what[1:])})
    else:
        events.append({"t": t0, "end": t1 or t0 + 150, "kind": "btn", "id": what.upper()})

data = {"frames": frames, "events": events, "audioT0": audio_t0, "runMs": run_ms}
wav_uri = "data:audio/wav;base64," + base64.b64encode(wav).decode()

html = (Path(__file__).with_name("demo_page.html")).read_text()
html = html.replace("__DATA__", json.dumps(data)).replace("__WAV__", wav_uri)
html = html.replace("__STATS__", f"{run_ms / 1000:.1f} s emulated · {insns / 1e6:.0f} M instructions · {irqs:,} interrupts · {wav_ms / 1000:.2f} s of I2S audio")
out.write_text(html)
print(f"{out}: {len(html) / 1e6:.2f} MB, {len(frames)} frames, {len(events)} events, audio from {audio_t0:.0f} ms")
