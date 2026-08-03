#!/bin/bash
# rip-guards.sh - run the WHOLE rip guard corpus and show it against the
# expected baseline. This is the regression gate for any sid-ripper.html
# change, the way `make verify` is the gate for engine changes.
#
#   make guards                 # or: tools/rip-guards.sh
#   tools/rip-guards.sh terra   # only labels matching "terra"
#
# Each tune guards a different player style, and they were chosen because they
# actually caught regressions - see the notes per row. A rip change that moves
# ANY of these needs an explanation before it is committed.
#
# Baselines are 30 s (1500 frames) captures as of 2026-08-03 (commit f408712).
# NOTE: 30 s is deliberate HERE for speed and stability; it is NOT the right
# capture length for listening - the ripper auto-fills the real song length
# from HVSC, and a short capture silently truncates the song.
set -e
cd "$(dirname "$0")/.."

FILTER="${1:-}"
HV=hvsc-cache/MUSICIANS
HU=/hvsc/MUSICIANS

# label | local .sid | hvsc url path | subtune | expected onset/pitch | what it guards
CORPUS=(
"commando|$HV/H/Hubbard_Rob/Commando.sid|$HU/H/Hubbard_Rob/Commando.sid|0|99.7/99.4|Hubbard staccato + drum onset wavetables; also uses sync AND ring mod"
"monty0|$HV/H/Hubbard_Rob/Monty_on_the_Run.sid|$HU/H/Hubbard_Rob/Monty_on_the_Run.sid|0|100.0/98.0|1-frame octave trill; fine-grid gate-rhythmic"
"monty2|$HV/H/Hubbard_Rob/Monty_on_the_Run.sid|$HU/H/Hubbard_Rob/Monty_on_the_Run.sid|2|100.0/99.6|densest subtune (223 notes)"
"ocean|$HV/G/Galway_Martin/Ocean_Loader_1.sid|$HU/G/Galway_Martin/Ocean_Loader_1.sid|0|100.0/100.0|Galway rubato -> fidelity mode + legato tie notes"
"wizball1|$HV/G/Galway_Martin/Wizball.sid|$HU/G/Galway_Martin/Wizball.sid|1|100.0/33.0|Galway legato melody; slow-drift filter"
"lastninja|$HV/D/Daglish_Ben/Last_Ninja.sid|$HU/D/Daglish_Ben/Last_Ninja.sid|2|78.7/97.9|arp lead, order-list transposes; descending arps"
"terra0|$HV/G/Galway_Martin/Terra_Cresta.sid|$HU/G/Galway_Martin/Terra_Cresta.sid|0|100.0/100.0|exact 64-frame filter cycle + PWM"
"terra8|$HV/G/Galway_Martin/Terra_Cresta.sid|$HU/G/Galway_Martin/Terra_Cresta.sid|8|99.5/100.0|densest Terra subtune (366 notes)"
"miami0|$HV/G/Galway_Martin/Miami_Vice.sid|$HU/G/Galway_Martin/Miami_Vice.sid|0|100.0/99.7|SHORT notes (5f on a 3f grid) - note-length guard"
"rat0|$HV/G/Galway_Martin/Rolands_Ratrace.sid|$HU/G/Galway_Martin/Rolands_Ratrace.sid|0|100.0/96.8|the only SYNC-sweep tune; ringing sync source"
)

if ! curl -s -o /dev/null --max-time 3 http://localhost:8471/sid-ripper.html; then
    echo "rip-guards: dev server not responding on :8471 - run 'make serve' first" >&2
    exit 1
fi

printf "%-12s %-8s %-8s   %s\n" "tune" "onset" "pitch" "expected (onset/pitch)"
printf -- "------------------------------------------------------------------\n"
fails=0
for row in "${CORPUS[@]}"; do
    IFS='|' read -r label sid url sub expect note <<< "$row"
    [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue
    if [ ! -f "$sid" ]; then
        printf "%-12s %s\n" "$label" "SKIP (no local .sid - it will be fetched on first rip)"
    fi
    line=$(tools/rip-measure.sh "$sid" "$url" "$sub" 1500 "$label" 2>/dev/null || echo "FAILED")
    onset=$(sed -E 's/.*onset match ([0-9.]+)%.*/\1/' <<< "$line")
    pitch=$(sed -E 's/.*pitch exact ([0-9.]+)%.*/\1/' <<< "$line")
    exp_on=${expect%%/*}; exp_pi=${expect##*/}
    flag=""
    if [ "$onset" != "$exp_on" ] || [ "$pitch" != "$exp_pi" ]; then flag="  <== CHANGED"; fails=$((fails+1)); fi
    printf "%-12s %-8s %-8s   %s%s\n" "$label" "${onset:-?}" "${pitch:-?}" "$expect" "$flag"
done
printf -- "------------------------------------------------------------------\n"
if [ "$fails" -gt 0 ]; then
    echo "$fails guard(s) CHANGED - explain before committing (update the baselines here if intended)"
else
    echo "all guards match baseline"
fi
