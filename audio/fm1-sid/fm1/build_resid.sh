#!/bin/sh
# Build reSID 0.16 + the workload replay (fm1/bench_resid.cc) for the FM-1's pi32v2:
#   fm1/build_resid.sh METHOD [opt]  -> build/resid_<METHOD>.bin   (0 fast, 1 interpolate, 2 resample)
# Needs ext/resid-0.16 (tools/fetch_ext.sh) and build/cmp/workload.sidlog (make compare / sid_record).
set -eu
cd "$(dirname "$0")/.."
M="${1:-0}"
OPT="${2:--O2}"
TC="${JIELI_TOOLCHAIN:-$(ls -d ../fm-1/reference/toolchain/jieli-linux-toolchains-* 2>/dev/null | tail -1)}"
O=build/fm1_resid_$M
mkdir -p "$O"
python3 fm1/sidlog2h.py build/cmp/workload.sidlog "$O/wl_log.h"
CXX="$TC/pi32v2/bin/clang++ -target pi32v2 -mcpu=r3 -mfprev1 -ffp-contract=off"
CF="$OPT -I$TC/pi32v2/include -ffreestanding -fno-builtin -fno-exceptions -fno-rtti -w -Iext/resid-0.16 -I$O -DMETHOD=$M ${EXTRA:-}"
"$TC/pi32v2/bin/clang" -target pi32v2 -c fm1/crt0.S -o "$O/crt0.o"
OBJS=""
for f in sid voice wave envelope filter extfilt pot wave6581_PST wave6581_PS_ wave6581_P_T wave6581__ST \
         wave8580_PST wave8580_PS_ wave8580_P_T wave8580__ST; do
    $CXX $CF -c ext/resid-0.16/$f.cc -o "$O/$f.o"
    OBJS="$OBJS $O/$f.o"
done
$CXX $CF -c fm1/bench_resid.cc -o "$O/bench.o"
L="$TC/pi32v2/lib/r3"
"$TC/pi32v2/bin/ld" --gc-sections -T fm1/bench_resid.ld -e _start "$O/crt0.o" "$O/bench.o" $OBJS \
    --start-group "$L/libm.a" "$L/libc.a" "$L/libcompiler_rt.a" --end-group -o "$O/bench.elf"
"$TC/common/bin/objcopy" -O binary -j .text "$O/bench.elf" "$O/text.bin"
"$TC/common/bin/objcopy" -O binary -j .data "$O/bench.elf" "$O/data.bin"
cat "$O/text.bin" "$O/data.bin" > "$O/bench.raw"
"$TC/common/bin/objdump" -d "$O/bench.elf" > "$O/bench.dis"
python3 - "$O/bench.raw" "build/resid_$M.bin" <<'PY'
import sys
b = open(sys.argv[1], 'rb').read()
open(sys.argv[2], 'wb').write(b'\0' * 0x120 + b)
print(f"{sys.argv[2]}: {len(b)} bytes (+0x120 pad)")
PY
