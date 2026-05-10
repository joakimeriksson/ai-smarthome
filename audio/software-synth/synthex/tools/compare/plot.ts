// FFT and SVG plotting for the comparison harness. Pure Node, no deps.

import { fftMagnitude, hann } from '../../packages/engine/tests/fft.ts'

export interface SpectrumOpts {
  fftSize?: number      // default 32768
  windowSec?: number    // default: take last (fftSize/sampleRate) sec for steady-state
}

// Compute log-magnitude spectrum (dB) of the loudest sustained slice of
// the signal. For percussive sounds (laser harp), the silent tail would
// otherwise dominate the window — find the highest-RMS fftSize-window and
// FFT that.
export function logSpectrum(
  samples: Float32Array,
  sampleRate: number,
  opts: SpectrumOpts = {},
): { freqs: Float32Array; db: Float32Array } {
  const fftSize = opts.fftSize ?? 32768
  const slice = new Float32Array(fftSize)

  if (samples.length <= fftSize) {
    for (let i = 0; i < samples.length; i++) slice[i] = samples[i]!
  } else {
    // Slide a coarse RMS window to find the loudest region — guarantees
    // we analyze the sustained tone, not the release tail.
    const STEP = Math.floor(sampleRate * 0.05) // 50 ms hop
    let bestStart = 0, bestRms = -1
    for (let s = 0; s + fftSize <= samples.length; s += STEP) {
      let sum = 0
      for (let i = 0; i < fftSize; i += 8) sum += samples[s + i]! ** 2
      if (sum > bestRms) { bestRms = sum; bestStart = s }
    }
    for (let i = 0; i < fftSize; i++) slice[i] = samples[bestStart + i]!
  }
  const mag = fftMagnitude(hann(slice))
  const freqs = new Float32Array(mag.length)
  const db = new Float32Array(mag.length)
  for (let i = 0; i < mag.length; i++) {
    freqs[i] = (i / fftSize) * sampleRate
    db[i] = 20 * Math.log10(Math.max(mag[i]!, 1e-12))
  }
  return { freqs, db }
}

// ---------------------------------------------------------------------------
// SVG spectrum plot (overlay multiple traces)
// ---------------------------------------------------------------------------

export interface Trace { label: string; color: string; freqs: Float32Array; db: Float32Array }

export function spectrumSvg(
  traces: Trace[],
  opts: { width?: number; height?: number; minHz?: number; maxHz?: number; minDb?: number; maxDb?: number; title?: string } = {},
): string {
  const W = opts.width ?? 720
  const H = opts.height ?? 240
  const ML = 50, MR = 12, MT = 22, MB = 26
  const PW = W - ML - MR
  const PH = H - MT - MB
  const minHz = opts.minHz ?? 20
  const maxHz = opts.maxHz ?? 20000
  const minDb = opts.minDb ?? -90
  const maxDb = opts.maxDb ?? 0
  const logMin = Math.log10(minHz), logMax = Math.log10(maxHz)
  const xOf = (hz: number) => ML + ((Math.log10(Math.max(hz, minHz)) - logMin) / (logMax - logMin)) * PW
  const yOf = (db: number) => MT + (1 - (Math.max(Math.min(db, maxDb), minDb) - minDb) / (maxDb - minDb)) * PH

  const gridLines: string[] = []
  for (const f of [50, 100, 500, 1000, 5000, 10000]) {
    if (f < minHz || f > maxHz) continue
    const x = xOf(f)
    gridLines.push(`<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + PH}" stroke="#2c2c33" />`)
    const lbl = f >= 1000 ? `${f / 1000}k` : `${f}`
    gridLines.push(`<text x="${x}" y="${MT + PH + 14}" fill="#888" font-size="10" text-anchor="middle">${lbl}</text>`)
  }
  for (let db = minDb; db <= maxDb; db += 20) {
    const y = yOf(db)
    gridLines.push(`<line x1="${ML}" y1="${y}" x2="${ML + PW}" y2="${y}" stroke="#2c2c33" />`)
    gridLines.push(`<text x="${ML - 6}" y="${y + 3}" fill="#888" font-size="10" text-anchor="end">${db}</text>`)
  }

  const tracePaths = traces.map(tr => {
    let d = ''
    for (let i = 0; i < tr.freqs.length; i++) {
      const f = tr.freqs[i]!
      if (f < minHz || f > maxHz) continue
      const x = xOf(f), y = yOf(tr.db[i]!)
      d += d.length === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
    }
    return `<path d="${d}" fill="none" stroke="${tr.color}" stroke-width="1" opacity="0.85" />`
  }).join('\n')

  const legend = traces.map((tr, i) =>
    `<g transform="translate(${ML + 8 + i * 130},${MT + 4})">
       <rect width="10" height="10" fill="${tr.color}" />
       <text x="14" y="9" fill="#e0e0e0" font-size="10">${escapeXml(tr.label)}</text>
     </g>`
  ).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0e0e10" />
  ${opts.title ? `<text x="${ML}" y="14" fill="#ff8a3d" font-size="11" font-family="ui-sans-serif">${escapeXml(opts.title)}</text>` : ''}
  <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="none" stroke="#3a3a3f" />
  ${gridLines.join('\n')}
  ${tracePaths}
  ${legend}
  <text x="${ML + PW / 2}" y="${H - 4}" fill="#888" font-size="10" text-anchor="middle">Frequency (Hz, log)</text>
  <text x="14" y="${MT + PH / 2}" fill="#888" font-size="10" text-anchor="middle" transform="rotate(-90 14,${MT + PH / 2})">dB</text>
</svg>`
}

// ---------------------------------------------------------------------------
// Spectrogram: rendered as inline-PNG via a simple raw-data → grayscale
// canvas approach. We avoid PNG deps by emitting a PPM file embedded in HTML
// via a data URL — but PPM isn't browser-supported. Use SVG with grouped
// rectangles at low resolution instead.
// ---------------------------------------------------------------------------

export function spectrogramSvg(
  samples: Float32Array,
  sampleRate: number,
  opts: { width?: number; height?: number; fftSize?: number; hop?: number; maxHz?: number; title?: string } = {},
): string {
  const W = opts.width ?? 720
  const H = opts.height ?? 180
  const fftSize = opts.fftSize ?? 1024
  const hop = opts.hop ?? 512
  const maxHz = opts.maxHz ?? 12000
  const ML = 50, MR = 12, MT = 22, MB = 22
  const PW = W - ML - MR
  const PH = H - MT - MB

  const slices = Math.max(1, Math.floor((samples.length - fftSize) / hop))
  // Downsample slices to fit cell width
  const cells = Math.min(slices, 240)
  const sliceStep = Math.max(1, Math.floor(slices / cells))

  // FFT over each slice, store dB
  const buf = new Float32Array(fftSize)
  const maxBin = Math.min(Math.floor((maxHz / sampleRate) * fftSize), fftSize / 2)
  const cellH = Math.max(1, Math.floor(PH / Math.max(1, maxBin)))
  const cellW = PW / cells

  const rects: string[] = []
  for (let c = 0; c < cells; c++) {
    const sliceIdx = c * sliceStep
    const start = sliceIdx * hop
    if (start + fftSize >= samples.length) break
    for (let i = 0; i < fftSize; i++) buf[i] = samples[start + i]!
    const mag = fftMagnitude(hannInPlace(buf))
    const x = ML + c * cellW
    for (let b = 1; b <= maxBin; b++) {
      const db = 20 * Math.log10(Math.max(mag[b]!, 1e-12))
      // Map -90..0 dB → 0..255 alpha
      const a = Math.max(0, Math.min(1, (db + 90) / 90))
      if (a < 0.05) continue
      const yTop = MT + PH - (b / maxBin) * PH - cellH
      // Color ramp: dark blue → orange
      const r = Math.round(255 * a)
      const g = Math.round(138 * a)
      const bl = Math.round(60 * a)
      rects.push(`<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${cellW.toFixed(2)}" height="${cellH}" fill="rgb(${r},${g},${bl})" />`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0e0e10" />
  ${opts.title ? `<text x="${ML}" y="14" fill="#ff8a3d" font-size="11" font-family="ui-sans-serif">${escapeXml(opts.title)}</text>` : ''}
  <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="none" stroke="#3a3a3f" />
  ${rects.join('')}
  <text x="${ML + PW / 2}" y="${H - 4}" fill="#888" font-size="10" text-anchor="middle">Time →</text>
  <text x="14" y="${MT + PH / 2}" fill="#888" font-size="10" text-anchor="middle" transform="rotate(-90 14,${MT + PH / 2})">Freq (0–${maxHz / 1000}kHz)</text>
</svg>`
}

function hannInPlace(buf: Float32Array): Float32Array {
  const n = buf.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    out[i] = buf[i]! * w
  }
  return out
}

function escapeXml(s: string): string {
  return s.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;' }[c] ?? c))
}
