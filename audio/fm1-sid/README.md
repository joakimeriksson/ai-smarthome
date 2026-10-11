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

Dessutom finns en **SID-spelare som firmware** (`firmware/`): riktiga C64-låtar (PSID) körs
med sin egen 6502-kod på FM-1:ans CPU, ljudet från reSID 0.16 (eller egna modellen), och
LCD:n visar de tre rösterna, sync/ring och filtret. Den går i `fm1-emu` och som webbsida
(`web/`, GitHub Pages) där hela FM-1 emuleras och man kan söka och spela hela HVSC; låtarna
hämtas direkt från hvsc.c64.org. Ljudet stämmer med reSID på datorn.

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

## The SID player firmware (`firmware/`, `player/`)

Path C below, built: C64 tunes played by their own 6502 code on the FM-1's CPU, with the
chip drawn on the LCD.

- `player/psid.c` is the C64 side of a PSID tune around floooh's cycle-stepped `m6502.h`
  (zlib, undocumented opcodes included; `ext/chips`): 64 KB RAM, `$01` banking, the CIA
  timer latch (`$DC04/05`) for the play rate, `$D012` raster reads, OSC3 / ENV3 reads. It runs
  `init` and `play` as subroutines and hands each SID write to a callback with its C64 cycle.
  RSID tunes (which need the full C64: interrupts, VIC, both CIAs) are not supported; JaC64
  (Java) or libsidplayfp would be the place to borrow that from.
- `player/psidlog.c` (`make build/psidlog`) runs the same code on the host and writes a
  sidlog v2, so `host/replay.cc` and `tools/refcheck.py` can hold it against libsidplayfp's
  stream: Sanxion 0.979, Roland's Rat Race 0.888, Contaxia 0.915 log-spectrum correlation
  against the `sidplayfp` render.
- `firmware/main.c` (GPL-3.0-only: it is built on Felucca's HAL, startup and ISR code in
  `ext/Felucca`) plays them. The main loop runs the play routine up to three frames ahead
  and queues the writes with their cycle; the audio interrupt (ALNK0, 128-frame half buffers
  at 44117.6 Hz) clocks reSID 0.16 fast (`firmware/resid_glue.cc`) to each write's cycle, or
  renders the own model to the sample. The LCD shows each voice (waveform, gate, note,
  envelope, pulse width; SYNC / RING badges), the filter (mode, routing, cutoff, resonance),
  an oscilloscope and the CPU load.
- Keys: PRESETS / SELECT encoder or OCT− / OCT+ = tune, PLAY = pause, EDIT = engine (reSID /
  own model), FX = 6581 / 8580. Hold OCT− and OCT+ for 3 s for the USB update mode.
- **Synth mode** (HOME switches): the 27 note keys play `src/sidsynth.c`'s 12 instruments on
  the same chip and engine. The driver's register writes go into the same cycle-stamped
  queue as a tune's: `sidsynth` has an optional write / envelope hook for another engine
  (`sidsyn_t.write`, `.env`, `sidsyn_tick`; without it nothing changes, same bench hash). Its
  50 Hz frames run in the audio interrupt, each at its own cycle, and key presses reach it
  through a small command queue at the start of the next half buffer (2.9 ms). PRESETS /
  SELECT pick the instrument, OCT- / OCT+ the octave, KNOB1-4 cutoff, resonance, attack and
  release; PLAY sends all notes off. Pack flag bit 3 boots straight into it.
- **Step sequencer** in the synth mode: three tracks of 16 steps, each a `sidsynth` part on
  its own SID voice with its own patch (`sidsyn_set_voice`; track 3 starts as a drum kit
  where a note's pitch class picks kick, snare or hat). The tracks share the chip's one filter
  the way C64 music does: routing bits merge, cutoff, resonance and mode come from the first
  track whose patch has a filter; sync and ring take the voice before as their source. Steps
  fire in the audio interrupt at their own cycle, between the driver's 50 Hz frames. SEQ shows
  the pattern on the LCD, PLAY runs it, REC records (running: to the nearest step; stopped: at
  the cursor, which SELECT moves), SCL / ENV / LFO pick track 1-3, PRESETS its patch,
  ALGORITHM the tempo, GLO clears a step, ARP a track. It starts with a demo pattern; nothing
  is saved yet (flash storage is the next step).
- The tunes ride after the firmware in flash as a **tune pack** (`firmware/main.c` reads it at
  the image's end, `_pack` in `firmware/app.ld`): "SIDPACK1", a count, the first entry and two
  flags (own model; chip 6581 / 8580 for every tune), then offset, length and song per entry.
  `tools/sidpack.py` makes one from .sid files, the web page builds the same in JavaScript
  (`web/pack.js`). Without a pack the firmware plays its own tune.
- `tools/housetune.py` writes that tune, *Pocket Sync* (31 s, PSID, BSD-2): the music is
  computed in Python frame by frame as SID register writes (bass and drums through a resonant
  low-pass, arpeggios, a lead that goes plain, hard-synced, then ring-modulated) and a 60-byte
  6502 routine plays one frame of writes per call.
- `firmware/build.sh` makes `build/fw/sidplayer.bin` (196 KB of the 568 KB app slot: player,
  reSID with its wave tables in flash, the own model, a font and the own tune; 350 KB RAM),
  `sidplayer_xip.bin` for `fm1-emu --bin`, and copies the image without a pack to
  `web/sidplayer.bin` (committed, since CI has no JieLi toolchain).
- The main loop sleeps (`idle`) until the next interrupt. On the FM-1 that saves power; in
  the emulator it lets idle skipping jump ahead, which made the web build 6x faster.
- Measured in `fm1-emu`: the audio interrupt takes ~9.5 % of the 240 MHz core with reSID, and
  its output matches host reSID fed the same stream (correlation 0.984). It needs PR #31's
  emulator fixes; on master the CPU halts.

- `tools/fwsc.py` packs it as an FM-1 update package, `web/sidplayer.fwsc`: Felucca's update
  loader (built here) and `tools/fm1pkg_make.py`, with three Apache-2.0 files of JieLi's AC79
  SDK (`tools/fetch_ext.sh` fetches them into `ext/ac79sdk` and checks Felucca's hashes; the
  page ships `web/LICENSES/Apache-2.0.txt`). The app is the image with an empty pack: its own
  tune and the synth. `../fm-1/web/fwsc.js` unpacks exactly that app from it, and the
  emulator boots it like the community packages. Not tried on a real FM-1 yet.

```sh
tools/fetch_ext.sh                            # engines, m6502.h, Felucca
firmware/build.sh                             # build/fw/sidplayer*.bin, web/sidplayer.bin
tools/fwsc.py                                 # web/sidplayer.fwsc, the update package
tools/sidpack.py build/fw/my_xip.bin --xip --first 1 A.sid B.sid:3   # a firmware with tunes
../fm-1/target/release/fm1-emu --bin build/fw/my_xip.bin --entry 0x02000120 \
    --ms 3000 --wav build/fw/out.wav --keys "t:PRESET:+1,t:EDIT" --snap 2500  # LCD -> work/
tools/webpage.sh [../fm-1]                    # the web page with the emulator -> build/pages
```

## The web page (`web/`, GitHub Pages)

`web/` is the player as a page: the FM-1's front panel (the emulator's own drawing code, as on
`../fm-1/web`), the emulated machine in an AudioWorklet booting `sidplayer.bin` plus a tune
pack the page builds from its playlist, and around it a player:

- **Playlist**: picks chosen for sync, ring modulation and filter work (`web/tunes.json`, from
  `tools/picks.py`: the HVSC path, header fields, the song's length from HVSC's
  `Songlengths.md5`, and tags measured from each tune's own register stream with
  `build/psidlog`), then *Pocket Sync*.
- **All of HVSC**: the page fetches `Songlengths.md5` (5 MB, all 61,157 paths) from
  hvsc.c64.org when asked and searches it; a tune is fetched when picked, added to the
  playlist, and the machine reboots on the new pack. "Surprise me" draws a random PSID tune.
  hvsc.c64.org sends `Access-Control-Allow-Origin: *`; no tune is hosted with the page.
- **Your files**: .sid files dropped on the page or picked join the playlist, locally.
- **SID synth**: the page's mode switch (HOME on the panel) turns the FM-1 into the synth; the
  Instruments tab lists the 12 patches, the computer keyboard (A W S E D ... ; ') and a MIDI
  keyboard over Web MIDI play the note keys (MIDI notes fold into the keys' range), and the
  octave and the four knobs have buttons. `?mode=synth` starts there.
- The page mirrors the firmware's state from the keys it sends (tune, engine, chip, pause), so
  its buttons and the panel's knobs stay in step; it moves to the next tune at the end of the
  HVSC song length. The address follows the tune: `?t=MUSICIANS/H/Hubbard_Rob/Sanxion.sid&s=2`.
- `scripts/build-pages.mjs` (entry `fm1-sid`) puts the page and the fm-1 build's
  `fm1_web.wasm` together; `.github/workflows/pages.yml` runs `web/smoke.mjs` on the result:
  the wasm must boot the firmware with a pack of the own tune (no network) to sound and a
  screen, and in the synth mode stay silent until a key goes down, then sound. With an fm1-core that lacks PR #31 this check fails (the CPU halts), so merge PR #31
  first.
- Headless Chromium on this cloud machine runs it at 0.9-1.0x real time; a desktop browser has
  room to spare. The emulator skips idle time, so the work per second does not depend on the
  emulated clock.

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
player/psid.h, psid.c     PSID tunes on floooh's m6502 (the C64 side: RAM, banking, CIA latch)
player/psidlog.c          the same on the host -> sidlog v2, to check against libsidplayfp
firmware/main.c,          the FM-1 SID player: 6502 + reSID 0.16 / own model, LCD visualiser
  resid_glue.cc, app.ld,  (GPL-3.0-only, on Felucca's HAL); tunes from a pack after the image
  gen_assets.py, build.sh
tools/sidpack.py          a firmware image with a tune pack
tools/fwsc.py             the firmware as an FM-1 update package (web/sidplayer.fwsc)
tools/housetune.py        the firmware's own tune, Pocket Sync (PSID)
web/                      the player page (GitHub Pages): panel, playlist, HVSC search, files
tools/picks.py            web/tunes.json: the picks with HVSC lengths and measured tags
tools/webpage.sh          the page with ../fm-1's wasm in build/pages, for a local look
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

**C. A `.sid` player** (built: see "The SID player firmware" above). A 6502 core plus the PSID format plays the C64 music library with the
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
5. The player: RSID tunes (full C64 from JaC64 or libsidplayfp), multi-SID tunes, tunes
   loaded over USB instead of built in; a tracker UI (path B).
