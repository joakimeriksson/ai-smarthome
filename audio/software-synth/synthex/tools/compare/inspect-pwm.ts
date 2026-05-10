// One-off PWM diagnostic. Renders bare squares at 50%, 25%, and 10% duty,
// FFTs each, and prints the dB level at the first 8 harmonics so we can
// confirm the duty cycle is actually shaping the harmonic content.

import { render } from './render.ts'
import { logSpectrum } from './plot.ts'
import type { LayerPatch, ModSlot } from '../../packages/engine/src/patch.ts'

const SR = 48000
const F0 = 220 // A3
const N = 32768

const empty = (): Record<ModSlot, number> => ({
  lfo1ToOsc1Pitch: 0, lfo1ToOsc2Pitch: 0, lfo1ToCutoff: 0,
  lfo1ToOsc1Pwm: 0,   lfo1ToOsc2Pwm: 0,   lfo1ToAmp: 0,
  lfo2ToOsc1Pitch: 0, lfo2ToOsc2Pitch: 0, lfo2ToCutoff: 0,
  lfo2ToOsc1Pwm: 0,   lfo2ToOsc2Pwm: 0,   lfo2ToAmp: 0,
  env1ToCutoff: 0, env1ToOsc2Pitch: 0,
  joyXToLfo1Depth: 0, joyXToLfo2Depth: 0,
  joyYToCutoff: 0, joyYToLfoFiltDepth: 0,
  velToAmp: 0, velToCutoff: 0, velToEnv1: 0,
})

function patch(pwm: number): LayerPatch {
  return {
    osc1: { wave: 'square', octave: 0, pwm },
    osc2: { wave: 'sawtooth', octave: 0, detune: 0, pwm: 0.5, sync: false },
    mix: { osc1: 1, osc2: 0, noise: 0, ringMod: false, crossMod: 0 },
    filter: { mode: 'lp24', cutoff: 1, resonance: 0, envAmount: 0, keyTrack: 0 },
    envFilter: { a: 0.001, d: 0.001, s: 1, r: 0.001 },
    envAmp: { a: 0.001, d: 0.001, s: 1, r: 0.001 },
    lfo1: { shape: 'tri', rate: 5, sync: false, delay: 0 },
    lfo2: { shape: 'tri', rate: 5, sync: false, delay: 0 },
    modMatrix: empty(),
    velocity: { amp: 0, cutoff: 0, env1: 0 },
    glide: { time: 0, mode: 'off' },
  }
}

function harmonics(pwm: number) {
  const buf = render({
    patch: patch(pwm),
    events: [{ kind: 'on', t: 0, note: 57, velocity: 1 }, { kind: 'off', t: 1.9, note: 57 }],
    durationSec: 2,
    sampleRate: SR,
  })
  const { freqs, db } = logSpectrum(buf, SR, { fftSize: N })
  const out: { h: number; hz: number; db: number }[] = []
  for (let h = 1; h <= 12; h++) {
    const target = h * F0
    let bestI = 0, bestDist = Infinity
    for (let i = 0; i < freqs.length; i++) {
      const d = Math.abs(freqs[i]! - target)
      if (d < bestDist) { bestDist = d; bestI = i }
    }
    out.push({ h, hz: freqs[bestI]!, db: db[bestI]! })
  }
  return out
}

console.log('PWM    | h1     h2     h3     h4     h5     h6     h7     h8     h9     h10    h11    h12')
console.log('-------|------------------------------------------------------------------------------')
for (const pwm of [0.5, 0.25, 0.10]) {
  const h = harmonics(pwm)
  const ref = h[0]!.db
  const cells = h.map(x => (x.db - ref).toFixed(1).padStart(6))
  console.log(`${pwm.toFixed(2).padStart(6)} | ${cells.join(' ')}`)
}
console.log('\n(values are dB relative to fundamental)')
console.log('Expected: 50% → even harmonics ≥40 dB down. 25% → all harmonics present, 4th drops out.')
