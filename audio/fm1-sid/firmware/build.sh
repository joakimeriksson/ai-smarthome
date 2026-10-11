#!/bin/sh
# Build the SID player firmware for the FM-1 (pi32v2, JieLi toolchain):
#   firmware/build.sh   -> build/fw/sidplayer.bin (app.bin for XIP 0x02000120)
#                          build/fw/sidplayer_xip.bin (+0x120 pad, for fm1-emu --bin)
#                          build/fw/sidplayer_base.bin (no tune pack: the web page appends one)
# Needs ext/ (tools/fetch_ext.sh: reSID 0.16, chips/m6502.h, Felucca's hal). The tunes come
# after the image as a tune pack (tools/sidpack.py); without one it plays its own tune.
# SPDX-License-Identifier: GPL-3.0-only
set -eu
cd "$(dirname "$0")/.."
TC="${JIELI_TOOLCHAIN:-$(ls -d ../fm-1/reference/toolchain/jieli-linux-toolchains-* 2>/dev/null | tail -1)}"
O=build/fw
F=ext/Felucca/firmware
L="$TC/pi32v2/lib/r3"
mkdir -p "$O"
python3 firmware/gen_assets.py "$O/assets.h"
CC="$TC/pi32v2/bin/clang -target pi32v2 -mcpu=r3 -mfprev1 -ffp-contract=off"
CXX="$TC/pi32v2/bin/clang++ -target pi32v2 -mcpu=r3 -mfprev1 -ffp-contract=off"
CF="-O2 -ffunction-sections -fno-builtin -ffreestanding -Wall -Wno-unused-function -I$TC/pi32v2/include"
$CC -c $F/crt0.S -o $O/crt0.o
$CC -c $F/hal/fm1_vec.S -o $O/fm1_vec.o
$CC -c $F/hal/fm1_isr.S -o $O/fm1_isr.o
$CC $CF -I$F/hal -Isrc -Iplayer -I$O -c firmware/main.c -o $O/main.o
$CC $CF -c src/sid.c -o $O/own_sid.o
$CC $CF -Iext/chips -c player/psid.c -o $O/psid.o
OBJS="$O/crt0.o $O/fm1_vec.o $O/fm1_isr.o $O/main.o $O/own_sid.o $O/psid.o"
for f in sid voice wave envelope filter extfilt pot wave6581_PST wave6581_PS_ wave6581_P_T wave6581__ST \
         wave8580_PST wave8580_PS_ wave8580_P_T wave8580__ST; do
    $CXX $CF -fno-exceptions -fno-rtti -w -Iext/resid-0.16 -c ext/resid-0.16/$f.cc -o $O/$f.o
    OBJS="$OBJS $O/$f.o"
done
$CXX $CF -fno-exceptions -fno-rtti -Iext/resid-0.16 -c firmware/resid_glue.cc -o $O/resid_glue.o
"$TC/pi32v2/bin/ld" --gc-sections -T firmware/app.ld -e _start $OBJS $O/resid_glue.o \
    --start-group "$L/libm.a" "$L/libc.a" "$L/libcompiler_rt.a" --end-group -o $O/sidplayer.elf
"$TC/common/bin/objcopy" -O binary -j .text $O/sidplayer.elf $O/text.bin
"$TC/common/bin/objcopy" -O binary -j .data $O/sidplayer.elf $O/data.bin
"$TC/common/bin/objdump" -d $O/sidplayer.elf > $O/sidplayer.dis
"$TC/pi32v2/bin/nm" $O/sidplayer.elf > $O/sidplayer.nm 2>/dev/null || "$TC/common/bin/nm" $O/sidplayer.elf > $O/sidplayer.nm
python3 - "$O" <<'PY'
import sys, re
o = sys.argv[1]
nm = {l.split()[-1]: int(l.split()[0], 16) for l in open(f"{o}/sidplayer.nm") if len(l.split()) == 3}
text, data = open(f"{o}/text.bin", "rb").read(), open(f"{o}/data.bin", "rb").read()
gap = nm["_data_load"] - 0x02000120 - len(text)
img = text + b"\xff" * gap + data
img += b"\xff" * (-len(img) % 4)
assert nm["_start"] == 0x02000120, hex(nm["_start"])
assert img[:4] == bytes([0x04, 0x81, 0x80, 0x00]), img[:4].hex()
assert len(img) == nm["_pack"] - 0x02000120, (len(img), hex(nm["_pack"]))
assert len(img) <= 0x8DFBC, f"image {len(img)} > app slot"
open(f"{o}/sidplayer_base.bin", "wb").write(img)
img += b"SIDPACK1" + bytes(8)              # an empty pack: the firmware's own tune
open(f"{o}/sidplayer.bin", "wb").write(img)
open(f"{o}/sidplayer_xip.bin", "wb").write(b"\0" * 0x120 + img)
ram = nm["_bss_end"] - 0x01C08000
print(f"{o}/sidplayer.bin: {len(img)} bytes of the 581564 app slot; RAM {ram} of 442368 bytes")
PY
# the web page (web/) boots the firmware without a pack and serves the own tune as a file
cp "$O/sidplayer_base.bin" web/sidplayer.bin
cp "$O/house.sid" web/house.sid
