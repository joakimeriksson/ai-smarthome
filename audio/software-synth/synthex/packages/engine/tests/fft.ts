// Tiny iterative radix-2 FFT, real input. Returns magnitude spectrum
// (length n/2 + 1) in linear units, normalized so a unit-amplitude
// sinusoid yields a magnitude of 0.5 at its bin.
//
// Sized for offline tests, not for hot-path code. n must be a power of 2.

export function fftMagnitude(input: Float32Array): Float32Array {
  const n = input.length
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be power of 2')

  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = input[i]!

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
    }
  }

  // Cooley-Tukey
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const tableStep = (-2 * Math.PI) / size
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = tableStep * k
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const tre = re[i + k + half]! * cos - im[i + k + half]! * sin
        const tim = re[i + k + half]! * sin + im[i + k + half]! * cos
        re[i + k + half] = re[i + k]! - tre
        im[i + k + half] = im[i + k]! - tim
        re[i + k] = re[i + k]! + tre
        im[i + k] = im[i + k]! + tim
      }
    }
  }

  const halfN = (n >> 1) + 1
  const mag = new Float32Array(halfN)
  const norm = 1 / n
  for (let i = 0; i < halfN; i++) {
    mag[i] = Math.hypot(re[i]!, im[i]!) * norm
  }
  return mag
}

// Hann window. Reduces spectral leakage so harmonics stay in their bins.
export function hann(buf: Float32Array): Float32Array {
  const n = buf.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    out[i] = buf[i]! * w
  }
  return out
}
