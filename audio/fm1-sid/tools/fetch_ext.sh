#!/bin/sh
# Fetch the reference SID engines into ext/ (GPL-2.0-or-later, not part of this repo) and
# generate the headers their autoconf builds would make:
#   reSID 0.16 (Dag Lem), reSID 1.0 (libsidplayfp/resid), reSIDfp (libsidplayfp/libresidfp),
#   libsidplayfp 2.6.0 (patched with a SID write hook, for build/sidlogger)
# and for the player firmware: floooh/chips m6502.h (zlib) and Felucca's FM-1 hal (GPL-3.0),
# and for its update package three AC79 SDK files (Apache-2.0)
set -eu
cd "$(dirname "$0")/.."
mkdir -p ext && cd ext
[ -d resid-0.16 ] || { curl -sSfL -o r016.tgz http://www.zimmers.net/anonftp/pub/cbm/crossplatform/emulators/resid/resid-0.16.tar.gz && tar xzf r016.tgz && rm r016.tgz; }
[ -d resid10 ] || git clone -q --depth 1 https://github.com/libsidplayfp/resid resid10
[ -d residfp ] || git clone -q --depth 1 https://github.com/libsidplayfp/libresidfp residfp
cd resid10
for f in *.dat; do [ -f "${f%.dat}.h" ] || perl samp2src.pl "${f%.dat}" "$f" "${f%.dat}.h"; done
sed -e 's/@RESID_INLINING@/1/;s/@RESID_INLINE@/inline/;s/@RESID_BRANCH_HINTS@/1/;s/@NEW_8580_FILTER@/0/' \
    -e 's/@HAVE_BOOL@/1/;s/@HAVE_BUILTIN_EXPECT@/1/;s/@HAVE_LOG1P@/1/' siddefs.h.in > siddefs.h
cd ../residfp/src
sed -e 's/@RESIDFP_BRANCH_HINTS@/1/;s/@HAVE_BUILTIN_EXPECT@/1/;s/@PACKAGE_VERSION@/git/' \
    -e 's/@RESIDFP_INLINING@/1/;s/@RESIDFP_INLINE@/inline/' siddefs-fp.h.in > siddefs-fp.h
sed -e 's/@LIB_MAJOR@/3/;s/@LIB_MINOR@/0/;s/@LIB_LEVEL@/0/' residfp/sidversion.h.in > residfp/sidversion.h
# libsidplayfp 2.6.0 with a write hook (tools/libsidplayfp-2.6.0-sidlog.patch) for build/sidlogger
cd ../..
if [ ! -f libsidplayfp-2.6.0/src/.libs/libsidplayfp.a ]; then
    [ -d libsidplayfp-2.6.0 ] || { curl -sSfL -o lsp.tgz https://github.com/libsidplayfp/libsidplayfp/releases/download/v2.6.0/libsidplayfp-2.6.0.tar.gz && tar xzf lsp.tgz && rm lsp.tgz
        patch -s -d libsidplayfp-2.6.0 -p1 < ../tools/libsidplayfp-2.6.0-sidlog.patch; }
    (cd libsidplayfp-2.6.0 && ./configure -q --disable-shared --enable-static --without-exsid --without-usbsid && make -s -j4)
fi
# the 6502 core for player/psid.c and the FM-1 startup / vector / ISR code for firmware/
mkdir -p chips
[ -f chips/m6502.h ] || curl -sSfL -o chips/m6502.h https://raw.githubusercontent.com/floooh/chips/master/chips/m6502.h
[ -d Felucca ] || git clone -q --depth 1 https://github.com/hugelton/Felucca Felucca
# three files of JieLi's AC79 SDK (Apache-2.0) for the .fwsc package (tools/fwsc.py), checked
# against the hashes Felucca's packages are made with
SDK=https://gitee.com/Jieli-Tech/fw-AC79_AIoT_SDK/raw/AC79NN_SDK_V1.2.1_2023-12-13/cpu/wl82/tools
for f in uboot.boot:4e3b4c220dc96641cb5a723f41e68ce41d5261ae9434bb33fbd7f2c59976ded4 \
         cfg_tool.bin:276579954f076886a6a7694f65dc71c034a63a2c204b76749065c0ac7b010d1b \
         cfg/eq_cfg_hw.bin:41167491bffed4651750719c973d2758adeb9021a5670d02d6a53c85ed80ea7d; do
    rel=${f%%:*}; sha=${f##*:}; out=ac79sdk/cpu/wl82/tools/$rel
    mkdir -p "$(dirname "$out")"
    for i in 1 2 3 4; do
        [ -f "$out" ] && echo "$sha  $out" | sha256sum -c --quiet 2>/dev/null && break
        curl -sSfL -o "$out" "$SDK/$rel" || sleep $((i * 2))
    done
    echo "$sha  $out" | sha256sum -c --quiet || { echo "ext/$out: download failed or wrong file"; exit 1; }
done
echo "ext/: reSID 0.16, reSID 1.0, reSIDfp, libsidplayfp, m6502.h, Felucca, AC79 SDK files ready"
