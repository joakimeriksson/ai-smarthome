// Comparison harness entry point. For each scenario:
//   1. Render Synthex Web's output to WAV
//   2. Compute log-magnitude spectrum + spectrogram
//   3. If a reference WAV exists in tools/compare/refs/<id>.wav, overlay
//      its spectrum and render its spectrogram side-by-side
//   4. Emit an HTML report
//
// Run with: npm run compare

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SCENARIOS } from './scenarios.ts'
import { render } from './render.ts'
import { writeWav, readWav } from './io.ts'
import { logSpectrum, spectrumSvg, spectrogramSvg, type Trace } from './plot.ts'

const SR = 48000
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, 'out')
const REFS = resolve(HERE, 'refs')
mkdirSync(OUT, { recursive: true })
mkdirSync(REFS, { recursive: true })

interface Result {
  id: string
  title: string
  description: string
  wavRel: string
  refWavRel: string | null
  spectrumSvgRel: string
  spectrogramSvgRel: string
  refSpectrogramSvgRel: string | null
  spectralRmsDb: number | null   // overall spectral distance vs ref (NaN if no ref)
}

const results: Result[] = []

for (const sc of SCENARIOS) {
  console.log(`Rendering ${sc.id}…`)
  const ours = render({
    patch: sc.patch,
    events: sc.events,
    params: sc.params,
    durationSec: sc.durationSec,
    sampleRate: SR,
  })
  const wavPath = resolve(OUT, `${sc.id}.wav`)
  writeWav(wavPath, ours, SR)

  const oursSpec = logSpectrum(ours, SR)
  const traces: Trace[] = [
    { label: 'synthex-web', color: '#ff8a3d', freqs: oursSpec.freqs, db: oursSpec.db },
  ]

  let refWav: Float32Array | null = null
  let spectralRmsDb: number | null = null
  const refPath = resolve(REFS, `${sc.id}.wav`)
  refWav = readWav(refPath, SR)
  if (refWav) {
    const refSpec = logSpectrum(refWav, SR)
    traces.push({ label: 'reference', color: '#4ec9ff', freqs: refSpec.freqs, db: refSpec.db })

    // Spectral-distance metric: RMS of dB difference, restricted to [50 Hz, 10 kHz]
    // and clamped to a -90..0 range so silent bins don't dominate.
    let sum = 0, count = 0
    for (let i = 0; i < oursSpec.freqs.length; i++) {
      const f = oursSpec.freqs[i]!
      if (f < 50 || f > 10000) continue
      const a = Math.max(oursSpec.db[i]!, -90)
      const b = Math.max(refSpec.db[i]!, -90)
      sum += (a - b) ** 2
      count++
    }
    spectralRmsDb = Math.sqrt(sum / Math.max(count, 1))
  }

  const specSvg = spectrumSvg(traces, {
    title: sc.title,
    maxHz: sc.maxPlotHz ?? 20000,
  })
  const spectroSvg = spectrogramSvg(ours, SR, {
    title: 'Synthex Web — spectrogram',
    maxHz: 12000,
  })
  const refSpectroSvg = refWav
    ? spectrogramSvg(refWav, SR, { title: 'Reference — spectrogram', maxHz: 12000 })
    : null

  writeFileSync(resolve(OUT, `${sc.id}.spectrum.svg`), specSvg)
  writeFileSync(resolve(OUT, `${sc.id}.spectrogram.svg`), spectroSvg)
  if (refSpectroSvg) writeFileSync(resolve(OUT, `${sc.id}.ref-spectrogram.svg`), refSpectroSvg)

  results.push({
    id: sc.id,
    title: sc.title,
    description: sc.description,
    wavRel: `out/${sc.id}.wav`,
    refWavRel: refWav ? `refs/${sc.id}.wav` : null,
    spectrumSvgRel: `out/${sc.id}.spectrum.svg`,
    spectrogramSvgRel: `out/${sc.id}.spectrogram.svg`,
    refSpectrogramSvgRel: refSpectroSvg ? `out/${sc.id}.ref-spectrogram.svg` : null,
    spectralRmsDb,
  })
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Synthex Web — comparison harness</title>
<style>
  body { background:#0d0d10; color:#e8e8e8; font-family: ui-sans-serif, system-ui, sans-serif; margin:0; padding:1.5rem 2rem; }
  h1 { color:#ff8a3d; letter-spacing:0.18em; font-size:1.3rem; margin:0 0 0.2rem; }
  .sub { color:#888; font-size:0.78rem; margin:0 0 1.5rem; }
  .scenario { background:#16161a; border:1px solid #2c2c33; border-radius:6px; padding:1rem 1.2rem; margin-bottom:1rem; }
  .scenario h2 { font-size:1rem; color:#ff8a3d; margin:0 0 0.3rem; }
  .scenario p { color:#bbb; font-size:0.84rem; margin:0 0 0.6rem; line-height:1.45; }
  .scenario .audio { display:flex; gap:1rem; align-items:center; margin-bottom:0.6rem; flex-wrap:wrap; }
  .scenario .audio label { font-size:0.78rem; color:#888; }
  audio { height:32px; }
  .plots { display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; margin-top:0.5rem; }
  .plot { border:1px solid #2c2c33; border-radius:4px; overflow:hidden; }
  .plot img { display:block; width:100%; height:auto; }
  .metric { display:inline-block; padding:0.15rem 0.5rem; border-radius:3px; font-size:0.78rem; margin-left:0.6rem; }
  .metric.good { background:#143a14; color:#7fdb7f; }
  .metric.warn { background:#3a3014; color:#ffce7f; }
  .metric.bad  { background:#3a1414; color:#ff7f7f; }
  .metric.none { background:#2c2c33; color:#888; }
  .legend { background:#1d1d22; padding:0.75rem 1rem; border-radius:6px; border:1px solid #2c2c33; margin-bottom:1rem; font-size:0.85rem; line-height:1.55; color:#ccc; }
  code { background:#2c2c33; padding:0 0.3rem; border-radius:2px; }
</style>
</head>
<body>
<h1>SYNTHEX WEB — Comparison harness</h1>
<p class="sub">Generated ${new Date().toISOString()} · ${results.length} scenarios at ${SR} Hz</p>

<div class="legend">
<strong>How to use:</strong>
Drop a reference WAV at <code>tools/compare/refs/&lt;scenario-id&gt;.wav</code> (any sample rate, mono or stereo) and re-run <code>npm run compare</code>.
The orange trace is Synthex Web; the blue trace is your reference. The "Δ" badge is the RMS dB difference of the spectra over 50 Hz – 10 kHz.
Lower = closer match. <em>Below 5 dB is good, 10 dB is suspicious, 20 dB+ means the subsystem is doing something different.</em>
Spectrogram comparisons are visual: look for matching attack timing, modulation rates, and harmonic structure over time.
</div>

${results.map(r => {
  const m = r.spectralRmsDb
  let metric = '<span class="metric none">no reference</span>'
  if (m != null) {
    const cls = m < 5 ? 'good' : m < 10 ? 'warn' : 'bad'
    metric = `<span class="metric ${cls}">Δ ${m.toFixed(1)} dB</span>`
  }
  return `<section class="scenario">
  <h2>${escape(r.title)} ${metric}</h2>
  <p>${escape(r.description)}</p>
  <div class="audio">
    <label>synthex-web</label>
    <audio controls src="${r.wavRel}"></audio>
    ${r.refWavRel ? `<label>reference</label><audio controls src="${r.refWavRel}"></audio>` : ''}
  </div>
  <div class="plots">
    <div class="plot"><img alt="spectrum" src="${r.spectrumSvgRel}" /></div>
    <div class="plot"><img alt="spectrogram" src="${r.spectrogramSvgRel}" /></div>
    ${r.refSpectrogramSvgRel ? `<div class="plot"><img alt="ref spectrogram" src="${r.refSpectrogramSvgRel}" /></div>` : ''}
  </div>
</section>`
}).join('\n')}

</body>
</html>`

function escape(s: string): string {
  return s.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','"':'&quot;' }[c] ?? c))
}

writeFileSync(resolve(HERE, 'index.html'), html)
console.log(`\nDone. Open: tools/compare/index.html`)

// Summary
const withRef = results.filter(r => r.spectralRmsDb != null)
console.log(`Rendered ${results.length} scenarios; ${withRef.length} have reference WAVs.`)
if (withRef.length > 0) {
  withRef.sort((a, b) => (b.spectralRmsDb ?? 0) - (a.spectralRmsDb ?? 0))
  console.log('Worst-fitting (largest spectral Δ):')
  for (const r of withRef.slice(0, 5)) {
    console.log(`  ${r.spectralRmsDb!.toFixed(1)} dB — ${r.id}`)
  }
}
