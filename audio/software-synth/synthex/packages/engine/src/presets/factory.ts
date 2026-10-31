/**
 * synthex-web — factory bank
 *
 * Source: original Elka Synthex User's Manual, p. 25.
 * Two banks of 40 patches each:
 *   PRESETS  — 40 ROM patches, locked, designed by Paul Wiffen (1982)
 *   MEMORIES — 40 RAM patches shipped on cassette tape, loadable into user RAM
 *
 * Hardware addressing: Bank (1..4) * 10 + Program (0..9). So "46" = Bank 4 /
 * Prog 6 = "Ring mod." (Wiffen's Laser Harp). The 2-digit display shows
 * exactly that number.
 *
 * Names are reproduced verbatim from the manual, including:
 *   - "Ceilos" (sic; typo for Cellos but canon)
 *   - "Ring mod." with the trailing period
 *   - Player attributions: John Lord, Brooker T, Emerson
 *
 * PRESETS: parameter values are the real ones. They were decoded from the
 * Synthex firmware EPROMs (the 40 x 25-byte packed table at $D000 in the
 * T41 ROM, unpacked by running the firmware's own recall routine in a 6502
 * emulator) and mapped to this schema with the conventions documented in
 * tools/synthex-rom/README.md. Knob curves (envelope times, LFO rate, glide
 * speed) are assumptions where the hardware curve is unknown.
 *
 * MEMORIES: still reconstructions by ear. The only circulating cassette
 * (virtual-music.at "factory presets") decodes cleanly but is a user bank:
 * nine of its slots are byte-identical copies of ROM presets and the "Sync"
 * and "Ring Mod" slots have neither sync nor ring mod set.
 *
 * Schema: see PLAN.md §4.
 */

import type { Patch, LayerPatch } from '../patch.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADSR = (a: number, d: number, s: number, r: number) => ({ a, d, s, r })

const defaults = (): LayerPatch => ({
  osc1:  { wave: 'sawtooth', octave: -1, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
  osc2:  { wave: 'sawtooth', octave: -1, detune: 0, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
  mix:   { osc1: 0.5, osc2: 0.5, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
  filter:{ mode: 'lp24', cutoff: 0.6, resonance: 0.2, envAmount: 0.3, keyTrack: 0.5 },
  envFilter: ADSR(0.005, 0.4, 0.4, 0.3),
  envAmp:    ADSR(0.005, 0.2, 0.8, 0.3),
  lfo1:  { shape: 'tri', rate: 5.0, sync: false, delay: 0, depthA: 1, depthB: 1 },
  lfo2:  { shape: 'tri', rate: 0.4, sync: false, delay: 0, depthA: 1, depthB: 1 },
  modMatrix: {
    lfo1ToOsc1Pitch: 0, lfo1ToOsc2Pitch: 0, lfo1ToCutoff: 0,
    lfo1ToOsc1Pwm: 0,   lfo1ToOsc2Pwm: 0,   lfo1ToAmp: 0,
    lfo2ToOsc1Pitch: 0, lfo2ToOsc2Pitch: 0, lfo2ToCutoff: 0,
    lfo2ToOsc1Pwm: 0,   lfo2ToOsc2Pwm: 0,   lfo2ToAmp: 0,
    env1ToCutoff: 1,    env1ToOsc2Pitch: 0,
    joyXToLfo1Depth: 0, joyXToLfo2Depth: 0,
    joyYToCutoff: 0,    joyYToLfoFiltDepth: 0,
    velToAmp: 0, velToCutoff: 0, velToEnv1: 0,
  },
  velocity: { amp: 0, cutoff: 0, env1: 0 },
  glide:    { time: 0, amount: 0, mode: 'off', osc1: true, osc2: true },
  keyAssign: 'poly',
  multiTrigger: true,
  pan: 0,
})

const L = (over: DeepPartial<LayerPatch>): LayerPatch =>
  mergeDeep(defaults(), over) as LayerPatch

type FxOverrides = {
  chorus?: Partial<Patch['fx']['chorus']>
  delay?: Partial<Patch['fx']['delay']>
  reverb?: Partial<Patch['fx']['reverb']>
}

const single = (
  name: string,
  upper: LayerPatch,
  fx: FxOverrides = {},
): Patch => ({
  version: 1,
  name,
  upper,
  lower: upper,
  voiceMode: 'single',
  splitPoint: 60,
  fx: {
    chorus: { enabled: true, mode: 2, mix: 0.5, rate: 0.5, depth: 0.6, ...fx.chorus },
    delay:  { enabled: false, mode: 'standard', time: 0.25, feedback: 0.3, tone: 0.5, spread: 0.3, mix: 0.2, ...fx.delay },
    reverb: { enabled: false, algorithm: 'plate', size: 0.5, damping: 0.5, mix: 0.2, ...fx.reverb },
  },
  master: { tune: 0, fineTune: 0, volume: 0.8, polyphony: 8, unisonDetune: 0.15, limiter: true },
  arp: { enabled: false, pattern: 'up', range: 1, hold: false, rate: 8, gateLength: 0.5 },
  chordMemory: { enabled: false, notes: [0] },
})

// ===========================================================================
// SYNTHEX PRESETS — 40 ROM patches (Paul Wiffen, 1982)
// Decoded from the Synthex firmware EPROMs (T41/EM3/FM3): the 40 x 25-byte
// packed records at $D000, unpacked by running the firmware's own recall
// routine in a 6502 emulator (tools/synthex-rom/). Values are the panel
// settings as the hardware stored them; see tools/synthex-rom/README.md
// for the raw-to-engine scaling conventions and which ones are assumptions.
// ===========================================================================

// --- Bank 1 ----------------------------------------------------------------

const PRESETS_B1: Record<number, Patch> = {
  // 10 Chunky Synth
  0: single('Chunky Synth', L({
    osc1: { wave: 'sawtooth', octave: -1, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: -1, detune: 10.2, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.276, resonance: 0, envAmount: 2.127, keyTrack: 0.552 },
    envFilter: ADSR(0.002, 0.099, 0.553, 0.66),
    envAmp:    ADSR(0.002, 0.198, 0.929, 0.515),
    lfo1: { shape: 'tri', rate: 0.46, delay: 0.02, depthA: 0.514, depthB: 0.749 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: false } }),
  // 11 Wah brass — RELEASE switch off
  1: single('Wah brass', L({
    osc1: { wave: 'sawtooth', octave: -1, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: -1, detune: 14.8, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.126, resonance: 0.094, envAmount: 2.223, keyTrack: 0 },
    envFilter: ADSR(0.05, 3.564, 0.384, 0.01),
    envAmp:    ADSR(0.002, 0.66, 1, 0.01),
    lfo1: { shape: 'tri', rate: 5.35, delay: 0, depthA: 0.247, depthB: 0.965 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 12 Fat Sound
  2: single('Fat Sound', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.173 },
    osc2: { wave: 'square', octave: 2, detune: 1.6, pwm: 0.213, sync: false },
    mix:  { osc1: 0.56, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false, crossMod2: 0.175 },
    filter: { mode: 'hp12', cutoff: -0.058, resonance: 0, envAmount: -1.849, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.66, 0.075, 0.515),
    envAmp:    ADSR(0.002, 0.257, 0.299, 0.515),
    lfo1: { shape: 'tri', rate: 0.99, delay: 0.03, depthA: 0.906, depthB: 0.608 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 13 Metallic
  3: single('Metallic', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.268 },
    osc2: { wave: 'triangle', octave: 1, detune: 313.3, pwm: 0.5, sync: true },
    mix:  { osc1: 0.7, osc2: 0.513, noise: 0, noiseColor: 'white', ringMod: false, crossMod2: 0.175 },
    filter: { mode: 'lp24', cutoff: 0.516, resonance: 0.063, envAmount: 0.797, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.66, 0, 1.782),
    envAmp:    ADSR(0.002, 0.074, 1, 1.782),
    lfo1: { shape: 'tri', rate: 2.41, delay: 0.05, depthA: 0.863, depthB: 0.812 },
    modMatrix: { env1ToCutoff: 0 },
    glide: { mode: 'glide', amount: 11, time: 1, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 14 Pan flutes — RELEASE switch off
  4: single('Pan flutes', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.5 },
    osc2: { wave: 'square', octave: 0, detune: 2.7, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.373, noise: 0.28, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.604, resonance: 0.283, envAmount: 1.825, keyTrack: 0 },
    envFilter: ADSR(0.002, 0.015, 0, 0.01),
    envAmp:    ADSR(0.05, 0.099, 0.354, 0.01),
    lfo1: { shape: 'tri', rate: 5.74, delay: 0.16, depthA: 0.941, depthB: 0 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: false } }),
  // 15 Tremolo piano
  5: single('Tremolo piano', L({
    osc1: { wave: 'triangle', octave: 0, pwm: 0.5 },
    osc2: { wave: 'triangle', octave: 2, detune: 1.2, pwm: 0.5, sync: false },
    mix:  { osc1: 0.28, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.435, resonance: 0, envAmount: 2.948, keyTrack: 0.413 },
    envFilter: ADSR(0.002, 0.037, 0.306, 6.6),
    envAmp:    ADSR(0.002, 0.015, 0.748, 3.564),
    lfo1: { shape: 'tri', rate: 3.42, delay: 0.01, depthA: 0.906, depthB: 0.694 },
    modMatrix: { env1ToCutoff: 0, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: false } }),
  // 16 Chorale
  6: single('Chorale', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.724 },
    osc2: { wave: 'square', octave: 0, detune: 37.9, pwm: 0.787, sync: false },
    mix:  { osc1: 0.373, osc2: 0.373, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'bp6', cutoff: 0.277, resonance: 0.386, envAmount: 0.42, keyTrack: 0.095 },
    envFilter: ADSR(0.003, 3.564, 0.784, 3.564),
    envAmp:    ADSR(0.66, 1.782, 0.929, 1.32),
    lfo1: { shape: 'tri', rate: 5.74, delay: 0, depthA: 0.941, depthB: 0 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0056, lfo1ToOsc1Pwm: 0.5, lfo1ToOsc2Pwm: 0.5 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 17 Brass I — RELEASE switch off
  7: single('Brass I', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 10.2, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.282, resonance: 0, envAmount: 2.356, keyTrack: 0.552 },
    envFilter: ADSR(0.018, 0.029, 0.796, 0.01),
    envAmp:    ADSR(0.002, 1.32, 0.205, 0.01),
    lfo1: { shape: 'tri', rate: 1.77, delay: 0, depthA: 0.988, depthB: 0.965 },
    modMatrix: { env1ToCutoff: 0 },
    glide: { mode: 'glide', amount: -3, time: 0.008, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 18 Brass II
  8: single('Brass II', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.15 },
    osc2: { wave: 'square', octave: 0, detune: 3.9, pwm: 0.165, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.359, resonance: 0, envAmount: 0.894, keyTrack: 0.81 },
    envFilter: ADSR(0.037, 0.515, 0.867, 0.66),
    envAmp:    ADSR(0.002, 0.66, 0.866, 0.515),
    lfo1: { shape: 'tri', rate: 5.87, delay: 1.28, depthA: 0.863, depthB: 0.161 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0143, lfo1ToOsc2Pitch: 0.0143 },
  }), { chorus: { enabled: false } }),
  // 19 Brass III
  9: single('Brass III', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 2.7, pwm: 0.5, sync: false },
    mix:  { osc1: 0.607, osc2: 0.653, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.48, resonance: 0, envAmount: 1.245, keyTrack: 0.81 },
    envFilter: ADSR(0.037, 3.564, 0.827, 0.074),
    envAmp:    ADSR(0.002, 0.037, 0.787, 0.198),
    lfo1: { shape: 'tri', rate: 11.61, delay: 0, depthA: 0.824, depthB: 0.827 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
}

// --- Bank 2 ----------------------------------------------------------------

const PRESETS_B2: Record<number, Patch> = {
  // 20 Double basses
  0: single('Double basses', L({
    osc1: { wave: 'sawtooth', octave: -1, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: -1, detune: 18.4, pwm: 0.5, sync: false },
    mix:  { osc1: 0.513, osc2: 0.373, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.8, resonance: 0, envAmount: 0.304, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 3.564, 0.773, 1.782),
    envAmp:    ADSR(0.257, 3.564, 0.929, 1.782),
    lfo1: { shape: 'tri', rate: 9.18, delay: 0.25, depthA: 0.91, depthB: 1 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pitch: 0.0089 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 21 Ceilos
  1: single('Ceilos', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 18.8, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.885, resonance: 0, envAmount: 0, keyTrack: 0.81 },
    envFilter: ADSR(0.33, 1.782, 0.925, 3.564),
    envAmp:    ADSR(0.257, 0.003, 1, 1.32),
    lfo1: { shape: 'tri', rate: 6.45, delay: 0.07, depthA: 0.933, depthB: 0.525 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pitch: 0.0064 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 22 Violins
  2: single('Violins', L({
    osc1: { wave: 'sawtooth', octave: 1, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 1, detune: 13.3, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.467, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.311, resonance: 0, envAmount: 1.624, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 3.564, 0.816, 1.782),
    envAmp:    ADSR(0.257, 3.564, 0.929, 1.32),
    lfo1: { shape: 'tri', rate: 10.57, delay: 0.07, depthA: 0.906, depthB: 0.525 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pitch: 0.0094 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 23 Church organ
  3: single('Church organ', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'square', octave: 2, detune: 1203.1, pwm: 0.575, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.842, resonance: 0.528, envAmount: 0, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.003, 0.247, 0.515),
    envAmp:    ADSR(0.018, 3.564, 1, 0.515),
    lfo1: { shape: 'tri', rate: 0.66, delay: 0.07, depthA: 0.906, depthB: 0.949 },
    modMatrix: { env1ToCutoff: 0, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: true, mode: 2 } }),
  // 24 Reed organ
  4: single('Reed organ', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'square', octave: 1, detune: 1.2, pwm: 0.606, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.679, resonance: 0.48, envAmount: 0, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.003, 0, 0.66),
    envAmp:    ADSR(0.018, 3.564, 0.906, 0.515),
    lfo1: { shape: 'tri', rate: 0.69, delay: 0.07, depthA: 0.906, depthB: 0.937 },
    modMatrix: { env1ToCutoff: 0, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: true, mode: 2 } }),
  // 25 Electronic organ
  5: single('Electronic organ', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 1, detune: 699.6, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.373, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.619, resonance: 0.496, envAmount: 1.305, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.003, 0, 0.003),
    envAmp:    ADSR(0.002, 0.003, 1, 0.037),
    lfo1: { shape: 'tri', rate: 1.4, delay: 0.82, depthA: 0.898, depthB: 0.816 },
    modMatrix: { env1ToCutoff: 0, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 26 High pass sweep
  6: single('High pass sweep', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.197 },
    osc2: { wave: 'square', octave: 1, detune: 9.4, pwm: 0.134, sync: false },
    mix:  { osc1: 0.467, osc2: 0.467, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'hp12', cutoff: 0.881, resonance: 0.457, envAmount: -1.095, keyTrack: 0 },
    envFilter: ADSR(0.002, 6.6, 0, 1.782),
    envAmp:    ADSR(0.257, 3.564, 0.189, 3.564),
    lfo1: { shape: 'tri', rate: 11.34, delay: 1.77, depthA: 0.898, depthB: 0 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pwm: 0.5 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 27 Filtered brass — RELEASE switch off
  7: single('Filtered brass', L({
    osc1: { wave: 'sawtooth', octave: -1, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: -1, detune: 5.5, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.367, resonance: 0, envAmount: 1.051, keyTrack: 0.552 },
    envFilter: ADSR(0.037, 1.782, 0.761, 0.01),
    envAmp:    ADSR(0.002, 1.32, 0.732, 0.01),
    lfo1: { shape: 'tri', rate: 1.77, delay: 0.49, depthA: 0.988, depthB: 0.161 },
    modMatrix: { env1ToCutoff: 0 },
    glide: { mode: 'glide', amount: -3, time: 0.008, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 28 Filtered chorus
  8: single('Filtered chorus', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 37.9, pwm: 0.5, sync: false },
    mix:  { osc1: 0.653, osc2: 0.653, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.377, resonance: 0.441, envAmount: 0.701, keyTrack: 0.81 },
    envFilter: ADSR(0.037, 3.564, 0.784, 13.2),
    envAmp:    ADSR(0.33, 1.782, 0.929, 1.782),
    lfo1: { shape: 'tri', rate: 9.62, delay: 0.16, depthA: 0.827, depthB: 0 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0188 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 29 Filtered strings
  9: single('Filtered strings', L({
    osc1: { wave: 'square', octave: 1, pwm: 0.5 },
    osc2: { wave: 'square', octave: 1, detune: 11.7, pwm: 0.5, sync: false },
    mix:  { osc1: 0.653, osc2: 0.56, noise: 0.093, noiseColor: 'white', ringMod: false },
    filter: { mode: 'bp12', cutoff: 0.335, resonance: 0, envAmount: 1.051, keyTrack: 0.81 },
    envFilter: ADSR(0.05, 0.515, 0.8, 0.099),
    envAmp:    ADSR(0.05, 0.029, 0.78, 0.003),
    lfo1: { shape: 'tri', rate: 4.98, delay: 0.67, depthA: 1, depthB: 0.898 },
    modMatrix: { env1ToCutoff: 0, lfo1ToCutoff: 0.5 },
    glide: { mode: 'glide', amount: -3, time: 0.028, osc1: true, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
}

// --- Bank 3 ----------------------------------------------------------------

const PRESETS_B3: Record<number, Patch> = {
  // 30 Metallic piano
  0: single('Metallic piano', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.268 },
    osc2: { wave: 'square', octave: 0, detune: 2.7, pwm: 0.283, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.634, resonance: 0.165, envAmount: 0.413, keyTrack: 0 },
    envFilter: ADSR(0.002, 0.198, 0.827, 1.782),
    envAmp:    ADSR(0.002, 0.037, 0.559, 1.32),
    lfo1: { shape: 'tri', rate: 3.67, delay: 0.05, depthA: 0.957, depthB: 1 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0041 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 31 Pianet
  1: single('Pianet', L({
    osc1: { wave: 'sawtooth', octave: 1, pwm: 0.5 },
    osc2: { wave: 'square', octave: 1, detune: 702.3, pwm: 0.89, sync: false },
    mix:  { osc1: 0.56, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.715, resonance: 0.213, envAmount: 0.133, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.015, 0.192, 1.782),
    envAmp:    ADSR(0.002, 0.029, 0.819, 1.32),
    lfo1: { shape: 'tri', rate: 0.92, delay: 0.01, depthA: 0.925, depthB: 0.773 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0072, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 32 Funky Clav.
  2: single('Funky Clav.', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.197 },
    osc2: { wave: 'square', octave: 0, detune: 10.2, pwm: 0.189, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.383, resonance: 0, envAmount: 1.522, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.074, 0.745, 3.564),
    envAmp:    ADSR(0.002, 0.099, 0.598, 1.782),
    lfo1: { shape: 'tri', rate: 0.71, delay: 0, depthA: 1, depthB: 0.878 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 33 Clavichord I
  3: single('Clavichord I', L({
    osc1: { wave: 'square', octave: 1, pwm: 0.5 },
    osc2: { wave: 'square', octave: 1, detune: 0.4, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.373, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.419, resonance: 0, envAmount: 1.426, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.099, 0.224, 0.257),
    envAmp:    ADSR(0.002, 0.074, 0.748, 0.003),
    lfo1: { shape: 'tri', rate: 0.69, delay: 0.07, depthA: 0.906, depthB: 0.937 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: false } }),
  // 34 Clavichord II
  4: single('Clavichord II', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.142 },
    osc2: { wave: 'square', octave: 0, detune: 701.2, pwm: 0.181, sync: false },
    mix:  { osc1: 0.607, osc2: 0.373, noise: 0, noiseColor: 'white', ringMod: true },
    filter: { mode: 'lp24', cutoff: 0.353, resonance: 0, envAmount: 2.791, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.029, 0.565, 1.782),
    envAmp:    ADSR(0.002, 0.257, 0.268, 0.66),
    lfo1: { shape: 'tri', rate: 11.61, delay: 0, depthA: 0.824, depthB: 0.827 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 35 Clavinet
  5: single('Clavinet', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.291 },
    osc2: { wave: 'square', octave: 0, detune: 28.9, pwm: 0.26, sync: false },
    mix:  { osc1: 0.7, osc2: 0.187, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.54, resonance: 0, envAmount: 1.994, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.099, 0.424, 3.564),
    envAmp:    ADSR(0.002, 0.099, 0.78, 1.782),
    lfo1: { shape: 'tri', rate: 7.97, delay: 0, depthA: 0.878, depthB: 0.529 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pwm: 0.5, lfo1ToOsc2Pwm: 0.5 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 36 Electric piano I — RELEASE switch off
  6: single('Electric piano I', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.094 },
    osc2: { wave: 'square', octave: -1, detune: 12.5, pwm: 0.11, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.921, resonance: 0, envAmount: 1.008, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.515, 0.145, 0.01),
    envAmp:    ADSR(0.002, 0.099, 0.614, 0.01),
    lfo1: { shape: 'tri', rate: 11.89, delay: 18.47, depthA: 0.694, depthB: 0.996 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 37 Electric piano II
  7: single('Electric piano II', L({
    osc1: { wave: 'sawtooth', octave: 1, pwm: 0.5 },
    osc2: { wave: 'square', octave: 2, detune: 205.1, pwm: 0.299, sync: true },
    mix:  { osc1: 0.653, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.57, resonance: 0.504, envAmount: 0, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.003, 0, 0.003),
    envAmp:    ADSR(0.002, 0.037, 0.858, 1.32),
    lfo1: { shape: 'tri', rate: 2.77, delay: 0, depthA: 0.565, depthB: 0.678 },
    modMatrix: { env1ToCutoff: 0, lfo1ToAmp: 0.37 },
  }), { chorus: { enabled: false } }),
  // 38 Chimes
  8: single('Chimes', L({
    osc1: { wave: 'triangle', octave: 1, pwm: 0.5 },
    osc2: { wave: 'triangle', octave: 2, detune: 1201.6, pwm: 0.5, sync: false },
    mix:  { osc1: 0.093, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.528, resonance: 0, envAmount: 0.79, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.515, 0.753, 3.564),
    envAmp:    ADSR(0.002, 0.003, 1, 3.564),
    lfo1: { shape: 'tri', rate: 11.89, delay: 0, depthA: 0.973, depthB: 0 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: false } }),
  // 39 Vibes
  9: single('Vibes', L({
    osc1: { wave: 'triangle', octave: 2, pwm: 0.5 },
    osc2: { wave: 'triangle', octave: 2, detune: 1200, pwm: 0.5, sync: false },
    mix:  { osc1: 0.607, osc2: 0.327, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.383, resonance: 0.142, envAmount: 2.139, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.006, 0.8, 3.564),
    envAmp:    ADSR(0.002, 0.074, 0.433, 1.32),
    lfo1: { shape: 'tri', rate: 0.74, delay: 0, depthA: 0.718, depthB: 0.773 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: false } }),
}

// --- Bank 4 ----------------------------------------------------------------

const PRESETS_B4: Record<number, Patch> = {
  // 40 Sweep 1
  0: single('Sweep 1', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.291 },
    osc2: { wave: 'square', octave: -1, detune: 1217.6, pwm: 0.26, sync: true },
    mix:  { osc1: 0.327, osc2: 0.327, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0, envAmount: 2.501, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.074, 0.639, 3.564),
    envAmp:    ADSR(0.002, 0.003, 1, 1.782),
    lfo1: { shape: 'tri', rate: 4.03, delay: 1.77, depthA: 0.91, depthB: 0.773 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pwm: 0.5 },
    glide: { mode: 'glide', amount: 16, time: 0.124, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 2 } }),
  // 41 Sweep 2
  1: single('Sweep 2', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.244 },
    osc2: { wave: 'square', octave: 0, detune: 308.2, pwm: 0.661, sync: true },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.462, resonance: 0, envAmount: 2.972, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.006, 0.553, 0.66),
    envAmp:    ADSR(0.002, 0.198, 0.276, 0.66),
    lfo1: { shape: 'tri', rate: 2.3, delay: 0, depthA: 0.561, depthB: 0.855 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pwm: 0.5 },
    glide: { mode: 'glide', amount: 18, time: 0.558, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 42 Take-off
  2: single('Take-off', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.638 },
    osc2: { wave: 'square', octave: 0, detune: 30.9, pwm: 0.606, sync: false },
    mix:  { osc1: 0.467, osc2: 0.467, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'hp12', cutoff: 0.069, resonance: 0.449, envAmount: 1.29, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 3.3, 0, 3.564),
    envAmp:    ADSR(0.002, 0.003, 1, 3.564),
    lfo1: { shape: 'tri', rate: 15.39, delay: 1.09, depthA: 0.855, depthB: 0.671 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pwm: 0.5, lfo1ToOsc2Pwm: 0.5 },
  }), { chorus: { enabled: true, mode: 3 } }),
  // 43 Landing
  3: single('Landing', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.906 },
    osc2: { wave: 'square', octave: 1, detune: 703.1, pwm: 0.299, sync: false },
    mix:  { osc1: 0.653, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: true, crossMod: 0.175, crossMod2: 0.175 },
    filter: { mode: 'bp12', cutoff: -0.004, resonance: 0.354, envAmount: 1.363, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 6.6, 0.82, 6.6),
    envAmp:    ADSR(0.002, 0.037, 0.874, 13.2),
    lfo1: { shape: 'tri', rate: 0.17, delay: 0, depthA: 0.42, depthB: 0.851 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pwm: 0.5, lfo1ToOsc2Pwm: 0.5, lfo1ToCutoff: 0.5 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 44 Wash of sound
  4: single('Wash of sound', L({
    osc1: { wave: 'square', octave: 0, pwm: 0.5 },
    osc2: { wave: 'square', octave: -1, detune: 829.7, pwm: 0.528, sync: true },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.196, resonance: 0.504, envAmount: 1.464, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.515, 0.859, 3.564),
    envAmp:    ADSR(0.002, 0.003, 1, 3.564),
    lfo1: { shape: 'tri', rate: 11.08, delay: 4.31, depthA: 0.733, depthB: 0.769 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0327, lfo1ToOsc2Pitch: 0.0327 },
    glide: { mode: 'glide', amount: 13, time: 0.153, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 45 Fast decay
  5: single('Fast decay', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.094 },
    osc2: { wave: 'square', octave: -1, detune: 11.7, pwm: 0.709, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.087, resonance: 0.331, envAmount: 1.704, keyTrack: 0.81 },
    envFilter: ADSR(0.007, 13.2, 0.286, 1.782),
    envAmp:    ADSR(0.002, 0.099, 0.614, 1.782),
    lfo1: { shape: 'tri', rate: 0.37, delay: 0, depthA: 0.973, depthB: 0.996 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pwm: 0.5 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 46 Ring mod.
  6: single('Ring mod.', L({
    osc1: { wave: 'square', octave: -1, pwm: 0.717 },
    osc2: { wave: 'square', octave: 1, detune: 709, pwm: 0.654, sync: true },
    mix:  { osc1: 0.513, osc2: 0.467, noise: 0, noiseColor: 'white', ringMod: true, crossMod: 0.175 },
    filter: { mode: 'lp24', cutoff: 0.77, resonance: 0, envAmount: 1.897, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 0.029, 0.173, 0.515),
    envAmp:    ADSR(0.002, 0.257, 0.488, 0.037),
    lfo1: { shape: 'tri', rate: 1.19, delay: 0, depthA: 0.757, depthB: 0.565 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc2Pwm: 0.5 },
    glide: { mode: 'glide', amount: 10, time: 0.846, osc1: false, osc2: true },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 47 Phased sweep
  7: single('Phased sweep', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 16, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0.093, noiseColor: 'pink', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.431, resonance: 0.567, envAmount: 0.855, keyTrack: 0.81 },
    envFilter: ADSR(0.002, 6.6, 0.212, 3.564),
    envAmp:    ADSR(0.002, 0.074, 1, 1.32),
    lfo1: { shape: 'tri', rate: 2.41, delay: 0.05, depthA: 0.863, depthB: 0.812 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 48 Bass pluck
  8: single('Bass pluck', L({
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 10.2, pwm: 0.5, sync: false },
    mix:  { osc1: 0.7, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.008, resonance: 0, envAmount: 2.936, keyTrack: 0.807 },
    envFilter: ADSR(0.002, 0.099, 0.659, 3.564),
    envAmp:    ADSR(0.002, 0.099, 0.598, 1.782),
    lfo1: { shape: 'tri', rate: 0.71, delay: 0, depthA: 1, depthB: 0.878 },
    modMatrix: { env1ToCutoff: 0 },
  }), { chorus: { enabled: true, mode: 1 } }),
  // 49 Whistle — RELEASE switch off
  9: single('Whistle', L({
    osc1: { wave: 'triangle', octave: 1, pwm: 0.5 },
    osc2: { wave: 'square', octave: 2, detune: 1200.8, pwm: 0.567, sync: false },
    mix:  { osc1: 0.42, osc2: 0.7, noise: 0.047, noiseColor: 'white', ringMod: false },
    filter: { mode: 'lp24', cutoff: 0.365, resonance: 0, envAmount: 1.257, keyTrack: 0.81 },
    envFilter: ADSR(0.037, 0.037, 0.733, 0.01),
    envAmp:    ADSR(0.05, 3.564, 0.189, 0.01),
    lfo1: { shape: 'tri', rate: 7.09, delay: 0.57, depthA: 0.71, depthB: 0 },
    modMatrix: { env1ToCutoff: 0, lfo1ToOsc1Pitch: 0.0368 },
    glide: { mode: 'portamento', amount: -4, time: 0.008, osc1: true, osc2: false },
  }), { chorus: { enabled: false } }),
}

// ===========================================================================
// SYNTHEX MEMORIES — 40 RAM patches shipped on cassette
// ===========================================================================
// Names verbatim from the manual. Parameters not yet authored — these load
// into editable RAM, so they're a good place for users to customize. Ship
// as named slots with default params; populate by ear from the cassette
// recording (or decode the .wav FSK dump). Marked `TODO` so it's obvious
// which are placeholder.

type MemoryEntry = { name: string; patch?: Patch }

// Names verbatim from the manual; parameter values are reconstructions.
// (The circulating cassette dump decodes but is not the factory bank — see
// the file header.) Tuned by ear/intuition to fit each name; users can tweak
// in their own RAM banks.

const MEM_B1: Record<number, MemoryEntry> = {
  0: { name: 'Cathedral choir', patch: single('Cathedral choir', L({
    osc1: { wave: 'triangle' },
    osc2: { wave: 'sawtooth', detune: 7 },
    mix: { osc1: 0.55, osc2: 0.45, noise: 0.04 },
    filter: { mode: 'lp12', cutoff: 0.42, resonance: 0.25, envAmount: 0.15 },
    envFilter: ADSR(1.2, 1.5, 0.7, 2.0),
    envAmp:    ADSR(1.0, 0.5, 0.9, 2.0),
    lfo2: { rate: 4.5 },
    modMatrix: { lfo2ToOsc1Pitch: 0.003, lfo2ToOsc2Pitch: 0.003 },
  }), { chorus: { mode: 3, mix: 0.7 }, reverb: { enabled: true, size: 0.85, mix: 0.5 } })},

  1: { name: 'Sync. Harmonic Sweep', patch: single('Sync. Harmonic Sweep', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', octave: 1, sync: true },
    mix: { osc1: 0.3, osc2: 0.7 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.5, envAmount: 0.7 },
    envFilter: ADSR(0.7, 1.5, 0.4, 0.8),
    envAmp:    ADSR(0.05, 0.3, 0.85, 0.4),
    modMatrix: { env1ToOsc2Pitch: 0.6 },
  }), { chorus: { mode: 2, mix: 0.4 } })},

  2: { name: 'Filtered Choir', patch: single('Filtered Choir', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    mix: { osc1: 0.5, osc2: 0.5, noise: 0.05 },
    filter: { mode: 'bp12', cutoff: 0.45, resonance: 0.45, envAmount: 0.3 },
    envFilter: ADSR(0.6, 1.0, 0.5, 1.0),
    envAmp:    ADSR(0.5, 0.4, 0.9, 1.2),
    lfo2: { rate: 4.5 },
    modMatrix: { lfo2ToOsc1Pitch: 0.003, lfo2ToOsc2Pitch: 0.003 },
  }), { chorus: { mode: 3, mix: 0.6 }, reverb: { enabled: true, size: 0.6, mix: 0.3 } })},

  3: { name: 'Harsh Clavinet', patch: single('Harsh Clavinet', L({
    osc1: { wave: 'square', pwm: 0.35 },
    osc2: { wave: 'square', detune: 4, pwm: 0.65 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.7, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.18, 0.0, 0.15),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.18),
  }))},

  4: { name: 'Echo', patch: single('Echo', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'triangle', detune: 3 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp12', cutoff: 0.55, resonance: 0.2, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.4, 0.0, 0.2),
    envAmp:    ADSR(0.005, 0.35, 0.0, 0.25),
  }), { delay: { enabled: true, time: 0.4, feedback: 0.6, mix: 0.5 } })},

  5: { name: 'Double Bass — Nylon Guitar', patch: single('Double Bass — Nylon Guitar', L({
    osc1: { wave: 'triangle', octave: -1 },
    osc2: { wave: 'sawtooth', octave: -1, detune: 5 },
    mix: { osc1: 0.55, osc2: 0.45, noise: 0.06 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.35, envAmount: 0.55 },
    envFilter: ADSR(0.005, 0.25, 0.0, 0.2),
    envAmp:    ADSR(0.005, 0.6, 0.0, 0.3),
  }))},

  6: { name: 'Sync. 1', patch: single('Sync. 1', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', octave: 1, detune: 0, sync: true },
    mix: { osc1: 0.4, osc2: 0.6 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.4, envAmount: 0.55 },
    envFilter: ADSR(0.005, 0.6, 0.3, 0.4),
    envAmp:    ADSR(0.005, 0.3, 0.85, 0.3),
    modMatrix: { env1ToOsc2Pitch: 0.4 },
  }))},

  7: { name: 'Sync. 2', patch: single('Sync. 2', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', octave: 1, detune: 0, sync: true, pwm: 0.5 },
    mix: { osc1: 0.35, osc2: 0.65 },
    filter: { mode: 'lp12', cutoff: 0.4, resonance: 0.55, envAmount: 0.7 },
    envFilter: ADSR(0.05, 0.8, 0.4, 0.5),
    envAmp:    ADSR(0.005, 0.4, 0.85, 0.35),
    modMatrix: { env1ToOsc2Pitch: 0.55, lfo1ToOsc2Pitch: 0.005 },
    lfo1: { rate: 5.0 },
  }))},

  8: { name: 'De-tuned pipe organ', patch: single('De-tuned pipe organ', L({
    osc1: { wave: 'square', pwm: 0.5 },
    osc2: { wave: 'square', detune: 12, pwm: 0.5 },   // detune well off-pitch
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp12', cutoff: 0.65, resonance: 0.15, envAmount: 0.0 },
    envFilter: ADSR(0.005, 0.2, 1.0, 0.3),
    envAmp:    ADSR(0.005, 0.2, 1.0, 0.25),
  }), { chorus: { mode: 3, mix: 0.6 } })},

  9: { name: 'Normal Clavinet', patch: single('Normal Clavinet', L({
    osc1: { wave: 'square', pwm: 0.5 },
    osc2: { wave: 'square', detune: 5, pwm: 0.5 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.4, envAmount: 0.45 },
    envFilter: ADSR(0.005, 0.18, 0.0, 0.15),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.18),
  }))},
}

const MEM_B2: Record<number, MemoryEntry> = {
  0: { name: 'Harsh lead', patch: single('Harsh lead', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -7 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.6, resonance: 0.6, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.5, 0.5, 0.3),
    envAmp:    ADSR(0.005, 0.3, 0.95, 0.25),
    glide: { time: 0.05, amount: 0, mode: 'portamento', osc1: true, osc2: true },
  }))},

  1: { name: 'Solo Violin', patch: single('Solo Violin', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 4 },
    mix: { osc1: 0.55, osc2: 0.45, noise: 0.04 },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0.3, envAmount: 0.2 },
    envFilter: ADSR(0.15, 0.4, 0.7, 0.4),
    envAmp:    ADSR(0.15, 0.3, 0.85, 0.4),
    lfo2: { shape: 'tri', rate: 5.5, delay: 0.4 },
    modMatrix: { lfo2ToOsc1Pitch: 0.005, lfo2ToOsc2Pitch: 0.005 },
  }), { reverb: { enabled: true, size: 0.4, mix: 0.2 } })},

  2: { name: 'Bass Guitar', patch: single('Bass Guitar', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'square', octave: -1, detune: 0 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.4, envAmount: 0.55 },
    envFilter: ADSR(0.005, 0.25, 0.1, 0.2),
    envAmp:    ADSR(0.005, 0.5, 0.4, 0.2),
  }))},

  3: { name: 'Sync. 3', patch: single('Sync. 3', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', octave: 0, detune: 0, sync: true },
    mix: { osc1: 0.35, osc2: 0.65 },
    filter: { mode: 'bp12', cutoff: 0.55, resonance: 0.5, envAmount: 0.45 },
    envFilter: ADSR(0.05, 0.6, 0.4, 0.4),
    envAmp:    ADSR(0.005, 0.4, 0.85, 0.35),
    modMatrix: { env1ToOsc2Pitch: 0.7 },
  }))},

  4: { name: 'Glide Strings', patch: single('Glide Strings', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 6 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp12', cutoff: 0.5, resonance: 0.2, envAmount: 0.2 },
    envFilter: ADSR(0.4, 0.8, 0.7, 0.8),
    envAmp:    ADSR(0.3, 0.5, 0.9, 0.8),
    glide: { time: 0.25, amount: 6, mode: 'glide', osc1: true, osc2: true },
    lfo2: { rate: 4.5 },
    modMatrix: { lfo2ToOsc1Pitch: 0.003, lfo2ToOsc2Pitch: 0.003 },
  }), { chorus: { mode: 2, mix: 0.5 } })},

  5: { name: 'Hammond 1 (John Lord)', patch: single('Hammond 1 (John Lord)', L({
    osc1: { wave: 'sine', octave: 0 },
    osc2: { wave: 'sine', octave: 1, detune: 0 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp12', cutoff: 0.7, resonance: 0.1, envAmount: 0 },
    envFilter: ADSR(0.005, 0.2, 1.0, 0.15),
    envAmp:    ADSR(0.005, 0.2, 1.0, 0.12),
    lfo1: { rate: 6.5 },
    modMatrix: { lfo1ToAmp: 0.4 },
  }), { chorus: { mode: 3, mix: 0.65 } })},

  6: { name: 'Phased Choir', patch: single('Phased Choir', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 8 },
    mix: { osc1: 0.5, osc2: 0.5, noise: 0.03 },
    filter: { mode: 'bp12', cutoff: 0.45, resonance: 0.4, envAmount: 0.2 },
    envFilter: ADSR(0.6, 1.2, 0.6, 1.5),
    envAmp:    ADSR(0.5, 0.5, 0.9, 1.2),
    lfo1: { shape: 'tri', rate: 0.3 },
    modMatrix: { lfo1ToCutoff: 0.5 },
  }), { chorus: { mode: 3, mix: 0.7 } })},

  7: { name: 'Brash Brass', patch: single('Brash Brass', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 4 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0.3, envAmount: 0.7 },
    envFilter: ADSR(0.02, 0.25, 0.4, 0.3),
    envAmp:    ADSR(0.02, 0.2, 0.9, 0.25),
  }))},

  8: { name: 'Brushed Cymbals', patch: single('Brushed Cymbals', L({
    osc1: { wave: 'noise' },
    osc2: { wave: 'noise', detune: 0 },
    mix: { osc1: 0.5, osc2: 0.0, noise: 0.6 },
    filter: { mode: 'hp12', cutoff: 0.75, resonance: 0.3, envAmount: 0.0 },
    envFilter: ADSR(0.005, 0.4, 0.0, 0.3),
    envAmp:    ADSR(0.05, 0.4, 0.0, 0.4),
  }), { reverb: { enabled: true, size: 0.5, mix: 0.3 } })},

  9: { name: 'Hammond 2 (Emerson)', patch: single('Hammond 2 (Emerson)', L({
    osc1: { wave: 'sine', octave: 0 },
    osc2: { wave: 'square', octave: 1, detune: 0, pwm: 0.5 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp12', cutoff: 0.65, resonance: 0.2, envAmount: 0 },
    envFilter: ADSR(0.005, 0.2, 1.0, 0.15),
    envAmp:    ADSR(0.005, 0.2, 1.0, 0.12),
    lfo1: { rate: 7.0 },
    modMatrix: { lfo1ToAmp: 0.5, lfo1ToOsc1Pitch: 0.003 },
  }), { chorus: { mode: 3, mix: 0.7 }, delay: { enabled: true, time: 0.18, feedback: 0.25, mix: 0.2 } })},
}

const MEM_B3: Record<number, MemoryEntry> = {
  0: { name: 'Plink', patch: single('Plink', L({
    osc1: { wave: 'triangle' },
    osc2: { wave: 'sine', octave: 1, detune: 4 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.7, resonance: 0.2, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.15, 0.0, 0.1),
    envAmp:    ADSR(0.005, 0.18, 0.0, 0.15),
  }), { reverb: { enabled: true, size: 0.4, mix: 0.2 } })},

  1: { name: 'Wah Ring Mod.', patch: single('Wah Ring Mod.', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', octave: 1, detune: 4 },
    mix: { osc1: 0.4, osc2: 0.6, ringMod: true },
    filter: { mode: 'bp12', cutoff: 0.5, resonance: 0.55, envAmount: 0.45 },
    envFilter: ADSR(0.05, 0.6, 0.4, 0.5),
    envAmp:    ADSR(0.005, 0.4, 0.85, 0.4),
    lfo1: { shape: 'tri', rate: 1.2 },
    modMatrix: { lfo1ToCutoff: 0.5 },
  }))},

  2: { name: 'Metallic Clavinet', patch: single('Metallic Clavinet', L({
    osc1: { wave: 'square', pwm: 0.4 },
    osc2: { wave: 'sawtooth', octave: 1, detune: 7 },
    mix: { osc1: 0.5, osc2: 0.5, ringMod: true },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.5, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.2, 0.0, 0.18),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.2),
  }))},

  3: { name: 'Bass Drum – tom-toms', patch: single('Bass Drum – tom-toms', L({
    osc1: { wave: 'sine', octave: -1 },
    osc2: { wave: 'noise' },
    mix: { osc1: 0.7, osc2: 0.0, noise: 0.25 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.4, envAmount: 0.7 },
    envFilter: ADSR(0.005, 0.15, 0.0, 0.05),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.05),
    modMatrix: { env1ToOsc2Pitch: 0.4 },
  }))},

  4: { name: 'Hammond 3 (Brooker T)', patch: single('Hammond 3 (Brooker T)', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'triangle', octave: 1, detune: 0 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp12', cutoff: 0.62, resonance: 0.15, envAmount: 0 },
    envFilter: ADSR(0.005, 0.2, 1.0, 0.15),
    envAmp:    ADSR(0.005, 0.2, 1.0, 0.15),
    lfo1: { rate: 5.5 },
    modMatrix: { lfo1ToAmp: 0.35, lfo1ToCutoff: 0.15 },
  }), { chorus: { mode: 3, mix: 0.65 } })},

  5: { name: 'Plucked brass', patch: single('Plucked brass', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0.4, envAmount: 0.7 },
    envFilter: ADSR(0.005, 0.18, 0.0, 0.15),
    envAmp:    ADSR(0.005, 0.4, 0.0, 0.2),
  }))},

  6: { name: 'Snare Drum', patch: single('Snare Drum', L({
    osc1: { wave: 'noise' },
    osc2: { wave: 'triangle', octave: 0 },
    mix: { osc1: 0.0, osc2: 0.3, noise: 0.7 },
    filter: { mode: 'bp12', cutoff: 0.6, resonance: 0.4, envAmount: 0.2 },
    envFilter: ADSR(0.005, 0.15, 0.0, 0.1),
    envAmp:    ADSR(0.005, 0.18, 0.0, 0.12),
  }))},

  7: { name: 'Distant Strings', patch: single('Distant Strings', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 7 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp12', cutoff: 0.4, resonance: 0.2, envAmount: 0.15 },
    envFilter: ADSR(0.5, 0.8, 0.7, 1.0),
    envAmp:    ADSR(0.4, 0.5, 0.85, 1.2),
  }), { reverb: { enabled: true, size: 0.85, mix: 0.5 } })},

  8: { name: 'Watery Grave', patch: single('Watery Grave', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'triangle', octave: -1, detune: -5 },
    mix: { osc1: 0.5, osc2: 0.5, noise: 0.05 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.55, envAmount: 0.0 },
    envFilter: ADSR(0.5, 1.5, 0.6, 1.5),
    envAmp:    ADSR(0.4, 1.0, 0.85, 1.5),
    lfo1: { shape: 'tri', rate: 0.25 },
    modMatrix: { lfo1ToCutoff: 0.7 },
  }), { reverb: { enabled: true, size: 0.9, mix: 0.55 } })},

  9: { name: 'High Portamento', patch: single('High Portamento', L({
    osc1: { wave: 'sawtooth', octave: 1 },
    osc2: { wave: 'square', octave: 1, detune: 5 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.6, resonance: 0.3, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.4, 0.6, 0.3),
    envAmp:    ADSR(0.005, 0.3, 0.9, 0.3),
    glide: { time: 0.4, amount: 7, mode: 'glide', osc1: true, osc2: true },
  }))},
}

const MEM_B4: Record<number, MemoryEntry> = {
  0: { name: 'Electric Piano', patch: single('Electric Piano', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'triangle', detune: 4 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp12', cutoff: 0.55, resonance: 0.15, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.5, 0.0, 0.4),
    envAmp:    ADSR(0.005, 0.6, 0.4, 0.4),
    lfo2: { shape: 'tri', rate: 5.5 },
    modMatrix: { lfo2ToAmp: 0.25 },
  }), { chorus: { mode: 2, mix: 0.4 } })},

  1: { name: 'Oriental Fourths', patch: single('Oriental Fourths', L({
    osc1: { wave: 'square', pwm: 0.5 },
    osc2: { wave: 'square', detune: 0, pwm: 0.5, octave: 0 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'bp12', cutoff: 0.55, resonance: 0.4, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.3, 0.4, 0.3),
    envAmp:    ADSR(0.005, 0.3, 0.7, 0.4),
  }), { reverb: { enabled: true, size: 0.5, mix: 0.3 } })},

  2: { name: 'Wood Blocks (use with sequencer)', patch: single('Wood Blocks', L({
    osc1: { wave: 'sine', octave: 1 },
    osc2: { wave: 'noise' },
    mix: { osc1: 0.5, osc2: 0.0, noise: 0.4 },
    filter: { mode: 'bp12', cutoff: 0.7, resonance: 0.6, envAmount: 0.0 },
    envFilter: ADSR(0.005, 0.05, 0.0, 0.04),
    envAmp:    ADSR(0.005, 0.07, 0.0, 0.05),
  }))},

  3: { name: 'Marimba', patch: single('Marimba', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'triangle', octave: 1, detune: 0 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.65, resonance: 0.2, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.2, 0.0, 0.15),
    envAmp:    ADSR(0.005, 0.35, 0.0, 0.2),
  }), { reverb: { enabled: true, size: 0.4, mix: 0.2 } })},

  4: { name: 'Harp', patch: single('Harp', L({
    osc1: { wave: 'triangle' },
    osc2: { wave: 'sine', detune: 5 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp24', cutoff: 0.6, resonance: 0.15, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.5, 0.0, 0.4),
    envAmp:    ADSR(0.005, 0.6, 0.0, 0.5),
  }), { reverb: { enabled: true, size: 0.6, mix: 0.35 } })},

  5: { name: 'Filtered brass', patch: single('Filtered brass', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.5, envAmount: 0.65 },
    envFilter: ADSR(0.05, 0.5, 0.4, 0.4),
    envAmp:    ADSR(0.04, 0.3, 0.85, 0.3),
  }))},

  6: { name: 'Deep. Sync.', patch: single('Deep. Sync.', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'sawtooth', octave: 0, sync: true },
    mix: { osc1: 0.4, osc2: 0.6 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.5, envAmount: 0.6 },
    envFilter: ADSR(0.05, 0.7, 0.4, 0.5),
    envAmp:    ADSR(0.005, 0.4, 0.85, 0.35),
    modMatrix: { env1ToOsc2Pitch: 0.55 },
  }))},

  7: { name: 'Mini Moog Bass', patch: single('Mini Moog Bass', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'square', octave: -1, detune: 7 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.5, envAmount: 0.6 },
    envFilter: ADSR(0.005, 0.3, 0.0, 0.2),
    envAmp:    ADSR(0.005, 0.4, 0.6, 0.2),
  }))},

  8: { name: 'Mini Moog Lead', patch: single('Mini Moog Lead', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 7 },
    mix: { osc1: 0.5, osc2: 0.5 },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.45, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.4, 0.5, 0.3),
    envAmp:    ADSR(0.005, 0.3, 0.9, 0.25),
    glide: { time: 0.06, amount: 0, mode: 'portamento', osc1: true, osc2: true },
  }))},

  9: { name: 'Steel Drums', patch: single('Steel Drums', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'square', octave: 1, detune: 5 },
    mix: { osc1: 0.4, osc2: 0.6, ringMod: true },
    filter: { mode: 'bp12', cutoff: 0.7, resonance: 0.4, envAmount: 0.2 },
    envFilter: ADSR(0.005, 0.3, 0.0, 0.25),
    envAmp:    ADSR(0.005, 0.4, 0.0, 0.3),
  }), { reverb: { enabled: true, size: 0.5, mix: 0.3 } })},
}

// ===========================================================================
// Export
// ===========================================================================

export interface FactorySlot { address: number; patch: Patch }
export interface MemorySlot  { address: number; name: string; patch?: Patch | undefined }

const flatten = <T>(banks: Record<number, T>[]): { address: number; value: T }[] =>
  banks.flatMap((bank, bankIdx) =>
    Object.entries(bank).map(([prog, value]) => ({
      address: (bankIdx + 1) * 10 + Number(prog),
      value,
    })),
  )

/** 40 ROM presets, addressed 10..49. */
export const PRESETS: FactorySlot[] = flatten<Patch>([
  PRESETS_B1, PRESETS_B2, PRESETS_B3, PRESETS_B4,
]).map(({ address, value }) => ({ address, patch: value }))

/** 40 cassette MEMORIES, addressed 10..49 in the user/RAM space. */
export const MEMORIES: MemorySlot[] = flatten<MemoryEntry>([
  MEM_B1, MEM_B2, MEM_B3, MEM_B4,
]).map(({ address, value }) => ({
  address,
  name: value.name,
  patch: value.patch,
}))

export default { PRESETS, MEMORIES }

// ---------------------------------------------------------------------------
// Utilities (replace with lodash.merge if you prefer)
// ---------------------------------------------------------------------------

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function mergeDeep<T>(target: T, source: DeepPartial<T>): T {
  const out: any = Array.isArray(target) ? [...(target as any)] : { ...target }
  for (const k in source) {
    const sv = (source as any)[k]
    const tv = (out as any)[k]
    out[k] = (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object')
      ? mergeDeep(tv, sv)
      : sv
  }
  return out
}
