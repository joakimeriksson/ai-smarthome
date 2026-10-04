// Sound regressions for the VA synth (js/va-processor.js).
//
// Each case below was a measured bug (2026-09-24), none of which threw:
//  - cross-mod >= 0.5 drove osc 1 through zero Hz; the phase went negative,
//    indexed the wavetable out of range and the voice output NaN for good
//  - the SVF diverged to NaN with the cutoff knob at max and low resonance
//  - the page's EQ band sliders ('fx.eq.<n>.gain') never reached the filter
//  - unison was 6 dB quieter than a single oscillator, and mono whatever the
//    Spread knob said
//  - re-triggering a sounding voice zeroed its filter: a step in the output
//  - the pulse carried a DC offset of 2*pw-1
//  - one wavetable per octave, built for the octave's lowest note, aliased
//    in the upper half of every octave (saw at B6: a -25 dBc spur)
//
// Own file: each vitest file gets its own module registry.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m?: unknown): void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}

let VA: new () => Proc

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => { if (name === 'va-synth-processor') VA = cls }
  await import('../../../../js/va-processor.js')
})

type Ev = [number, Record<string, unknown>]

// Deterministic: drift zero, sustain full, no FX.
function render(setup: Record<string, unknown>, events: Ev[], seconds: number) {
  const p = new VA()
  const msg = (m: unknown) => p.port.onmessage!({ data: m })
  for (const [param, value] of Object.entries({ driftAmount: 0, ampSustain: 1, ...setup })) msg({ type: 'param', param, value })
  const total = Math.round(SR * seconds)
  const L = new Float64Array(total), R = new Float64Array(total)
  const l = new Float32Array(128), r = new Float32Array(128)
  let e = 0
  for (let i = 0; i < total; i += 128) {
    while (e < events.length && events[e]![0] * SR < i + 128) msg(events[e++]![1])
    p.process([], [[l, r]])
    for (let k = 0; k < Math.min(128, total - i); k++) { L[i + k] = l[k]!; R[i + k] = r[k]! }
  }
  return { L, R }
}
const on = (t: number, note: number, voice = 0): Ev => [t, { type: 'noteOn', voice, note, velocity: 100 }]

const rms = (b: Float64Array, a: number, e: number) => { let s = 0; for (let i = a; i < e; i++) s += b[i]! ** 2; return Math.sqrt(s / (e - a)) }
const db = (x: number) => 20 * Math.log10(x)
const finite = (b: Float64Array) => b.every(Number.isFinite)
const maxStep = (b: Float64Array, a: number, e: number) => { let m = 0; for (let i = a + 1; i < e; i++) m = Math.max(m, Math.abs(b[i]! - b[i - 1]!)); return m }

function goertzel(b: Float64Array, f: number, from: number, len: number): number {
  const c = 2 * Math.cos(2 * Math.PI * f / SR)
  let s1 = 0, s2 = 0
  // Blackman window: a rectangular one leaks harmonics ~-35 dB into the gaps.
  for (let i = from; i < from + len; i++) {
    const x = (i - from) / (len - 1)
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x)
    const s = b[i]! * w + c * s1 - s2; s2 = s1; s1 = s
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / len
}

describe('VA sound', () => {
  it('survives cross-mod deeper than the carrier (through-zero FM)', () => {
    for (const crossModAmount of [0.5, 1]) {
      const { L } = render({ crossModAmount, osc2Level: 0.5 }, [on(0, 60)], 0.5)
      expect(finite(L)).toBe(true)
      expect(rms(L, SR * 0.2, SR * 0.5)).toBeGreaterThan(1e-3)
    }
  })

  it('keeps the SVF stable with the cutoff at max and no resonance', () => {
    for (const filterMode of [0, 1, 2, 3]) {
      const { L } = render({ filterType: 1, filterMode, filterCutoff: 20000, filterResonance: 0 }, [on(0, 48)], 0.5)
      expect(finite(L)).toBe(true)
      expect(Math.max(...L.map(Math.abs))).toBeLessThan(1)
    }
  })

  it('applies the EQ band gains the page sends', () => {
    const level = (gain: number) => {
      const eq: Record<string, unknown> = { 'fx.eq.enabled': true }
      for (const b of [0, 1, 2]) eq[`fx.eq.${b}.gain`] = gain
      const { L } = render(eq, [on(0, 36)], 0.8)
      return db(rms(L, SR * 0.3, SR * 0.8))
    }
    const flat = level(0)
    expect(level(12) - flat).toBeGreaterThan(8)
    expect(flat - level(-12)).toBeGreaterThan(8)
  })

  it('unison keeps the single-oscillator level and spreads in stereo', () => {
    const one = render({ unisonCount: 1 }, [on(0, 60)], 1.2)
    const single = db(rms(one.L, SR * 0.2, SR * 1.2))
    for (const unisonCount of [2, 4, 8]) {
      const { L, R } = render({ unisonCount, unisonDetune: 20, unisonSpread: 1 }, [on(0, 60)], 1.2)
      expect(Math.abs(db(rms(L, SR * 0.2, SR * 1.2)) - single)).toBeLessThan(3)
      let lr = 0, ll = 0, rr = 0
      for (let i = SR * 0.2; i < SR * 1.2; i++) { lr += L[i]! * R[i]!; ll += L[i]! ** 2; rr += R[i]! ** 2 }
      expect(lr / Math.sqrt(ll * rr)).toBeLessThan(0.9)
    }
  })

  it('re-triggering a sounding voice does not click', () => {
    for (const filterType of [0, 1]) {
      const { L } = render({ filterType, filterCutoff: 2000, filterResonance: 0.5 },
        [[0, { type: 'noteOn', voice: 0, note: 60, velocity: 127 }], [0.5, { type: 'noteOn', voice: 0, note: 72, velocity: 127 }]], 1)
      const at = Math.round(0.5 * SR / 128) * 128
      const body = Math.max(maxStep(L, SR * 0.2, SR * 0.49), maxStep(L, SR * 0.7, SR * 0.99))
      expect(maxStep(L, at - 256, at + 256)).toBeLessThan(body * 1.3)
    }
  })

  it('the pulse carries no DC at narrow widths', () => {
    // SVF low-pass wide open passes DC; the output DC blocker is slow enough
    // (5 Hz) to leave a 20 ms mean well inside what an offset would show.
    const { L } = render({ osc1Waveform: 1, pulseWidth: 0.2, filterType: 1, filterCutoff: 20000 }, [on(0, 60)], 0.12)
    // Exactly 5 periods, so a partial cycle cannot fake an offset.
    const period = SR / (440 * 2 ** ((60 - 69) / 12))
    let s = 0; const a = Math.round(SR * 0.08), e = a + Math.round(5 * period)
    for (let i = a; i < e; i++) s += L[i]!
    expect(Math.abs(s / (e - a))).toBeLessThan(0.01 * rms(L, a, e) + 1e-4)
  })

  it('band-limited saw: no alias spur in the audible band, top of an octave', () => {
    // B6 sits at the top of an octave: the old per-octave tables aliased here.
    // Linear SVF and a low master level, so only the oscillator is measured.
    const note = 95, f0 = 440 * 2 ** ((note - 69) / 12)
    const { L } = render({ filterType: 1, filterCutoff: 20000, filterResonance: 0.3, masterVolume: 0.25 }, [on(0, note)], 0.6)
    const from = Math.round(SR * 0.3), len = Math.round(SR * 0.25)
    const fund = goertzel(L, f0, from, len)
    let worst = 0
    // Probe midway between harmonics, where only aliases can be.
    for (let k = 1; (k + 0.5) * f0 < 19000; k++) worst = Math.max(worst, goertzel(L, (k + 0.5) * f0, from, len))
    // Aliases of a table's harmonics land at arbitrary frequencies: sweep them.
    for (let f = 200; f < 19000; f += 37) {
      const nearest = Math.round(f / f0) * f0
      if (Math.abs(f - nearest) > 60) worst = Math.max(worst, goertzel(L, f, from, len))
    }
    expect(db(worst / fund)).toBeLessThan(-70)
  })
})
