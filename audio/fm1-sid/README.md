# fm1-sid — a SID synth for the M-VAVE FM-1?

A feasibility study, with a working prototype: can the **M-VAVE FM-1** pocket synth
(JieLi AC791N, pi32v2 CPU at 240 MHz, see [`../fm-1`](../fm-1)) be turned into a synth built
on the **MOS 6581 / 8580 SID**, the Commodore 64's sound chip?

## Summary (svenska)

**Ja, det går.** Två saker är utredda:

1. **Egen SID-modell** (`src/sid.c`, heltals-C) plus ett synthlager som spelar chipet som
   C64-musik gör (`src/sidsynth.c`: 50 Hz-ramar, vågformstabeller, PWM- och filtersvep,
   sync/ring, hard restart). ~320 instruktioner per sampel och chip på FM-1, ~6 % av en kärna.
2. **Jämförelse med de färdiga motorerna** reSID 0.16, reSID 1.0 och reSIDfp: samma
   registerström genom alla, kostnad uppmätt på emulerad FM-1, ljud nivåmatchat för lyssning.

Slutsats: **reSID 0.16 i "fast"-läge är rätt chipmotor för FM-1.** Den kostar 440
instruktioner per sampel (8 % av en kärna per chip), ger bit för bit samma ljud på FM-1
som på datorn och har uppmätta vågformstabeller och filterkurvor från riktiga chip. Den
egna modellen är billigare men sämre. reSIDs högkvalitetslägen (resample, utan aliasing)
klockar chipet cykel för cykel och kostar 1–7 kärnor; reSID 1.0 och reSIDfp ryms inte alls i
FM-1 (8–21 MB filtertabeller per chipmodell, mot 1 MB flash totalt). Synthlagret (`sidsynth`) är det som är nytt här och
behålls ovanpå reSID. På vägen hittades fyra fel i FM-1-emulatorn (64-bitars carry, flaggor,
multiply-accumulate och push/pop-masker) som gjorde all `double`-räkning fel; fixarna ligger
i PR #31.

## Short answer

Yes. A SID chip costs **~8 % of one 240 MHz core with reSID 0.16 (fast mode)** and ~6 % with
the model written here, measured on the emulated FM-1 and bit-identical to the host builds.
**Use reSID 0.16 for the chip** (real combined-waveform tables, measured filter curves, years
of use in VICE / sidplay); keep `sidsynth` (the instrument driver) on top. The high-quality,
alias-free modes of reSID and the newer engines do not fit the FM-1 (see the comparison).

## Engine comparison: own model, reSID 0.16, reSID 1.0, reSIDfp

The demo pieces' register streams are recorded (`host/demo.c record`: every write with its
sample position) and replayed on every engine, each clocked to the exact cycle of each write
(`host/replay.cc`). On the FM-1 the bench workload's stream replays through reSID 0.16 built
for pi32v2 (`fm1/bench_resid.cc`, `fm1/run_resid.py`).

| engine | FM-1 instr / sample | of a 240 MHz core | RAM | host ms per s of audio | verdict |
|---|---:|---:|---|---:|---|
| own (`src/sid.c`) | 316 | 5.8 % | ~1 KB RAM + 32 KB tables | 2.4 | fits, lowest fidelity |
| reSID 0.16 fast | 440 | 8.1 % | 17 KB RAM + 128 KB tables | 3.1 | **fits: use this** |
| reSID 0.16 interpolate | 5,562 | 102 % | 17 KB RAM + 128 KB tables | 27.9 | too heavy |
| reSID 0.16 resample | 39,226 | 721 % | 167 KB RAM + 128 KB tables | 133 | far too heavy |
| reSID 1.0 resample | – | – | 8.3 MB of filter tables per chip model | 117 | does not fit |
| reSIDfp resample | – | – | ~21 MB of filter tables per chip model, `std::thread` | 72 | does not fit |

Per SID chip (3 voices + filter), 44.1 kHz. Host: one core of an Intel Xeon at 2.1 GHz.
FM-1 outputs equal the host's bit for bit for every row with a number. Tables are constant
after init, so they can live in flash (XIP) instead of RAM: reSID 0.16's 128 KB of wave
tables and the own model's 32 KB fit easily. The FM-1 has 1 MB of flash in all (~568 KB for
the app), so the 8-21 MB filter tables of reSID 1.0 and reSIDfp do not fit there either.

What the listening shows (`tools/compare.sh`, `tools/listen.py`, level-matched to -20 dBFS):

- **Aliasing**: the own model and reSID fast both sample the waveforms at 44.1 kHz; high notes
  get folded partials (spectrograms of the high chord: a dense floor between the harmonics).
  The resample modes are clean, at 15–90x the cost.
- **6581 filter**: reSID 1.0 / reSIDfp model its non-linearity; reSID 0.16 has the measured
  cutoff curve without distortion; the own model has an approximate curve.
- **Combined waveforms**: reSID plays tables sampled from real chips; the own model guesses.

Next quality step that fits: reSID 0.16 fast at 2x the output rate with a half-band
decimator (about 2x the cost, ~16 % of a core per chip) to push most aliasing out of the
audible band; to be measured.

### Real C64 tunes

`host/sidlogger.cpp` runs a tune on libsidplayfp's C64 emulation (PSID and RSID, multi-SID)
and logs every SID write with its C64 cycle (sidlog v2); `host/replay.cc` then plays that log
on every engine, each clocked to the cycle of each write. libsidplayfp 2.6.0 is built in
`ext/` with a 24-line patch (`tools/libsidplayfp-2.6.0-sidlog.patch`) that calls a hook on
each SID write. `tools/scan_tunes.py` ranks HVSC tunes by how much they use hard sync, ring
modulation and the filter (from their register streams); `tools/tunes.sh` fetches the chosen
ones (they and their renders stay in `build/`, not in the repo) and renders each with
`sidplayfp` as a reference. `tools/refcheck.py` aligns ours with the reference: the tempo holds
and the log-spectra correlate ~0.8 with our reSIDfp replay; the rest is engine settings
(filter curve) and where in the frame the player runs.

### Emulator fixes found on the way (`../fm-1`, PR #31)

reSID's `double` setup came out wrong on the emulator; tracing it found four gaps in
`fm1-core`: no arithmetic flags (64-bit add lost its carry, 64-bit subtract always
borrowed, 64-bit compares read psr = 0), the add / subtract-with-carry classes fitted to the
corpus registers only, the 64-bit multiply-accumulate `fc e1`, and rets + register-mask
push / pop for masks the corpora never had. The fixes, their probes and notes are in
[PR #31](https://github.com/joakimeriksson/ai-smarthome/pull/31) (branch
`fm-1-flags-carry`). Until it is merged, `fm1/run_resid.py` needs an `fm1-emu` built from
that branch; `fm1/run.py` (the own model, integer only) runs on either.

## Measured (own model)

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
fm1/bench_resid.cc,       reSID 0.16 replaying the workload's register stream on the FM-1
  bench_resid.ld, build_resid.sh, run_resid.py, sidlog2h.py
host/replay.cc,           one register stream on every engine (own, reSID 0.16 / 1.0, reSIDfp)
  engines.h, eng_*.cc
tools/fetch_ext.sh        fetch reSID 0.16, reSID 1.0, reSIDfp into ext/ (GPL, not in the repo)
tools/compare.sh          record every demo piece, replay on every engine -> build/cmp/
tools/listen.py,          level-matched MP3s, spectrograms and the A/B page -> build/listen/
  listen.html
host/sidlogger.cpp        a tune's SID writes, cycle-exact, from libsidplayfp's C64 (sidlog v2)
tools/scan_tunes.py       rank HVSC tunes by sync / ring / filter use
tools/tunes.sh,           HVSC tunes on every engine + sidplayfp reference; alignment check
  refcheck.py
```

```sh
make test                 # self tests
make wav                  # build/patch_*.wav (every patch, 8580) and build/song_{6581,8580}.wav
make bench                # host timing
fm1/run.py [chips...]     # the FM-1 measurement (needs the toolchain and ../fm-1's emulator)
tools/fetch_ext.sh && make build/sid_record build/sid_replay && tools/compare.sh && tools/listen.py
fm1/run_resid.py [0 1 2]  # reSID 0.16 fast / interpolate / resample on the FM-1 (after compare.sh)
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

- **Aliasing** (own model and reSID fast alike): the waveforms are sampled at 44.1 kHz,
  while the real chip runs at ~1 MHz into an analogue filter. The alias-free reSID modes cost
  1-7 cores. In between: reSID fast at 2x rate + a half-band decimator, or polyBLEP edges
  in the own model; to be measured.
- **Licence**: reSID is GPL-2.0-or-later, so a firmware using it is GPL (as Felucca is).
  The own model stays BSD.
- **6581 filter distortion** is only in reSID 1.0 / reSIDfp, which do not fit.
- **Cycles, not instructions**: confirm on hardware once the FM-1 arrives (the emulator does
  not model cycle timing; reSID's integer code and the own model run mostly single-cycle ops).
- The FM-1 itself has not run this code, only its emulator (which needed four fixes for it).

## Next steps

1. reSID 0.16 (fast) as the chip under `sidsynth`; its wave tables as `const` in flash.
2. Measure reSID fast at 88.2 kHz + half-band decimation against the alias-free modes.
3. Felucca engine (path A): `eng_sid.c`, build Felucca with the toolchain, play it in
   `fm1-live` and the web emulator.
4. On the real FM-1 when it arrives: cycle cost, sound check against a real C64.
5. Optional: the 6502 + PSID player (path C), a tracker UI (path B).
