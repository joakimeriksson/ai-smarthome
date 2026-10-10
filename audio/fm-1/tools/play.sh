#!/usr/bin/env bash
# Run Felucca in the emulator with a front-panel script, then play the sound
# and open a page with the screen, keys and knobs following the audio.
#
#   tools/play.sh                         # a short default tune
#   tools/play.sh 4000 "800-1200:C4,1300-1700:E4,1800-2600:G4,2000:K1:-6"
#
# Script items (times in emulated ms; nothing reaches Felucca before ~700 ms):
#   800-1200:C4     hold a note (F3..G5, sharps as F#4)
#   2000:PLAY       tap a button: FX SCL ENV LFO EDIT GLO HOME SAVE ARP SEQ PLAY REC OCTDN OCTUP
#   2000:K1:-6      turn an encoder by clicks, + = clockwise: K1..K4 SELECT ALGO PRESET
#   2500:pot:300    the MASTER pot, 0..1023
# One emulated second takes ~14 s to compute.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MS="${1:-3000}"
KEYS="${2:-800-1050:C4,1100-1350:E4,1400-1650:G4,1700-2600:C5,1900:K1:-3,2200:K1:-3}"

[ -f work/felucca_xip.bin ] || { echo "work/felucca_xip.bin missing: build Felucca first (see PLAN.md 5.6)"; exit 1; }
cargo build --release -q
rm -f work/lcd_*.bmp
echo "$KEYS" > work/demo_keys.txt
SNAPS=$(python3 -c "print(','.join(str(t) for t in range(400, $MS + 1, 100)))")
echo "running ${MS} ms of emulated time (about $(( MS * 14 / 1000 )) s)..."
./target/release/fm1-emu --bin work/felucca_xip.bin --entry 0x02000120 --ms "$MS" \
  --wav work/demo.wav --keys "$KEYS" --snap "$SNAPS" > work/demo_run.log 2>&1 || true
grep -E "^time|^wav|halt reason" work/demo_run.log || { tail -20 work/demo_run.log; exit 1; }
python3 tools/demo_page.py work/session.html
[ -n "${NO_OPEN:-}" ] || open work/session.html
[ -n "${NO_OPEN:-}" ] || afplay work/demo.wav
