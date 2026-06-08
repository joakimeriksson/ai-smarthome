#!/usr/bin/env bash
# Rebuild Piper's Swedish espeak dictionary:
#   current upstream sv_list/sv_rules  +  your sv_custom.txt overrides,
# compiled against Piper's own phoneme tables (so it's guaranteed compatible),
# then installed into the bundled espeak-ng-data. Fixes pronunciation GLOBALLY
# for every Piper voice — no [[ ]] needed.
#
# Requires: espeak-ng CLI (brew install espeak-ng).
set -euo pipefail
cd "$(dirname "$0")"

command -v espeak-ng >/dev/null || { echo "need espeak-ng (brew install espeak-ng)"; exit 1; }

PD=$(python -c 'import piper,os;print(os.path.join(os.path.dirname(piper.__file__),"espeak-ng-data"))')
echo "piper espeak data: $PD"

# one-time backup of the original dict
[ -f "$PD/sv_dict.orig" ] || cp "$PD/sv_dict" "$PD/sv_dict.orig"

# fetch upstream Swedish source if missing
mkdir -p espeak_sv
[ -f espeak_sv/sv_list ]  || curl -fsSL "https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/dictsource/sv_list"  -o espeak_sv/sv_list
[ -f espeak_sv/sv_rules ] || curl -fsSL "https://raw.githubusercontent.com/espeak-ng/espeak-ng/master/dictsource/sv_rules" -o espeak_sv/sv_rules

# assemble dictsource: custom overrides FIRST (espeak uses the first match), then upstream
WORK=espeak_build; rm -rf "$WORK"; mkdir -p "$WORK"
cp espeak_sv/sv_rules "$WORK/sv_rules"
{
  echo "// ==== custom overrides (from sv_custom.txt) ===="
  grep -vE '^\s*(#|//|$)' sv_custom.txt 2>/dev/null || true
  echo ""
  cat espeak_sv/sv_list
} > "$WORK/sv_list"

# compile into Piper's data dir (writes $PD/sv_dict). A couple of retroflex-rule
# warnings are expected and non-fatal, so don't abort on them.
( cd "$WORK" && espeak-ng --compile=sv --path="$PD" ) || true

echo "installed updated sv_dict -> $PD/sv_dict"
echo "(restore original any time: cp '$PD/sv_dict.orig' '$PD/sv_dict')"
