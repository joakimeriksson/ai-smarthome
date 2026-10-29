"""Rebuild the Synthex 6502 address space from raw EPROM dumps.

Usage: unscramble.py <T41.bin> <E-rom.bin> <F-rom.bin> <out_cpu_image.bin>

The CPU board wires the EPROM address and data lines in a permuted order
(README in dbwbp.com's ELKA_Synthex.zip), so a dump read by an ordinary
programmer is scrambled. The output is 10 KiB of memory as the CPU sees it,
starting at $D800: T41 (2 KiB, mirrored at $D000 because A11 is tied low),
then the $E000 ROM (EM3 / EU85 / E7) and the $F000 ROM (FM3 / F7).
Dumps: https://archive.org/download/vintage-synth-firmware-collection/ELKA_Synthex.zip
"""
import sys

AMAP = {0: 7, 1: 8, 2: 6, 3: 9, 4: 5, 5: 4, 6: 3, 7: 10, 8: 2, 9: 1, 10: 0, 11: 11}  # CPU A -> EPROM A
DMAP = {0: 7, 1: 6, 2: 0, 3: 2, 4: 3, 5: 4, 6: 1, 7: 5}                                # CPU D -> EPROM D


def unscramble(raw: bytes, nbits: int) -> bytes:
    out = bytearray(1 << nbits)
    for c in range(1 << nbits):
        e = 0
        for k in range(nbits):
            if c >> k & 1:
                e |= 1 << AMAP[k]
        b = raw[e]
        v = 0
        for k in range(8):
            if b >> DMAP[k] & 1:
                v |= 1 << k
        out[c] = v
    return bytes(out)


if __name__ == '__main__':
    t41, erom, from_, out = sys.argv[1:5]
    img = (unscramble(open(t41, 'rb').read(), 11)
           + unscramble(open(erom, 'rb').read(), 12)
           + unscramble(open(from_, 'rb').read(), 12))
    open(out, 'wb').write(img)
    vec = [hex(img[i] | img[i + 1] << 8) for i in (0x27FA, 0x27FC, 0x27FE)]
    print('wrote', out, 'NMI/RESET/IRQ =', vec)
