#!/bin/bash
# rip-measure.sh - measure ONE tune through the full rip loop and print the
# rip-compare summary line.
#
#   tools/rip-measure.sh <local.sid> <hvsc-url-path> <subtune0based> <frames> <label>
#
# e.g. tools/rip-measure.sh sids/Commando.sid /sids/Commando.sid 0 1500 commando
#
# The pipeline is:
#   sid-dump.js       original .sid -> register dump   (ground truth)
#   rip-roundtrip.mjs .sid -> ripper -> tracker -> .sng (needs the dev server)
#   worklet-dump.js   .sng -> register dump             (what the rip plays)
#   rip-compare.js    musical diff of the two dumps
#
# Intermediate dumps land in $RIP_WORK (default: a temp dir) so they can be
# inspected afterwards - most ripper debugging starts by diffing those two
# JSON dumps frame by frame.
set -e
cd "$(dirname "$0")/.."

SID="$1"; URL="$2"; SUB="${3:-0}"; FR="${4:-1500}"; LABEL="${5:-$(basename "$SID" .sid)}"
if [ -z "$SID" ] || [ -z "$URL" ]; then
    echo "usage: tools/rip-measure.sh <local.sid> <hvsc-url-path> <subtune> <frames> <label>" >&2
    exit 2
fi

WORK="${RIP_WORK:-${TMPDIR:-/tmp}/rip-measure}"
mkdir -p "$WORK"
SECS=$(( FR / 50 ))

# Preflight: the round trip drives a real browser against the dev server, and
# without it playwright fails with an opaque "Could not connect" stack.
if ! curl -s -o /dev/null --max-time 3 http://localhost:8471/sid-ripper.html; then
    echo "rip-measure: dev server not responding on :8471 - run 'make serve' first" >&2
    exit 1
fi

node tools/sid-dump.js "$SID" --subtune "$SUB" --frames "$FR" > "$WORK/$LABEL-orig.json" 2>/dev/null
node tools/rip-roundtrip.mjs "$URL" "$WORK/$LABEL-rip.sng" "$SECS" "$SUB" >/dev/null 2>&1
node tools/worklet-dump.js "$WORK/$LABEL-rip.sng" --frames "$FR" > "$WORK/$LABEL-rep.json" 2>/dev/null

printf "%-12s " "$LABEL:"
node tools/rip-compare.js "$WORK/$LABEL-orig.json" "$WORK/$LABEL-rep.json" 2>/dev/null | grep SUMMARY
