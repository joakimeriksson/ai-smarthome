// Sound-level regressions for js/drum-processor.js: the sequencer's timing,
// retrigger clicks, the kit's level balance and the pan law. Each of these was
// measured broken in an offline audit (2026-09-24) while every voice-fit test
// stayed green — the fit renders one voice, once, alone, and none of these
// failures show up there.
//
// Own file for the same reason drum-fit.test.ts is: Node caches the processor
// module by path, so only the first loader in a registry sees registerProcessor.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000   // what a browser AudioContext actually runs at

interface Voice { active: boolean }
interface Proc {
  channels: Record<string, number>[]
  masterVolume: number
  drumVoices: Voice[]
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
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

const send = (p: Proc, data: unknown) => p.port.onmessage!({ data })

function render(p: Proc, samples: number, each?: (i: number) => void): { L: Float32Array; R: Float32Array } {
  const L = new Float32Array(samples), R = new Float32Array(samples)
  const l = new Float32Array(128), r = new Float32Array(128)
  for (let i = 0; i < samples; i += 128) {
    each?.(i)
    p.process([], [[l, r]])
    L.set(l.subarray(0, Math.min(128, samples - i)), i)
    R.set(r.subarray(0, Math.min(128, samples - i)), i)
  }
  return { L, R }
}

/**
 * Sample positions at which the sequencer fires, exact to the sample. Every
 * voice slot's process() runs once per output sample, so the count of calls
 * made before a trigger, divided by the slots per sample, is its position.
 */
function onsets(p: Proc, samples: number): number[] {
  const proto = Object.getPrototypeOf(p.drumVoices[0]) as {
    process: (...a: unknown[]) => number; trigger: (v: number) => void
  }
  const { process, trigger } = proto
  let calls = 0
  const at: number[] = []
  proto.process = function (this: unknown, ...a: unknown[]) { calls++; return process.apply(this, a) }
  proto.trigger = function (this: unknown, v: number) { at.push(calls); return trigger.call(this, v) }
  try {
    render(p, 128)                       // idle block: learn slots per sample
    const perSample = calls / 128
    calls = 0; at.length = 0
    send(p, { type: 'play' })
    render(p, samples)
    return at.map(c => c / perSample)
  } finally {
    proto.process = process
    proto.trigger = trigger
  }
}

function everyStep(bpm: number, swing: number): Proc {
  const p = new Processor!()
  send(p, { type: 'setPattern', pattern: [Array(16).fill(100)] })
  send(p, { type: 'param', param: 'bpm', value: bpm })
  send(p, { type: 'param', param: 'swing', value: swing })
  return p
}

describe('sequencer timing', () => {
  it('stays on the BPM grid at a tempo that is not a whole number of samples', () => {
    const spp = SR * 60 / (118 * 4)       // 6101.69 samples per step
    const at = onsets(everyStep(118, 0), Math.round(spp * 64 + 64))
    expect(at.length).toBeGreaterThanOrEqual(64)
    // Rounding the step length used to drift ~15 samples late by bar 4.
    for (let k = 0; k < 64; k++) expect(Math.abs(at[k]! - k * spp), `step ${k}`).toBeLessThan(1)
  })

  it.each([0.12, 0.25, 0.5])('swing %s delays the off-beats and leaves the downbeats alone', (swing) => {
    const spp = SR * 60 / (120 * 4)
    const at = onsets(everyStep(120, swing), Math.round(spp * 64 + 64))
    expect(at.length).toBeGreaterThanOrEqual(64)
    for (let k = 0; k < 64; k++) {
      // Even steps on the grid, odd ones late — and the bar never grows. The
      // old code delayed the downbeats instead and slowed the tempo.
      const ideal = k * spp + (k % 2 ? swing * spp : 0)
      expect(Math.abs(at[k]! - ideal), `step ${k}`).toBeLessThan(1)
    }
  })
})

describe('retrigger', () => {
  it.each([
    { name: 'tom', type: 5, tone: 110, gap: 0.06 },
    { name: 'conga', type: 10, tone: 281, gap: 0.04 },
  ])('re-hitting a ringing $name does not click', ({ type, tone, gap }) => {
    const setup = () => {
      const p = new Processor!()
      p.channels = p.channels.map((c, i) =>
        i === 0 ? { ...c, type, tone, decay: 0.5, color: 0.4, level: 1, pan: 0 } : { ...c, level: 0 })
      p.masterVolume = 0.02
      return p
    }
    const maxStep = (b: Float32Array, from: number, to: number) => {
      let m = 0
      for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(b[i]! - b[i - 1]!))
      return m
    }
    const at = Math.floor(gap * SR / 128) * 128
    const clean = setup(); send(clean, { type: 'trigger', channel: 0, velocity: 1 })
    const one = render(clean, SR / 2).L
    const re = setup(); send(re, { type: 'trigger', channel: 0, velocity: 1 })
    const two = render(re, SR / 2, i => { if (i === at) send(re, { type: 'trigger', channel: 0, velocity: 1 }) }).L

    // Resetting the ringing voice in place jumped by ~10x the largest step a
    // clean hit ever makes. A re-hit may be as sharp as a hit, never sharper.
    expect(maxStep(two, at, at + 8)).toBeLessThan(maxStep(one, 0, one.length) * 1.5)
  })
})

describe('mix', () => {
  it('keeps the cymbal in the kit instead of clipping the output stage', () => {
    const p = new Processor!()
    p.channels = p.channels.map((c, i) =>
      i === 0 ? { ...c, type: 8, tone: 300, decay: 0.5, color: 0.5, level: 0.9, pan: 0 } : { ...c, level: 0 })
    send(p, { type: 'trigger', channel: 0, velocity: 1 })
    const { L } = render(p, SR)
    let rail = 0, pk = 0
    for (const v of L) { if (Math.abs(v) >= 0.999) rail++; pk = Math.max(pk, Math.abs(v)) }
    // It used to sit ~25 dB above the other voices, pinned at the rail.
    expect(rail).toBe(0)
    expect(pk).toBeLessThan(0.9)
    expect(pk).toBeGreaterThan(0.1)
  })

  it('pans at constant power', () => {
    const power = (pan: number) => {
      // Cowbell phases are random per hit, and hit-to-hit power varies by up
      // to ~1.8 dB — more than this test's tolerance. Seed Math.random the
      // same way for every render so the only difference is the pan law.
      let seed = 12345
      const realRandom = Math.random
      Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      try { return renderPower(pan) } finally { Math.random = realRandom }
    }
    const renderPower = (pan: number) => {
      const p = new Processor!()
      p.channels = p.channels.map((c, i) => i === 0 ? { ...c, type: 7, level: 1, pan } : { ...c, level: 0 })
      p.masterVolume = 0.02
      send(p, { type: 'trigger', channel: 0, velocity: 1 })
      const { L, R } = render(p, SR / 4)
      let e = 0
      for (let i = 0; i < L.length; i++) e += L[i]! * L[i]! + R[i]! * R[i]!
      return 10 * Math.log10(e)
    }
    const centre = power(0)
    // The linear law put the edges 3 dB above the centre.
    for (const pan of [-1, -0.5, 0.5, 1]) expect(Math.abs(power(pan) - centre), `pan ${pan}`).toBeLessThan(1)
  })
})
