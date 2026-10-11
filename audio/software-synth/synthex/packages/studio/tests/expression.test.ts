// Two things the long demos rely on: VA key pressure (aftertouch) opening
// the filter, and idle SID chips not being clocked.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000
interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}
const registry: Record<string, new () => Proc> = {}

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class { port = { onmessage: null, postMessage() { /* host */ } } }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => { registry[name] = cls }
  await import('../../../../js/va-processor.js')
  await import('../../../../js/sid-processor.js')
})

function run(p: Proc, seconds: number): Float64Array {
  const n = Math.round(seconds * SR / 128) * 128, out = new Float64Array(n)
  const l = new Float32Array(128), r = new Float32Array(128)
  for (let i = 0; i < n; i += 128) { p.process([], [[l, r]]); for (let k = 0; k < 128; k++) out[i + k] = l[k]! }
  return out
}
/** Energy of the first difference relative to the signal: a brightness proxy. */
const bright = (x: Float64Array, a: number, b: number) => {
  let e = 0, h = 0
  for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) { e += x[i]! ** 2; h += (x[i]! - x[i - 1]!) ** 2 }
  return 10 * Math.log10(h / e)
}

describe('VA aftertouch', () => {
  function note(pressure: number | null): Float64Array {
    const p = new registry['va-synth-processor']!()
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    for (const [param, value] of Object.entries({
      filterCutoff: 400, filterEnvAmount: 0, filterResonance: 0, unisonCount: 1, driftAmount: 0,
      'mod.1.src': 'pressure', 'mod.1.dst': 'cutoff', 'mod.1.amount': 1,   // full scale: +4 octaves
    })) send({ type: 'param', param, value })
    send({ type: 'noteOn', voice: 0, note: 57, velocity: 100 })
    const a = run(p, 0.5)
    if (pressure !== null) send({ type: 'pressure', voice: 0, value: pressure, time: 0.2 })
    const b = run(p, 0.8)
    const all = new Float64Array(a.length + b.length); all.set(a); all.set(b, a.length)
    return all
  }

  it('opens the filter on the pressed note, and only after the press', () => {
    const plain = note(null), pressed = note(1)
    expect(Math.abs(bright(pressed, 0.2, 0.45) - bright(plain, 0.2, 0.45))).toBeLessThan(0.1)
    expect(bright(pressed, 0.9, 1.25) - bright(plain, 0.9, 1.25)).toBeGreaterThan(3)
  })

  it('starts every new key press with no pressure', () => {
    const p = new registry['va-synth-processor']!()
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    send({ type: 'noteOn', voice: 0, note: 57, velocity: 100 })
    send({ type: 'pressure', voice: 0, value: 1, time: 0 })
    run(p, 0.1)
    send({ type: 'noteOn', voice: 0, note: 60, velocity: 100 })
    const v = (p as unknown as { voices: { pressure: number }[] }).voices[0]!
    expect(v.pressure).toBe(0)
  })
})

describe('SID idle chips', () => {
  it('stop being clocked once silent, and wake on the next note', () => {
    const p = new registry['sid-synth-processor']!() as Proc & { _idle: Int32Array }
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    send({ type: 'param', param: 'sr', value: 0xF0 })       // short release
    send({ type: 'noteOn', voice: 0, note: 60, velocity: 100 })
    run(p, 0.3)
    send({ type: 'noteOff', voice: 0 })
    run(p, 1.5)
    expect([...p._idle].every(n => n >= 4096)).toBe(true)
    send({ type: 'noteOn', voice: 0, note: 60, velocity: 100 })
    const x = run(p, 0.3)
    expect(p._idle[0]).toBe(0)
    let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.05)
  })
})
