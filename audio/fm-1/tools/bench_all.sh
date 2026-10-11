#!/usr/bin/env bash
# Speed of every firmware, native (fm1-live --bench) and optionally the wasm build (web/bench.mjs),
# as one table to diff before and after a change. Optionally keeps each bench's audio and compares
# it with an earlier run's: the identity check for changes that must not change behaviour.
#
#   tools/bench_all.sh                        # native, 8 s per firmware
#   WASM=1 tools/bench_all.sh                 # + the wasm build at 240 MHz (web/build.sh first)
#   WAV=dir tools/bench_all.sh                # keep the audio as dir/<id>.raw
#   WAV=new REF=old tools/bench_all.sh        # ... and compare it with old/<id>.raw
#   BIN=path/to/fm1-live MS=6000 MHZ=240 FW="felucca x0x" tools/bench_all.sh
#   ENV="FM1_NO_JIT=1" tools/bench_all.sh     # extra environment for the native runs
#
# "stock" is M-VAVE's V13 package (reference/FM-1-RE), dual core.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BIN="${BIN:-target/release/fm1-live}"
MS="${MS:-8000}"
MHZ="${MHZ:-240}"
STOCK="reference/FM-1-RE/firmware-images/v13/raw_fw/FM-1.fwsc"
if [ -z "${FW:-}" ]; then
  FW="$("$BIN" --fw list 2>&1 | grep -v missing | awk '{print $1}' | tr '\n' ' ') stock"
fi
[ -n "${WAV:-}" ] && mkdir -p "$WAV"
printf "%-14s %8s %9s" firmware native "M insn/s"
[ -n "${WASM:-}" ] && printf " %8s" wasm
[ -n "${REF:-}" ] && printf "  audio"
echo
for f in $FW; do
  if [ "$f" = stock ]; then src=(--fwsc "$STOCK"); else src=(--fw "$f"); fi
  wavenv=()
  [ -n "${WAV:-}" ] && wavenv=(FM1_BENCH_WAV="$WAV/$f.raw")
  line="$(env ${ENV:-} ${wavenv[@]+"${wavenv[@]}"} "$BIN" "${src[@]}" --mhz "$MHZ" --bench "$MS" 2>&1 | grep "real time")"
  x="$(sed -E 's/.* ([0-9.]+)x real time.*/\1/' <<<"$line")"
  mi="$(sed -E 's/.* ([0-9.]+) M instructions.*/\1/' <<<"$line")"
  printf "%-14s %7sx %9s" "$f" "${x:-?}" "${mi:-?}"
  if [ -n "${WASM:-}" ]; then
    if [ "$f" = stock ]; then pkg="$STOCK"; else pkg="reference/firmwares/$f.fwsc"; fi
    w="$(FM1_FWSC="$pkg" node web/bench.mjs "$MHZ" "$((MS / 1000))" 2>&1 | sed -nE 's/.* ([0-9.]+)x real time.*/\1/p')"
    printf " %7sx" "${w:-?}"
  fi
  if [ -n "${REF:-}" ]; then
    # (a bench can end an audio half earlier or later: the run loop checks its budget per block)
    c="$(cmp "$WAV/$f.raw" "$REF/$f.raw" 2>&1)"
    if [ -z "$c" ]; then printf "  same"; elif grep -q EOF <<<"$c"; then printf "  same (prefix)"; else printf "  DIFFERENT"; fi
  fi
  echo
done
