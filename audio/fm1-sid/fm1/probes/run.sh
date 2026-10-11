#!/bin/sh
# Emulator probes for 64-bit integer and soft-double code (../../../fm-1/docs/isa-notes.md,
# "Flags, carry and soft double"): build each for pi32v2 (the reSID flags) and for the host,
# run on fm1-emu, compare the result words.   fm1/probes/run.sh
set -eu
cd "$(dirname "$0")/../.."
TC="${JIELI_TOOLCHAIN:-$(ls -d ../fm-1/reference/toolchain/jieli-linux-toolchains-* 2>/dev/null | tail -1)}"
EMU=../fm-1/target/release/fm1-emu
O=build/probes
mkdir -p "$O"
L="$TC/pi32v2/lib/r3"
"$TC/pi32v2/bin/clang" -target pi32v2 -c fm1/crt0.S -o "$O/crt0.o"
fail=0
for p in int64 wide softdouble; do
    "$TC/pi32v2/bin/clang" -target pi32v2 -mcpu=r3 -mfprev1 -O1 -ffreestanding -fno-builtin -c fm1/probes/$p.c -o "$O/$p.o"
    "$TC/pi32v2/bin/ld" -T fm1/bench_resid.ld -e _start "$O/crt0.o" "$O/$p.o" \
        --start-group "$L/libm.a" "$L/libc.a" "$L/libcompiler_rt.a" --end-group -o "$O/$p.elf"
    "$TC/common/bin/objcopy" -O binary -j .text "$O/$p.elf" "$O/$p.text"
    python3 -c "import sys; b=open(sys.argv[1],'rb').read(); open(sys.argv[2],'wb').write(b'\0'*0x120+b)" "$O/$p.text" "$O/$p.bin"
    cc -O1 -DNATIVE -o "$O/$p.native" fm1/probes/$p.c
    "$O/$p.native" > "$O/$p.want"
    n=$(wc -l < "$O/$p.want")
    "$EMU" --bin "$O/$p.bin" --entry 0x02000120 --steps 5000000 --quiet --dump 0x01C80000 "$n" \
        | grep "^  0x" | cut -d: -f2- | tr ' ' '\n' | grep . | head -n "$n" > "$O/$p.got"
    if cmp -s "$O/$p.want" "$O/$p.got"; then echo "$p: ok ($n words)"; else echo "$p: DIFFERS"; diff "$O/$p.want" "$O/$p.got" | head; fail=1; fi
done
exit $fail
