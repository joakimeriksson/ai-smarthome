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
 * Names are authoritative. Parameter values are reconstructions: the manual
 * does not publish the patch data and the .wav cassette dump is FSK audio
 * that we haven't decoded. Each patch below is designed to match its name
 * and exercise the appropriate Synthex feature; tweak by ear against
 * perkristian's "All 40 Synthex presets" recording for accuracy.
 *
 * Schema: see PLAN.md §4.
 */

import type { Patch, LayerPatch } from '../patch.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADSR = (a: number, d: number, s: number, r: number) => ({ a, d, s, r })

const defaults = (): LayerPatch => ({
  osc1:  { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
  osc2:  { wave: 'sawtooth', octave: 0, detune: 0, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
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
  glide:    { time: 0, mode: 'off' },
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
// ===========================================================================

// --- Bank 1 ----------------------------------------------------------------

const PRESETS_B1: Record<number, Patch> = {
  0: single('Chunky Synth', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 7 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.4, envAmount: 0.4 },
    envFilter: ADSR(0.005, 0.3, 0.5, 0.25),
    envAmp:    ADSR(0.005, 0.2, 0.85, 0.2),
  })),
  1: single('Wah brass', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.6, envAmount: 0.6 },
    envFilter: ADSR(0.05, 0.5, 0.4, 0.4),
    envAmp:    ADSR(0.05, 0.3, 0.8, 0.3),
  })),
  2: single('Fat Sound', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -10 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.2, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.4, 0.6, 0.4),
    envAmp:    ADSR(0.005, 0.2, 0.9, 0.4),
  }), { chorus: { mode: 2, mix: 0.6 } }),
  3: single('Metallic', L({   // ✓ verified — "London Kid" (JMJ)
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', octave: 1, detune: 7 },
    mix: { osc1: 0.4, osc2: 0.6, ringMod: true },
    filter: { mode: 'bp12', cutoff: 0.55, resonance: 0.55, envAmount: 0.35 },
    envFilter: ADSR(0.005, 0.6, 0.3, 0.4),
    envAmp:    ADSR(0.005, 0.4, 0.6, 0.4),
  }), { chorus: { mode: 2, mix: 0.55 } }),
  4: single('Pan flutes', L({
    osc1: { wave: 'sine', octave: 0 },
    osc2: { wave: 'triangle', detune: 3 },
    mix: { osc1: 0.65, osc2: 0.35, noise: 0.08 },
    filter: { mode: 'lp12', cutoff: 0.4, resonance: 0.3, envAmount: 0.2 },
    envFilter: ADSR(0.05, 0.25, 0.7, 0.3),
    envAmp:    ADSR(0.08, 0.2, 0.85, 0.3),
    lfo2: { rate: 5.0, delay: 0.2 },
    modMatrix: { lfo2ToOsc1Pitch: 0.004, lfo2ToOsc2Pitch: 0.004 },
  })),
  5: single('Tremolo piano', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'triangle', detune: 4 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.15, envAmount: 0.2 },
    envFilter: ADSR(0.005, 0.6, 0.0, 0.5),
    envAmp:    ADSR(0.005, 0.6, 0.4, 0.4),
    lfo2: { shape: 'tri', rate: 5.5 },
    modMatrix: { lfo2ToAmp: 0.35 },
  })),
  6: single('Chorale', L({
    osc1: { wave: 'triangle' },
    osc2: { wave: 'sawtooth', detune: -7 },
    filter: { mode: 'bp12', cutoff: 0.45, resonance: 0.4, envAmount: 0.2 },
    envFilter: ADSR(0.7, 1.2, 0.7, 1.5),
    envAmp:    ADSR(0.7, 0.4, 0.9, 1.5),
    lfo2: { rate: 4.0 },
    modMatrix: { lfo2ToOsc1Pitch: 0.004, lfo2ToOsc2Pitch: 0.004 },
  }), { chorus: { mode: 3, mix: 0.7 } }),
  7: single('Brass I', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 3 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.2, envAmount: 0.55 },
    envFilter: ADSR(0.05, 0.3, 0.5, 0.3),
    envAmp:    ADSR(0.04, 0.3, 0.85, 0.3),
  })),
  8: single('Brass II', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', detune: 7 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.3, envAmount: 0.65 },
    envFilter: ADSR(0.02, 0.4, 0.4, 0.3),
    envAmp:    ADSR(0.02, 0.4, 0.8, 0.25),
  })),
  9: single('Brass III', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    filter: { mode: 'lp12', cutoff: 0.45, resonance: 0.4, envAmount: 0.55 },
    envFilter: ADSR(0.04, 0.35, 0.55, 0.3),
    envAmp:    ADSR(0.04, 0.3, 0.85, 0.3),
    lfo2: { rate: 5.5, delay: 0.4 },
    modMatrix: { lfo2ToOsc1Pitch: 0.003, lfo2ToOsc2Pitch: 0.003 },
  })),
}

// --- Bank 2 ----------------------------------------------------------------

const PRESETS_B2: Record<number, Patch> = {
  0: single('Double basses', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'sawtooth', octave: -1, detune: -10 },
    filter: { mode: 'lp24', cutoff: 0.32, resonance: 0.2, envAmount: 0.25 },
    envFilter: ADSR(0.3, 0.8, 0.5, 0.8),
    envAmp:    ADSR(0.3, 0.4, 0.85, 1.0),
  }), { chorus: { mode: 2, mix: 0.6 } }),
  1: single('Ceilos', L({       // sic — original spelling; actually cellos
    osc1: { wave: 'sawtooth', octave: 0 },
    osc2: { wave: 'sawtooth', octave: 0, detune: -7 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.15, envAmount: 0.2 },
    envFilter: ADSR(0.4, 0.9, 0.5, 1.0),
    envAmp:    ADSR(0.35, 0.4, 0.85, 1.2),
  }), { chorus: { mode: 2, mix: 0.65 } }),
  2: single('Violins', L({
    osc1: { wave: 'sawtooth', octave: 0 },
    osc2: { wave: 'sawtooth', octave: 0, detune: 8 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.1, envAmount: 0.15 },
    envFilter: ADSR(0.5, 1.0, 0.6, 1.0),
    envAmp:    ADSR(0.45, 0.4, 0.85, 1.4),
    lfo2: { rate: 5.0, delay: 0.5 },
    modMatrix: { lfo2ToOsc1Pitch: 0.005, lfo2ToOsc2Pitch: 0.005 },
  }), { chorus: { mode: 3, mix: 0.7 } }),
  3: single('Church organ', L({
    osc1: { wave: 'square', octave: 0 },
    osc2: { wave: 'square', octave: 1 },
    filter: { mode: 'lp24', cutoff: 0.7, resonance: 0.0, envAmount: 0 },
    envFilter: ADSR(0.005, 0.0, 1.0, 0.0),
    envAmp:    ADSR(0.05, 0.0, 1.0, 0.2),
  }), { chorus: { mode: 3, mix: 0.6 }, reverb: { enabled: true, size: 0.85, damping: 0.4, mix: 0.4 } }),
  4: single('Reed organ', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', detune: -7 },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0.2, envAmount: 0.1 },
    envFilter: ADSR(0.05, 0.0, 1.0, 0.1),
    envAmp:    ADSR(0.05, 0.0, 1.0, 0.15),
  }), { chorus: { mode: 2, mix: 0.55 } }),
  5: single('Electronic organ', L({
    osc1: { wave: 'square', octave: 0 },
    osc2: { wave: 'square', octave: 1, detune: 0 },
    filter: { mode: 'lp24', cutoff: 0.6, resonance: 0.1, envAmount: 0 },
    envFilter: ADSR(0.005, 0.0, 1.0, 0.0),
    envAmp:    ADSR(0.005, 0.0, 1.0, 0.05),
  }), { chorus: { mode: 1, mix: 0.65 } }),
  6: single('High pass sweep', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -7 },
    filter: { mode: 'hp12', cutoff: 0.1, resonance: 0.6, envAmount: 0.7 },
    envFilter: ADSR(0.6, 1.5, 0.7, 1.5),
    envAmp:    ADSR(0.5, 0.5, 0.9, 1.2),
  }), { chorus: { mode: 2, mix: 0.6 } }),
  7: single('Filtered brass', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 5 },
    filter: { mode: 'lp24', cutoff: 0.3, resonance: 0.35, envAmount: 0.7 },
    envFilter: ADSR(0.03, 0.4, 0.45, 0.3),
    envAmp:    ADSR(0.03, 0.3, 0.85, 0.3),
  })),
  8: single('Filtered chorus', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -10 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.45, envAmount: 0.4 },
    envFilter: ADSR(0.6, 1.0, 0.6, 1.0),
    envAmp:    ADSR(0.6, 0.4, 0.9, 1.2),
  }), { chorus: { mode: 3, mix: 0.75 } }),
  9: single('Filtered strings', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 8 },
    filter: { mode: 'bp12', cutoff: 0.45, resonance: 0.5, envAmount: 0.35 },
    envFilter: ADSR(0.5, 1.0, 0.5, 1.0),
    envAmp:    ADSR(0.4, 0.4, 0.85, 1.3),
  }), { chorus: { mode: 3, mix: 0.7 } }),
}

// --- Bank 3 ----------------------------------------------------------------

const PRESETS_B3: Record<number, Patch> = {
  0: single('Metallic piano', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'sine', octave: 1, detune: 5 },
    mix: { osc1: 0.5, osc2: 0.5, ringMod: true },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.2, envAmount: 0.2 },
    envFilter: ADSR(0.005, 1.0, 0.0, 0.8),
    envAmp:    ADSR(0.005, 1.2, 0.1, 0.8),
  }), { chorus: { mode: 2, mix: 0.5 } }),
  1: single('Pianet', L({
    osc1: { wave: 'square' },
    osc2: { wave: 'sine', detune: -3 },
    mix: { osc1: 0.6, osc2: 0.4 },
    filter: { mode: 'lp24', cutoff: 0.45, resonance: 0.4, envAmount: 0.3 },
    envFilter: ADSR(0.005, 0.4, 0.0, 0.3),
    envAmp:    ADSR(0.005, 0.5, 0.2, 0.25),
  })),
  2: single('Funky Clav.', L({
    osc1: { wave: 'square' },
    osc2: { wave: 'sawtooth', detune: 7 },
    filter: { mode: 'bp12', cutoff: 0.45, resonance: 0.55, envAmount: 0.45 },
    envFilter: ADSR(0.005, 0.15, 0.2, 0.1),
    envAmp:    ADSR(0.005, 0.25, 0.5, 0.1),
  })),
  3: single('Clavichord I', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', detune: -5 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.45, envAmount: 0.5 },
    envFilter: ADSR(0.005, 0.18, 0.0, 0.12),
    envAmp:    ADSR(0.005, 0.3, 0.0, 0.15),
  })),
  4: single('Clavichord II', L({
    osc1: { wave: 'square' },
    osc2: { wave: 'square', octave: 1, detune: 3 },
    filter: { mode: 'lp12', cutoff: 0.5, resonance: 0.5, envAmount: 0.45 },
    envFilter: ADSR(0.005, 0.22, 0.0, 0.15),
    envAmp:    ADSR(0.005, 0.35, 0.0, 0.2),
  })),
  5: single('Clavinet', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', detune: -7 },
    filter: { mode: 'lp24', cutoff: 0.32, resonance: 0.5, envAmount: 0.55 },
    envFilter: ADSR(0.005, 0.18, 0.15, 0.12),
    envAmp:    ADSR(0.005, 0.3, 0.4, 0.12),
  })),
  6: single('Electric piano I', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'sine', octave: 1, detune: 7 },
    mix: { osc1: 0.6, osc2: 0.4, ringMod: true },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.1, envAmount: 0.2 },
    envFilter: ADSR(0.005, 0.8, 0.0, 0.6),
    envAmp:    ADSR(0.005, 0.9, 0.2, 0.6),
  }), { chorus: { mode: 2, mix: 0.5 } }),
  7: single('Electric piano II', L({
    osc1: { wave: 'sine' },
    osc2: { wave: 'triangle', detune: 5 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0.15, envAmount: 0.25 },
    envFilter: ADSR(0.005, 0.7, 0.0, 0.5),
    envAmp:    ADSR(0.005, 0.85, 0.25, 0.5),
  }), { chorus: { mode: 1, mix: 0.55 } }),
  8: single('Chimes', L({
    osc1: { wave: 'sine', octave: 1 },
    osc2: { wave: 'sine', octave: 2, detune: 4 },
    mix: { osc1: 0.5, osc2: 0.5, ringMod: true },
    filter: { mode: 'lp24', cutoff: 0.7, resonance: 0.1, envAmount: 0.15 },
    envFilter: ADSR(0.005, 1.5, 0.0, 1.5),
    envAmp:    ADSR(0.005, 1.8, 0.0, 1.8),
  }), { chorus: { mode: 2, mix: 0.55 }, reverb: { enabled: true, size: 0.7, damping: 0.5, mix: 0.3 } }),
  9: single('Vibes', L({
    osc1: { wave: 'sine', octave: 0 },
    osc2: { wave: 'sine', octave: 1, detune: 0 },
    mix: { osc1: 0.55, osc2: 0.45 },
    filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.15, envAmount: 0.15 },
    envFilter: ADSR(0.005, 1.0, 0.1, 0.8),
    envAmp:    ADSR(0.005, 1.3, 0.15, 0.9),
    lfo2: { shape: 'tri', rate: 5.0 },
    modMatrix: { lfo2ToAmp: 0.3 },
  })),
}

// --- Bank 4 ----------------------------------------------------------------

const PRESETS_B4: Record<number, Patch> = {
  0: single('Sweep 1', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -7 },
    filter: { mode: 'lp24', cutoff: 0.25, resonance: 0.7, envAmount: 0.7 },
    envFilter: ADSR(0.5, 1.2, 0.6, 1.2),
    envAmp:    ADSR(0.4, 0.5, 0.9, 1.2),
  })),
  1: single('Sweep 2', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: 7 },
    filter: { mode: 'hp12', cutoff: 0.15, resonance: 0.65, envAmount: 0.7 },
    envFilter: ADSR(0.6, 1.5, 0.7, 1.4),
    envAmp:    ADSR(0.5, 0.5, 0.9, 1.4),
  })),
  2: single('Take-off', L({
    osc1: { wave: 'noise' },
    osc2: { wave: 'sawtooth', octave: 0 },
    mix: { osc1: 0.3, osc2: 0.7, noise: 0.4 },
    filter: { mode: 'bp12', cutoff: 0.2, resonance: 0.7, envAmount: 0.8 },
    envFilter: ADSR(2.0, 1.0, 1.0, 0.5),
    envAmp:    ADSR(2.0, 0.0, 1.0, 0.5),
    lfo1: { rate: 0.5 },
    modMatrix: { lfo1ToOsc1Pitch: 0, env1ToOsc2Pitch: 0.8 },
  })),
  3: single('Landing', L({
    osc1: { wave: 'noise' },
    osc2: { wave: 'sawtooth' },
    mix: { osc1: 0.3, osc2: 0.7, noise: 0.4 },
    filter: { mode: 'bp12', cutoff: 0.6, resonance: 0.65, envAmount: -0.7 },
    envFilter: ADSR(0.005, 2.5, 0.0, 0.5),
    envAmp:    ADSR(0.005, 2.8, 0.0, 0.5),
    modMatrix: { env1ToOsc2Pitch: -0.8 },
  })),
  4: single('Wash of sound', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -12 },
    filter: { mode: 'lp24', cutoff: 0.35, resonance: 0.2, envAmount: 0.3 },
    envFilter: ADSR(1.2, 1.5, 0.6, 2.0),
    envAmp:    ADSR(1.0, 0.5, 0.9, 2.0),
    lfo2: { rate: 0.3 },
    modMatrix: { lfo2ToCutoff: 0.3 },
  }), { chorus: { mode: 3, mix: 0.8 }, reverb: { enabled: true, size: 0.85, damping: 0.5, mix: 0.4 } }),
  5: single('Fast decay', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'square', detune: 7 },
    filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.55, envAmount: 0.6 },
    envFilter: ADSR(0.005, 0.18, 0.0, 0.1),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.1),
  })),
  // 46 — Wiffen's Laser Harp ("Ring mod.")
  // Verified against the canonical Wiffen patch (KVR Audio thread; switched-on
  // synthesizer blog reconstruction; perkristian's recording).
  //
  // Original Synthex front panel:
  //   OSC1: 8' (oct 0), Pulse, PW −1/±5, vol 7
  //   OSC2: 2' (oct +2) + Transpose 7 (perfect 5th), waveform = "OSC1 PWM + Ring Mod"
  //          (i.e. cross-mod ON + ring mod ON simultaneously), Sync ON, vol 7
  //   LFO:  Triangle → PW2, Freq 3, Depth 3, no delay
  //   Filter: LP24, Freq 5, Reso 0, Kbd-track 10 (full), Env amount 5
  //   Env-Filter: A=0 D=2 S=2 R=0
  //   Env-Amp:    A=0 D=5 S=5 R=3 (release env ON)
  //   Chorus: setting 1 (slowest/shallowest)
  //   "OSC2 Glide" (a Synthex-specific OSC2 pitch envelope, NOT note portamento)
  //
  // Mapping notes:
  //   - OSC2 +24 semis (oct=2) + 700 ct gives the +31 semi free-running pitch.
  //     With sync, this sets the formant the sync detune sweeps over.
  //   - Synthex "OSC2 Glide" ≈ env1→OSC2 pitch (the filter-env swoop on attack).
  //     Note portamento (glide.time) is OFF — that's a different control.
  6: single('Ring mod.', L({
    // OSC1 plays straight; OSC2 starts a major-second above target and
    // slides down on each note attack — Wiffen's "OSC2 Glide. Speed 10.
    // Amount 2." This per-osc Glide IS the laser harp swoop. Note portamento
    // (glide.time) stays off — different feature.
    osc1: { wave: 'square', octave: 0, pwm: 0.45,
            glide: { amount: 0, speed: 0.05 } },              // not glided
    osc2: { wave: 'square', octave: 2, detune: 700, pwm: 0.45, sync: true,
            glide: { amount: 2, speed: 0.05 } },              // +2 semi swoop
    mix:  { osc1: 0.5, osc2: 0.5, ringMod: true, crossMod: 0.55 },
    filter: { mode: 'lp24', cutoff: 0.5, resonance: 0, envAmount: 0.5, keyTrack: 1.0 },
    // Synthex ADSR knobs are logarithmic: 0 ≈ instant, 2 ≈ 0.5 s, 5 ≈ 2 s,
    // 9 ≈ 20 s+. The original published values were misread as small linear
    // numbers in the first pass.
    envFilter: ADSR(0.001, 0.5, 0.2, 0.05),                   // A=0 D=2 S=2 R=0
    envAmp:    ADSR(0.001, 2.0, 0.4, 1.5),                    // A=0 D=5 S=5 R=3
    glide: { time: 0, mode: 'off' },                          // portamento off
    lfo1: { shape: 'tri', rate: 2.5, sync: false, delay: 0 }, // LFO Freq 3
    modMatrix: {
      lfo1ToOsc2Pwm: 0.33,      // LFO Triangle → PW2, Depth 3 of 9
    },
  }), {
    chorus: { mode: 1, mix: 0.55 },                           // Chorus setting 1
    // perkristian's reference is recorded with room reverb. The Synthex has
    // no onboard reverb, but we add a modest amount so the demo matches the
    // reference's space and the bell decay can ring out audibly.
    reverb: { enabled: true, size: 0.6, damping: 0.4, mix: 0.25 },
  }),
  7: single('Phased sweep', L({
    osc1: { wave: 'sawtooth' },
    osc2: { wave: 'sawtooth', detune: -7 },
    filter: { mode: 'bp6', cutoff: 0.5, resonance: 0.7, envAmount: 0.3 },
    envFilter: ADSR(0.6, 1.0, 0.5, 1.0),
    envAmp:    ADSR(0.4, 0.5, 0.9, 1.0),
    lfo1: { rate: 0.4 },
    modMatrix: { lfo1ToCutoff: 0.55 },
  }), { chorus: { mode: 3, mix: 0.7 } }),
  8: single('Bass pluck', L({
    osc1: { wave: 'sawtooth', octave: -1 },
    osc2: { wave: 'square', octave: -1, detune: -5 },
    filter: { mode: 'lp24', cutoff: 0.3, resonance: 0.55, envAmount: 0.6 },
    envFilter: ADSR(0.005, 0.2, 0.0, 0.1),
    envAmp:    ADSR(0.005, 0.25, 0.0, 0.1),
  })),
  9: single('Whistle', L({
    osc1: { wave: 'triangle', octave: 1 },
    osc2: { wave: 'sine', octave: 2, detune: 4 },
    filter: { mode: 'lp12', cutoff: 0.55, resonance: 0.3, envAmount: 0.1 },
    envFilter: ADSR(0.05, 0.2, 0.7, 0.3),
    envAmp:    ADSR(0.06, 0.15, 0.85, 0.25),
    lfo2: { rate: 6.0, delay: 0.15 },
    modMatrix: { lfo2ToOsc1Pitch: 0.005, lfo2ToOsc2Pitch: 0.005 },
  })),
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

// Names verbatim from the manual; parameter values are reconstructions
// (the cassette dump hasn't been decoded). Tuned by ear/intuition to fit
// each name; users can tweak in their own RAM banks.

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
    glide: { time: 0.05, mode: 'legato' },
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
    glide: { time: 0.25, mode: 'always' },
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
    glide: { time: 0.4, mode: 'always' },
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
    glide: { time: 0.06, mode: 'legato' },
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
