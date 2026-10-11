#!/usr/bin/env python3
"""The player firmware's own tune: 31 s for one SID, written here so the firmware and the web
page always have something to play without fetching anything, and the CI smoke test has a
tune it may use. It shows what the player draws: hard sync, ring modulation, the filter.

The music is computed here, frame by frame (PAL, 50 Hz), as SID register writes; a 60-byte
6502 player copies one frame of writes per play call. Out: a PSID v2 file.
    tools/housetune.py OUT.sid
Voice 1: bass with the drums on it (kick, snare), pulse with PWM, through a resonant
low-pass whose cutoff drifts. Voice 2: chord arpeggios, then the sync master and the ring
modulator for voice 3. Voice 3: the lead, plain saw, then hard-synced, then a ring bell.
SPDX-License-Identifier: BSD-2-Clause"""
import math
import struct
import sys

CLOCK = 985248
STEP = 6                       # frames per 16th note: 125 BPM
LOAD = 0x1000


def freq(note):
    return min(0xFFFF, round(440 * 2 ** ((note - 69) / 12) * 16777216 / CLOCK))


CHORDS = [(57, (0, 3, 7)), (53, (0, 4, 7)), (48, (0, 4, 7)), (55, (0, 4, 7))]   # Am F C G
MELODY = [                     # (step, note, steps) per bar of the progression
    [(0, 72, 2), (2, 76, 2), (4, 81, 4), (8, 79, 2), (10, 76, 2), (12, 74, 4)],
    [(0, 72, 3), (3, 77, 3), (6, 81, 2), (8, 84, 4), (12, 81, 4)],
    [(0, 79, 2), (2, 76, 2), (4, 72, 4), (8, 74, 2), (10, 76, 2), (12, 79, 4)],
    [(0, 83, 3), (3, 79, 3), (6, 74, 2), (8, 71, 6), (14, 74, 2)],
]
BARS = 16


def song():
    """Each frame: the list of (reg, value) writes, in order."""
    frames = []
    shadow = [None] * 25
    for bar in range(BARS):
        root, quality = CHORDS[bar % 4]
        section = bar // 4                 # 0 intro, 1 lead, 2 sync lead, 3 ring bell
        mel = {s: (n, l) for s, n, l in MELODY[bar % 4]}
        lead = None
        for step in range(16):
            if step in mel:
                lead = (mel[step][0], step, mel[step][1])
            for f in range(STEP):
                t = len(frames)
                fr = {}
                gate_retrig = []
                # ---- voice 1: bass and drums, through the filter
                bnote = root - 12 + (12 if step % 4 == 3 else 0)
                pw = 0x400 + int(0x500 * (0.5 - 0.5 * math.cos(t * 2 * math.pi / 96)))
                if step % 8 == 0:              # kick: a falling triangle, then the bass
                    if f < 2:
                        fr[0x04] = 0x11
                        fr.update(dict(zip((0, 1), struct.pack("<H", freq(bnote + 36 - 18 * f)))))
                    else:
                        fr[0x04] = 0x41
                        fr.update(dict(zip((0, 1), struct.pack("<H", freq(bnote)))))
                    fr[0x05], fr[0x06] = 0x09, 0xA4
                    if f == 0:
                        gate_retrig.append(0x04)
                elif step % 8 == 4:            # snare: noise falling, a short gap after
                    fr[0x04] = 0x81 if f < 4 else 0x80
                    fr.update(dict(zip((0, 1), struct.pack("<H", freq(96 - 4 * f)))))
                    fr[0x05], fr[0x06] = 0x08, 0x82
                    if f == 0:
                        gate_retrig.append(0x04)
                else:                          # bass: pumping 8ths, gate off for the last frame
                    fr[0x04] = 0x41 if f < STEP - 1 else 0x40
                    fr.update(dict(zip((0, 1), struct.pack("<H", freq(bnote)))))
                    fr[0x05], fr[0x06] = 0x09, 0xA4
                    if f == 0:
                        gate_retrig.append(0x04)
                fr[0x02], fr[0x03] = pw & 0xFF, pw >> 8
                # ---- voice 2
                if section < 2:                # arpeggio, a frame per chord tone
                    an = root + 12 + quality[t % 3]
                    fr.update(dict(zip((7, 8), struct.pack("<H", freq(an)))))
                    fr[0x09], fr[0x0A] = 0x00, 0x06
                    fr[0x0B] = 0x41
                    fr[0x0C], fr[0x0D] = 0x00, 0x90 if section == 0 else 0x70
                    if step % 8 == 0 and f == 0:
                        gate_retrig.append(0x0B)
                # ---- voice 3: the lead
                if section >= 1 and lead:
                    n, s0, ln = lead
                    age = (step - s0) * STEP + f
                    held = age < ln * STEP - 1
                    vib = 0.25 * math.sin(age * 2 * math.pi / 6) * min(1, max(0, age - 10) / 10)
                    if section == 1:           # plain sawtooth with vibrato
                        fr.update(dict(zip((0x0E, 0x0F), struct.pack("<H", freq(n + vib)))))
                        fr[0x12] = 0x21 if held else 0x20
                        fr[0x13], fr[0x14] = 0x08, 0xA6
                    elif section == 2:         # synced to voice 2: the slave sweeps up over the note
                        master = n - 12
                        fr.update(dict(zip((7, 8), struct.pack("<H", freq(master + vib)))))
                        fr[0x0B] = 0x11 if held else 0x10
                        fr[0x0C], fr[0x0D] = 0x00, 0x60
                        sweep = 1.3 + 2.4 * min(1, age / (ln * STEP))
                        fr.update(dict(zip((0x0E, 0x0F), struct.pack("<H", min(0xFFFF, int(freq(master) * sweep))))))
                        fr[0x12] = 0x23 if held else 0x22
                        fr[0x13], fr[0x14] = 0x06, 0xA6
                    else:                      # ring: voice 2 silent, an inharmonic ratio
                        fr.update(dict(zip((0x0E, 0x0F), struct.pack("<H", freq(n + vib)))))
                        fr.update(dict(zip((7, 8), struct.pack("<H", freq(n + 6.3)))))
                        fr[0x0B] = 0x10
                        fr[0x12] = 0x15 if held else 0x14
                        fr[0x13], fr[0x14] = 0x0A, 0x09
                    if age == 0:
                        gate_retrig.append(0x12)
                        if section == 2:
                            gate_retrig.append(0x0B)
                else:
                    fr[0x12] = 0x20
                # ---- filter: voice 1 into a resonant low-pass, the cutoff drifts
                cut = int(300 + 900 * (0.5 - 0.5 * math.cos(t * 2 * math.pi / 384)))
                if step % 8 == 0 and f < 3:
                    cut += 400 - 130 * f
                fr[0x15], fr[0x16] = cut & 7, cut >> 3
                fr[0x17] = 0xC1
                fr[0x18] = 0x1C
                # emit: a retriggered gate goes off first, then everything that changed
                writes = []
                for r in gate_retrig:
                    if shadow[r] is not None and shadow[r] & 1:
                        writes.append((r, shadow[r] & 0xFE))
                        shadow[r] &= 0xFE
                for r in sorted(fr, key=lambda r: (r in (0x04, 0x0B, 0x12), r)):
                    if t == 0 or shadow[r] != fr[r]:
                        writes.append((r, fr[r]))
                        shadow[r] = fr[r]
                frames.append(writes)
    # the first frame sets every register, so the loop starts from a known chip
    full = dict((r, 0) for r in range(25))
    for r, v in frames[0]:
        full[r] = v
    frames[0] = [(r, full[r]) for r in sorted(full, key=lambda r: (r in (0x04, 0x0B, 0x12), r))]
    return frames


def player(data_addr):
    """init sets the stream pointer ($FB/$FC); play copies one frame: n, then n (reg, value)
    pairs, through a self-modified STA $D4xx; $FF loops."""
    init = LOAD
    play = LOAD + 9
    code = bytearray()
    code += bytes([0xA9, data_addr & 0xFF, 0x85, 0xFB, 0xA9, data_addr >> 8, 0x85, 0xFC, 0x60])
    assert len(code) == 9
    # play:
    code += bytes([0xA0, 0x00, 0xB1, 0xFB, 0xC9, 0xFF, 0xD0, 0x06])        # ldy #0; lda (fb),y; cmp #ff; bne ok
    code += bytes([0x20, init & 0xFF, init >> 8, 0x4C, play & 0xFF, play >> 8])   # jsr init; jmp play
    code += bytes([0xAA, 0xC8])                                            # ok: tax; iny
    lp = LOAD + len(code)
    mod = lp + 4 + 2 + 3 + 1 + 2                                           # the STA's operand
    code += bytes([0xE0, 0x00, 0xF0, 0x10])                                # lp: cpx #0; beq done
    code += bytes([0xB1, 0xFB, 0x8D, (mod + 1) & 0xFF, (mod + 1) >> 8, 0xC8])   # lda (fb),y; sta mod+1; iny
    code += bytes([0xB1, 0xFB])                                            # lda (fb),y
    assert LOAD + len(code) == mod
    code += bytes([0x8D, 0x00, 0xD4, 0xC8, 0xCA, 0x4C, lp & 0xFF, lp >> 8])  # mod: sta $d400; iny; dex; jmp lp
    code += bytes([0x98, 0x18, 0x65, 0xFB, 0x85, 0xFB, 0x90, 0x02, 0xE6, 0xFC, 0x60])  # done: y -> pointer
    return bytes(code), init, play


def main(out):
    frames = song()
    stream = bytearray()
    for w in frames:
        assert len(w) <= 120
        stream.append(len(w))
        for r, v in w:
            stream += bytes([r, v])
    stream.append(0xFF)
    code, init, play = player(0)
    data_addr = LOAD + len(code)
    code, init, play = player(data_addr)
    body = code + stream
    assert LOAD + len(body) <= 0xD000, len(body)
    hdr = bytearray(0x7C)
    hdr[0:4] = b"PSID"
    struct.pack_into(">HHHHHHHI", hdr, 4, 2, 0x7C, 0, init, play, 1, 1, 0)
    for off, s in ((0x16, "Pocket Sync"), (0x36, "fm1-sid"), (0x56, "2026 ai-smarthome")):
        hdr[off:off + len(s)] = s.encode("latin-1")
    struct.pack_into(">H", hdr, 0x76, 0x24)            # PAL, 8580
    data = bytes(hdr) + struct.pack("<H", LOAD) + body
    open(out, "wb").write(data)
    print(f"{out}: {len(frames)} frames ({len(frames) / 50:.1f} s), {len(data)} bytes")


if __name__ == "__main__":
    main(sys.argv[1])
