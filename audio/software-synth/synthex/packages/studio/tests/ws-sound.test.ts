// Sound regressions for the WaveSynth (ws-processor.js), from the 2026-09-24
// audit. Each of these was measured broken, and none of them threw:
//   - the SVF went unstable above ~sr/3 and emitted NaN (Bell Chime, top octave)
//   - band-limited tables were chosen for the bottom of each octave, so the top
//     half of every octave aliased (saw at C7: -18 dB of non-harmonic energy)
//   - dsp-lib's Freeverb wet path runs ~28 dB above dry; a 30 % mix buried the
//     note in a clipped master
//   - misaligned wave phases bent the pitch during sequence crossfades
//   - a one-shot wave sequence faded back to its FIRST step at the end
//   - stealing a sounding voice zeroed its filter: a click
//
// Own file for the same reason as synth-tuning.test.ts: a private module
// registry, so these stubs cannot collide with other tests'.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 44100

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m?: unknown): void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}

let WS: new () => Proc

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => {
    if (name === 'ws-synth-processor') WS = cls
  }
  await import('../../../../js/ws-processor.js')
})

type Ev = [number, Record<string, unknown>]
const param = (p: string, value: unknown): Ev => [0, { type: 'param', param: p, value }]
const on = (t: number, note: number, voice = 0): Ev => [t, { type: 'noteOn', voice, note, velocity: 100 }]

function render(events: Ev[], seconds: number): Float64Array {
  const p = new WS()
  const send = (m: unknown) => p.port.onmessage!({ data: m })
  const ev = events.slice().sort((a, b) => a[0] - b[0])
  let ei = 0
  const total = Math.round(SR * seconds)
  const out = new Float64Array(total)
  const l = new Float32Array(128), r = new Float32Array(128)
  for (let i = 0; i < total; i += 128) {
    while (ei < ev.length && ev[ei]![0] * SR <= i) send(ev[ei++]![1])
    p.process([], [[l, r]])
    for (let k = 0; k < Math.min(128, total - i); k++) out[i + k] = l[k]!
  }
  return out
}

function goertzel(b: Float64Array, f: number, from: number, len: number): number {
  const c = 2 * Math.cos(2 * Math.PI * f / SR)
  let s1 = 0, s2 = 0
  for (let i = from; i < from + len; i++) { const s = b[i]! + c * s1 - s2; s2 = s1; s1 = s }
  return 2 * Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / len   // sinusoid amplitude
}
const rms = (b: Float64Array, from: number, len: number) => {
  let s = 0; for (let i = from; i < from + len; i++) s += b[i]! * b[i]!; return Math.sqrt(s / len)
}
/** Fractional MIDI note whose period is exactly `period` samples. */
const noteForPeriod = (period: number) => 69 + 12 * Math.log2(SR / period / 440)

// A plain, bright, open patch: sustain 1, SVF lowpass (the filter under test).
const OPEN: Ev[] = [
  param('filterType', 1), param('filterResonance', 0), param('filterEnvAmount', 0),
  param('ampA', 0.001), param('ampS', 1), param('masterVolume', 0.5),
]

describe('WaveSynth sound', () => {
  it('SVF stays finite with the cutoff pushed to the top (no NaN)', () => {
    const out = render([...OPEN, param('filterCutoff', 20000), param('filterKeyTrack', 1),
      param('oscA.wave', 3), on(0, 96), on(0, 108, 1)], 0.5)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(rms(out, SR * 0.1, SR * 0.3)).toBeGreaterThan(0.01)
  })

  it('saw near C7 is band-limited (non-harmonic energy < -50 dB)', () => {
    // Period of exactly 21 samples (2100 Hz): every harmonic sits on a
    // Goertzel bin over a whole number of periods, so their power is exact.
    const P = 21
    const out = render([...OPEN, param('filterCutoff', 20000), param('oscA.wave', 2), on(0, noteForPeriod(P))], 1.2)
    const from = Math.round(SR * 0.3), len = P * 1800
    let harm = 0
    for (let h = 1; h * SR / P < SR / 2; h++) harm += goertzel(out, h * SR / P, from, len) ** 2 / 2
    const total = rms(out, from, len) ** 2
    const nonHarmonicDb = 10 * Math.log10(Math.max(total - harm, 1e-20) / harm)
    expect(nonHarmonicDb).toBeLessThan(-50)
  })

  it('reverb at 30 % mix does not swamp the dry note', () => {
    const base: Ev[] = [...OPEN, param('filterCutoff', 5000), param('oscA.wave', 0), on(0, 60)]
    const dry = render(base, 1.5)
    const wet = render([...base, param('fx.reverb.enabled', true), param('fx.reverb.mix', 0.3)], 1.5)
    const gainDb = 20 * Math.log10(rms(wet, SR * 0.8, SR * 0.6) / rms(dry, SR * 0.8, SR * 0.6))
    expect(Math.abs(gainDb)).toBeLessThan(3)
  })

  it('sequence crossfades between differently-shaped waves keep the pitch', () => {
    // Wave Pad's sequence at C2 read 8.6 cents sharp: triangle's fundamental
    // was 90° from sine/saw/square, so each crossfade rotated its phase.
    const seq: Ev = [0, { type: 'waveSeqA', loopMode: 1, speed: 1, steps: [
      { wave: 0, duration: 600, crossfade: 0.5 }, { wave: 1, duration: 600, crossfade: 0.5 },
      { wave: 2, duration: 600, crossfade: 0.5 }, { wave: 3, duration: 600, crossfade: 0.5 }] }]
    const note = 36, f0 = 440 * Math.pow(2, (note - 69) / 12)
    const out = render([seq, ...OPEN, param('filterCutoff', 4000), param('oscA.mode', 2), on(0, note)], 2.0)
    const from = Math.round(SR * 0.5), len = SR
    let best = f0, bm = -1
    for (let c = -15; c <= 15; c += 0.1) {
      const f = f0 * Math.pow(2, c / 1200), m = goertzel(out, f, from, len)
      if (m > bm) { bm = m; best = f }
    }
    expect(Math.abs(1200 * Math.log2(best / f0))).toBeLessThan(1)
  })

  it('a one-shot sequence holds its last wave', () => {
    const seq: Ev = [0, { type: 'waveSeqA', loopMode: 0, speed: 1, steps: [
      { wave: 0, duration: 100, crossfade: 0.5 }, { wave: 3, duration: 100, crossfade: 0.5 }] }]
    const P = 300, f0 = SR / P
    const out = render([seq, ...OPEN, param('filterCutoff', 20000), param('oscA.mode', 2), on(0, noteForPeriod(P))], 0.8)
    // Square: 3rd harmonic at 1/3 of the fundamental. Sine: none.
    const from = Math.round(SR * 0.5), len = P * 40
    const ratio = goertzel(out, 3 * f0, from, len) / goertzel(out, f0, from, len)
    expect(ratio).toBeGreaterThan(0.25)
  })

  it('stealing a sounding voice does not click', () => {
    // Same pitch, so a clean steal is exactly periodic: the residual against
    // the signal one period earlier must stay tiny across the steal.
    const P = 400
    const note = noteForPeriod(P)
    const out = render([param('filterType', 0), param('filterCutoff', 3000), param('filterResonance', 0.2),
      param('ampA', 0.005), param('ampS', 1), param('oscA.wave', 0), on(0, note), on(0.5, note)], 0.7)
    let worst = 0
    for (let i = Math.round(SR * 0.45); i < Math.round(SR * 0.6); i++) worst = Math.max(worst, Math.abs(out[i]! - out[i - P]!))
    expect(worst / rms(out, SR * 0.3, SR * 0.15)).toBeLessThan(0.01)
  })
})
