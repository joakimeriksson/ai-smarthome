#!/bin/bash
# rip-audio.sh - render an original .sid and a ripped .sng through the SAME
# engine (sidplayfp) and compare them at the AUDIO level.
#
#   tools/rip-audio.sh <orig.sid> <rip.sng> <subtune0based> [seconds] [label]
#
# Complements tools/rip-compare.js, which only sees notes/pitch/gates and is
# blind to timbre (filter, PWM, waveform). See tools/spectral-compare.py.
set -e
cd "$(dirname "$0")/.."
SID="$1"; SNG="$2"; SUB="${3:-0}"; SECS="${4:-20}"; LABEL="${5:-$(basename "$SID" .sid)}"
OUT="${TMPDIR:-/tmp}/rip-audio-$$"
mkdir -p "$OUT"

# sidplayfp -o<num> is a 1-BASED track number
TRACK=$((SUB + 1))
tools/bin/sidplayfp --sidlite -q -m -f44100 -o$TRACK -t"$SECS" -w"$OUT/orig.wav" "$SID" >/dev/null 2>&1
node tools/export-sid.js "$SNG" "$OUT/rip.sid" >/dev/null 2>&1
# the exported rip always has the ripped subtune as track 1
tools/bin/sidplayfp --sidlite -q -m -f44100 -o1 -t"$SECS" -w"$OUT/rip.wav" "$OUT/rip.sid" >/dev/null 2>&1

python3 tools/spectral-compare.py "$OUT/orig.wav" "$OUT/rip.wav" --label "$LABEL" "${@:6}"
echo "(wavs in $OUT)"
