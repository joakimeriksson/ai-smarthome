// js/minipops-processor.js against the SR-95 service manual: the rhythms'
// hit positions (pp. 6-7), each voice's resonance, decay and output level
// (p. 8), and the clock the studio starts it with.
//
// Own file: Node caches the processor module by path, so only the first
// loader in a registry sees registerProcessor.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000

interface Voice { name: string; active: boolean; trim: number; trigger(v: number, g?: number): void; process(): number }
interface Proc {
  voices: Voice[]
  step: number
  len: number
  div: number
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}
interface Spec { kind: string; f: number; t20: number; out: number }

let Processor: (new () => Proc) | null = null
let SPEC: Record<string, Spec> = {}
let VOICE_NAMES: string[] = []

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (_name: string, cls: new () => Proc) => { Processor = cls }
  const mod = await import('../../../../js/minipops-processor.js') as unknown as {
    SPEC: Record<string, Spec>; VOICE_NAMES: string[]
  }
  SPEC = mod.SPEC
  VOICE_NAMES = mod.VOICE_NAMES
})

const send = (p: Proc, data: unknown) => p.port.onmessage!({ data })

function render(p: Proc, samples: number): Float32Array {
  const out = new Float32Array(samples)
  const l = new Float32Array(128), r = new Float32Array(128)
  for (let i = 0; i < samples; i += 128) {
    p.process([], [[l, r]])
    out.set(l.subarray(0, Math.min(128, samples - i)), i)
  }
  return out
}

/**
 * Sample position of every strike, by voice name. Each voice's process()
 * runs once per output sample, so a global call count divided by the number
 * of voices is the sample clock.
 */
function onsets(p: Proc, samples: number): Record<string, number[]> {
  const proto = Object.getPrototypeOf(p.voices[0]) as {
    process: () => number; trigger: (v: number, g?: number) => void
  }
  const { process, trigger } = proto
  const n = p.voices.length
  let calls = 0
  const at: Record<string, number[]> = {}
  proto.process = function (this: Voice) { calls++; return process.call(this) }
  proto.trigger = function (this: Voice, v: number, g?: number) {
    (at[this.name] ??= []).push(Math.round(calls / n))
    return trigger.call(this, v, g)
  }
  try {
    render(p, samples)
    return at
  } finally {
    proto.process = process
    proto.trigger = trigger
  }
}

function box(params: Record<string, unknown>, bpm = 120): Proc {
  const p = new Processor!()
  send(p, { type: 'preset', params })
  send(p, { type: 'param', param: 'tempo', value: bpm })
  return p
}

const steps = (positions: number[], samplesPerStep: number) =>
  positions.map(s => Math.round(s * samplesPerStep))

describe('rhythms from the pulse-generator grids', () => {
  // At 120 bpm an eighth-note step is a quarter second: 12000 samples.
  const SPS = SR * 60 / 120 / 2

  it('Rock 1 (A, key 7): hat on every eighth, snare on 2 and 4, the manual bass drum figure', () => {
    const p = box({ section: 0, 'key.6': true })
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    expect(hit['BD']).toEqual(steps([0, 3, 4, 7, 8, 11, 12, 15], SPS))
    expect(hit['SD1']).toEqual(steps([2, 6, 10, 14], SPS))
    expect(hit['HH']).toEqual(steps([...Array(16).keys()], SPS))
    expect(hit['TA']).toBeUndefined()         // slider at zero: not struck at all
  })

  it('Rumba (A, key 4) carries the 3-2 son clave on the claves', () => {
    const p = box({ section: 0, 'key.3': true })
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    expect(hit['CL']).toEqual(steps([0, 3, 6, 10, 12], SPS))
    // ...and the one sixteenth in its hi-hat figure.
    expect(hit['HH']).toContain(Math.round(1.5 * SPS))
  })

  it('the lever picks the lower rhythm of the same key', () => {
    const p = box({ section: 1, 'key.6': true })           // Rock 2
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    expect(hit['SD1']).toEqual(steps([2, 5, 10, 13], SPS))
  })

  it("Swing's ride plays the late triplet eighth a third of a step after the beat", () => {
    const p = box({ section: 0, 'key.9': true })
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    const ride = hit['CY2']!
    for (const s of [3.33, 7.33, 11.33, 15.33]) {
      const want = s * SPS
      expect(ride.some(x => Math.abs(x - want) <= 2)).toBe(true)
    }
    expect(ride).toHaveLength(12)
  })

  it('Slow Rock (B, key 6) runs twelve triplet steps to the bar', () => {
    const p = box({ section: 1, 'key.5': true })
    expect(p.len).toBe(12)
    expect(p.div).toBe(3)
    const sps = SR * 60 / 120 / 3
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(12 * sps))
    expect(hit['BD']).toEqual(steps([0, 5, 6, 11], sps))
    expect(hit['CB']).toEqual(steps([3, 9], sps))
    expect(hit['HH']).toHaveLength(12)
  })

  it('two keys down combine their rhythms', () => {
    const p = box({ section: 0, 'key.6': true, 'key.5': true })   // Rock 1 + Bossanova
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    expect(hit['SD1']).toEqual(steps([2, 6, 10, 14], SPS))                 // Rock 1's snare
    expect(hit['CB']).toEqual(steps([0, 3, 6, 10, 13], SPS))               // Bossanova's bell
    expect(hit['BD']).toEqual(steps([0, 3, 4, 7, 8, 11, 12, 15], SPS))    // shared figure, struck once
  })

  it('the additional rhythms come in with their sliders', () => {
    const p = box({ section: 0, 'key.8': true, tambourine: 0.5, quijada: 0.7, guiro: 0.4 })   // March 2/4
    send(p, { type: 'play' })
    const hit = onsets(p, Math.round(16 * SPS))
    expect(hit['TA']).toHaveLength(16)
    expect(hit['QU']).toEqual(steps([2, 6, 10, 14], SPS))
    expect(hit['GU']).toHaveLength(12)
  })

  it('starts on the AudioContext time the studio hands it', () => {
    const p = box({ section: 0, 'key.6': true })
    send(p, { type: 'play', startTime: 0.5 })       // currentTime is 0 in this harness
    const hit = onsets(p, SR)
    expect(hit['BD']![0]).toBe(Math.round(0.5 * SR))
  })

  it('is silent with no key down and never produces non-finite output', () => {
    const p = box({ section: 0 })
    send(p, { type: 'play' })
    const out = render(p, SR)
    expect(out.every(x => x === 0)).toBe(true)
    send(p, { type: 'preset', params: { section: 1, 'key.3': true, guiro: 1, quijada: 1, tambourine: 1 } })
    const loud = render(p, SR * 2)
    expect(loud.every(Number.isFinite)).toBe(true)
    expect(Math.max(...loud)).toBeGreaterThan(0.1)
  })
})

describe('voices against the output-level table', () => {
  /** One hit of a voice alone, straight from the voice. */
  function hit(name: string): Float64Array {
    const p = new Processor!()
    const v = p.voices[VOICE_NAMES.indexOf(name)]!
    v.trigger(1, name === 'GU' ? Math.round(SR * 0.25) : 0)
    const out = new Float64Array(SR)
    for (let i = 0; i < SR; i++) out[i] = v.process()
    return out
  }

  function peakFreq(x: Float64Array, lo: number, hi: number): number {
    const M = Math.round(0.1 * SR)
    let best = 0, bf = 0
    for (let f = lo; f <= hi; f *= 1.01) {
      let re = 0, im = 0
      const w = 2 * Math.PI * f / SR
      for (let i = 0; i < M; i++) { re += x[i]! * Math.cos(w * i); im -= x[i]! * Math.sin(w * i) }
      if (re * re + im * im > best) { best = re * re + im * im; bf = f }
    }
    return bf
  }

  it('each voice rings or hisses at the frequency the manual gives', () => {
    for (const name of VOICE_NAMES) {
      const s = SPEC[name]!
      const f = peakFreq(hit(name), s.f * 0.7, s.f * 1.4)
      expect(Math.abs(f / s.f - 1), `${name} peak at ${f.toFixed(0)} Hz, manual ${s.f}`).toBeLessThan(0.08)
    }
  })

  it('the drums fall 20 dB in the time the manual gives', () => {
    for (const name of ['CO', 'LB', 'SB', 'CL', 'CB']) {
      const s = SPEC[name]!
      const x = hit(name)
      const w = Math.round(Math.max(0.002, 3 / s.f) * SR)      // a few cycles per window
      const env: number[] = []
      for (let i = 0; i + w <= x.length; i += w) {
        let e = 0
        for (let k = 0; k < w; k++) e += x[i + k]! ** 2
        env.push(Math.sqrt(e / w))
      }
      const top = Math.max(...env)
      const m = env.indexOf(top)
      const below = env.findIndex((e, i) => i > m && e < top * 0.1)
      const t20 = (below - m) * w / SR
      expect(Math.abs(t20 / s.t20 - 1), `${name} -20 dB after ${(t20 * 1000).toFixed(0)} ms, manual ${s.t20 * 1000}`).toBeLessThan(0.35)
    }
  })

  it('peaks stand in the ratio of the output-level column', () => {
    const peaks: Record<string, number> = {}
    for (const name of VOICE_NAMES) {
      const x = hit(name)
      let pk = 0
      for (let i = 0; i < x.length; i++) pk = Math.max(pk, Math.abs(x[i]!))
      peaks[name] = pk
    }
    for (const name of VOICE_NAMES) {
      const want = SPEC[name]!.out / SPEC['CL']!.out
      expect(Math.abs(peaks[name]! / peaks['CL']! / want - 1), `${name} ${peaks[name]!.toFixed(3)}`).toBeLessThan(0.15)
    }
  })

  it('keyboard play strikes the voices from C2 upward', () => {
    const p = new Processor!()
    const proto = Object.getPrototypeOf(p.voices[0]) as { trigger: (v: number) => void }
    const struck: string[] = []
    const orig = proto.trigger
    proto.trigger = function (this: Voice, v: number) { struck.push(this.name); return orig.call(this, v) }
    try {
      send(p, { type: 'noteOn', note: 36, velocity: 100 })
      send(p, { type: 'noteOn', note: 36 + 10, velocity: 100 })
      send(p, { type: 'trigger', voice: 'CB', velocity: 1 })
    } finally { proto.trigger = orig }
    expect(struck).toEqual(['BD', 'CL', 'CB'])
  })
})
