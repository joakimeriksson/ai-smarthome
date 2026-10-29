"""Decode a Synthex cassette dump (program banks) and unpack the programs.

Usage: uv run --with numpy --with py65 python tape_decode.py <tape.wav> <cpu_image.bin> <out.json>

Tape format (from the firmware's loader at $D44D/$D50F): FSK, one bit per
cycle, 800 Hz = 1, 1600 Hz = 0, LSB first. Leader of 0x16 bytes, then
0x2A, checksum lo, checksum hi, 'B', 250 bytes = one bank of ten 25-byte
programs. The loader stores the 250 bytes with DEY from 250 down to 1, so
the stream is reversed into RAM. 'S' blocks (sequences) are ignored.
Works on the 8 kHz 8-bit file from virtual-music.at and the 44.1 kHz
stereo file from jbemond.free.fr.
"""
import collections, json, sys, wave
import numpy as np
from decode_rom import recall  # noqa: E402  (same directory)

wavpath, fwpath, outpath = sys.argv[1:4]
w = wave.open(wavpath)
n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
raw = w.readframes(n)
x = (np.frombuffer(raw, dtype=np.int16).astype(float) if sw == 2
     else np.frombuffer(raw, dtype=np.uint8).astype(float) - 128)
if ch > 1:
    x = x.reshape(-1, ch).mean(axis=1)
k = int(sr / 200)
x = x - np.convolve(x, np.ones(k) / k, 'same')  # remove DC / rumble

# The firmware measures the length of each HIGH half-cycle and compares it
# with a threshold between the two tones.
hi = (x > 0).astype(int)
d = np.diff(hi)
rises = np.where(d == 1)[0] + 1
falls = np.where(d == -1)[0] + 1
if falls[0] < rises[0]:
    falls = falls[1:]
m = min(len(rises), len(falls))
hl, rises = falls[:m] - rises[:m], rises[:m]
thr, gap = sr / 2133.0, sr / 400.0
print(f'sr={sr} ch={ch} dur={n / sr:.1f}s half-cycle hist (in 8 kHz samples):',
      sorted(collections.Counter(np.round(hl / (sr / 8000)).astype(int).tolist()).items())[:12])
bits = [0 if L < thr else (1 if L < gap else None) for L in hl]

segs, cur, start = [], [], None
for b, t in zip(bits, rises):
    if b is None:
        if cur:
            segs.append((start, cur))
            cur = []
    else:
        if not cur:
            start = t
        cur.append(b)
if cur:
    segs.append((start, cur))


def bytes_lsb(bl, off):
    return [sum(bl[i + k] << k for k in range(8)) for i in range(off, len(bl) - 7, 8)]


banks = []
for st, c in segs:
    if len(c) < 300:
        continue
    best = max(((sum(1 for v in bytes_lsb(c, off)[:30] if v == 0x16), off) for off in range(8)))
    bs = bytes_lsb(c, best[1])
    i = 0
    while i < len(bs) and bs[i] == 0x16:
        i += 1
    dd = bs[i:]
    ok = len(dd) >= 254 and dd[0] == 0x2A and dd[3] == 0x42
    if ok:
        payload = dd[4:254]
        cs, exp = sum(payload) & 0xFFFF, dd[1] | dd[2] << 8
        print(f't={st / sr:6.2f}s leader={i} type=B checksum={cs:04x} expected={exp:04x} match={cs == exp}')
        if cs == exp:
            banks.append(payload[::-1])
    else:
        print(f't={st / sr:6.2f}s leader={i} hdr={dd[:5]} nbytes={len(dd)} (not a program bank)')
print('program banks:', len(banks))

ram = bytes(sum(banks, []))
img = open(fwpath, 'rb').read()
programs = [recall(img, k % 10, k // 10, ram) for k in range(len(banks) * 10)]
json.dump({'source': wavpath, 'banks': banks, 'programs': programs}, open(outpath, 'w'))
for k, p in enumerate(programs):
    flags = ''.join(f if cond else '.' for f, cond in (
        ('S', p[35] & 0x80), ('R', p[37] & 0xC0), ('G', p[34] & 0x40), ('P', p[34] & 0x80), ('N', p[39] & 0xC0)))
    print(f'{(k // 10 + 1) * 10 + k % 10:3d}', ' '.join(f'{v:3d}' for v in p), ' ', flags)
