#!/bin/sh
# Fetch the reference SID engines into ext/ (GPL-2.0-or-later, not part of this repo) and
# generate the headers their autoconf builds would make:
#   reSID 0.16 (Dag Lem), reSID 1.0 (libsidplayfp/resid), reSIDfp (libsidplayfp/libresidfp),
#   libsidplayfp 2.6.0 (patched with a SID write hook, for build/sidlogger)
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
echo "ext/: reSID 0.16, reSID 1.0, reSIDfp, libsidplayfp ready"
