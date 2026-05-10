import { describe, it, expect } from 'vitest'
import { PolyBlepSaw } from '../src/dsp/polyblep'
import { fftMagnitude, hann } from './fft'

const SR = 48000
const N = 16384 // ~341 ms at 48 kHz

function renderSaw(freqHz: number, n: number, sr = SR): Float32Array {
  const osc = new PolyBlepSaw()
  const buf = new Float32Array(n)
  const dt = freqHz / sr
  // Discard a few hundred samples to skip the initial transient
  for (let i = 0; i < 256; i++) osc.next(dt)
  for (let i = 0; i < n; i++) buf[i] = osc.next(dt)
  return buf
}

function binAt(freqHz: number, n: number, sr = SR): number {
  return Math.round((freqHz / sr) * n)
}

describe('PolyBLEP sawtooth', () => {
  it('A4 saw has a strong fundamental at 440 Hz', () => {
    const sig = renderSaw(440, N)
    const spec = fftMagnitude(hann(sig))
    const k1 = binAt(440, N)
    const peak = Math.max(...spec)
    expect(spec[k1]).toBeGreaterThan(peak * 0.5)
  })

  it('harmonics decay roughly as 1/n', () => {
    const f0 = 220 // A3 — many harmonics fit under Nyquist
    const sig = renderSaw(f0, N)
    const spec = fftMagnitude(hann(sig))
    const h1 = spec[binAt(f0, N)]!
    const h2 = spec[binAt(f0 * 2, N)]!
    const h3 = spec[binAt(f0 * 3, N)]!
    const h4 = spec[binAt(f0 * 4, N)]!

    // Sawtooth: a_n ∝ 1/n. Allow 30% slop for windowing/leakage.
    expect(h2 / h1).toBeGreaterThan(1 / 2 * 0.7)
    expect(h2 / h1).toBeLessThan(1 / 2 * 1.3)
    expect(h3 / h1).toBeGreaterThan(1 / 3 * 0.7)
    expect(h3 / h1).toBeLessThan(1 / 3 * 1.3)
    expect(h4 / h1).toBeGreaterThan(1 / 4 * 0.7)
    expect(h4 / h1).toBeLessThan(1 / 4 * 1.3)
  })

  it('A6 saw shows minimal aliasing in the upper half', () => {
    // A6 = 1760 Hz. Harmonics 1.76, 3.52, 5.28, 7.04, 8.80, 10.56, 12.32... kHz.
    // With PolyBLEP, energy in non-harmonic bins should be far below the
    // fundamental — both real harmonics and any aliased mirror images.
    const f0 = 1760
    const sig = renderSaw(f0, N)
    const spec = fftMagnitude(hann(sig))
    const fundamental = spec[binAt(f0, N)]!

    // True harmonic bins (within ±2 bins of integer multiples of f0).
    const isHarmonic = new Uint8Array(spec.length)
    for (let h = 1; h * f0 < SR / 2; h++) {
      const k = binAt(f0 * h, N)
      for (let dk = -2; dk <= 2; dk++) {
        if (k + dk >= 0 && k + dk < spec.length) isHarmonic[k + dk] = 1
      }
    }

    // Find the loudest non-harmonic bin in the upper half (where aliases land)
    const lowerBound = binAt(SR / 4, N)
    let maxAlias = 0
    for (let i = lowerBound; i < spec.length; i++) {
      if (!isHarmonic[i] && spec[i]! > maxAlias) maxAlias = spec[i]!
    }

    // 1st-order PolyBLEP gives ~25–40 dB alias suppression depending on pitch;
    // A6 is high enough that we accept ≥25 dB. Higher-order BLEP would do better.
    const ratioDb = 20 * Math.log10(maxAlias / fundamental)
    expect(ratioDb).toBeLessThan(-25)
  })
})
