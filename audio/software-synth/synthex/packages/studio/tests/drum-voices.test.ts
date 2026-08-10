// Regression tests for the TR-808 voice engine in js/drum-processor.js.
//
// The studio hosts that processor, so a break here is a break in the studio.
// Two bugs during the 808 rewrite were silent — a filter that went unstable
// above sr/6 and produced NaN, and a voice-retirement check that read the
// instantaneous sample so anything oscillating switched itself off within
// milliseconds. Neither threw. Both are covered below.
//
// AudioWorklet globals are stubbed and process() is called directly; driving a
// real browser is far less reliable for this.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 44100
const TYPES = [
  'kick', 'snare', 'closed hat', 'open hat', 'clap',
  'tom', 'rim', 'cowbell', 'cymbal', 'maraca', 'conga', 'claves',
]

interface Channel { type: number; tone: number; decay: number; color: number; level: number; pan: number }
interface Proc {
  channels: Channel[]
  masterVolume: number
  drumVoices: { trigger(v: number): void; choke(): void; active: boolean }[]
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  _choke(ch: number): void
}

let Processor: (new () => Proc) | null = null

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (_name: string, cls: new () => Proc) => { Processor = cls }
  await import('../../../../js/drum-processor.js')
})

/**
 * Render one voice type alone. `master` backs off the output stage: at unity
 * the bus saturation is audible and colours the measurement, which is right
 * for level tests and wrong for timbre tests.
 */
function render(type: number, seconds = 2, velocity = 1, decay?: number, master = 1): Float32Array {
  const p = new Processor!()
  p.channels = p.channels.map((c, i) =>
    i === 0
      ? { ...c, type, level: 1, pan: 0, ...(decay !== undefined ? { decay } : {}) }
      : { ...c, level: 0 })
  p.masterVolume = master
  p.drumVoices[0]!.trigger(velocity)

  const total = Math.round(SR * seconds)
  const out = new Float32Array(total)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  for (let i = 0; i < total; i += 128) {
    l.fill(0); r.fill(0)
    p.process([], [[l, r]])
    out.set(l.subarray(0, Math.min(128, total - i)), i)
  }
  return out
}

const peak = (b: Float32Array) => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

function rms(b: Float32Array, from: number, len: number): number {
  let s = 0
  for (let i = from; i < from + len && i < b.length; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / len)
}

/** Time until the signal falls 60 dB below its peak. */
function decayTime(b: Float32Array): number {
  const pk = peak(b)
  if (pk === 0) return 0
  // Start at the peak: a voice whose loudest moment arrives a few milliseconds
  // in would otherwise report a decay of 0, because its opening window is quiet
  // relative to a peak it has not reached yet.
  let start = 0
  for (let i = 0; i < b.length; i++) if (Math.abs(b[i]!) === pk) { start = i; break }
  for (let i = start; i + 256 < b.length; i += 256) {
    if (rms(b, i, 256) < pk * 0.001) return i / SR
  }
  return b.length / SR
}

function goertzel(b: Float32Array, freq: number, from: number, len: number): number {
  const c = 2 * Math.cos(2 * Math.PI * freq / SR)
  let s1 = 0, s2 = 0
  for (let i = from; i < from + len && i < b.length; i++) {
    const s = b[i]! + c * s1 - s2
    s2 = s1; s1 = s
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / len
}

describe('808 voices', () => {
  it.each(TYPES.map((name, type) => ({ name, type })))(
    '$name produces finite, audible output',
    ({ type }) => {
      const b = render(type)
      expect(b.every(Number.isFinite), 'non-finite sample').toBe(true)
      // The hi-hat filters run at 6-9 kHz, where a Chamberlin SVF diverges.
      expect(peak(b)).toBeGreaterThan(0.02)
      expect(peak(b)).toBeLessThanOrEqual(1)
    },
  )

  it.each(TYPES.map((name, type) => ({ name, type })))(
    '$name has no DC offset',
    ({ type }) => {
      const b = render(type)
      const dc = b.reduce((a, v) => a + v, 0) / b.length
      expect(Math.abs(dc)).toBeLessThan(0.01)
    },
  )

  it('lets every voice ring for at least its attack, not one zero crossing', () => {
    // The retirement check used to read the instantaneous sample, so a 50 Hz
    // kick died at its first quiet zero crossing ~30 ms in.
    for (const type of [0, 1, 3, 5, 7, 8]) {
      expect(decayTime(render(type)), `${TYPES[type]} decay`).toBeGreaterThan(0.1)
    }
  })

  it('makes the decay control monotonic on the kick', () => {
    const times = [0, 0.25, 0.5, 0.75, 1].map(d => decayTime(render(0, 3, 1, d)))
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!, `decay ${i}`).toBeGreaterThan(times[i - 1]!)
    }
    // The kit's BD samples run from 0.10 s at DECAY 0 to 3.0 s at DECAY 10,
    // so the range has to reach that far — an earlier bound of 2.5 s here was
    // a guess made before the reference kit was available.
    expect(times[0]!).toBeGreaterThan(0.05)
    expect(times[0]!).toBeLessThan(0.5)
    expect(times[times.length - 1]!).toBeGreaterThan(2)
    expect(times[times.length - 1]!).toBeLessThan(4)
  })

  it('puts the kick fundamental where it is tuned', () => {
    const b = render(0)
    const at = (f: number) => goertzel(b, f, 1000, 8192)
    // Default kick tone is 55 Hz; the 808's pitch drop is slight, so the
    // fundamental must dominate rather than a swept harmonic above it.
    expect(at(55)).toBeGreaterThan(at(150))
    expect(at(55)).toBeGreaterThan(at(250))
  })

  it('opens the voices up on an accented hit, not just louder', () => {
    expect(peak(render(1, 1, 1))).toBeGreaterThan(peak(render(1, 1, 0.4)))

    // Averaged over several hits, because the snare re-seeds its noise on every
    // trigger: a single pair of renders measures the noise realisation as much
    // as the accent bus, and lands either side of the line run to run.
    //
    // Measured with the output stage backed off, too — at unity the bus
    // saturation compresses the loud hit and redistributes its spectrum, which
    // would make this a test of the limiter.
    const balance = (velocity: number) => {
      let sum = 0
      for (let i = 0; i < 16; i++) {
        const b = render(1, 1, velocity, undefined, 0.02)
        let high = 0
        for (const f of [4000, 6000, 9000]) high += goertzel(b, f, 0, 8192)
        let low = 0
        for (const f of [180, 220, 300]) low += goertzel(b, f, 0, 8192)
        sum += high / low
      }
      return sum / 16
    }
    expect(balance(1)).toBeGreaterThan(balance(0.4) * 1.05)
  })
})

describe('hi-hat choke', () => {
  it('mutes a ringing open hat without a click', () => {
    const p = new Processor!()
    p.channels = p.channels.map((c, i) => ({ ...c, level: i === 3 ? 1 : 0, pan: 0 }))
    p.masterVolume = 1

    const total = SR
    const out = new Float32Array(total)
    const l = new Float32Array(128)
    const r = new Float32Array(128)
    const chokeAt = 8192

    p.drumVoices[3]!.trigger(1)
    for (let i = 0; i < total; i += 128) {
      // Channel 2 is the closed hat; muted above, so only its choke is heard.
      if (i >= chokeAt && i < chokeAt + 128) p._choke(2)
      l.fill(0); r.fill(0)
      p.process([], [[l, r]])
      out.set(l.subarray(0, Math.min(128, total - i)), i)
    }

    const before = rms(out, chokeAt - 1200, 1000)
    const after = rms(out, chokeAt + 1200, 1000)
    expect(before).toBeGreaterThan(0.001)
    expect(after).toBeLessThan(before * 0.05)

    // A hard cut would leave a step the size of the signal; the fade must not.
    let jump = 0
    for (let i = chokeAt; i < chokeAt + 600; i++) jump = Math.max(jump, Math.abs(out[i]! - out[i - 1]!))
    expect(jump).toBeLessThan(peak(out) * 0.75)
  })
})
