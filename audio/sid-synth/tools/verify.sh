#!/bin/bash
# verify.sh - GT2 parity regression suite.
# For every (song, subtune) in the corpus, dumps SID register writes from:
#   ref     - native gplay.c reference (tools/gt2-refdump/gt2dump)
#   worklet - headless AudioWorklet engine (tools/worklet-dump.js)
#   sid     - exported .SID played by a 6502 emulator (tools/sid-dump.js)
#   resave  - the song saved by gt2-sng-writer.js, replayed by the native ref
# and diffs worklet/sid/resave against ref (hardware-masked, auto-align).
#
# Golden reference dumps live in tests/golden/*.json.gz. When the native
# gt2dump cannot be built (no gcc), the golden dumps serve as the reference
# so the suite still runs. When gt2dump IS available, fresh dumps are also
# diffed against golden to catch reference drift.
#
# Usage: tools/verify.sh [frames]         (default 1000)
#        tools/verify.sh --update-golden  (refresh tests/golden from gt2dump)

cd "$(dirname "$0")/.." || exit 2

UPDATE_GOLDEN=0
FRAMES=1000
for arg in "$@"; do
  case "$arg" in
    --update-golden) UPDATE_GOLDEN=1 ;;
    *) FRAMES=$arg ;;
  esac
done

DUMPS=tests/dumps
GOLDEN=tests/golden
mkdir -p "$DUMPS" "$GOLDEN" tests/songs

# Build prerequisites quietly
HAVE_REF=1
[ -x tools/gt2-refdump/gt2dump ] || make -C tools/gt2-refdump >/dev/null 2>&1 || HAVE_REF=0
node tests/make-test-songs.js >/dev/null 2>&1

if [ $UPDATE_GOLDEN -eq 1 ] && [ $HAVE_REF -eq 0 ]; then
  echo "cannot update golden dumps: gt2dump unavailable" >&2
  exit 2
fi

# corpus: song-file:subtunes
CORPUS=(
  "sids/dojo.sng:0 1 2 3"
  "tests/songs/features.sng:0 1 2 3 4 5 6 7 8 9 10"
)

pass=0; fail=0; failed=()

check() { # label, dump_a, dump_b
  local label=$1 a=$2 b=$3
  if out=$(node tools/regdiff.js "$a" "$b" --quiet 2>/dev/null); then
    printf '  \033[32mOK\033[0m   %s\n' "$label"
    pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m %s — %s\n' "$label" "$out"
    fail=$((fail+1)); failed+=("$label")
  fi
}

note_fail() { # label, message
  printf '  \033[31mFAIL\033[0m %s — %s\n' "$1" "$2"
  fail=$((fail+1)); failed+=("$1")
}

for entry in "${CORPUS[@]}"; do
  song=${entry%%:*}
  subtunes=${entry#*:}
  base=$(basename "$song" .sng)
  echo "$song:"

  # Round-trip the song once through the JS parser + writer
  resaved="$DUMPS/$base-resave.sng"
  RESAVE_OK=1
  if ! node tools/resave-sng.js "$song" "$resaved" 2>/dev/null; then
    note_fail "$base: .sng save round-trip" "parse(write(parse)) mismatch"
    RESAVE_OK=0
  fi

  # Export once: all subtunes go into a single multi-song .SID
  sidfile="$DUMPS/$base.sid"
  SID_OK=1
  if ! node tools/export-sid.js "$song" "$sidfile" 2>/dev/null; then
    note_fail "$base: export" "export failed"
    SID_OK=0
  fi

  for st in $subtunes; do
    ref="$DUMPS/$base-s$st-ref.json"
    wk="$DUMPS/$base-s$st-worklet.json"
    sid="$DUMPS/$base-s$st-sid.json"
    gold="$GOLDEN/$base-s$st-ref.json.gz"

    if [ $HAVE_REF -eq 1 ]; then
      tools/gt2-refdump/gt2dump "$song" --frames "$FRAMES" --subtune "$st" > "$ref" 2>/dev/null
      if [ $UPDATE_GOLDEN -eq 1 ]; then
        gzip -9 -c "$ref" > "$gold"
        printf '  \033[33mGOLD\033[0m %s subtune %s: golden ref updated\n' "$base" "$st"
        continue
      fi
      if [ -f "$gold" ]; then
        check "$base subtune $st: ref vs golden" "$ref" <(gunzip -c "$gold")
      fi
    elif [ -f "$gold" ]; then
      gunzip -c "$gold" > "$ref"
      printf '  \033[33mNOTE\033[0m %s subtune %s: gt2dump unavailable, using golden ref\n' "$base" "$st"
    else
      note_fail "$base subtune $st" "no gt2dump and no golden reference"
      continue
    fi

    node tools/worklet-dump.js "$song" --frames "$FRAMES" --subtune "$st" > "$wk" 2>/dev/null
    check "$base subtune $st: worklet vs ref" "$ref" "$wk"

    if [ $SID_OK -eq 1 ]; then
      node tools/sid-dump.js "$sidfile" --frames "$FRAMES" --subtune "$st" > "$sid" 2>/dev/null
      check "$base subtune $st: exported SID vs ref" "$ref" "$sid"
    fi

    if [ $RESAVE_OK -eq 1 ] && [ $HAVE_REF -eq 1 ]; then
      rsdump="$DUMPS/$base-s$st-resave.json"
      tools/gt2-refdump/gt2dump "$resaved" --frames "$FRAMES" --subtune "$st" > "$rsdump" 2>/dev/null
      check "$base subtune $st: resaved .sng vs ref" "$ref" "$rsdump"
    fi
  done
done

if [ $UPDATE_GOLDEN -eq 1 ]; then
  echo
  echo "golden dumps updated in $GOLDEN"
  exit 0
fi

echo
echo "verify: $pass passed, $fail failed"
[ $fail -eq 0 ]
