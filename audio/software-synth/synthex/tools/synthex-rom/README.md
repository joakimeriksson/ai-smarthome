# synthex-rom — the real Synthex factory programs

The 40 ROM PRESETS in `packages/engine/src/presets/factory.ts` are decoded
from the Elka Synthex firmware, not reconstructed by ear. This directory
holds the tooling and the decoded data. Nothing here runs in the app.

## Pipeline

1. **EPROM dumps** — `ELKA_Synthex.zip` from
   <https://archive.org/download/vintage-synth-firmware-collection/> (mirror of
   dbwbp.com): `sx_t41.bin` (2516), `sx_em3.bin`, `sx_fm3.bin` (2532). The
   T41 chip, which holds the preset table, is byte-identical in every
   circulating dump set (MIDI and pre-MIDI firmware).
2. `unscramble.py` — the CPU board permutes the EPROM address and data lines;
   rebuild the 6502 image ($D800–$FFFF, T41 mirrored at $D000).
3. `decode_rom.py` — the presets are 40 packed 25-byte records at $D000.
   Instead of re-implementing the bit unpacker, the script runs the firmware's
   recall routine ($E08B) in `py65` and reads the 40 parameters it leaves in
   zero page `$38..$5F`. Output: `data/rom_presets_raw.json`.
4. `gen_factory.py` — maps raw values to the engine's patch schema and prints
   the `PRESETS_B1..B4` TypeScript blocks. Parameter identities come from
   Bob Grieb's (Tauntek) Synthex CC map, which lists the RAM address of every
   parameter, cross-checked against the firmware (e.g. the CV output code
   subtracts `$3F` from `$3D` when the ENV +/- bit is set: cutoff and env
   amount).
5. `tape_decode.py` — FSK decoder for cassette dumps (format from the
   firmware's loader; checksums verify). Both circulating "factory presets"
   tapes decode cleanly but are **user banks**, not the MEMORIES listed in
   the manual: `data/tape_virtual-music.json` has 7 slots that are
   byte-identical ROM copies, `data/tape_emond.json` has 3 and its names do
   not fit the sounds either. The MEMORIES bank in factory.ts therefore stays
   a reconstruction.

```sh
cd tools/synthex-rom
python3 unscramble.py sx_t41.bin sx_em3.bin sx_fm3.bin synthex_cpu.bin
uv run --with py65 python decode_rom.py synthex_cpu.bin data/rom_presets_raw.json
python3 gen_factory.py data/rom_presets_raw.json > presets.ts      # paste into factory.ts
uv run --with numpy --with py65 python tape_decode.py tape.wav synthex_cpu.bin data/tape.json
```

## Record layout (per program, 25 bytes = 200 bits)

Index → meaning, stored width → value after the firmware's left shift:

| idx | parameter | bits |
|---|---|---|
| 0 | OSC2 detune (centre 128, ±¼ tone) | 8 |
| 1, 2 | LFO depth A, depth B | 8 |
| 3, 4 | LFO frequency, LFO delay (**pots read inverted**) | 8 |
| 5, 6, 7 | VCF cutoff, key track, env amount | 8 |
| 8 | VCF env sustain | 8 |
| 9 | VCA env sustain | 7→8 |
| 10 | VCF resonance | 7→8 |
| 11, 12 | OSC1 PW, OSC2 PW | 7→8 |
| 13, 14 | glide speed, glide amount (`(v>>2)-32` st) | 7→8 |
| 15, 16 | OSC1, OSC2 transpose (threshold table at $E99F → 0..12 st) | 7→8 |
| 17, 18, 19 | OSC1, OSC2, noise volume | 4→8 |
| 20–25 | VCF A, VCA A, VCF D, VCA D, VCF R, VCA R (16 steps) | 4→8 |
| 26 | LFO routing: b0 osc1 pitch, b1 osc2 pitch, b2 osc1 PW, b3 amp, b4 filter, b5 osc2 PW | 6 |
| 27, 28 | OSC1, OSC2 footage 0..4 = 16' 8' 4' 2' 1' | 3 |
| 29, 30 | OSC1, OSC2 wave 0 tri, 1 saw, 2 square, 3 pulse, 4 pulse PWM'd by the other osc | 3 |
| 31 | LFO wave 0 tri, 1 falling ramp, 2 rising ramp, 3 square | 2 |
| 32 | VCF mode 0 LP24, 1 BP 6 dB, 2 BP 12 dB, 3 HP | 2 |
| 33 | chorus 0 off, 1, 2, 3 | 2 |
| 34 | b6 glide, b7 portamento | 2→8 |
| 35 | b6 VCF env invert, b7 OSC2 sync | 2→8 |
| 36 | b6 glide→OSC2, b7 glide→OSC1 (firmware routing; the panel buttons are cross-wired) | 2→8 |
| 37 | b7 OSC1 ring mod, b6 OSC2 ring mod | 2→8 |
| 38 | b7 RELEASE switch on, b6 HOLD | 2→8 |
| 39 | b6 white noise, b7 pink noise | 2→8 |

## Conventions: measured, derived, assumed

**Derived from hardware or firmware**

- Envelope stage times: the 16-step table of the voice card's envelope
  (3.1, 6.2, 14.5, 29, 37, 74, 99, 198, 257, 515, 660, 1320, 1782, 3564,
  6600, 13200 ms), from pecostm32's Synthex emulator
  (<https://github.com/pecostm32/Elka_Synthex_Emulator>, `synthexhardware.js`:
  the CPU cycles at 1 MHz the firmware waits for the attack comparator). That
  emulator's ROM image is byte-identical to ours, and its RAM image is the
  jbemond cassette bank. Measured against Per Kristian's run-through (the
  marks in the marker tool, first and last ten presets confirmed by ear):
  the **attack** reaches its peak in about half the table time (Double
  basses, Violins, High pass sweep 0.12-0.135 s for 0.257; Whistle and Pan
  flutes ~50 ms for 99 ms) -> `ATTACK_SCALE = 0.5`; the **decay** is linear in
  CV and takes the table time (Phased sweep's cutoff falls linearly from
  peak to sustain over 6.6 s); the **release** is exponential (amplitude
  linear in dB over 30 dB and more) at 20 dB per table time, within +-25 %
  on nine presets with a static filter (Vibes, Pianet, Metallic piano,
  Funky Clav., Clavinet, Clavichord II, Sweep 2, Brass II, Church organ).
  The engine's `Adsr` release is now exponential with `r` = time to fall
  20 dB. Presets with the RELEASE switch off drop at 500-800 dB/s on the
  recording, confirming that bit.
  The VCA opens about 1.5 ms after the filter envelope starts
  (`AMP_ONSET_DELAY` in the engine's voice core): Take-off's HP12 climbs
  its attack in 1.5 ms and the recording has nothing of the unfiltered
  square in the note's first 2 ms, while the static-filter presets reach
  full level within half a millisecond once they start. With both
  envelopes starting together the engine put a 1 ms tick on every
  Take-off note; 1.5 ms is the smallest delay that removes it.
- LFO rate: `27.7 * 400^(-v/255)` Hz, fitted to six measured vibrato and
  tremolo rates (Wash of sound raw 39 -> 11.0 Hz, Clavinet 53 -> 8.05,
  Whistle 58 -> 7.1, Tremolo piano 89 -> 3.39, Electric piano II 98 -> 2.8,
  Ring mod. 134 -> 1.1), all within 5 %. The pot is inverted (low raw value
  = fast), as the data already suggested.
- **One LFO per layer, and when a key restarts it** (2026-11-10; firmware and the schematic of the LFO
  board 410CST5850, sheet 6). The board has one oscillator per layer: a capacitor (330 nF) discharged by the
  rate's current and reset to +5 V, a falling ramp; the rising ramp is its inversion, the square a comparator
  on it, the triangle the two ramps switched at mid-cycle. It runs whether or not a key is down. Its SYNC
  line restarts the ramp (for the triangle it sets the capacitor to the triangle's middle instead) and
  recharges the delay capacitor, whose discharge fades the modulation in. The firmware strobes SYNC in the
  key-assign routine ($F5FD-$F61B) only when a key goes down while no other key of the layer is gated, and
  never when the layer's delay byte is above $F4 (the flags in $019F, set at $EF15). So the 15 presets
  without delay (Landing, Chorale, Clavinet, Electric piano II, Ring mod. and ten more) have an LFO that no key restarts, and the others fade
  it in once per phrase. `VoiceCore.syncLfo` and `Lfo.advance` play that: every voice carries a copy of the
  layer's LFO, a silent voice keeps advancing it, and the voices' owner strobes all of them. Until then each
  voice's LFO stopped while the voice was silent and its delay ramp ran once, when the voice was created.
  Cherry Audio's Elka-X behaves the same way (its LFO carries on across notes unless RESET is on).
- **Both LFO depth knobs read inverted** (byte 255 = none), like the rate, delay and cutoff knobs. On the
  board the level CVs set the bias of the two 13600s through (5 V - LEV) / 10K, and the firmware writes
  the stored bytes to those sample-and-holds unchanged ($FAB1). OTA A feeds the pitch and both pulse widths,
  OTA B the VCA and the VCF. Measured: the pitch at the LFO's own rate is 29 cents peak on Whistle (A 181),
  11 on Wash of sound (187), 7 on Filtered chorus (211) and 4 to 6 on Violins, Double basses and Ceilos
  (231 to 238), where a direct reading had the strings 1.3 x Whistle (`PITCH_MOD` 0.09 = 1.1 st at full
  depth); the level's ripple at the LFO rate over the first 15 s of a passage is 1.5 dB on Church organ
  (B 242) and 2.0 on Reed organ (239), where the direct reading renders 4.9 and 3.9 and the inverted one
  1.2 and 1.0, with Tremolo piano 4.6 (render 4.4), Pianet 3.6 (3.4), Electric piano II 6.5 (4.9)
  (`AMP_MOD` 1.0: full tremolo at full depth). The pulse-width depth (`PWM_MOD` 2.0) follows the board's
  resistors and the earlier harmonic-swing reading; the cutoff depth (`CUTOFF_MOD` 2.0) is not measured:
  the A/B scores of Landing and Filtered strings, the only presets with the routing, do not tell 0.5
  from 2. The string presets' audible 4 to 5 Hz wobble on the recording is not the LFO; it sits at the
  chorus's rate. Tremolo piano and Electric piano II ripple from the first window, so the LFO delay stays
  inverted (byte 255 = none).
- Key tracking and the whole VCF cutoff mapping. **The cutoff pot reads
  inverted** (raw 255 = knob at minimum), like the two LFO pots: that is
  what makes Bass pluck and Fast decay "knob near zero plus a full
  envelope", Ceilos and the organs open, and the measurements consistent.
  The firmware writes (key - 36) * 2 to the DAC per voice ($F3B3: `SBC
  #$24`, $F64A: `ASL` before `STA $14E0`), using the KEY TRACK knob's
  sample-and-hold as the DAC reference (a multiplying DAC, see the 5870
  board handler in the emulator), so tracking is zero at the bottom key C2.
  On the voice card (schematic 410CST5800, sheet 4) the cutoff summing
  amplifier (47K feedback) takes the cutoff knob through 30K, the key-track
  CV through 43K and the envelope through 24K: weights 1 : 0.698 : 1.25.
  Two anchors on Per Kristian's recording fix the scale (Chunky Synth at
  C2 with the filter at sustain: note 108; Phased sweep at its sustain, key
  46: note 72): 0.58 st per DAC unit and note -1 with every CV at zero.
  Checks not used in the fit, same recording: Filtered brass 94/101 vs
  measured 97/98, Church organ 95 vs 96, Electronic organ 74/83/93 vs
  76/88/100 at three keys, Pan flutes 82 vs ~76. `gen_factory.py`
  re-expresses this in the engine's fields (`CUT_SLOPE`, `CUT_OFFSET`,
  `KEY_W`, `ENV_W`): full key tracking is 1.0 st per key (see below) and a full
  envelope about 185 st (the engine clamps at note 132). The harmonic
  estimator saturates above about note 112 on these MP3 sources, so open
  readings are lower bounds; the resonant presets were read by tracking
  their resonant peak instead.
- **Key tracking and the filter sustain** (2026-11-09, `KEY_W`,
  `FILTER_SUSTAIN`), measured on held notes at the start of each preset's
  passage (the run-through transcribed per passage; the cutoff offset, or
  the sustain scale, that explains the hardware's harmonics frame by frame
  against engine renders of the same key). Later in a passage Per Kristian
  moves the panel: the same key on Reed organ reads +3 st at 0.6 s and +18
  at 16.9 s, so only the openings count.
  Full key tracking is 1.0 st per key: the organs read +0 at key 36, +3 at
  44 and 45, +3 / +7.5 / +9 at 48 / 60 / 65, which the schematic's 0.81
  falls behind by 0.19 st per key above C2 (with the Electronic organ check
  above). `KEY_W` is set from it, not from the resistor.
  The filter envelope's sustain reaches 0.7 of the decoded value: Chunky
  Synth, Brass I, Clavinet, Sweep 1 and Sweep 2 read 15 to over 30 st under
  the engine once their decay is over, with their onsets about right, and a
  sustain of 0.65 to 0.85 x the decoded value explains each; a curve (s^1.5,
  s^2) fits worse, and the same scale on the amp envelope made the level
  profiles worse. Together the two take the spectrum distance from 5.51 to
  4.78 dB on the forty 3 s stretches of the Scintilla A/B (18 better, 3
  worse) and from 4.92 to 4.37 on the whole passages (13 better, 8 worse).
  Electric piano II seemed to lose most (6.5 to 10 dB, a resonance near
  2 kHz that the hardware does not have): that was the transcription, not
  the engine. Its stretch had three notes an octave above played ones (72,
  74, 75 over 60, 62, 63); without them it scores 4.5 dB (2026-11-10).
- **Metallic** was corrected the same way (envelope amount x 0.65, decay
  kept) until the decay-length rule above took it over. Measured 2026-10-31 on the run-through's passage at
  0:47 (32 notes), after the engine's synced triangle became a phase-derived
  one: the cutoff per note window, read off the hardware against the
  engine's filter-open render, had the decoded envelope 12-18 st too high
  at the onsets (keys 48-72) and about right a second in; x 0.65 centres it
  (keys below 48 +2.6 st, above -0.5 st). The two presets agree on the
  factor, which argues for a rule, but the run-through gives no held notes
  on the others to settle it.
  What remains on Metallic is the pulse: a pulse-plus-LP24 fit of the
  recording's harmonics reads an effective duty of 0.36 (quartiles 0.19 to
  0.42) against 0.24 from the engine with the decoded 0.27 and the assumed
  cross-mod depth. The static pulses measure as decoded (Electric piano I
  0.08, Funky Clav. 0.16, Metallic piano 0.24, Clavinet 0.27, Whistle's OSC2
  0.42 for 0.57), so it is the cross-mod, `XMOD_DEPTH` or its polarity, that
  is unmeasured; a unipolar modulator (centre shifted up 0.1) fits Metallic
  but cannot be checked on Fat Sound, Landing or Ring mod., whose filters
  and sync defeat the fit. Resolved 2026-11-11 by the schematic: see the
  cross-mod under the ring modulator below.
- **Resonance** stays `p[10] / 254` in the patch; the engine's Q curve changed
  instead (`voice-core.ts`, `updateCoeffs`): Q = 0.5 + 2.2 r^0.75 + 22 r^8.
  On the recording the resonant bump over the neighbouring harmonics is 5 to
  10 dB, Q 2 to 3, on every preset with the knob between 0.2 and 0.6 (Pianet
  0.21, Pan flutes 0.28, Fast decay 0.33, Filtered chorus 0.44, Wash of
  sound 0.50, Phased sweep 0.57), where the old square law gave Q 1.6 to 8.5
  and bumps of 12 to 25 dB; the top of the knob must still self-oscillate.
  Measured 2026-10-31; Wash of sound and Phased sweep went from the two
  worst-scoring presets to the middle of the field with it.
- **Filter envelope reach** (`ENV_LONG_DECAY` 0.6): read off the recording at
  each note's onset against the engine's filter-open render (the cutoff that
  explains the harmonics), the envelope reaches about 0.6 of its decoded
  amount on the presets whose filter envelope has a fast attack (table index
  up to 3, 15 ms or less) running into a long decay (index above 6): Violins
  0.5, Landing 0.4, Take-off 0.4, Metallic 0.6, Chorale, Filtered strings.
  With a slower attack (Brass II and III, Filtered brass, Filtered chorus,
  index 5) or a short decay (the plucks: Chunky Synth, Clavinet, Funky Clav.,
  Brass I) it reads as the full amount. A single global factor helped the
  sweeps and hurt the plucks and brasses; a decay-only rule still hurt the
  brasses. Why a sharp peak reads smaller is open; an envelope that rounds
  it off would do it. Wah brass and Filtered strings (attack index 6)
  measured 0.6 but take the full amount under the rule, a point or two
  worse on the scorecard. Measured 2026-10-31 on 14 presets.
- **Filtered chorus** is corrected one by one too (`FILTER_ENV_FIX`: envelope
  amount x 0.7, measured 2026-11-09). Its opening notes read 12-15 st under
  the engine through the first second (reach 0.64-0.71 of the decoded
  amount), and the band-level distance to the recording falls from 11.6 to
  2.5 dB. Folding it into `ENV_LONG_DECAY` by dropping the attack condition
  does not work: Brass II goes from 4.6 to 12 dB, Brass III from 3.4 to 4.8.
- **Take-off** is corrected one by one (`FILTER_ENV_FIX` in `gen_factory.py`:
  envelope amount x 0.65, filter decay 3.3 s instead of the table's 13.2 s).
  On the recording (the C2 note at 682.14 s) its HP12 starts near note 87
  and falls past the key's second harmonic within about 2 s; mapped as
  above it started at the engine's clamp (note 140 before it) and fell for
  13.2 s, so for the first 3 s the engine played a thin edge some 30 dB
  under the hardware's sound, and the onset, where the filter is still low,
  stood out as a click on every note. The two values are a fit of renders
  to the recording's third-octave band levels over the note's first 3.8 s:
  6.3 dB rms, against 23.8 as mapped (3.6 s fits as well as 3.3). Neither
  carries over as a rule. An envelope weight of 0.7 x on every preset helps
  half of the 20 run-through presets marked by ear (Sweep 1, Bass pluck,
  Phased sweep, Chorale, Landing) and hurts the others (Chunky Synth, Wah
  brass, the Brasses, Ring mod.); and the envelope table is pecostm32's
  timing of the attack comparator, not a measurement, so its last step
  (13.2 s) may be wrong, but Fast decay, the only other preset with that
  filter decay, does not decide it. Single held notes from a hardware
  Synthex would.

- **The scorer** (`ab/render_ab.ts`, `ab/score_ab.py`, 2026-11-10) renders the
  bank on the transcribed notes, puts it through the recording's codec
  (lame, 56 kb/s mono) and compares third-octave levels, whole-clip and in
  100 ms frames, floored 40 dB down (the recording hums at 60 and 120 Hz
  35-50 dB under the notes). Three sets: the 3 s stretches, the notes that
  sound alone, and any other folder laid out the same (the first 15 s of
  each passage was the cross-check). With it: no global constant moves
  (each within 0.07 dB of its best; a curved attack or decay and a slew on
  the envelope CV within 0.03), and three presets are corrected one by one
  (`FILTER_ENV_FIX`: High pass sweep, Filtered brass, Clavichord I; the
  rejected candidates are listed there). Stretches 5.85 -> 5.76 dB, passages
  7.11 -> 7.04. Landing is the worst preset left (12.5 dB) and its three
  sets disagree about the cure: on the passage the hardware's brightness
  falls from the first frame of each note, about 10 st a second, where the
  engine's rose for 3 s first, every voice's LFO then starting at its
  trough. Its LFO (0.17 Hz on the cutoff and both pulse widths, no delay)
  is never restarted by a key, so the phase under each note of the
  recording is whatever it was; with the layer's LFO running through and
  the falling half under the note the stretch scores 8.3 dB. Its rate byte
  (217) is far outside the six the rate curve was fitted on (39 to 134),
  and its passage is transcribed about a second late. Open.

**Still assumptions** (refine by measurement): LFO delay 1 ms to 30 s on
the inverted scale (Whistle's vibrato reaches full depth within ~0.4 s of
the note, consistent with its 0.57 s); glide speed `0.005 * 200^(1-v/254)` s
(calibrated so Ring mod. is about 0.85 s; Whistle's portamento at raw 232
is inaudibly short on the recording, consistent); panel volume 10 -> mix
0.7; LFO->cutoff 2.0 x the inverted depth B; the LFO's phase and polarity at a SYNC (taken
as the triangle's middle, falling); the cross-mod's polarity (fitted, below); the oscillators' coupling into the mixer and ring modulator, a 5 Hz
one-pole high-pass (`AC_COUPLING_HZ` in the voice core: without it a pulse's
DC, 2 pw - 1, came out of the VCA as a thump on every note, and the run-through
has none). The raw values in `data/` are the fixed point.

**The ring modulator** is the voice board's (410CST5800, service manual
page 22), not a multiplier. Each oscillator is a counter whose bits pass
through XOR gates into the waveform DAC; with RING MOD on, the gates' other
input is the other oscillator's pulse, so the wave is inverted while that
pulse is high. For OSC2's pulse this is
`(A - A')/2 + s1 (A + A')/2`, A the pulse of width pw2, A' the one of width
1 - pw2 from the same phase (`PolyBlepSquare.mirror`), s1 OSC1's pulse:
constant amplitude, a part of OSC2 that OSC1 does not touch, and the plain
product at pw 0.5. It is made from the uncoupled waves and coupled by its
own tracker. Until 2026-11-11 it was the product of the two coupled waves:
Ring mod.'s 72 % pulse then sat at +0.57 / -1.43 and the product was 8 dB
louder for 4 ms of every cycle of a low note, a treble burst 10 to 14 ms
into it (11 dB over the note; the recording and the new model: 3 dB). A/B
distance: Clavichord II 4.3 -> 3.0 dB, Landing 10.0 -> 8.2, Ring mod. 2.9 ->
3.4 (3.4 also before the coupling). Other waveforms keep the product of the
raw waves. Open: which way round OSC1's pulse switches (both score alike).

**Cross-mod** (waveform 4, the MOD switch) is on the same sheet: the pulse
comparator compares the oscillator's DAC wave with the PW voltage plus,
through 10K / 10K, the other oscillator's DAC wave. So the modulator is not
the other oscillator's output but the wave in front of its comparator: the
counter's ramp folded into a triangle by the oscillator's own flip-flop, or,
on the ringed oscillator, the ramp as the other pulse flips it
(`prevOsc1 / 2` in the voice core). The depth follows from the divider: the
wave's full swing moves the width by +-0.25 (`XMOD_DEPTH` 0.556 x the
engine's 0.45). Until 2026-11-11 it was 0.175 of the other oscillator's
pulse, from an Elka-X fit. A/B distance of the four presets that have it,
after the ring modulator above: Ring mod. 3.4 -> 2.9 dB, Landing 8.2 -> 7.6,
Metallic 6.3 -> 4.0, Fat Sound 4.2 -> 3.5; the treble burst at Ring mod.'s
note start stays at the recording's 3 dB (2.6). The polarity is fitted: the
triangle taken as 4 |phase - 1/2| - 1, high at the start of the cycle
(Metallic 4.0 against 5.1 the other way, Ring mod. 2.9 against 3.5; Fat
Sound prefers the other, 3.2 against 3.5). The comparator's 10 nF is not
modelled.

**The cutoff's ceiling** (2026-11-12). The filter opens no further than note
120, 8.4 kHz (`CUTOFF_CEILING` in the voice core; it was 132, 16.7 kHz).
Found by ear on Ring mod., the laser harp: every note began with a hard hit.
Its filter envelope adds 114 semitones on a 2 ms attack, so the filter stood
wide open for the first 20 ms of a note; `ab/onset.py` (each note's loudest
30 ms, by band) put that at 6.6 dB over the recording above 3 kHz, and the
other plucks with it (Chunky Synth 14.6, Funky Clav. 18.5, Bass pluck 12.9,
Clavichord II 7.1), all of them right again 120 ms later. A lag on the
envelope does not move it and half the envelope's reach leaves Ring mod. at
5.6; a ceiling brings all of them down. At 120 the forty presets' onsets
above 3 kHz are 5.1 dB off (6.1 before), the A/B score 5.60 (5.65), Ring mod.
3.70 (4.21), eleven presets better and seven worse (the worst Electric
piano I, +0.7, already too dark). Under 116 the clavinets and the organs
lose treble the recording has. A second Synthex on the same preset (Magnus
Gladen's video, full band) agrees: its attack's jump over the sound 150 ms
later is 6.5 dB at 3-9 kHz and 12.3 at 9-16 kHz; the engine's 7.6 and 10.8
at 120, 11.0 and 26.4 without the ceiling. It is a fit to recordings, not a
reading of the filter's circuit. What is left: below 1 kHz the engine's
attack is 1 to 2.5 dB stronger than both recordings'.
