// Measurements used to compare a synthesised drum voice against a real one.
//
// Level is deliberately never compared directly: the kit was recorded with
// every voice's LEVEL knob at maximum, so absolute amplitude carries no
// information about the machine. Everything here is either level-invariant
// (spectrum shapes normalised, decay measured relative to a voice's own peak)
// or explicitly a ratio.

export const peak = (b: Float64Array): number =>
  b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

export function rms(b: Float64Array, from: number, len: number): number {
  let s = 0
  const end = Math.min(from + len, b.length)
  for (let i = from; i < end; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, end - from))
}

/** Single-bin DFT magnitude — cheaper than a full FFT for a handful of bins. */
export function goertzel(
  b: Float64Array, freq: number, rate: number, from = 0, len = b.length,
): number {
  const c = 2 * Math.cos(2 * Math.PI * freq / rate)
  let s1 = 0
  let s2 = 0
  const end = Math.min(from + len, b.length)
  for (let i = from; i < end; i++) {
    const s = b[i]! + c * s1 - s2
    s2 = s1
    s1 = s
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / Math.max(1, end - from)
}

/** Time for the signal to fall 60 dB below its own peak. */
export function decayTime(b: Float64Array, rate: number): number {
  const pk = peak(b)
  if (pk === 0) return 0
  // Start at the peak, not at zero. A voice whose loudest moment arrives a few
  // milliseconds in — a low-tuned cowbell may not even complete a cycle in the
  // first window — would otherwise report a decay of 0 because its opening
  // window is quiet relative to a peak it has not reached yet.
  let start = 0
  for (let i = 0; i < b.length; i++) if (Math.abs(b[i]!) === pk) { start = i; break }
  const win = 256
  for (let i = start; i + win < b.length; i += win) {
    if (rms(b, i, win) < pk * 0.001) return i / rate
  }
  return b.length / rate
}

/** Strongest partial in a range — the voice's perceived pitch. */
export function fundamental(b: Float64Array, rate: number, lo: number, hi: number): number {
  let bestFreq = lo
  let bestMag = -1
  const from = Math.round(rate * 0.02)      // skip the attack transient
  const len = Math.round(rate * 0.25)
  const step = Math.max(0.25, lo / 200)
  for (let f = lo; f <= hi; f += step) {
    const m = goertzel(b, f, rate, from, len)
    if (m > bestMag) { bestMag = m; bestFreq = f }
  }
  return bestFreq
}

/** Energy-weighted mean frequency — "brightness". */
export function centroid(b: Float64Array, rate: number): number {
  let num = 0
  let den = 0
  const len = Math.min(b.length, rate >> 1)
  for (let f = 60; f < 15000; f *= 1.22) {
    const m = goertzel(b, f, rate, 0, len)
    num += f * m
    den += m
  }
  return den ? num / den : 0
}

/**
 * Band-energy spectrum on a constant-Q grid, normalised to its own mean.
 *
 * Normalising is what makes this comparable at all: the kit's voices were
 * recorded at full level and ours are not, so only the SHAPE of the spectrum
 * carries information about whether we sound like the machine.
 */
export function shape(b: Float64Array, rate: number, lo = 50, hi = 14000, bins = 40): number[] {
  const out: number[] = []
  const len = Math.min(b.length, rate)
  const ratio = Math.pow(hi / lo, 1 / (bins - 1))
  for (let i = 0; i < bins; i++) {
    const f = lo * Math.pow(ratio, i)
    // Integrate ENERGY across the band rather than probing one frequency.
    // The metallic voices are combs of discrete lines, so a single bin lands
    // between harmonics as often as on one and reads 25 dB low for reasons
    // that have nothing to do with how the voice sounds. Summing across the
    // band makes the measurement about spectral balance, which is what we are
    // actually trying to match.
    let e = 0
    const sub = 5
    for (let j = 0; j < sub; j++) {
      const fj = f * Math.pow(ratio, (j / sub) - 0.5)
      const m = goertzel(b, fj, rate, 0, len)
      e += m * m
    }
    out.push(10 * Math.log10(Math.max(1e-18, e / sub)))
  }
  const mean = out.reduce((a, v) => a + v, 0) / out.length
  return out.map(v => v - mean)
}

/** Mean absolute difference between two normalised spectra, in dB. */
export function spectralDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!)
  return s / n
}

/**
 * How the energy decays over time, as dB relative to peak at fixed offsets.
 * Two voices can share a spectrum and still sound nothing alike if one is a
 * click and the other rings for a second.
 */
export function envelope(b: Float64Array, rate: number, marks = [0.005, 0.02, 0.05, 0.1, 0.2, 0.4, 0.8]): number[] {
  const pk = peak(b) || 1e-9
  return marks.map(t => {
    const i = Math.round(t * rate)
    return 20 * Math.log10(Math.max(1e-6, rms(b, i, Math.round(rate * 0.01)) / pk))
  })
}

export function envelopeDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!)
  return s / n
}
