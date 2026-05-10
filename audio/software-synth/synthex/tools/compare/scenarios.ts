// Test scenarios for the comparison harness.
//
// Each scenario isolates one DSP feature (oscillator shape, filter, sync,
// ring mod, cross-mod, ADSR, LFO) plus a couple of full patches. Keep
// patches minimal so spectral differences point at the specific subsystem
// being tested.

import type { LayerPatch, ModSlot, DeepPartial } from '../../packages/engine/src/patch.ts'
import { mergeDeep } from '../../packages/engine/src/patch.ts'
import type { NoteEvent, Param } from './render.ts'

export interface Scenario {
  id: string
  title: string
  description: string
  patch: LayerPatch
  events: NoteEvent[]
  params?: Param[]
  durationSec: number
  // Hint for plot range (some tests want a narrower view)
  maxPlotHz?: number
}

const emptyMatrix = (): Record<ModSlot, number> => ({
  lfo1ToOsc1Pitch: 0, lfo1ToOsc2Pitch: 0, lfo1ToCutoff: 0,
  lfo1ToOsc1Pwm: 0,   lfo1ToOsc2Pwm: 0,   lfo1ToAmp: 0,
  lfo2ToOsc1Pitch: 0, lfo2ToOsc2Pitch: 0, lfo2ToCutoff: 0,
  lfo2ToOsc1Pwm: 0,   lfo2ToOsc2Pwm: 0,   lfo2ToAmp: 0,
  env1ToCutoff: 0,    env1ToOsc2Pitch: 0,
  joyXToLfo1Depth: 0, joyXToLfo2Depth: 0,
  joyYToCutoff: 0,    joyYToLfoFiltDepth: 0,
  velToAmp: 0, velToCutoff: 0, velToEnv1: 0,
})

// Bare patch: open filter, no resonance, slow attack/release suppressed,
// just lets the raw oscillator through. Deep-merge so partial overrides
// (e.g. just {osc1: {wave: 'square'}}) don't drop sibling fields.
function bare(over: DeepPartial<LayerPatch> = {}): LayerPatch {
  const base: LayerPatch = {
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
    osc2: { wave: 'sawtooth', octave: 0, detune: 0, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
    mix:  { osc1: 1, osc2: 0, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
    filter: { mode: 'lp24', cutoff: 1, resonance: 0, envAmount: 0, keyTrack: 0 },
    envFilter: { a: 0.001, d: 0.001, s: 1, r: 0.001 },
    envAmp:    { a: 0.001, d: 0.001, s: 1, r: 0.001 },
    lfo1: { shape: 'tri', rate: 5, sync: false, delay: 0, depthA: 1, depthB: 1 },
    lfo2: { shape: 'tri', rate: 5, sync: false, delay: 0, depthA: 1, depthB: 1 },
    modMatrix: emptyMatrix(),
    velocity: { amp: 0, cutoff: 0, env1: 0 },
    glide: { time: 0, mode: 'off' },
    keyAssign: 'poly',
    multiTrigger: true,
    pan: 0,
  }
  return mergeDeep(base, over)
}

// Helper: render a single sustained note from t=0 to (durationSec - 0.1)
function holdNote(note: number, durationSec: number): NoteEvent[] {
  return [
    { kind: 'on', t: 0, note, velocity: 1 },
    { kind: 'off', t: durationSec - 0.1, note },
  ]
}

export const SCENARIOS: Scenario[] = [
  // ---- Bare oscillators ---------------------------------------------------
  {
    id: 'osc-saw-A3',
    title: 'PolyBLEP saw — A3 (220 Hz)',
    description: 'Bare sawtooth at 220 Hz with filter wide open. Spectrum should show fundamental + harmonics decaying as 1/n. Aliased mirror images mean the BLEP isn\'t suppressing enough.',
    patch: bare(),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'osc-saw-A5',
    title: 'PolyBLEP saw — A5 (880 Hz)',
    description: 'Saw at 880 Hz. Fewer harmonics fit under Nyquist; aliasing becomes visible above ~12 kHz if the BLEP is too narrow.',
    patch: bare(),
    events: holdNote(81, 2),
    durationSec: 2,
  },
  {
    id: 'osc-saw-A6',
    title: 'PolyBLEP saw — A6 (1760 Hz)',
    description: 'High-pitch alias stress test. 1st-order PolyBLEP typically gives 25–35 dB SNR here. Reference synths with higher-order BLEP (or oversampling) will show a cleaner upper band.',
    patch: bare(),
    events: holdNote(93, 2),
    durationSec: 2,
  },
  {
    id: 'osc-square-50pct',
    title: 'Square (50% duty) — A3',
    description: 'Square at 50% duty has only odd harmonics. Even harmonics should be ≥40 dB below odd ones; if not, the dual-saw-subtract isn\'t matched.',
    patch: bare({ osc1: { wave: 'square', octave: 0, pwm: 0.5 } }),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'osc-square-25pct',
    title: 'Square (25% duty) — A3',
    description: 'PWM at 25%. Even harmonics now appear; spectral envelope should match the analytic formula sin(πfk·d)/(πfk).',
    patch: bare({ osc1: { wave: 'square', octave: 0, pwm: 0.25 } }),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'osc-tri-A3',
    title: 'Triangle — A3',
    description: 'Triangle has odd harmonics decaying as 1/n². Compare slope of the decay; band-limited triangles don\'t alias significantly under typical pitches.',
    patch: bare({ osc1: { wave: 'triangle', octave: 0, pwm: 0.5 } }),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'osc-sine-A3',
    title: 'Sine — A3',
    description: 'Sine reference. Should show one very tall fundamental with everything else ≥120 dB down.',
    patch: bare({ osc1: { wave: 'sine', octave: 0, pwm: 0.5 } }),
    events: holdNote(57, 2),
    durationSec: 2,
  },

  // ---- Filter -------------------------------------------------------------
  {
    id: 'filter-lp24-sweep',
    title: 'LP24 cutoff sweep on saw — A3',
    description: 'Sustained saw, cutoff sweeping 0→1 over 2 seconds, no resonance. Spectrogram should show harmonics being shaved off the top.',
    patch: bare({
      filter: { mode: 'lp24', cutoff: 0, resonance: 0, envAmount: 0, keyTrack: 0 },
    }),
    events: holdNote(57, 3),
    params: Array.from({ length: 100 }, (_, i) => ({
      path: 'filter.cutoff', t: 0.2 + i * 0.018, value: i / 99,
    })),
    durationSec: 3,
  },
  {
    id: 'filter-lp24-resonance',
    title: 'LP24 resonance peak — fc=A4',
    description: 'Cutoff fixed near A4 (440 Hz). Resonance ramps 0→1; expect a growing peak at fc.',
    patch: bare({
      filter: { mode: 'lp24', cutoff: 0.5, resonance: 0, envAmount: 0, keyTrack: 0 },
    }),
    events: holdNote(57, 3),
    params: Array.from({ length: 50 }, (_, i) => ({
      path: 'filter.resonance', t: 0.2 + i * 0.04, value: i / 49 * 0.95,
    })),
    durationSec: 3,
  },
  {
    id: 'filter-bp12',
    title: 'BP12 — fc=A4 — Q≈3',
    description: 'Band-pass at A4 with moderate resonance. Expect a single bump centered at 440 Hz with ~12 dB/oct skirts on both sides.',
    patch: bare({
      filter: { mode: 'bp12', cutoff: 0.5, resonance: 0.4, envAmount: 0, keyTrack: 0 },
    }),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'filter-hp12',
    title: 'HP12 — fc=440 Hz on saw',
    description: 'High-pass at 440 Hz. Saw fundamental at 220 should be down ~12 dB; harmonics above 440 mostly intact.',
    patch: bare({
      filter: { mode: 'hp12', cutoff: 0.5, resonance: 0, envAmount: 0, keyTrack: 0 },
    }),
    events: holdNote(57, 2),
    durationSec: 2,
  },

  // ---- Sync / ring / cross-mod -------------------------------------------
  {
    id: 'sync-osc2-sweep',
    title: 'Hard sync — osc1 A3, osc2 sweep A3→A6',
    description: 'Classic sync sweep. Spectrogram should show an animated formant moving up while the fundamental stays at 220 Hz.',
    patch: bare({
      osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
      osc2: { wave: 'sawtooth', octave: 0, detune: 0, pwm: 0.5, sync: true, glide: { amount: 0, speed: 0.05 } },
      mix:  { osc1: 0.3, osc2: 0.7, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
    }),
    events: holdNote(57, 3),
    params: Array.from({ length: 60 }, (_, i) => ({
      path: 'osc2.detune', t: 0.1 + i * 0.045, value: (i / 59) * 3600, // up 3 octaves in cents
    })),
    durationSec: 3,
  },
  {
    id: 'ring-mod-fifth',
    title: 'Ring mod — osc1 A3, osc2 +7 semis (perfect 5th)',
    description: 'Ring modulator output is sum and difference frequencies of the two oscillators. With a perfect 5th, expect a clangorous spectrum with sum/diff sidebands.',
    patch: bare({
      osc1: { wave: 'sine', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
      osc2: { wave: 'sine', octave: 0, detune: 700, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
      mix:  { osc1: 0, osc2: 1, noise: 0, noiseColor: 'white', ringMod: true, crossMod: 0, crossMod2: 0 },
    }),
    events: holdNote(57, 2),
    durationSec: 2,
  },
  {
    id: 'cross-mod-pwm',
    title: 'Cross-mod — osc1 audio-rate → osc2 PWM',
    description: 'OSC1 at 110 Hz modulates OSC2\'s pulse width at audio rate. The Synthex signature feature (slot 46 "Ring mod." / Laser Harp).',
    patch: bare({
      osc1: { wave: 'sawtooth', octave: -1, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
      osc2: { wave: 'square', octave: 0, detune: 0, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
      mix:  { osc1: 0.0, osc2: 1, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0.7, crossMod2: 0 },
    }),
    events: holdNote(57, 2),
    durationSec: 2,
  },

  // ---- Envelope / LFO -----------------------------------------------------
  {
    id: 'adsr-amp',
    title: 'ADSR amp envelope — A=10ms D=200ms S=0.7 R=300ms',
    description: 'Sustained note with the spec envelope. View the spectrogram\'s loudness over time to verify attack/decay/release timing.',
    patch: bare({
      envAmp: { a: 0.01, d: 0.2, s: 0.7, r: 0.3 },
    }),
    events: [
      { kind: 'on', t: 0.1, note: 57, velocity: 1 },
      { kind: 'off', t: 1.0, note: 57 },
    ],
    durationSec: 2,
  },
  {
    id: 'lfo-vibrato',
    title: 'LFO 1 vibrato — 5 Hz → osc1 pitch',
    description: 'Triangle LFO at 5 Hz pitching osc1 by ±~5 cents. Spectrum should show two sidebands either side of the carrier.',
    patch: bare({
      modMatrix: { ...emptyMatrix(), lfo1ToOsc1Pitch: 0.005 },
      lfo1: { shape: 'tri', rate: 5, sync: false, delay: 0 },
    }),
    events: holdNote(57, 2),
    durationSec: 2,
    maxPlotHz: 1000,
  },

  // ---- Full patches ------------------------------------------------------
  {
    id: 'patch-laser-harp',
    title: 'Patch — Ring mod. (Laser Harp, slot 46)',
    description: 'The Wiffen/JMJ "Rendez-Vous" sound. All four "weird" switches engaged: sync + ring + cross-mod + filter env on osc2 pitch.',
    patch: {
      // Now uses the authentic Wiffen tuning: per-osc Glide on OSC2 (not env1ToOsc2Pitch).
      osc1: { wave: 'square', octave: 0, pwm: 0.45, glide: { amount: 0, speed: 0.05 } },
      osc2: { wave: 'square', octave: 2, detune: 700, pwm: 0.45, sync: true, glide: { amount: 2, speed: 0.05 } },
      mix:  { osc1: 0.5, osc2: 0.5, noise: 0, noiseColor: 'white', ringMod: true, crossMod: 0.55, crossMod2: 0 },
      filter: { mode: 'lp24', cutoff: 0.5, resonance: 0, envAmount: 0.5, keyTrack: 1.0 },
      envFilter: { a: 0.001, d: 0.5, s: 0.2, r: 0.05 },
      envAmp:    { a: 0.001, d: 2.0, s: 0.4, r: 1.5 },
      lfo1: { shape: 'tri', rate: 2.5, sync: false, delay: 0, depthA: 1, depthB: 1 },
      lfo2: { shape: 'tri', rate: 0.4, sync: false, delay: 0, depthA: 1, depthB: 1 },
      modMatrix: { ...emptyMatrix(), env1ToCutoff: 1, lfo1ToOsc2Pwm: 0.33 },
      velocity: { amp: 0, cutoff: 0, env1: 0 },
      glide: { time: 0, mode: 'off' },
      keyAssign: 'mono',
      multiTrigger: true,
      pan: 0,
    },
    events: [
      // perkristian's reference recording opens around D3 (~147 Hz). Match
      // the pitch so the spectral comparison is apples-to-apples.
      { kind: 'on', t: 0.1, note: 50, velocity: 1 },
      { kind: 'off', t: 2.4, note: 50 },
    ],
    durationSec: 3,
  },
  {
    id: 'patch-brass-1',
    title: 'Patch — Brass I (slot 17)',
    description: 'Standard brass patch from PRESETS_B1. Detuned saws + filter env. Compare against perkristian recording or any brass preset on Cherry/Arturia.',
    patch: {
      osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
      osc2: { wave: 'sawtooth', octave: 0, detune: 3, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
      mix:  { osc1: 0.5, osc2: 0.5, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
      filter: { mode: 'lp24', cutoff: 0.4, resonance: 0.2, envAmount: 0.55, keyTrack: 0.5 },
      envFilter: { a: 0.05, d: 0.3, s: 0.5, r: 0.3 },
      envAmp:    { a: 0.04, d: 0.3, s: 0.85, r: 0.3 },
      lfo1: { shape: 'tri', rate: 5, sync: false, delay: 0, depthA: 1, depthB: 1 },
      lfo2: { shape: 'tri', rate: 0.4, sync: false, delay: 0, depthA: 1, depthB: 1 },
      modMatrix: { ...emptyMatrix(), env1ToCutoff: 1 },
      velocity: { amp: 0, cutoff: 0, env1: 0 },
      glide: { time: 0, mode: 'off' },
      keyAssign: 'poly',
      multiTrigger: true,
      pan: 0,
    },
    events: holdNote(60, 2),
    durationSec: 2,
  },
]
