#!/usr/bin/env bash
# Disassemble a raw FM-1 app image with JieLi's objdump: wrap it in an ELF (.incbin, linked at
# BASE, default 0x02000120 as Felucca and its forks) and dump it.
#   tools/disasm_app.sh reference/firmwares/x0x-1.0.3.app.bin work/x0x_objdump.txt [0x02000120]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
app="$1"; out="$2"; base="${3:-0x02000120}"
rel_app="${app#$ROOT/}"; rel_out="${out#$ROOT/}"
TC=/fm1/reference/toolchain/jieli-linux-toolchains-20250324.1
docker run --rm --platform linux/amd64 -v "$ROOT":/fm1 -w /fm1 debian:bookworm-slim bash -c "
set -e
mkdir -p work/probe
printf '.section .text,\"ax\"\n.globl _start\n_start:\n.incbin \"/fm1/$rel_app\"\n' > work/probe/incbin.S
'$TC/pi32v2/bin/clang' -target pi32v2 -c work/probe/incbin.S -o work/probe/incbin.o
'$TC/pi32v2/bin/ld' -Ttext=$base -e _start work/probe/incbin.o -o work/probe/incbin.elf
'$TC/common/bin/objdump' -d work/probe/incbin.elf > '/fm1/$rel_out'
"
wc -l "$out"
