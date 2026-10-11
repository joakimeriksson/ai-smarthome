#!/bin/sh
# Build the SID bench (fm1/bench.c) for the FM-1's pi32v2 CPU with the JieLi toolchain:
#   fm1/build.sh [chips] [opt]     -> build/bench_<chips>.bin (flat, +0x120 pad for fm1-emu --bin)
# JIELI_TOOLCHAIN: the toolchain root (default: ../fm-1/reference/toolchain/jieli-linux-toolchains-*,
# which ../fm-1/docs/recon.md says how to fetch). Linux x86-64 runs it natively.
# SPDX-License-Identifier: BSD-2-Clause
set -eu
cd "$(dirname "$0")/.."
CHIPS="${1:-1}"
OPT="${2:--O2}"
TC="${JIELI_TOOLCHAIN:-$(ls -d ../fm-1/reference/toolchain/jieli-linux-toolchains-* 2>/dev/null | tail -1)}"
[ -x "$TC/pi32v2/bin/clang" ] || { echo "build.sh: no JieLi toolchain (set JIELI_TOOLCHAIN)"; exit 1; }
CC="$TC/pi32v2/bin/clang -target pi32v2"
O=build/fm1_$CHIPS
mkdir -p "$O"
CF="$OPT -ffreestanding -nostdlib -fno-builtin -Wall -Wno-unused-function -DWL_CHIPS=$CHIPS"
$CC -c fm1/crt0.S -o "$O/crt0.o"
$CC $CF -c src/sid.c -o "$O/sid.o"
$CC $CF -c src/sidsynth.c -o "$O/sidsynth.o"
$CC $CF -c fm1/bench.c -o "$O/bench.o"
"$TC/pi32v2/bin/ld" -T fm1/bench.ld -e _start "$O/crt0.o" "$O/bench.o" "$O/sidsynth.o" "$O/sid.o" -o "$O/bench.elf"
# .data loads right after .text (bench.ld: > RAM AT > XIP); the program copies it itself
"$TC/common/bin/objcopy" -O binary -j .text "$O/bench.elf" "$O/text.bin"
"$TC/common/bin/objcopy" -O binary -j .data "$O/bench.elf" "$O/data.bin"
cat "$O/text.bin" "$O/data.bin" > "$O/bench.raw"
"$TC/common/bin/objdump" -d "$O/bench.elf" > "$O/bench.dis"
python3 - "$O/bench.raw" "build/bench_$CHIPS.bin" <<'PY'
import sys
b = open(sys.argv[1], 'rb').read()
open(sys.argv[2], 'wb').write(b'\0' * 0x120 + b)
print(f"{sys.argv[2]}: {len(b)} bytes (+0x120 pad)")
PY
