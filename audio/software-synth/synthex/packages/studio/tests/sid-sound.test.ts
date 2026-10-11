// Sound regressions for the SID synth (js/sid-processor.js), found by
// measurement — none of them threw, all of them were audible:
//  - every note started ~33 ms late (the envelope rate counter wrapped: the
//    SID "ADSR bug" a player's hard restart exists to avoid);
//  - the filter envelope wrote an 8-bit cutoff into the 11-bit register, so
//    filter-env presets sat nearly closed;
//  - point-sampling the 1 MHz chip aliased a raw saw at C6 to only 26 dB
//    below its harmonics;
//  - key-up rewrote the control register from the patch, dropping SYNC/RING
//    for the release;
//  - a preset merged into the previous one, so a drum's noise layer leaked
//    into every preset after it.
//
// Own file: each vitest file gets its own module registry and stubs.

import { describe, it, expect, beforeAll } from 'vitest'

const SR = 48000

interface Env { envelope_counter: number; gate: number }
interface Wave { freq: number; sync: number; ring_mod: number; waveform: number }
interface Chip {
  voice: { envelope: Env; wave: Wave }[]
  filter: { fc: number }
}
interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m?: unknown): void }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  sids: Chip[]
}

let SID: new () => Proc

beforeAll(async () => {
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => { if (name === 'sid-synth-processor') SID = cls }
  await import('../../../../js/sid-processor.js')
})

function make(params: Record<string, unknown>) {
  const p = new SID()
  const msg = (m: unknown) => p.port.onmessage!({ data: m })
  msg({ type: 'preset', params })
  msg({ type: 'tableEnabled', value: false })
  const l = new Float32Array(128), r = new Float32Array(128)
  const run = (sec: number): Float64Array => {
    const out = new Float64Array(Math.ceil(sec * SR / 128) * 128)
    for (let i = 0; i < out.length; i += 128) {
      p.process([], [[l, r]])
      for (let k = 0; k < 128; k++) out[i + k] = l[k]!
    }
    return out
  }
  return { p, msg, run }
}

const note = (v: number, n: number) => ({ type: 'noteOn', voice: v, note: n, velocity: 100 })
const off = (v: number) => ({ type: 'noteOff', voice: v })

describe('SID synth sound', () => {
  it('starts a note on time, also when retriggered in the release', () => {
    const { p, msg, run } = make({ waveform: 0x41, ad: 0x09, sr: 0x89 })
    run(0.2)
    msg(note(0, 60)); run(0.3); msg(off(0)); run(0.1)
    const env = p.sids[0]!.voice[0]!.envelope
    const before = env.envelope_counter
    msg(note(0, 60))
    run(128 * 2 / SR)            // two blocks: 5.3 ms; attack 0 is 2 ms
    expect(env.envelope_counter, 'attack began').toBeGreaterThan(before + 100)
  })

  it('filter envelope drives the full 11-bit cutoff', () => {
    // cutoff 0x20 + 0.7 * 255 at the envelope peak -> 8-bit ~210 -> 11-bit ~1690
    const { p, msg, run } = make({ waveform: 0x21, filterOn: true, filterMode: 0x10,
      filterCutoff: 0x20, filterReso: 0, filterEnvAmt: 0.7, fltAd: 0x09, fltSr: 0xF0 })
    run(0.2); msg(note(0, 48)); run(0.06)
    expect(p.sids[0]!.filter.fc).toBeGreaterThan(1500)
  })

  it('keeps a raw saw at C6 clean of aliases', () => {
    const { p, msg, run } = make({ waveform: 0x21, ad: 0, sr: 0xF0, filterOn: false })
    run(0.2); msg(note(0, 84))
    const y = run(0.8)
    const f0 = p.sids[0]!.voice[0]!.wave.freq * 985248 / 16777216
    // Energy within +-16 Hz of each harmonic vs everything else, 50 Hz..18 kHz,
    // by direct DFT at 4 Hz spacing over a Blackman-Harris window.
    const from = Math.round(0.2 * SR), N = 12000
    const win = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      const t = 2 * Math.PI * i / (N - 1)
      win[i] = y[from + i]! * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t))
    }
    let harm = 0, rest = 0
    for (let f = 50; f < 18000; f += 4) {
      const c = 2 * Math.cos(2 * Math.PI * f / SR)
      let s1 = 0, s2 = 0
      for (let i = 0; i < N; i++) { const s = win[i]! + c * s1 - s2; s2 = s1; s1 = s }
      const pw = s1 * s1 + s2 * s2 - c * s1 * s2, k = Math.round(f / f0)
      if (k >= 1 && Math.abs(f - k * f0) <= 16) harm += pw; else rest += pw
    }
    expect(10 * Math.log10(rest / harm), 'inharmonic energy (dB)').toBeLessThan(-30)
  }, 60_000)

  it('keeps SYNC and RING through the release', () => {
    for (const bits of [{ hardSync: true }, { ringMod: true, waveform: 0x11 }]) {
      const { p, msg, run } = make({ waveform: 0x21, osc2EnvAmt: 0, ...bits })
      run(0.2); msg(note(0, 60)); run(0.1); msg(off(0)); run(0.02)
      const w = p.sids[0]!.voice[0]!.wave
      expect(w.sync || w.ring_mod, JSON.stringify(bits)).toBeTruthy()
      expect(p.sids[0]!.voice[0]!.envelope.gate).toBe(0)
    }
  })

  it('does not carry a previous preset into the next one', () => {
    const { p, msg, run } = make({ waveform: 0x41, layerOn: true, layerWave: 0x81, layerDetune: 40 })
    msg({ type: 'preset', params: { waveform: 0x41 } })
    run(0.2); msg(note(0, 60)); run(0.05)
    expect(p.sids[0]!.voice[1]!.envelope.gate, 'layer channel stays off').toBe(0)
  })

  it('does not thump when the filter is first switched on', () => {
    // Filter routing moves the 6581's DC level. Set at preset load (muted
    // while idle), not at the first note: the note's opening must not be
    // much louder than its body.
    const { msg, run } = make({ waveform: 0x41, ad: 0x00, sr: 0xF0 })
    run(0.3)
    msg({ type: 'preset', params: { waveform: 0x41, ad: 0x00, sr: 0xF0, filterOn: true,
      filterMode: 0x10, filterCutoff: 0xC0, filterReso: 2 } })
    const idle = run(0.3)
    msg(note(0, 60))
    const open = run(0.03), body = run(0.3)
    const pk = (a: Float64Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
    expect(pk(idle), 'silent while idle').toBeLessThan(0.01)
    expect(pk(open), 'opening vs body').toBeLessThan(pk(body) * 1.5)
  })
})
