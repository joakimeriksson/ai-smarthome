// Sound regressions for the FM synth (js/fm-processor.js). Each of these was a
// real, silent bug found by measurement on 2026-09-24:
//
//  - Algorithm table: algorithm 3 left OP5/OP6 unconnected, algorithm 4 had OP2
//    modulating ITSELF (and OP3/OP5/OP6 dead), algorithm 5 output OP4 (a
//    modulator) instead of OP5. Nothing threw; the knobs just did nothing.
//  - OP6 feedback >= 0.75 falls into a period-3 limit cycle at a third of the
//    internal rate; the old 2x-then-average decimation folded it to 16 kHz as a
//    non-harmonic whine (up to 43 % of the tone's energy).
//  - Every note-on zeroed the operator phases, even on a voice still ringing —
//    and the voice pools re-use the lowest free (i.e. still-releasing) voice, so
//    repeated notes clicked.
//  - A preset left out-of-preset FX and LFO waveform from the previous preset.
//
// Own file: each vitest file gets its own module registry.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m?: unknown): void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  reverb: { enabled: boolean }
  chorus: { enabled: boolean }
  params: { lfoWaveform: number }
}

let FM: new () => Proc

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => {
    if (name === 'fm-synth-processor') FM = cls
  }
  await import('../../../../js/fm-processor.js')
})

type Ev = [number, Record<string, unknown>]   // [sample index, message]

function render(params: Record<string, unknown>, events: Ev[], samples: number): { p: Proc; out: Float64Array } {
  const p = new FM()
  const msg = (m: unknown) => p.port.onmessage!({ data: m })
  msg({ type: 'preset', params: JSON.parse(JSON.stringify(params)), fx: {} })
  const out = new Float64Array(samples)
  const l = new Float32Array(128), r = new Float32Array(128)
  let e = 0
  for (let i = 0; i < samples; i += 128) {
    while (e < events.length && events[e]![0] < i + 128) msg(events[e++]![1])
    l.fill(0); r.fill(0)
    p.process([], [[l, r]])
    for (let k = 0; k < Math.min(128, samples - i); k++) out[i + k] = l[k]!
  }
  return { p, out }
}

const noteOn = (at: number, note = 60): Ev => [at, { type: 'noteOn', voice: 0, note, velocity: 100 }]
const noteOff = (at: number): Ev => [at, { type: 'noteOff', voice: 0 }]

function patch(algorithm: number, enabled: number[], feedback = 0, level = 0.5) {
  return {
    algorithm, feedback, lfoRate: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
    ops: [0, 1, 2, 3, 4, 5].map(i => ({
      on: enabled.includes(i), ratio: 1, fine: 1, level,
      attack: 0.0001, decay: 1, sustain: 1, release: 0.1, velSens: 0,
    })),
  }
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(a * k), ci = Math.sin(a * k)
        const p = i + k, q = p + len / 2
        const vr = re[q]! * cr - im[q]! * ci, vi = re[q]! * ci + im[q]! * cr
        re[q] = re[p]! - vr; im[q] = im[p]! - vi
        re[p] = re[p]! + vr; im[p] = im[p]! + vi
      }
    }
  }
}

// Carriers per algorithm, OP numbers as on the page (the chart in fm-main.js).
const CARRIERS = [[1], [1], [1], [1, 2, 4], [1, 2, 3, 5], [1, 2, 3, 4, 5], [1, 3, 5], [1, 2, 3, 4, 5, 6]]

describe('FM synth sound', () => {
  it('routes every algorithm as its chart says: the right carriers, no dead operators', () => {
    const N = 9600
    for (let a = 0; a < 8; a++) {
      const heardAlone: number[] = []
      for (let i = 0; i < 6; i++) {
        const { out } = render(patch(a, [i]), [noteOn(0)], N)
        let e = 0
        for (let k = 2400; k < N; k++) e += out[k]! * out[k]!
        if (e > 1e-9) heardAlone.push(i + 1)
      }
      expect(heardAlone, `algorithm ${a + 1} carriers`).toEqual(CARRIERS[a])

      const all = render(patch(a, [0, 1, 2, 3, 4, 5]), [noteOn(0)], N).out
      for (let i = 0; i < 6; i++) {
        const without = render(patch(a, [0, 1, 2, 3, 4, 5].filter(x => x !== i)), [noteOn(0)], N).out
        let d = 0
        for (let k = 0; k < N; k++) d = Math.max(d, Math.abs(all[k]! - without[k]!))
        expect(d, `algorithm ${a + 1}: OP${i + 1} must affect the output`).toBeGreaterThan(1e-6)
      }
    }
  })

  it('full OP6 feedback stays a clean buzz (no folded limit-cycle whine)', () => {
    // OP6 alone as a carrier (algorithm 8), feedback 1 — the DX7's buzzy saw.
    // Its harmonics fall off ~1/n, so above 12 kHz at C3 holds well under 1 %
    // of the energy. The folded limit cycle put 24-57 % there (at 16 kHz).
    const note = 48, N = 16384, from = 4800
    const { out } = render(patch(7, [5], 1, 1), [noteOn(0, note)], from + N)
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let k = 0; k < N; k++) re[k] = out[from + k]! * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / N))
    fft(re, im)
    let total = 0, high = 0
    for (let k = 4; k < N / 2; k++) {        // skip DC
      const pw = re[k]! * re[k]! + im[k]! * im[k]!
      total += pw
      if (k * SR / N > 12000) high += pw
    }
    expect(high / total).toBeLessThan(0.02)
  })

  it('re-striking a still-ringing voice does not click', () => {
    // Pad-like patch, key released and re-struck while it rings — the voice
    // pools hand back the same (lowest free) voice.
    const p = { ...patch(6, [0, 1, 2, 3, 4, 5]), feedback: 0.3 }
    p.ops.forEach(o => { o.attack = 0.05; o.release = 1 })
    const at = 188 * 128             // block-aligned: messages land at block starts
    const { out } = render(p, [noteOn(0, 36), noteOff(19200), noteOn(at, 36)], at + 4800)
    let before = 0, after = 0
    for (let k = at - 1440; k < at; k++) before = Math.max(before, Math.abs(out[k]! - out[k - 1]!))
    for (let k = at; k < at + 96; k++) after = Math.max(after, Math.abs(out[k]! - out[k - 1]!))
    // Phase reset made this step ~30 dB larger than anything in the waveform.
    expect(after).toBeLessThan(before * 2)
  })

  it('a preset is the whole patch: FX and LFO shape do not leak from the previous one', () => {
    const p = new FM()
    const msg = (m: unknown) => p.port.onmessage!({ data: m })
    msg({ type: 'preset', params: { ...patch(6, [0, 1]), lfoWaveform: 2 },
      fx: { chorus: { enabled: true }, reverb: { enabled: true, roomSize: 0.9, mix: 0.3 } } })
    expect(p.reverb.enabled).toBe(true)
    msg({ type: 'preset', params: patch(6, [0, 1]), fx: {} })
    expect(p.reverb.enabled).toBe(false)
    expect(p.chorus.enabled).toBe(false)
    expect(p.params.lfoWaveform).toBe(0)
  })
})
