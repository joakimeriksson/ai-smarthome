// Parameter sweep for the Laser Harp patch against the Elka-X reference.
//
// Renders a grid of patch variants and scores each with a TIME-AVERAGED
// spectral distance (Welch-style PSD over the sustained segment). The
// single-window metric in run.ts is unstable for this patch because the
// LFO animates the spectrum at ~1 Hz — averaging removes the phase luck.
//
// Run: node --experimental-transform-types tools/compare/sweep-laser.ts

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from './render.ts'
import { readWav } from './io.ts'
import { SCENARIOS } from './scenarios.ts'
import type { LayerPatch } from '../../packages/engine/src/patch.ts'

const SR = 48000
const HERE = dirname(fileURLToPath(import.meta.url))

const base = SCENARIOS.find(s => s.id === 'patch-laser-harp')!
const ref = readWav(resolve(HERE, 'refs/patch-laser-harp.wav'), SR)
if (!ref) throw new Error('no reference WAV')

// --- Time-averaged log spectrum over the sustain ---------------------------
function avgSpectrumDb(samples: Float32Array, sr: number): Float32Array {
  const N = 8192
  // onset-align
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!))
  const th = peak * 0.01
  let onset = 0
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]!) > th) { onset = i; break }
  const start = onset + Math.floor(0.5 * sr)
  const end = Math.min(onset + Math.floor(9.5 * sr), samples.length - N)
  const acc = new Float64Array(N / 2)
  let count = 0
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let s = start; s + N <= end; s += Math.floor(N / 2)) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
      re[i] = samples[s + i]! * w
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < N / 2; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!
    count++
  }
  const out = new Float32Array(N / 2)
  for (let k = 0; k < N / 2; k++) out[k] = 10 * Math.log10(acc[k]! / Math.max(count, 1) + 1e-20)
  return out
}

// In-place radix-2 FFT
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!, ui = im[i + k]!
        const vr = re[i + k + len / 2]! * cwr - im[i + k + len / 2]! * cwi
        const vi = re[i + k + len / 2]! * cwi + im[i + k + len / 2]! * cwr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const nwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr
        cwr = nwr
      }
    }
  }
}

// Level-invariant RMS distance in the 80–6000 Hz band
function distanceDb(a: Float32Array, b: Float32Array, sr: number): number {
  const N = a.length * 2
  const lo = Math.floor((80 / sr) * N)
  const hi = Math.floor((6000 / sr) * N)
  let meanDiff = 0, count = 0
  for (let k = lo; k < hi; k++) { meanDiff += a[k]! - b[k]!; count++ }
  meanDiff /= count
  let sum = 0
  for (let k = lo; k < hi; k++) {
    const d = a[k]! - b[k]! - meanDiff
    sum += d * d
  }
  return Math.sqrt(sum / count)
}

const refSpec = avgSpectrumDb(ref, SR)

interface Variant {
  label: string
  mutate: (p: LayerPatch) => void
}

const variants: Variant[] = []
for (const amt of [8, 10, 12]) {
  for (const time of [0.65, 0.8, 1.0]) {
    for (const pwmDepth of [0.75, 1.0]) {
      for (const cutoff of [0.42, 0.44, 0.47, 0.5]) {
        variants.push({
          label: `glide=${amt}st/${time}s pwm=${pwmDepth} cut=${cutoff}`,
          mutate: p => {
            p.glide.amount = amt
            p.glide.time = time
            p.modMatrix.lfo1ToOsc2Pwm = pwmDepth
            p.filter.cutoff = cutoff
          },
        })
      }
    }
  }
}

const results: { label: string; d: number }[] = []
for (const v of variants) {
  const patch: LayerPatch = structuredClone(base.patch)
  v.mutate(patch)
  const out = render({ patch, events: base.events, fx: base.fx, durationSec: base.durationSec, sampleRate: SR })
  const d = distanceDb(avgSpectrumDb(out, SR), refSpec, SR)
  results.push({ label: v.label, d })
  console.log(`${d.toFixed(2)} dB  ${v.label}`)
}

results.sort((x, y) => x.d - y.d)
console.log('\n=== Best 5 ===')
for (const r of results.slice(0, 5)) console.log(`${r.d.toFixed(2)} dB  ${r.label}`)
