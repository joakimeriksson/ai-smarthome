// The SID synth's delayed vibrato (vibDepth / vibRate / vibDelay), read off
// the chip's frequency register: a note must start dead on pitch, stay there
// for the delay, then swing at the set depth and rate — the Galway profile
// the "Galway Vibrato Lead" preset and the Hi-Score demo depend on.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000

interface SidProc {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  regs: Int16Array[]
}
let Proc: new () => SidProc

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class { port = { onmessage: null, postMessage() { /* host */ } } }
  g['registerProcessor'] = (_: string, cls: new () => SidProc) => { Proc = cls }
  await import('../../../../js/sid-processor.js')
})

/** Cents from A440 on voice 0's frequency register, once per 128-sample block. */
function trace(params: Record<string, number>, seconds: number): number[] {
  const p = new Proc()
  const send = (m: unknown) => p.port.onmessage!({ data: m })
  for (const [param, value] of Object.entries(params)) send({ type: 'param', param, value })
  send({ type: 'noteOn', voice: 0, note: 69, velocity: 100 })
  const l = new Float32Array(128), r = new Float32Array(128), out: number[] = []
  for (let b = 0; b < Math.round(seconds * SR / 128); b++) {
    p.process([], [[l, r]])
    const reg = p.regs[0]![0]! | (p.regs[0]![1]! << 8)
    out.push(1200 * Math.log2(reg * 985248 / 16777216 / 440))
  }
  return out
}

describe('SID delayed vibrato', () => {
  it('holds pitch through the delay, then swings at depth and rate', () => {
    const c = trace({ vibDepth: 31, vibRate: 5.7, vibDelay: 0.24 }, 1.2)
    const block = 128 / SR
    const before = c.slice(0, Math.floor(0.23 / block))
    const after = c.slice(Math.ceil(0.3 / block))
    // Dead on pitch (within the 16-bit register's rounding) before the delay.
    expect(Math.max(...before.map(Math.abs))).toBeLessThan(2)
    // +-31 cents after it.
    expect(Math.max(...after)).toBeGreaterThan(27)
    expect(Math.min(...after)).toBeLessThan(-27)
    expect(Math.max(...after.map(Math.abs))).toBeLessThan(35)
    // Rate from zero crossings: 5.7 Hz within 5 %.
    let crossings = 0
    for (let i = 1; i < after.length; i++) if ((after[i - 1]! < 0) !== (after[i]! < 0)) crossings++
    const hz = crossings / 2 / (after.length * block)
    expect(Math.abs(hz - 5.7) / 5.7).toBeLessThan(0.05)
  })

  it('is off by default', () => {
    const c = trace({}, 0.8)
    expect(Math.max(...c.map(Math.abs))).toBeLessThan(2)
  })
})
