#!/bin/sh
# C64 tunes for the comparison: fetch tunes from HVSC (not part of the repo), run them on
# libsidplayfp's C64 with build/sidlogger (register stream, cycle-exact), replay on every
# engine, and render a reference with sidplayfp (reSIDfp) when it is installed.
#   tools/tunes.sh [seconds]      -> build/cmp/tune_<name>.<engine>.wav, .ref.wav
set -eu
cd "$(dirname "$0")/.."
SECS="${1:-30}"
HVSC="${HVSC_MIRROR:-https://hvsc.brona.dk/HVSC/C64Music}"
mkdir -p build/tunes build/cmp
# name  path-in-HVSC  song
while read -r name path song; do
    [ -z "$name" ] && continue
    f="build/tunes/$(basename "$path")"
    [ -f "$f" ] || curl -sSf -o "$f" "$HVSC/$path"
    build/sidlogger "$f" "build/cmp/tune_$name.sidlog" "$song" "$SECS"
    build/sid_replay "build/cmp/tune_$name.sidlog" "build/cmp/tune_$name" > /dev/null
    if command -v sidplayfp > /dev/null; then
        sidplayfp -q -m -o"$song" -t$((SECS + 4)) --residfp -w"build/tunes/$name.ref.wav" "$f" > /dev/null 2>&1 || true
    fi
done <<'LIST'
contaxia     MUSICIANS/O/Ouwehand_Reyn/Contaxia.sid               1
thatsthe     MUSICIANS/T/Tel_Jeroen/Thats_the_Way_It_Is_main.sid  1
pandora      MUSICIANS/H/Hubbard_Rob/Pandora.sid                  1
killerring   MUSICIANS/D/Daglish_Ben/Killer-Ring.sid              1
badblood     MUSICIANS/O/Ouwehand_Reyn/Bad_Blood-City.sid         1
lightforce   MUSICIANS/H/Hubbard_Rob/Lightforce.sid               1
rawrecruit   MUSICIANS/F/Follin_Tim/Raw_Recruit.sid               1
wizball2     MUSICIANS/G/Galway_Martin/Wizball.sid                2
wizball4     MUSICIANS/G/Galway_Martin/Wizball.sid                4
wizball7     MUSICIANS/G/Galway_Martin/Wizball.sid                7
wizball9     MUSICIANS/G/Galway_Martin/Wizball.sid                9
commando     MUSICIANS/H/Hubbard_Rob/Commando.sid                 1
monty        MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid         1
delta        MUSICIANS/H/Hubbard_Rob/Delta.sid                    1
cybernoid2   MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid              1
lastninja    MUSICIANS/D/Daglish_Ben/Last_Ninja.sid               1
altdisco     MUSICIANS/J/Jammer/Alt_Disco.sid                     1
LIST
