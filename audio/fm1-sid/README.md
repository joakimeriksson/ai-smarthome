# fm1-sid — a SID synth for the M-VAVE FM-1?

A feasibility study, with a working prototype: can the **M-VAVE FM-1** pocket synth
(JieLi AC791N, pi32v2 CPU at 240 MHz, see [`../fm-1`](../fm-1)) be turned into a synth built
on the **MOS 6581 / 8580 SID**, the Commodore 64's sound chip?

## Summary (svenska)

**Ja, det går, och med god marginal.** I katalogen finns en egen, registernivå-modell av
SID-chipet (6581 och 8580) i heltals-C, och ett synthlager ovanpå som spelar den som C64-musik
gör (50 Hz-ramar, vågformstabeller, PWM- och filtersvep, sync/ring, hard restart). Samma kod
kompileras med JieLis verktygskedja för FM-1:ans pi32v2-CPU och körs i FM-1-emulatorn i
`../fm-1`. Den ger **bit för bit samma ljud** som på värddatorn och kostar **~320 instruktioner
per sampel och SID-chip** (3 röster + filter) vid 44,1 kHz, alltså **~6 % av en
240 MHz-kärna per chip**. Fyra chip (12 röster) ryms på ~25 %. Rekommenderad väg vidare: en
ny SID-motor i Felucca (GPL-firmware som redan har UI, sequencer, MIDI och installation),
därefter ev. en egen firmware och en `.sid`-spelare (6502-emulering är billig i
sammanhanget).

## Short answer

Yes. The SID model in `src/` runs on the FM-1's CPU (built with the vendor toolchain, run in
the `fm1-emu` emulator) bit-identical to the host build, at about **320 instructions per
sample per SID chip** — three voices, envelopes, the filter and the instrument driver —
which is **~6 % of one 240 MHz core per chip**. CPU is not the constraint; the work is in
the instrument design and the firmware integration.

## Measured

`fm1/run.py` builds the bench (`fm1/bench.c` + `fm1/workload.h`: a held chord on every
voice, SAW LEAD patch with the filter and vibrato, a chord change halfway, rendered in
128-sample blocks like Felucca's I2S half buffers) with the JieLi clang for pi32v2, runs it
in `../fm-1`'s emulator, counts the instructions between two markers and compares the
output with the host build:

| SID chips | voices | instr / sample (-O2) | of a 240 MHz core | -Os (Felucca's flag) | output = host |
|---:|---:|---:|---:|---:|:---:|
| 1 | 3  | 316   | 5.8 %  | 334 (6.1 %)    | yes |
| 2 | 6  | 642   | 11.8 % |                | yes |
| 3 | 9  | 979   | 18.0 % |                | yes |
| 4 | 12 | 1,348 | 24.8 % | 1,418 (26.1 %) | yes |

- Instructions are not cycles: the percentages assume one instruction per cycle. pi32v2
  issues one most of the time, but loads from XIP flash and divides take longer, so read them
  as a lower bound. Even at 2x the FM-1 has room for four SIDs plus effects.
- Init (building the combined-waveform tables) costs ~9.9 M instructions per chip model
  (14.7 M at -Os), once at boot (~40–60 ms). In a firmware these should become `const` tables in flash.
- The code is small: the whole bench, SID model + synth driver + 12 patches, is 6 KB of
  pi32v2 code.
- `make test`: 14 checks against the datasheet / known chip behaviour pass (pitch, attack
  times, decay / release with the exponential divider, sustain, the ADSR delay bug, noise,
  hard sync, a retrigger at full level, filter stability at full resonance, 6581
  volume-register digis).

## What is in here

```
src/sid.h, sid.c          the chip: register-level 6581 / 8580 model (integer only)
src/sidsynth.h, .c        the instrument driver + 12 example patches
host/demo.c               self tests, demo WAVs, the host side of the bench, host timing
fm1/workload.h            the bench workload (shared by host and FM-1 builds)
fm1/bench.c, crt0.S,      bare-metal pi32v2 program for the emulator
  bench.ld, build.sh
fm1/run.py                build + run on the emulated FM-1 + compare + report
```

```sh
make test                 # self tests
make wav                  # build/patch_*.wav (every patch, 8580) and build/song_{6581,8580}.wav
make bench                # host timing
fm1/run.py [chips...]     # the FM-1 measurement (needs the toolchain and ../fm-1's emulator)
```

`fm1/run.py` needs `../fm-1/target/release/fm1-emu` (`cargo build --release -p fm1-emu` in
`../fm-1`) and the JieLi Linux toolchain, which runs natively on Linux x86-64
(`../fm-1/docs/recon.md` has the URL; `JIELI_TOOLCHAIN` points at it, the default is
`../fm-1/reference/toolchain/jieli-linux-toolchains-*`). On macOS run the toolchain through
Docker as `../fm-1/tools/probe_build.sh` does.

### The chip model (`src/sid.c`)

Written from public descriptions of the chip — no code from reSID / reSIDfp — so it can be
BSD like the rest of this repo. Integer-only, no 64-bit arithmetic and no division per
sample, so the FM-1 and the host produce identical samples. It runs at the output rate and
advances the chip by the ~22.3 SID cycles that fit in each sample, solving the parts that
need cycle precision analytically:

- **Oscillators**: 24-bit phase accumulators, triangle / saw / pulse / noise; hard sync
  restarts the synced voice where it would be after the source's MSB rose inside the batch;
  ring modulation flips the triangle with the source's MSB; the 23-bit noise LFSR is clocked
  once per rising edge of accumulator bit 19 (several times per sample at high pitches); the
  test bit; "no waveform" holds the last DAC value.
- **Envelope**: the real 15-bit rate counter, the 16-entry period table, the exponential
  decay / release divider, the sustain comparison, the freeze at zero — and the **ADSR delay
  bug** (lower the rate below the counter and it wraps through 0x7FFF first), which matters
  for how real C64 music sounds and why drivers use a hard restart.
- **Combined waveforms**: AND of the components plus a neighbour-bit pull-down, harder on the
  6581 than on the 8580. A model of my own, *not* sampled from real chips (see below).
- **Filter**: 12 dB/oct state-variable filter in the TPT form (stable up to the top of the
  range), LP / BP / HP and their sums (notch), resonance Q 0.7–1.7 (8580) / 0.7–2.0 (6581);
  the 8580's linear cutoff curve and an S-shaped 6581 curve (approximate — real 6581s differ
  from chip to chip).
- **Mixer**: 3OFF, the master volume, the 6581's DC offsets (so writing the volume
  register plays samples, the classic "digi" trick) and the output's AC coupling.

### The synth driver (`src/sidsynth.c`)

The SID sound people know is as much the music drivers as the chip: registers written once
per video frame from per-instrument tables. `sidsynth` does that, for 1–4 chips:

- **wavetable** per instrument: waveform + note offset per frame, with a loop (drums = a noise
  frame then a falling pulse/triangle; the C64 "chord" = a 0-4-7 arpeggio looped at 50 Hz)
- **pulse width sweep** (ping-pong), **filter**: mode, resonance, cutoff start and sweep
- **vibrato** with delay, **sync / ring** patches (the note then uses voice 1 as the sounding
  voice and voice 3 as the silent modulator at its own interval, with a pitch sweep),
  **hard restart**
- polyphony: 3 notes per chip (1 per chip with sync / ring patches); the notes on a chip
  share its filter, as on the real thing; 50 Hz (PAL) frames, settable for "multispeed"

Patches: SAW LEAD, PWM BASS, MAJ / MIN CHORD, SYNC LEAD, RING BELL, KICK, SNARE, HAT, RESO
PAD, P&S ORGAN, BP SWEEP. `make wav` renders each, plus a short four-chip song (bass,
chords, sync lead, drums) on both chip models.

## The FM-1 as a SID synth

What the hardware gives (from `../fm-1/docs/recon.md` and Felucca's HAL):

| | |
|---|---|
| CPU | pi32v2, 240 MHz, **two cores**, FPU (single) |
| Memory | ~512 KB SRAM, 1 MB flash (XIP), ~568 KB of it for the app |
| Audio | I2S codec, 44.1 kHz, 24-bit, 128-frame half buffers (2.9 ms) |
| Panel | 27 keys, 14 buttons with LEDs, 7 encoders, MASTER pot, 240×240 LCD |
| I/O | USB-C (MIDI, audio, the SysEx firmware update), TRS MIDI in, BLE |

Everything a SID instrument needs is there. A possible panel layout:

- **keys**: notes (or, in a "tracker" mode, pattern steps)
- **encoders**: K1 cutoff, K2 resonance, K3 pulse width, K4 waveform / wavetable;
  SELECT / ALGO / PRESET for patch browsing and the ADSR page
- **buttons**: 6581 / 8580, filter mode LP / BP / HP, SYNC, RING, ARP, 1–4 SIDs
- **screen**: the 29 registers live, the envelope, the oscilloscope, the wavetable editor

Polyphony: 12 voices with four chips is ~25 % of a core. The second core is free in
Felucca-style firmwares (Melodee and X0X hand audio to it), which could run more chips or a
`.sid` player.

## Ways to build it

**A. A SID engine in Felucca (recommended first step).** Felucca
(`hugelton/Felucca`, GPL-3.0) already has the UI, presets, the sequencer, USB / TRS MIDI,
flash storage, the update package and a browser emulator, and it runs in `../fm-1`'s
emulator. Its engines are plug-ins (`engine_t` in `firmware/src/core.h`): `note_on`,
`render`, `block` (once per block — the place for the 50 Hz driver tick), `ownenv` + `done`
(the engine's own envelope is the amplitude: the SID ADSR), 8 EDIT parameters and a part
memory (12.9 KB per part; a 1-chip `sidsynth_t` is well under 1 KB). One wrinkle: Felucca
renders per voice, a SID shares one filter between three voices — run the part as one chip
(poly cap 3, the filter in `block`) rather than one chip per voice. The combined-waveform
tables become `const` (flash). The result is GPL-3.0 (this code is BSD-2, which is
compatible).

**B. A dedicated firmware** on Felucca's HAL: full freedom for a SID-specific UI (register
view, wavetable / pulse / filter table editors, a small tracker), multi-SID, and room for C.
More work: USB, MIDI, flash and the update path have to come along.

**C. A `.sid` player.** A 6502 core plus the PSID format plays the C64 music library with the
same chip model. Cost is small: a typical play routine runs a few thousand 6502 cycles per
frame, i.e. a few million pi32v2 instructions per second. Digi-heavy tunes that write
registers at kHz rates need the chip rendered in smaller chunks (supported: `sid_render`
takes any length).

## Limits and open questions

- **Aliasing.** The model computes the raw waveforms at 44.1 kHz; the real chip outputs at
  ~1 MHz and the analogue path filters it. High notes on saw / pulse / noise alias more than
  the real chip. Remedies: polyBLEP on saw / pulse edges (Felucca's TRIO engine does this) or
  2x oversampling of the oscillators; both fit the budget. Not done yet.
- **Combined waveforms** are modelled, not measured. Real tables (as sampled from chips by
  the reSID authors) are GPL; measuring our own needs a real C64 / SID.
- **6581 filter**: approximate cutoff curve, no distortion model.
- **Cycles, not instructions**: confirm on hardware once the FM-1 arrives (the emulator does
  not model cycle timing yet).
- The FM-1 itself has not been tested with this code — only its emulator.

## Next steps

1. polyBLEP / oversampling for the oscillators; measure the cost on the emulator.
2. Felucca engine (path A): `eng_sid.c`, build Felucca with the toolchain, play it in
   `fm1-live` and the web emulator.
3. On the real FM-1 when it arrives: cycle cost, sound check against a real C64.
4. Optional: the 6502 + PSID player (path C), a tracker UI (path B).
