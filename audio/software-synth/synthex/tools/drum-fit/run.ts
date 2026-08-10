// Compare every synthesised drum voice against the real TR-808 it models.
//
//   npm run drum-fit            all voices
//   npm run drum-fit -- BD SD   only these
//
// Reports, per sample: pitch, decay and brightness against the reference, plus
// a level-invariant spectral-shape distance in dB. Lower is closer; the shape
// figure is the one to watch, since pitch and decay are easy to hit and easy to
// hit for the wrong reasons.

import { kitPresent, listSamples, readWav, KIT_DIR } from './kit.ts'
import { loadProcessor, renderVoice, voiceSetup, SR } from './render.ts'
import {
  centroid, decayTime, fundamental, shape, spectralDistance, envelope, envelopeDistance,
} from './measure.ts'

/** Pitch search range per voice, so the fundamental finder does not wander. */
const PITCH_RANGE: Record<string, [number, number]> = {
  BD: [30, 90], SD: [120, 300], LT: [50, 140], MT: [90, 220], HT: [120, 300],
  RS: [120, 400], CB: [400, 1200],
  LC: [140, 280], MC: [200, 380], HC: [300, 550], CL: [1800, 3200],
}

async function main(): Promise<void> {
  if (!kitPresent()) {
    console.error(`[drum-fit] no TR-808 kit at ${KIT_DIR}`)
    console.error('[drum-fit] set TR808_KIT to the sample folder.')
    process.exitCode = 1
    return
  }
  await loadProcessor()

  const only = process.argv.slice(2).map(s => s.toUpperCase())
  const samples = listSamples()
    .filter(s => (only.length ? only.includes(s.voice) : true))
    .filter(s => voiceSetup(s.voice, s.knobs) !== null)
    .sort((a, b) => a.voice.localeCompare(b.voice) || a.knobs[0]! - b.knobs[0]!)

  if (!samples.length) {
    console.error('[drum-fit] nothing to compare')
    process.exitCode = 1
    return
  }

  console.log('voice  knobs      pitch Hz          decay s         centroid Hz       shape  env')
  console.log('                  ref    ours       ref    ours     ref    ours        dB    dB')
  console.log('─'.repeat(88))

  const byVoice = new Map<string, number[]>()

  for (const s of samples) {
    const setup = voiceSetup(s.voice, s.knobs)!
    const ref = readWav(s.path)
    // Match the reference's length so the two envelopes cover the same span.
    const seconds = Math.max(0.5, Math.min(3, ref.data.length / ref.rate))
    const ours = renderVoice(setup.type, setup.params, seconds)

    const range = PITCH_RANGE[s.voice]
    const refPitch = range ? fundamental(ref.data, ref.rate, range[0], range[1]) : NaN
    const ourPitch = range ? fundamental(ours, SR, range[0], range[1]) : NaN

    const sd = spectralDistance(shape(ref.data, ref.rate), shape(ours, SR))
    const ed = envelopeDistance(envelope(ref.data, ref.rate), envelope(ours, SR))

    byVoice.set(s.voice, [...(byVoice.get(s.voice) ?? []), sd])

    const num = (v: number, w: number, d = 0) =>
      (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

    console.log(
      `${s.voice.padEnd(6)} ${s.knobs.join('/').padEnd(9)} ` +
      `${num(refPitch, 6, 1)} ${num(ourPitch, 7, 1)}   ` +
      `${num(decayTime(ref.data, ref.rate), 6, 3)} ${num(decayTime(ours, SR), 7, 3)}   ` +
      `${num(centroid(ref.data, ref.rate), 6)} ${num(centroid(ours, SR), 7)}    ` +
      `${num(sd, 6, 1)} ${num(ed, 5, 1)}`,
    )
  }

  console.log('─'.repeat(88))
  console.log('\nmean spectral-shape distance per voice (dB, lower is closer):')
  const summary = [...byVoice.entries()]
    .map(([v, ds]) => ({ v, mean: ds.reduce((a, d) => a + d, 0) / ds.length, n: ds.length }))
    .sort((a, b) => b.mean - a.mean)
  for (const { v, mean, n } of summary) {
    console.log(`  ${v.padEnd(4)} ${mean.toFixed(1).padStart(5)} dB   (${n} sample${n === 1 ? '' : 's'})  ${'█'.repeat(Math.round(mean))}`)
  }
  const all = [...byVoice.values()].flat()
  console.log(`\n  overall ${(all.reduce((a, d) => a + d, 0) / all.length).toFixed(2)} dB across ${all.length} samples`)
}

await main()
