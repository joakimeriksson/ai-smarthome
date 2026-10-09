#!/usr/bin/env bash
# pi32v2 compile + disassemble probe pipeline.
# Runs the JieLi vendor toolchain (Linux x86-64) in an amd64 Docker container.
#
# Usage:
#   tools/probe.sh probes/basic.c          # compile C and disassemble
#   tools/probe.sh --asm work/wrap.S       # assemble .S and disassemble
#
# Notes:
# - pi32v2/bin/cc is a python wrapper and debian:bookworm-slim has no python3,
#   so we call clang directly with -target pi32v2.
# - Output: byte pattern + vendor mnemonic per instruction — feed these
#   triples into isa/fm1.yaml.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="debian:bookworm-slim"
TC=/fm1/reference/toolchain/jieli-linux-toolchains-20250324.1

src="${1:?usage: probe.sh <file.c|file.S> [extra clang flags]}"
shift || true
base="$(basename "$src")"
obj="${base%.*}.o"

docker run --rm --platform linux/amd64 \
    -v "$ROOT":/fm1 -w "/fm1/$(dirname "$src")" "$IMAGE" bash -c "
set -e
if [[ '$base' == *.S ]]; then
  '$TC/pi32v2/bin/clang' -target pi32v2 -c '$base' -o '$obj'
else
  '$TC/pi32v2/bin/clang' -target pi32v2 -O1 -ffreestanding -nostdlib $* -c '$base' -o '$obj'
fi
'$TC/common/bin/objdump' -d '$obj'
"
