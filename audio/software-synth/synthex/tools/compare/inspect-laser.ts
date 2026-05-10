// Diagnostic: extract the dominant pitch and harmonic content of both
// our laser-harp render and perkristian's reference, so we can speak
// concretely about what's matching and what isn't.

import { readWav } from './io.ts'
import { logSpectrum } from './plot.ts'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SR = 48000

const ours = readWav(resolve(HERE, 'out/patch-laser-harp.wav'), SR)!
const ref  = readWav(resolve(HERE, 'refs/patch-laser-harp.wav'), SR)!

// Compute spectrum, find top-N peaks above a threshold.
function topPeaks(samples: Float32Array, n = 12): { hz: number; db: number }[] {
  const { freqs, db } = logSpectrum(samples, SR, { fftSize: 32768 })
  const peaks: { hz: number; db: number }[] = []
  // Local max with min separation of 30 Hz
  for (let i = 2; i < freqs.length - 2; i++) {
    if (freqs[i]! < 60 || freqs[i]! > 12000) continue
    if (db[i]! < -75) continue
    if (db[i]! > db[i-1]! && db[i]! > db[i+1]! && db[i]! > db[i-2]! && db[i]! > db[i+2]!) {
      // Suppress if too close to previous peak
      if (peaks.length && Math.abs(peaks[peaks.length-1]!.hz - freqs[i]!) < 30) {
        if (db[i]! > peaks[peaks.length-1]!.db) peaks[peaks.length-1] = { hz: freqs[i]!, db: db[i]! }
        continue
      }
      peaks.push({ hz: freqs[i]!, db: db[i]! })
    }
  }
  return peaks.sort((a, b) => b.db - a.db).slice(0, n)
}

const oursP = topPeaks(ours)
const refP = topPeaks(ref)

console.log('OURS (top 12 peaks, 60–12000 Hz):')
for (const p of oursP) console.log(`  ${p.hz.toFixed(1).padStart(8)} Hz  ${p.db.toFixed(1).padStart(6)} dB`)
console.log('\nREFERENCE (perkristian, top 12 peaks):')
for (const p of refP) console.log(`  ${p.hz.toFixed(1).padStart(8)} Hz  ${p.db.toFixed(1).padStart(6)} dB`)

// Try to identify the fundamental from the lowest strong peak.
const oursF0 = oursP.sort((a, b) => a.hz - b.hz).find(p => p.db > -55)
const refF0  = refP.sort((a, b) => a.hz - b.hz).find(p => p.db > -55)

const semis = (hz: number) => 12 * Math.log2(hz / 440) + 69
console.log('\nApparent fundamentals:')
if (oursF0) console.log(`  ours: ${oursF0.hz.toFixed(1)} Hz  (≈ MIDI ${semis(oursF0.hz).toFixed(1)})`)
if (refF0)  console.log(`  ref:  ${refF0.hz.toFixed(1)} Hz  (≈ MIDI ${semis(refF0.hz).toFixed(1)})`)
