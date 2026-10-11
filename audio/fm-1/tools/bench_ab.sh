#!/usr/bin/env bash
# Interleaved A/B speed comparison of two fm1-live builds (A, B, A, B, ...: machine drift
# between back-to-back runs fakes 6-8% differences). Prints the median real-time factor of each.
#   tools/bench_ab.sh OLD_BIN NEW_BIN [rounds=3] [firmware ids...]   (default: felucca x0x ghoulbox)
#   MS=6000 MHZ=240 ENV="FM1_NO_JIT=1" tools/bench_ab.sh ...
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
A="$1"; B="$2"; N="${3:-3}"; shift 2; [ $# -gt 0 ] && shift
FW="${*:-felucca x0x ghoulbox}"
MS="${MS:-6000}"; MHZ="${MHZ:-240}"
STOCK="reference/FM-1-RE/firmware-images/v13/raw_fw/FM-1.fwsc"
run() {
  local src=(--fw "$2"); [ "$2" = stock ] && src=(--fwsc "$STOCK")
  env ${ENV:-} "$1" "${src[@]}" --mhz "$MHZ" --bench "$MS" 2>&1 | sed -nE 's/.* ([0-9.]+)x real time.*/\1/p' | tail -1
}
median() { tr ' ' '\n' | grep . | sort -n | awk '{a[NR]=$1} END {print a[int((NR+1)/2)]}'; }
printf "%-14s %8s %8s %7s\n" firmware A B "B/A"
for f in $FW; do
  ra=""; rb=""
  for _ in $(seq "$N"); do ra="$ra $(run "$A" "$f")"; rb="$rb $(run "$B" "$f")"; done
  ma="$(median <<<"$ra")"; mb="$(median <<<"$rb")"
  awk -v f="$f" -v a="$ma" -v b="$mb" 'BEGIN { printf "%-14s %7sx %7sx %7.3f\n", f, a, b, b / a }'
done
