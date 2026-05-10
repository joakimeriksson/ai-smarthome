import { describe, it, expect } from 'vitest'
import { ZdfSvfLowpass, svfCoeffs } from '../src/dsp/svf'
import { fftMagnitude, hann } from './fft'

const SR = 48000
const N = 16384

// Drive the cascaded 24 dB LP with a unit impulse, FFT, return magnitude
// in dB at requested test frequencies.
function lpResponseDb(cutoffHz: number, q: number, testFreqs: number[]): number[] {
  const a = new ZdfSvfLowpass()
  const b = new ZdfSvfLowpass()
  const c = svfCoeffs(cutoffHz, SR, q)
  const buf = new Float32Array(N)
  buf[0] = 1
  for (let i = 0; i < N; i++) {
    buf[i] = b.step(a.step(buf[i]!, c), c)
  }
  const spec = fftMagnitude(buf) // no window — impulse response
  return testFreqs.map(f => {
    const k = Math.round((f / SR) * N)
    const m = spec[k]!
    return 20 * Math.log10(Math.max(m, 1e-12))
  })
}

describe('ZdfSvfLowpass (cascaded ×2 = 24 dB/oct)', () => {
  it('passes DC and rejects high frequencies', () => {
    const [dc, hi] = lpResponseDb(1000, 0.707, [10, 12000])
    expect(dc).toBeGreaterThan(hi! + 60)
  })

  it('rolls off at ~24 dB/oct above cutoff (one octave above ≥ 18 dB down)', () => {
    const fc = 1000
    const [atFc, oneOctaveUp] = lpResponseDb(fc, 0.707, [fc, fc * 2])
    const drop = atFc! - oneOctaveUp!
    // Theoretical 24 dB; tolerate transition-band roundoff and ZDF warping.
    expect(drop).toBeGreaterThan(18)
    expect(drop).toBeLessThan(30)
  })

  it('cutoff frequency is approximately correct (-3 dB to -12 dB at fc)', () => {
    // Two cascaded 2nd-order LPs: each is ~-3 dB at fc, so cascade is ~-6 dB.
    // ZDF prewarp shifts this somewhat at high cutoffs; allow a wide window.
    const fc = 2000
    const [atDc, atFc] = lpResponseDb(fc, 0.707, [10, fc])
    const drop = atDc! - atFc!
    expect(drop).toBeGreaterThan(3)
    expect(drop).toBeLessThan(12)
  })

  it('resonance creates a peak near cutoff', () => {
    const fc = 1000
    const flat = lpResponseDb(fc, 0.707, [fc])
    const reso = lpResponseDb(fc, 8, [fc])
    expect(reso[0]! - flat[0]!).toBeGreaterThan(8)
  })
})
