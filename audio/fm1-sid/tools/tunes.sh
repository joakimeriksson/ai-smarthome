#!/bin/sh
# C64 tunes for the comparison: fetch PSID tunes from HVSC (not part of the repo), play their
# 6502 code with build/sidplay (register stream, cycle-exact), replay on every engine, and
# render a reference with sidplayfp (reSIDfp) when it is installed.
#   tools/tunes.sh [seconds]      -> build/cmp/tune_<name>.<engine>.wav, .ref.wav
set -eu
cd "$(dirname "$0")/.."
SECS="${1:-30}"
HVSC="${HVSC_MIRROR:-https://hvsc.brona.dk/HVSC/C64Music}"
mkdir -p build/tunes build/cmp
# name  path-in-HVSC  song
while read -r name path song; do
    [ -z "$name" ] && continue
    f="build/tunes/$name.sid"
    [ -f "$f" ] || curl -sSf -o "$f" "$HVSC/$path"
    build/sidplay "$f" "build/cmp/tune_$name.sidlog" "$song" "$SECS"
    build/sid_replay "build/cmp/tune_$name.sidlog" "build/cmp/tune_$name" > /dev/null
    if command -v sidplayfp > /dev/null; then
        sidplayfp -q -m -o"$song" -t$((SECS + 4)) --residfp -w"build/tunes/$name.ref.wav" "$f" > /dev/null 2>&1 || true
    fi
done <<'LIST'
commando     MUSICIANS/H/Hubbard_Rob/Commando.sid              1
monty        MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid      1
delta        MUSICIANS/H/Hubbard_Rob/Delta.sid                 1
cybernoid2   MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid           1
lastninja    MUSICIANS/D/Daglish_Ben/Last_Ninja.sid            1
wizball      MUSICIANS/G/Galway_Martin/Wizball.sid             2
altdisco     MUSICIANS/J/Jammer/Alt_Disco.sid                  1
LIST
