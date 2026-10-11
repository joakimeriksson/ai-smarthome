// Regression fit against the real TR-808.
//
// Lives in its own file on purpose: drum-voices.test.ts imports the processor
// with its own stubbed registerProcessor, and Node caches ES modules by path —
// so a second loader in the same module registry never sees registerProcessor
// fire and ends up with nothing. Separate files get separate registries.

import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Fit against the real machine
//
// Proxies for "does this sound like an 808" kept going stale. Spectral flatness
// separated metal voices from noise ones until the oscillators were given
// asymmetric duty cycles — which densified the comb deliberately, to match the
// hardware, and collapsed the margin. Periodicity did no better.
//
// With the reference kit available there is no need to proxy: measure the
// distance to the real machine. Skips when the kit is absent, since the samples
// are third-party and not checked in (see tools/drum-fit/kit.ts).
// ---------------------------------------------------------------------------

const kit = await import('../../../tools/drum-fit/kit.ts')
const fitRender = await import('../../../tools/drum-fit/render.ts')
const fitMeasure = await import('../../../tools/drum-fit/measure.ts')

/**
 * Ceilings per voice, set roughly 1.5 dB above the fitted values so ordinary
 * drift does not flake the suite but a structural regression does. For scale,
 * before the kit-driven fit the worst of these sat at 17 dB.
 *
 * The metal and noise voices start at random phases on every hit, and a
 * voice with a single reference sample swings about +/-1.2 dB render to
 * render (measured 2026-10-01 over 20 renders: RS 4.5-6.9, CB 4.7-7.2
 * around means of 5.6 and 5.8) - enough to cross a ceiling one run in
 * three. So those voices are rendered TAKES times and averaged; the many-
 * sample voices average over their samples already (CY: 6.5-6.8).
 */
const TAKES = 8
const CEILING: Record<string, number> = {
  BD: 6.5, SD: 7.5, CH: 5.5, OH: 6.5, CP: 5.5, LT: 7, MT: 7, HT: 7,
  RS: 7, CB: 7, CY: 8, MA: 7, LC: 6.5, MC: 7.5, HC: 7.5, CL: 7.5,
}

describe.skipIf(!kit.kitPresent())('fit against the real TR-808', () => {
  it('keeps every voice within its measured distance of the machine', async () => {
    await fitRender.loadProcessor()
    const byVoice = new Map<string, number[]>()

    const samples = kit.listSamples()
    const count = (voice: string) => samples.filter(s => s.voice === voice).length
    for (const sample of samples) {
      const setup = fitRender.voiceSetup(sample.voice, sample.knobs)
      if (!setup) continue
      const ref = kit.readWav(sample.path)
      const refShape = fitMeasure.shape(ref.data, ref.rate)
      const seconds = Math.max(0.5, Math.min(3, ref.data.length / ref.rate))
      const takes = count(sample.voice) < 4 ? TAKES : 1
      for (let k = 0; k < takes; k++) {
        const ours = fitRender.renderVoice(setup.type, setup.params, seconds)
        const d = fitMeasure.spectralDistance(refShape, fitMeasure.shape(ours, fitRender.SR))
        byVoice.set(sample.voice, [...(byVoice.get(sample.voice) ?? []), d])
      }
    }

    expect(byVoice.size).toBe(16)     // every voice in the kit, congas and claves included
    const means: number[] = []
    for (const [voice, ds] of byVoice) {
      const mean = ds.reduce((a, d) => a + d, 0) / ds.length
      means.push(...Array.from({ length: Math.min(ds.length, count(voice)) }, () => mean))
      expect(mean, `${voice} drifted from the reference`).toBeLessThan(CEILING[voice] ?? 12)
    }
    // Over all samples, each weighted once (a voice's takes are one sample).
    expect(means.reduce((a, d) => a + d, 0) / means.length).toBeLessThan(6.3)
  }, 60_000)
})
