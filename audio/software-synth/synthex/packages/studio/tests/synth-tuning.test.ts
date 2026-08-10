// Tuning regression for the five vanilla synths.
//
// Every bug this guards against was silent: the SID played an OCTAVE flat
// (note-to-table offset of 24 where the GT2 table starts at C0 = 12), the
// Karplus-Strong string was up to 33 cents sharp at the top of the keyboard
// (integer delay line, and an averaging filter whose second tap SHORTENS the
// loop), and VA applied random per-voice detune that ignored the drift knob.
// None of them threw; all of them were out of tune.
//
// Lives in its own file: each vitest file gets its own module registry, so the
// processor imports here cannot collide with the drum tests' stubs.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 44100

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m?: unknown): void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}

const registry: Record<string, new () => Proc> = {}

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => { registry[name] = cls }
  const J = '../../../../js'
  await import(`${J}/va-processor.js`)
  await import(`${J}/ws-processor.js`)
  await import(`${J}/sid-processor.js`)
  await import(`${J}/fm-processor.js`)
  await import(`${J}/pm-processor.js`)
})

function render(proc: string, setup: [string, unknown][], note: number, seconds = 0.9): Float64Array {
  const p = new registry[proc]!()
  const msg = (m: unknown) => p.port.onmessage!({ data: m })
  for (const [param, value] of setup) msg({ type: 'param', param, value })
  msg({ type: 'noteOn', voice: 0, note, velocity: 100 })
  const total = Math.round(SR * seconds)
  const out = new Float64Array(total)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  for (let i = 0; i < total; i += 128) {
    l.fill(0); r.fill(0)
    p.process([], [[l, r]])
    for (let k = 0; k < Math.min(128, total - i); k++) out[i + k] = l[k]!
  }
  return out
}

function goertzel(b: Float64Array, f: number, from: number, len: number): number {
  const c = 2 * Math.cos(2 * Math.PI * f / SR)
  let s1 = 0, s2 = 0
  for (let i = from; i < from + len && i < b.length; i++) {
    const s = b[i]! + c * s1 - s2
    s2 = s1; s1 = s
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / len
}

/** Fundamental near the expected frequency, refined to sub-cent resolution. */
function centsError(b: Float64Array, expect: number): number {
  const from = Math.round(SR * 0.15)
  const len = Math.min(b.length - from, SR)
  let lo = expect * Math.pow(2, -1.5 / 12)
  let hi = expect * Math.pow(2, 1.5 / 12)
  let best = expect
  for (let pass = 0; pass < 3; pass++) {
    const step = (hi - lo) / 60
    let bm = -1
    for (let f = lo; f <= hi; f += step) {
      const m = goertzel(b, f, from, len)
      if (m > bm) { bm = m; best = f }
    }
    lo = best - step; hi = best + step
  }
  return 1200 * Math.log2(best / expect)
}

const freq = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

describe('synth tuning', () => {
  it('VA is exact with the drift knob at zero', () => {
    const setup: [string, unknown][] = [
      ['driftAmount', 0], ['unisonCount', 1], ['osc1Waveform', 1],
      ['filterCutoff', 18000], ['filterEnvAmount', 0], ['lfo1Rate', 0],
    ]
    for (const note of [45, 69, 93]) {
      expect(Math.abs(centsError(render('va-synth-processor', setup, note), freq(note))),
        `VA note ${note}`).toBeLessThan(0.5)
    }
  })

  it('WS is exact — PPG oscillators are digital and in tune', () => {
    const setup: [string, unknown][] = [['filterCutoff', 18000], ['filterEnvAmount', 0]]
    for (const note of [45, 69, 93]) {
      expect(Math.abs(centsError(render('ws-synth-processor', setup, note), freq(note))),
        `WS note ${note}`).toBeLessThan(0.5)
    }
  })

  it('SID plays at concert pitch, within its register quantisation', () => {
    // The GT2 table starts at C0: A4 is entry 57 (0x1d46 = 440.1 Hz at the PAL
    // clock). An offset of 24 here once played everything an octave flat.
    const setup: [string, unknown][] = [['waveform', 0x11], ['filterOn', false]]
    for (const note of [45, 69, 93]) {
      expect(Math.abs(centsError(render('sid-synth-processor', setup, note), freq(note))),
        `SID note ${note}`).toBeLessThan(1.5)
    }
  }, 30_000)

  it('FM carrier is exact', () => {
    const setup: [string, unknown][] = [
      ['feedback', 0], ['lfoPitchDepth', 0],
      ['op.1.on', false], ['op.2.on', false], ['op.3.on', false],
      ['op.4.on', false], ['op.5.on', false],
      ['op.0.ratio', 1], ['op.0.fine', 1], ['op.0.level', 0.9],
      ['op.0.sustain', 1], ['op.0.decay', 0.1],
    ]
    for (const note of [45, 69, 93]) {
      expect(Math.abs(centsError(render('fm-synth-processor', setup, note), freq(note))),
        `FM note ${note}`).toBeLessThan(0.5)
    }
  })

  it('PM string is in tune across the keyboard', () => {
    // Integer-delay Karplus-Strong was 33 cents sharp by E6; the Jaffe-Smith
    // allpass with filter delays evaluated AT THE FUNDAMENTAL fixes it. Note
    // the sign: the averaging filter's second tap is one sample newer, so it
    // shortens the loop.
    const setup: [string, unknown][] = [
      ['exciter', 0], ['decay', 0.9], ['damping', 0.05],
      ['brightness', 0.7], ['bodyAmount', 0], ['pickup', 0],
    ]
    for (const note of [45, 69, 88, 93]) {
      expect(Math.abs(centsError(render('pm-synth-processor', setup, note), freq(note))),
        `PM note ${note}`).toBeLessThan(1)
    }
  })

  it('PM stays in tune when brightness moves the loop filter', () => {
    // The averaging filter's delay depends on brightness, so tuning must be
    // compensated per block, not only at note-on.
    for (const brightness of [0.1, 0.5, 0.9]) {
      const setup: [string, unknown][] = [
        ['exciter', 0], ['decay', 0.9], ['damping', 0.05],
        ['brightness', brightness], ['bodyAmount', 0], ['pickup', 0],
      ]
      expect(Math.abs(centsError(render('pm-synth-processor', setup, 88), freq(88))),
        `brightness ${brightness}`).toBeLessThan(1.5)
    }
  })
})
