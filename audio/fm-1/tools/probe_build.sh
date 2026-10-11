#!/usr/bin/env bash
# Build a probe (probes/<name>.c + probes/harness/crt0.S) into a flat image
# the emulator can run: work/probe_<name>.bin at 0x02000120 (pad 0x120 for
# `--bin`), plus the vendor disassembly for reference.
#
#   tools/probe_build.sh arith
#   target/release/fm1-emu --bin work/probe_arith_xip.bin --entry 0x02000120 --dump 0x01C10000 52
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC=/fm1/reference/toolchain/jieli-linux-toolchains-20250324.1
name="${1:?usage: probe_build.sh <probe-name>}"
docker run --rm --platform linux/amd64 -e PROBE_CFLAGS="${PROBE_CFLAGS:-}" -v "$ROOT":/fm1 -w /fm1 debian:bookworm-slim bash -c "
set -e
mkdir -p work/probe
'$TC/pi32v2/bin/clang' -target pi32v2 -c probes/harness/crt0.S -o work/probe/crt0.o
'$TC/pi32v2/bin/clang' -target pi32v2 -O1 -ffreestanding -nostdlib -fno-builtin ${PROBE_CFLAGS:-} -c probes/$name.c -o work/probe/$name.o
'$TC/pi32v2/bin/ld' -T probes/harness/probe.ld -e _start work/probe/crt0.o work/probe/$name.o -o work/probe/$name.elf
'$TC/common/bin/objcopy' -O binary -j .text work/probe/$name.elf work/probe_$name.bin
'$TC/common/bin/objdump' -d work/probe/$name.elf > work/probe_$name.objdump.txt
"
python3 - "$ROOT/work/probe_$name.bin" "$ROOT/work/probe_${name}_xip.bin" <<'EOF'
import sys
b = open(sys.argv[1], 'rb').read()
open(sys.argv[2], 'wb').write(b'\0' * 0x120 + b)
print(f"{sys.argv[2]}: {len(b)} bytes (+0x120 pad)")
EOF
