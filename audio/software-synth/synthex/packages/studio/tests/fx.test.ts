// The studio's effects and mixer: the DSP (public/fx/fx-dsp.js), its
// worklet host (public/fx/fx-processor.js), the definitions the UI and the
// project file use (src/lib/fx.ts), and the routing — inserts, pre/post
// sends, returns, master — as scripts/render-song.ts mirrors it.

import { describe, it, expect, beforeAll } from 'vitest'
import { FX_DEFS, resolveParams, defaultReturns, type FxKind } from '../src/lib/fx.ts'
import { DEMOS } from '../src/lib/demos.ts'
import type { Project } from '../src/lib/project.ts'

const SR = 48000
const B = 128

interface Effect {
  set(name: string, value: number): boolean
  setTempo(bpm: number): void
  process(L: Float32Array, R: Float32Array, n: number): void
  tail(): number
}
let dsp: { createEffect(kind: string, sr: number): Effect; EFFECT_PARAMS: Record<string, string[]> }

beforeAll(async () => {
  dsp = await import('../public/fx/fx-dsp.js') as typeof dsp
})

const KINDS = FX_DEFS.map(d => d.kind)
const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-30))

function make(kind: FxKind, over: Record<string, number> = {}, context: 'insert' | 'return' = 'insert'): Effect {
  const fx = dsp.createEffect(kind, SR)
  for (const [k, v] of Object.entries({ ...resolveParams({ kind }, context), ...over })) fx.set(k, v)
  return fx
}
function run(fx: Effect, inL: Float32Array, inR = inL): [Float32Array, Float32Array] {
  const L = inL.slice(), R = inR.slice()
  for (let i = 0; i < L.length; i += B) fx.process(L.subarray(i, i + B), R.subarray(i, i + B), Math.min(B, L.length - i))
  return [L, R]
}
function noise(n: number, amp = 0.3, seed = 7): Float32Array {
  let s = seed
  return Float32Array.from({ length: n }, () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 * 2 - 1) * amp)
}
const impulse = (n: number) => { const x = new Float32Array(n); x[0] = 1; return x }
const energy = (x: Float32Array, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i]! ** 2; return e }

/** RT60 by Schroeder backward integration, fitted over -5..-35 dB. */
function rt60(ir: Float32Array): number {
  const e = new Float64Array(ir.length)
  let acc = 0
  for (let i = ir.length - 1; i >= 0; i--) { acc += ir[i]! ** 2; e[i] = acc }
  let a = -1, b = -1
  for (let i = 0; i < ir.length; i++) {
    const d = 10 * Math.log10(e[i]! / e[0]!)
    if (a < 0 && d <= -5) a = i
    if (d <= -35) { b = i; break }
  }
  return 2 * (b - a) / SR
}

describe('effect definitions', () => {
  it('name exactly the parameters the DSP takes', () => {
    for (const d of FX_DEFS) {
      expect(d.params.map(p => p.id).sort(), d.kind).toEqual([...dsp.EFFECT_PARAMS[d.kind]!].sort())
      const fx = dsp.createEffect(d.kind, SR)
      for (const p of d.params) expect(fx.set(p.id, p.def), `${d.kind}.${p.id}`).toBe(true)
      expect(fx.set('nonsense', 1)).toBe(false)
    }
  })

  it('keep defaults and presets inside the controls\' ranges', () => {
    for (const d of FX_DEFS) {
      for (const p of d.params) expect(p.def >= p.min && p.def <= p.max, `${d.kind}.${p.id} default`).toBe(true)
      for (const pr of d.presets) {
        for (const [k, v] of Object.entries(pr.params)) {
          const p = d.params.find(x => x.id === k)
          expect(p, `${d.kind} preset ${pr.name}: ${k}`).toBeDefined()
          expect(v >= p!.min && v <= p!.max, `${d.kind} preset ${pr.name}: ${k}=${v}`).toBe(true)
        }
      }
    }
  })

  it('make a return 100 % wet whatever the preset says', () => {
    for (const d of FX_DEFS) for (const pr of d.presets) {
      expect(resolveParams({ kind: d.kind, preset: pr.name }, 'return')['mix']).toBe(1)
    }
    expect(resolveParams({ kind: 'hall', params: { mix: 0.4 } }, 'return')['mix']).toBe(0.4)
  })
})

describe('effect DSP', () => {
  it('passes the dry signal untouched at mix 0', () => {
    const x = noise(SR / 2)
    for (const kind of KINDS) {
      const [L] = run(make(kind, { mix: 0 }), x)
      let maxDiff = 0
      for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(L[i]! - x[i]!))
      expect(maxDiff, kind).toBe(0)
    }
  })

  // The decay knob is the time to fall 60 dB. Measured on the impulse
  // response with damping 0 (damping shortens the highs by design).
  it('reverbs decay in the time their Decay knob says', () => {
    for (const kind of ['hall', 'room', 'plate'] as const) {
      for (const decay of [0.8, 2, 5]) {
        const n = Math.round(SR * (decay * 2 + 0.5))
        const [L, R] = run(make(kind, { decay, damping: 0, predelay: 0, lowcut: 20, highcut: 20000 }, 'return'), impulse(n))
        const ir = L.map((v, i) => (v + R[i]!) / 2)
        const t = rt60(ir)
        expect(Math.abs(t / decay - 1), `${kind} decay ${decay}: measured ${t.toFixed(2)} s`).toBeLessThan(0.12)
      }
    }
  })

  // A return at unity fader should not jump out of the mix or vanish into
  // it: steady noise in, the wet signal within 3 dB of the input.
  it('reverbs come out of a return at about the level that went in', () => {
    const x = noise(SR * 6)
    for (const kind of ['hall', 'room', 'plate'] as const) {
      const [L, R] = run(make(kind, {}, 'return'), x)
      const ratio = db((energy(L, SR * 3) + energy(R, SR * 3)) / 2 / energy(x, SR * 3))
      expect(Math.abs(ratio), `${kind}: ${ratio.toFixed(1)} dB`).toBeLessThan(3)
    }
  })

  it('reverbs and choruses turn a mono source into a wide one', () => {
    const x = noise(SR * 3)
    for (const kind of ['hall', 'room', 'plate', 'chorus', 'ensemble'] as const) {
      const [L, R] = run(make(kind, {}, 'return'), x)
      let c = 0
      for (let i = SR; i < x.length; i++) c += L[i]! * R[i]!
      const corr = c / Math.sqrt(energy(L, SR) * energy(R, SR))
      expect(corr, kind).toBeLessThan(0.5)
    }
    // Width 0 folds a reverb to mono.
    const [L, R] = run(make('hall', { width: 0 }, 'return'), x)
    for (let i = SR; i < SR + 1000; i++) expect(L[i]).toBeCloseTo(R[i]!, 6)
  })

  it('stays finite and bounded at its most extreme settings', () => {
    const x = noise(SR * 4, 0.9)
    const extremes: Record<FxKind, Record<string, number>> = {
      chorus: { feedback: 0.9, depth: 8, rate: 10 },
      ensemble: { depth: 6, shimmer: 1 },
      delay: { feedback: 0.95, sync: 0, time: 1, lowcut: 20, highcut: 20000 },
      plate: { decay: 15, size: 2, damping: 0, mod: 1 },
      hall: { decay: 15, size: 2, damping: 0, mod: 1 },
      room: { decay: 4, size: 1, damping: 0 },
      flanger: { feedback: 0.95, manual: 10, depth: 1, rate: 20 },
      phaser: { feedback: 0.9, stages: 3, depth: 4, rate: 20 },
      tremolo: { depth: 1, shape: 2, rate: 20, smooth: 0.1 },
      autofilter: { resonance: 1, lfoDepth: 4, envDepth: 5, sensitivity: 1, rate: 20, shape: 5 },
      drive: { drive: 40, type: 2, output: 12 },
      lofi: { rate: 500, bits: 2, drive: 24, noise: -24 },
      gated: { time: 1000, shape: 1, diffusion: 1 },
      shimmer: { shimmer: 0.85, decay: 20, size: 2, damping: 0, interval: 4 },
      scatter: { speed: 2, ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`s${i + 1}`, 5 + (i % 7)])) },
    }
    for (const kind of KINDS) {
      const [L, R] = run(make(kind, { ...extremes[kind], mix: 1 }), x)
      let peak = 0, bad = 0
      for (let i = 0; i < L.length; i++) {
        if (!Number.isFinite(L[i]!) || !Number.isFinite(R[i]!)) bad++
        peak = Math.max(peak, Math.abs(L[i]!), Math.abs(R[i]!))
      }
      expect(bad, kind).toBe(0)
      expect(peak, kind).toBeLessThan(20)
    }
  })

  it('goes quiet within its reported tail once the input stops', () => {
    for (const kind of KINDS) {
      const fx = make(kind, { mix: 1 })
      const n = Math.round(SR * (fx.tail() + 1.5))
      const x = new Float32Array(n)
      x.set(noise(SR / 2, 0.5))
      const [L, R] = run(fx, x)
      const start = Math.round(SR * (0.5 + fx.tail()))
      const lvl = db((energy(L, start) + energy(R, start)) / (n - start) / (energy(x, 0, SR / 2) / (SR / 2)))
      expect(lvl, `${kind} after ${fx.tail().toFixed(2)} s`).toBeLessThan(-55)
    }
  })

  it('echoes on the beat: a synced dotted eighth at 120 BPM repeats every 375 ms', () => {
    const fx = make('delay', { division: 6, feedback: 0.5, wobble: 0, lowcut: 20, highcut: 20000, mix: 1 })
    fx.setTempo(120)
    const [L] = run(fx, impulse(SR))
    let peakAt = 0
    for (let i = 1; i < SR / 2; i++) if (Math.abs(L[i]!) > Math.abs(L[peakAt]!)) peakAt = i
    expect(Math.abs(peakAt - 0.375 * SR)).toBeLessThanOrEqual(2)
    // and follows a tempo change
    const fx2 = make('delay', { division: 8, feedback: 0, wobble: 0, lowcut: 20, highcut: 20000, mix: 1 })
    fx2.setTempo(100)
    const [L2] = run(fx2, impulse(SR))
    let p2 = 0
    for (let i = 1; i < SR; i++) if (Math.abs(L2[i]!) > Math.abs(L2[p2]!)) p2 = i
    expect(Math.abs(p2 - 0.6 * SR)).toBeLessThanOrEqual(2)
  })

  it('ping-pong puts the first echo on the left and the next on the right', () => {
    const fx = make('delay', { sync: 0, time: 100, feedback: 0.6, pingpong: 1, wobble: 0, lowcut: 20, highcut: 20000, mix: 1 })
    const [L, R] = run(fx, impulse(SR / 2))
    const around = (x: Float32Array, t: number) => energy(x, Math.round(t * SR) - 50, Math.round(t * SR) + 50)
    expect(around(L, 0.1)).toBeGreaterThan(100 * around(R, 0.1))
    expect(around(R, 0.2)).toBeGreaterThan(100 * around(L, 0.2))
  })
})

describe('fx-processor worklet', () => {
  interface Proc {
    port: { onmessage: ((e: { data: unknown }) => void) | null }
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
  }
  let Cls: new () => Proc
  beforeAll(async () => {
    const g = globalThis as unknown as Record<string, unknown>
    g['sampleRate'] = SR
    g['AudioWorkletProcessor'] = class { port = { onmessage: null, postMessage() { /* host */ } } }
    g['registerProcessor'] = (_: string, c: new () => Proc) => { Cls = c }
    await import('../public/fx/fx-processor.js')
  })
  const block = (p: Proc, x: Float32Array) => {
    const L = new Float32Array(B), R = new Float32Array(B)
    p.process([[x, x]], [[L, R]])
    return L
  }

  it('passes audio through an empty chain', () => {
    const p = new Cls()
    const x = noise(B)
    expect([...block(p, x)]).toEqual([...x])
  })

  it('keeps an effect\'s tail when the chain is re-sent around it', () => {
    const p = new Cls()
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    const hall = { id: 'a', kind: 'hall', params: resolveParams({ kind: 'hall' }, 'return'), bypass: false }
    send({ type: 'chain', slots: [hall] })
    block(p, noise(B, 0.5))
    for (let i = 0; i < 40; i++) block(p, new Float32Array(B))
    // Add a chorus in front: the hall's tail must carry on, not restart.
    send({ type: 'chain', slots: [{ id: 'b', kind: 'chorus', params: resolveParams({ kind: 'chorus' }, 'insert'), bypass: false }, hall] })
    expect(energy(block(p, new Float32Array(B)))).toBeGreaterThan(1e-8)
  })

  // A scatter whose step 0 is muted and the rest plain: where the silence
  // falls shows where it thinks the bar starts. 120 BPM: a step is 6000 samples.
  const muteStepZero = () => ({
    id: 'sc', kind: 'scatter', bypass: false,
    params: { ...resolveParams({ kind: 'scatter' }, 'insert'), ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`s${i + 1}`, i === 0 ? 8 : 0])) },
  })

  it('pins a step-locked effect to the song position it is sent', () => {
    ;(globalThis as unknown as Record<string, unknown>)['currentTime'] = 0
    const p = new Cls()
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    send({ type: 'chain', slots: [muteStepZero()] })
    send({ type: 'tempo', bpm: 120 })
    send({ type: 'pos', beat: 0, at: (2 * B) / SR })      // the bar starts two blocks from now
    const x = noise(B)
    expect([...block(p, x)]).toEqual([...x])              // still the bar before
    block(p, x)
    block(p, x)                                           // step 0 begins: the splice fades out
    expect(energy(block(p, x))).toBe(0)                   // muted
  })

  it('keeps a bypassed effect\'s clock running', () => {
    ;(globalThis as unknown as Record<string, unknown>)['currentTime'] = 0
    const p = new Cls()
    const send = (m: unknown) => p.port.onmessage!({ data: m })
    send({ type: 'chain', slots: [muteStepZero()] })
    send({ type: 'tempo', bpm: 120 })
    send({ type: 'pos', beat: 0, at: 0 })
    send({ type: 'bypass', id: 'sc', on: true })
    const x = noise(B)
    for (let i = 0; i < 750; i++) block(p, x)             // one bar exactly, bypassed
    send({ type: 'bypass', id: 'sc', on: false })
    block(p, x)                                           // step 0 of the next bar
    expect(energy(block(p, x))).toBe(0)
    for (let i = 0; i < 46; i++) block(p, x)              // 6144 samples in: step 1
    expect(energy(block(p, x))).toBeGreaterThan(0)
  })

  it('stops computing once silent past the longest tail', () => {
    const p = new Cls()
    p.port.onmessage!({ data: { type: 'chain', slots: [{ id: 'r', kind: 'room', params: resolveParams({ kind: 'room' }, 'return'), bypass: false }] } })
    block(p, noise(B, 0.5))
    const blocks = Math.ceil(SR * 2 / B)   // room tail is ~1.05 s
    for (let i = 0; i < blocks; i++) block(p, new Float32Array(B))
    const t0 = performance.now()
    for (let i = 0; i < 2000; i++) block(p, new Float32Array(B))
    const idleMs = performance.now() - t0
    expect(idleMs / 2000).toBeLessThan(0.05)   // a copy, not a reverb
  })
})

describe('mixer routing (render-song)', () => {
  let renderProject: (p: Project, loops: number) => Promise<{
    stems: { L: Float64Array }[]
    returns: { name: string; L: Float64Array; R: Float64Array }[]
    preLimiter: { L: Float64Array }
  }>
  beforeAll(async () => {
    renderProject = (await import('../scripts/render-song.ts')).renderProject as typeof renderProject
  })

  // One VA track, a single held chord; only the mixer settings vary.
  function project(over: Partial<Project['tracks'][number]>, busOver: Partial<Project> = {}): Project {
    const base = DEMOS[0]!.build()
    const src = base.tracks.find(t => t.kind === 'va')!
    const steps = Array.from({ length: 16 }, () => ({ note: null as number | null, velocity: 100 }))
    steps[0] = { note: 57, velocity: 100, length: 8, chord: [4, 7] } as never
    return {
      ...base, bpm: 120, masterLevel: 1, buses: defaultReturns(),
      tracks: [{ ...src, steps, level: 1, pan: 0, params: {}, inserts: [], sends: {}, muted: false, soloed: false, ...over }],
      ...busOver,
    }
  }
  // The VA's analog drift is random: seed it the same for every render, so
  // two renders differ only in what the test changes.
  const seeded = async (p: Project) => {
    let s = 12345
    const real = Math.random
    Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
    try { return await renderProject(p, 1) } finally { Math.random = real }
  }
  const hallEnergy = async (p: Project) => {
    const r = await seeded(p)
    const a = r.returns.find(x => x.name.startsWith('A'))!
    let e = 0
    for (let i = 0; i < a.L.length; i++) e += a.L[i]! ** 2 + a.R[i]! ** 2
    return e
  }

  it('a post-fader send follows the track fader; a pre-fader send does not', async () => {
    const full = await hallEnergy(project({ sends: { A: { level: 0.5 } } }))
    const halfFader = await hallEnergy(project({ level: 0.5, sends: { A: { level: 0.5 } } }))
    expect(db(halfFader / full)).toBeCloseTo(-6.02, 1)
    const pre = await hallEnergy(project({ level: 0.5, sends: { A: { level: 0.5, pre: true } } }))
    expect(db(pre / full)).toBeCloseTo(0, 1)
  }, 60_000)

  it('a muted track sends nothing; a return with no sends is silent', async () => {
    expect(await hallEnergy(project({ muted: true, sends: { A: { level: 1, pre: true } } }))).toBeLessThan(1e-12)
    expect(await hallEnergy(project({ sends: { B: { level: 1 } } }))).toBeLessThan(1e-12)
  }, 60_000)

  // The offline render must scatter where the studio does: on the song's steps.
  it('a scatter on the master is in step with the song', async () => {
    const steps = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`s${i + 1}`, i === 1 ? 8 : 0]))
    const r = await seeded(project({}, { masterInserts: [{ kind: 'scatter', params: steps }] }))
    const x = r.preLimiter.L, at = (step: number) => Math.round((0.06 + step * 0.125) * SR)
    const e = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i]! ** 2; return s }
    // The chord sounds from step 0 for 8 steps; step 1 is muted, 0 and 2 are not.
    expect(e(at(1) + 200, at(2))).toBe(0)
    expect(e(at(0) + 200, at(1))).toBeGreaterThan(1e-3)
    expect(e(at(2) + 200, at(3))).toBeGreaterThan(1e-3)
  }, 60_000)

  it('a version 1 project, with no buses or sends, mixes as it always did', async () => {
    const withBuses = project({})
    const v1: Project = { ...withBuses, version: 1 }
    delete v1.buses
    // Seeded, so they must agree to the sample.
    const a = await seeded(withBuses), b = await seeded(v1)
    expect([...b.stems[0]!.L]).toEqual([...a.stems[0]!.L])
    expect(b.returns.map(x => x.name)).toEqual(['A Hall', 'B Plate', 'C Echo'])
  }, 60_000)
})
