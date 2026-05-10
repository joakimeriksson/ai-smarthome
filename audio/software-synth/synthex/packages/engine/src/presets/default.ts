// Initial patch — used until the UI selects one from the factory bank.
// Plain warm saw lead so "press a key, hear a note" works on first load.

import type { Patch, LayerPatch, ModSlot } from '../patch.ts'

const emptyMatrix = (): Record<ModSlot, number> => ({
  lfo1ToOsc1Pitch: 0, lfo1ToOsc2Pitch: 0, lfo1ToCutoff: 0,
  lfo1ToOsc1Pwm: 0,   lfo1ToOsc2Pwm: 0,   lfo1ToAmp: 0,
  lfo2ToOsc1Pitch: 0, lfo2ToOsc2Pitch: 0, lfo2ToCutoff: 0,
  lfo2ToOsc1Pwm: 0,   lfo2ToOsc2Pwm: 0,   lfo2ToAmp: 0,
  env1ToCutoff: 1,    env1ToOsc2Pitch: 0,
  joyXToLfo1Depth: 0, joyXToLfo2Depth: 0,
  joyYToCutoff: 0,    joyYToLfoFiltDepth: 0,
  velToAmp: 0, velToCutoff: 0, velToEnv1: 0,
})

const defaultLayer = (): LayerPatch => ({
  osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
  osc2: { wave: 'sawtooth', octave: 0, detune: 7, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
  mix:  { osc1: 0.5, osc2: 0.5, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
  filter: { mode: 'lp24', cutoff: 0.55, resonance: 0.25, envAmount: 0.4, keyTrack: 0.4 },
  envFilter: { a: 0.005, d: 0.4, s: 0.5, r: 0.3 },
  envAmp:    { a: 0.005, d: 0.2, s: 0.85, r: 0.3 },
  lfo1: { shape: 'tri', rate: 5.0, sync: false, delay: 0, depthA: 1, depthB: 1 },
  lfo2: { shape: 'tri', rate: 0.4, sync: false, delay: 0, depthA: 1, depthB: 1 },
  modMatrix: emptyMatrix(),
  velocity: { amp: 0.3, cutoff: 0.2, env1: 0 },
  glide: { time: 0, mode: 'off' },
  keyAssign: 'poly',
  multiTrigger: true,
  pan: 0,
})

export function factoryDefault(): Patch {
  const upper = defaultLayer()
  return {
    version: 1,
    name: 'Init',
    upper,
    lower: defaultLayer(),
    voiceMode: 'single',
    splitPoint: 60,
    fx: {
      chorus: { enabled: true, mode: 2, mix: 0.4, rate: 0.5, depth: 0.5 },
      delay:  { enabled: false, mode: 'standard', time: 0.25, feedback: 0.3, tone: 0.5, spread: 0.3, mix: 0.2 },
      reverb: { enabled: true, algorithm: 'plate', size: 0.4, damping: 0.5, mix: 0.15 },
    },
    master: { tune: 0, fineTune: 0, volume: 0.8, polyphony: 8, unisonDetune: 0.15, limiter: true },
    arp: { enabled: false, pattern: 'up', range: 1, hold: false, rate: 8, gateLength: 0.5 },
    chordMemory: { enabled: false, notes: [0] },
  }
}
