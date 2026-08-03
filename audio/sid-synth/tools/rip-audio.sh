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

# spectral-compare needs numpy. An active virtualenv earlier in PATH (a project
# .venv, say) shadows the interpreter that has it, and the only symptom is a
# ModuleNotFoundError buried under the renders - i.e. the audio metric silently
# stops working. Pick the first interpreter that can actually import numpy.
PY="${PYTHON:-python3}"
if ! "$PY" -c 'import numpy' >/dev/null 2>&1; then
    PY=""
    for cand in /usr/bin/python3 /opt/homebrew/bin/python3 python3.12 python3.11 python3; do
        if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import numpy' >/dev/null 2>&1; then
            PY="$cand"; break
        fi
    done
    if [ -z "$PY" ]; then
        echo "rip-audio: no python3 with numpy found (set PYTHON=/path/to/python3)" >&2
        exit 1
    fi
fi

"$PY" tools/spectral-compare.py "$OUT/orig.wav" "$OUT/rip.wav" --label "$LABEL" "${@:6}"
echo "(wavs in $OUT)"
