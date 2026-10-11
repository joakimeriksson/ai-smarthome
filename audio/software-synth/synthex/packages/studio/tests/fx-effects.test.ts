// Each newer effect, measured doing what its controls say: the flanger's
// sweep and its through-zero null, the phaser's notches, the filter's
// slopes and envelope, the tremolo's gate and equal-power pan, the drive's
// loudness match, the lo-fi's bits and aliasing, the gated reverb's burst,
// the shimmer's octave. fx.test.ts covers what every effect must do
// (definitions, dry at mix 0, stability, tail, routing).

import { describe, it, expect, beforeAll } from 'vitest'
import {
  resolveParams, fxDef, LFO_DIVISION_LABELS, LFO_SHAPES, SHIMMER_INTERVAL_LABELS,
  SCATTER_STEP_LABELS, SCATTER_STEP_SHORT, SCATTER_SPEED_LABELS, SCATTER_PADS, type FxKind,
} from '../src/lib/fx.ts'

const SR = 48000
const B = 128

interface Effect {
  set(name: string, value: number): boolean
  setTempo(bpm: number): void
  process(L: Float32Array, R: Float32Array, n: number): void
  tail(): number
  syncBeat?(beat: number, offsetSamples: number): void
  advance?(n: number): void
}
let dsp: {
  createEffect(kind: string, sr: number): Effect
  LFO_DIVISIONS: number[]
  SHIMMER_INTERVALS: number[]
  SCATTER_TYPES: string[]
  SCATTER_SPEEDS: number[]
}
beforeAll(async () => { dsp = await import('../public/fx/fx-dsp.js') as typeof dsp })

const make = (kind: FxKind, over: Record<string, number> = {}) => {
  const fx = dsp.createEffect(kind, SR)
  for (const [k, v] of Object.entries({ ...resolveParams({ kind }, 'insert'), ...over })) fx.set(k, v)
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
const sine = (n: number, hz: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / SR))
const impulse = (n: number) => { const x = new Float32Array(n); x[0] = 1; return x }
const energy = (x: Float32Array, a = 0, b = x.length) => { let e = 0; for (let i = a; i < b; i++) e += x[i]! ** 2; return e }
const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-30))

/** |H(f)| in dB of an impulse response. */
function gainAt(ir: Float32Array, hz: number): number {
  let re = 0, im = 0
  for (let i = 0; i < ir.length; i++) { const a = 2 * Math.PI * hz * i / SR; re += ir[i]! * Math.cos(a); im -= ir[i]! * Math.sin(a) }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-15)
}
/** Amplitude of a sinusoid at `hz` over x[a..b) (least squares). */
function amp(x: Float32Array, hz: number, a = 0, b = x.length): number {
  let c = 0, s = 0
  for (let i = a; i < b; i++) { const w = 2 * Math.PI * hz * i / SR; c += x[i]! * Math.cos(w); s += x[i]! * Math.sin(w) }
  return 2 * Math.hypot(c, s) / (b - a)
}

describe('LFO tables', () => {
  it('match the labels the editor shows', () => {
    expect(dsp.LFO_DIVISIONS.length).toBe(LFO_DIVISION_LABELS.length)
    expect(LFO_SHAPES.length).toBe(6)
    expect(dsp.SHIMMER_INTERVALS.length).toBe(SHIMMER_INTERVAL_LABELS.length)
    // 1 bar is 4 beats; 2 bars 8.
    expect(dsp.LFO_DIVISIONS[LFO_DIVISION_LABELS.indexOf('1 bar')]).toBe(4)
    expect(dsp.LFO_DIVISIONS[LFO_DIVISION_LABELS.indexOf('2 bars')]).toBe(8)
  })
})

describe('flanger', () => {
  /** The comb's delay over time: the autocorrelation peak in 50 ms windows. */
  function delays(y: Float32Array, from: number, to: number): number[] {
    const out: number[] = [], W = 2400
    for (let s = from; s + W + 400 < to; s += W) {
      let best = 0, bv = -Infinity
      for (let lag = 4; lag < 400; lag++) {
        let c = 0
        for (let i = 0; i < W; i++) c += y[s + i]! * y[s + i + lag]!
        if (c > bv) { bv = c; best = lag }
      }
      out.push(best / SR * 1000)
    }
    return out
  }

  it('sweeps its delay over manual x 2^(+-3 depth), exponentially', () => {
    // Manual 2 ms, depth 0.5: 0.707 to 5.66 ms.
    const fx = make('flanger', { manual: 2, depth: 0.5, feedback: 0, rate: 0.25, shape: 1, spread: 0, mix: 0.5 })
    const [L] = run(fx, noise(SR * 5))
    const d = delays(L, SR / 2, SR * 5)
    expect(Math.min(...d) / 0.707).toBeGreaterThan(0.9)
    expect(Math.min(...d) / 0.707).toBeLessThan(1.15)
    expect(Math.max(...d) / 5.66).toBeGreaterThan(0.9)
    expect(Math.max(...d) / 5.66).toBeLessThan(1.1)
  })

  it('negative feedback inverts the sweep: a notch at DC instead of a peak', () => {
    const at = (fb: number) => {
      const [L] = run(make('flanger', { depth: 0, manual: 1, feedback: fb, mix: 0.5 }), impulse(8192))
      return gainAt(L, 0)
    }
    expect(at(0.01)).toBeGreaterThan(-0.5)
    expect(at(-0.01)).toBeLessThan(-30)
  })

  // Measured with a slow sweep, so a 10 ms window sees the relative delay
  // move by a fraction of a sample: on a 500 Hz sine for the inverted null
  // (noise would leave its top octaves in the window), and on noise for the
  // non-inverted case (a sine is cancelled by any comb notch it meets).
  it('through-zero, inverted, cancels completely where the taps cross', () => {
    const minWindow = (fb: number, x: Float32Array) => {
      const fx = make('flanger', { tzf: 1, manual: 3, depth: 1, feedback: fb, rate: 0.05, shape: 1, spread: 0, mix: 0.5 })
      const [L] = run(fx, x)
      const W = 480, mean = energy(L, SR, SR * 7) / (SR * 6)
      let lo = Infinity
      for (let s = SR; s + W < SR * 7; s += W) lo = Math.min(lo, energy(L, s, s + W) / W)
      return db(lo / mean)
    }
    expect(minWindow(-0.01, sine(SR * 7, 500, 0.3))).toBeLessThan(-35)   // the zero-point null (at 5 s)
    expect(minWindow(0.01, noise(SR * 7))).toBeGreaterThan(-12)          // non-inverted never cancels
  })

  it('locks its sweep to the tempo when synced', () => {
    const fx = make('flanger', { sync: 1, division: LFO_DIVISION_LABELS.indexOf('1 bar'), manual: 2, depth: 0.5, feedback: 0, shape: 1, spread: 0, mix: 0.5 })
    fx.setTempo(60)   // 1 bar = 4 s
    const [L] = run(fx, noise(SR * 5))
    const d = delays(L, 0, SR * 5)
    // Triangle from the bottom: smallest delay at 0 and 4 s, largest at 2.
    const step = 0.05
    const near = (t: number) => d.slice(Math.round(t / step) - 2, Math.round(t / step) + 3)
    expect(Math.min(...near(4))).toBeLessThan(0.8)
    expect(Math.max(...near(2))).toBeGreaterThan(5)
  })
})

describe('phaser', () => {
  /** Notches deeper than -30 dB in the static response, 20 Hz-20 kHz. */
  function notches(stages: number): number {
    const [L] = run(make('phaser', { stages, depth: 0, center: 1000, feedback: 0, mix: 0.5 }), impulse(16384))
    const fs = Array.from({ length: 1200 }, (_, i) => 20 * Math.pow(1000, i / 1199))
    const g = fs.map(f => gainAt(L, f))
    let count = 0
    for (let i = 1; i < g.length - 1; i++) if (g[i]! < g[i - 1]! && g[i]! <= g[i + 1]! && g[i]! < -30) count++
    return count
  }
  it('digs one notch per pair of stages', () => {
    expect(notches(0)).toBe(2)   // 4 stages
    expect(notches(1)).toBe(3)   // 6
    expect(notches(2)).toBe(4)   // 8
    expect(notches(3)).toBe(6)   // 12
  })
})

describe('auto-filter', () => {
  const static_ = (over: Record<string, number>) =>
    run(make('autofilter', { lfoDepth: 0, envDepth: 0, cutoff: 1000, resonance: 0, mix: 1, ...over }), impulse(16384))[0]

  it('has 12 dB/oct Butterworth slopes at resonance 0, and a unity bandpass peak', () => {
    const lp = static_({ type: 0 })
    expect(gainAt(lp, 100)).toBeCloseTo(0, 0)
    expect(gainAt(lp, 1000)).toBeCloseTo(-3, 0)
    expect(Math.abs(gainAt(lp, 4000) + 24)).toBeLessThan(2)
    const hp = static_({ type: 2 })
    expect(gainAt(hp, 1000)).toBeCloseTo(-3, 0)
    expect(Math.abs(gainAt(hp, 250) + 24)).toBeLessThan(2)
    expect(gainAt(static_({ type: 1 }), 1000)).toBeCloseTo(0, 0)
    expect(gainAt(static_({ type: 3 }), 1000)).toBeLessThan(-40)
  })

  it('opens with the input level when the envelope follower is on', () => {
    const bright = (a: number) => {
      const fx = make('autofilter', { type: 0, cutoff: 300, resonance: 0.3, lfoDepth: 0, envDepth: 3, sensitivity: 1, attack: 1, release: 50, mix: 1 })
      const [L] = run(fx, noise(SR, a))
      // energy of the first difference relative to the signal: brightness
      let d = 0
      for (let i = SR / 2 + 1; i < SR; i++) d += (L[i]! - L[i - 1]!) ** 2
      return db(d / energy(L, SR / 2, SR))
    }
    expect(bright(0.5) - bright(0.005)).toBeGreaterThan(10)
  })
})

describe('tremolo', () => {
  it('a square at full depth gates the signal on and off', () => {
    const [L] = run(make('tremolo', { shape: 2, depth: 1, rate: 2, smooth: 1, sync: 0 }), sine(SR * 2, 440, 0.5))
    const W = 960
    let hi = 0, lo = Infinity
    for (let s = W; s + W < SR * 2; s += W) { const e = energy(L, s, s + W); hi = Math.max(hi, e); lo = Math.min(lo, e) }
    expect(db(hi / lo)).toBeGreaterThan(40)
  })

  // A 1/4 ramp at full depth is the sidechain pump: quietest on the beat.
  // Without the sync it would dip wherever its own clock happened to be.
  it('synced, it dips on the beat the transport gives it', () => {
    const fx = make('tremolo', { sync: 1, division: LFO_DIVISION_LABELS.indexOf('1/4'), shape: LFO_SHAPES.indexOf('Ramp up'), depth: 1, smooth: 1 })
    fx.setTempo(120)                    // a beat is 24000 samples
    fx.syncBeat!(0, 7000)               // beat 0 lands 7000 samples from now
    const [L] = run(fx, sine(SR * 2, 440, 0.5))
    const lvl = (a: number) => db(energy(L, a, a + 480) / 480)
    for (const beat of [7000, 31000, 55000]) {
      expect(lvl(beat + 300) - lvl(beat - 800), `beat at ${beat}`).toBeLessThan(-20)   // drops as the beat hits
      expect(lvl(beat + 12000) - lvl(beat + 300)).toBeGreaterThan(15)                  // and recovers
    }
    // advance() keeps it in step through an idle stretch.
    const fx2 = make('tremolo', { sync: 1, division: LFO_DIVISION_LABELS.indexOf('1/4'), shape: LFO_SHAPES.indexOf('Ramp up'), depth: 1, smooth: 1 })
    fx2.setTempo(120); fx2.syncBeat!(0, 0); fx2.advance!(24000 * 3 + 7000)
    const [M] = run(fx2, sine(SR, 440, 0.5))
    const lv2 = (a: number) => db(energy(M, a, a + 480) / 480)
    expect(lv2(17000 + 300) - lv2(17000 - 800)).toBeLessThan(-20)
  })

  it('at 180 degrees auto-pans at constant power', () => {
    const [L, R] = run(make('tremolo', { shape: 0, depth: 1, rate: 1, spread: 180, sync: 0 }), sine(SR * 2, 440, 0.5))
    const W = 480
    const sums: number[] = [], diffs: number[] = []
    for (let s = W; s + W < SR * 2; s += W) {
      sums.push(energy(L, s, s + W) + energy(R, s, s + W))
      diffs.push(db(energy(L, s, s + W) / energy(R, s, s + W)))
    }
    const mean = sums.reduce((a, b) => a + b) / sums.length
    for (const e of sums) expect(Math.abs(db(e / mean))).toBeLessThan(0.3)
    expect(Math.max(...diffs) - Math.min(...diffs)).toBeGreaterThan(40)
  })
})

describe('drive', () => {
  it('keeps a -12 dBFS sine at its level whatever the drive', () => {
    for (const type of [0, 1, 2]) {
      for (const drive of [0, 12, 24, 36]) {
        const x = sine(SR, 1000, 0.25)
        const [L] = run(make('drive', { type, drive, tone: 20000, output: 0 }), x)
        expect(Math.abs(db(energy(L, SR / 4) / energy(x, SR / 4))), `type ${type} drive ${drive}`).toBeLessThan(1)
      }
    }
  })

  it('adds harmonics as it is driven harder, oversampled so they barely fold back', () => {
    const thd = (drive: number) => {
      const x = sine(SR, 1000, 0.25)
      const [L] = run(make('drive', { type: 0, drive, tone: 20000 }), x)
      const f = amp(L, 1000, SR / 4)
      let h = 0
      for (let k = 3; k <= 9; k += 2) h += amp(L, 1000 * k, SR / 4) ** 2
      return 20 * Math.log10(Math.sqrt(h) / f)
    }
    expect(thd(24) - thd(6)).toBeGreaterThan(10)
    // A 7 kHz sine driven hard: its 5th harmonic (35 kHz) would fold to
    // 13 kHz at the base rate; at 2x it lands above the halfband's cut.
    const x = sine(SR, 7000, 0.25)
    const [L] = run(make('drive', { type: 0, drive: 24, tone: 20000 }), x)
    expect(20 * Math.log10(amp(L, 13000, SR / 4) / amp(L, 7000, SR / 4))).toBeLessThan(-35)
  })
})

describe('lo-fi', () => {
  it('quantises to 6 dB of signal-to-noise per bit', () => {
    for (const bits of [4, 8, 12]) {
      const x = sine(SR, 997, 0.999)
      const [L] = run(make('lofi', { rate: 48000, bits, tone: 20000, antialias: 0, drive: 0 }), x)
      // Remove the fitted sine; what is left is the quantisation noise.
      let c = 0, s = 0
      for (let i = 1000; i < SR; i++) { const w = 2 * Math.PI * 997 * i / SR; c += L[i]! * Math.cos(w); s += L[i]! * Math.sin(w) }
      c *= 2 / (SR - 1000); s *= 2 / (SR - 1000)
      let sig = 0, res = 0
      for (let i = 1000; i < SR; i++) {
        const w = 2 * Math.PI * 997 * i / SR, fit = c * Math.cos(w) + s * Math.sin(w)
        sig += fit * fit; res += (L[i]! - fit) ** 2
      }
      const snr = db(sig / res), theory = 6.02 * bits + 1.76
      expect(Math.abs(snr - theory), `${bits} bits: ${snr.toFixed(1)} dB`).toBeLessThan(3)
    }
  })

  it('aliases at a low rate, and the anti-alias filter stops it', () => {
    // 6 kHz into 8 kHz sampling folds to 2 kHz.
    const alias = (aa: number) => {
      const x = sine(SR, 6000, 0.5)
      const [L] = run(make('lofi', { rate: 8000, bits: 16, tone: 20000, antialias: aa }), x)
      return 20 * Math.log10(amp(L, 2000, SR / 4) / 0.5)
    }
    expect(alias(0)).toBeGreaterThan(-12)
    expect(alias(1)).toBeLessThan(alias(0) - 15)
  })
})

describe('gated reverb', () => {
  const burst = (over: Record<string, number>) => {
    const [L, R] = run(make('gated', { predelay: 0, time: 300, lowcut: 20, highcut: 20000, mix: 1, ...over }), impulse(SR))
    return L.map((v, i) => (v + R[i]!) / 2)
  }
  const ms = (t: number) => Math.round(t * SR / 1000)

  it('lasts its Time and then stops - the same on every hit', () => {
    const ir = burst({ shape: 0 })
    expect(db(energy(ir, ms(360)) / energy(ir))).toBeLessThan(-40)
    // Flat: the two halves carry about the same energy.
    expect(Math.abs(db(energy(ir, ms(150), ms(300)) / energy(ir, 0, ms(150))))).toBeLessThan(3)
  })

  it('Shape tilts it: rising is reverse, falling is a cut-off room', () => {
    const rise = burst({ shape: -1 }), fall = burst({ shape: 1 })
    expect(db(energy(rise, ms(150), ms(300)) / energy(rise, 0, ms(150)))).toBeGreaterThan(6)
    expect(db(energy(fall, 0, ms(150)) / energy(fall, ms(150), ms(300)))).toBeGreaterThan(6)
  })

  it('comes out at the level that went in', () => {
    const x = noise(SR * 3)
    const [L, R] = run(make('gated', { mix: 1, lowcut: 20, highcut: 20000 }), x)
    expect(Math.abs(db((energy(L, SR) + energy(R, SR)) / 2 / energy(x, SR)))).toBeLessThan(2)
  })
})

describe('shimmer', () => {
  /**
   * Power near f (within 3 % ) in the tail, after a 1 s tone at 440 Hz stops,
   * from Hann-windowed 4096-sample frames: a pitch shifter's crossfades jump
   * phase every 40 ms, which a single coherent fit would average away.
   */
  const tail = (over: Record<string, number>, f: number) => {
    const n = SR * 4, x = new Float32Array(n)
    x.set(sine(SR, 440, 0.3))
    const [L, R] = run(make('shimmer', { mix: 1, decay: 4, ...over }), x)
    const N = 4096
    let p = 0
    for (let s = Math.round(SR * 1.2); s + N < SR * 3; s += N / 2) {
      let best = 0
      for (let df = -0.03; df <= 0.03; df += 0.005) {
        let re = 0, im = 0
        for (let i = 0; i < N; i++) {
          const w = (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)) * (L[s + i]! + R[s + i]!) / 2, a = 2 * Math.PI * f * (1 + df) * i / SR
          re += w * Math.cos(a); im -= w * Math.sin(a)
        }
        best = Math.max(best, re * re + im * im)
      }
      p += best
    }
    return 10 * Math.log10(p + 1e-30)
  }
  it('feeds its tail back an interval up: an octave by default', () => {
    expect(tail({ shimmer: 0.6 }, 880) - tail({ shimmer: 0.6 }, 440)).toBeGreaterThan(-15)
    expect(tail({ shimmer: 0 }, 880) - tail({ shimmer: 0 }, 440)).toBeLessThan(-30)
  })
  it('follows the Interval: a fifth up', () => {
    const fifth = 440 * Math.pow(2, 7 / 12)
    expect(tail({ shimmer: 0.6, interval: 1 }, fifth) - tail({ shimmer: 0, interval: 1 }, fifth)).toBeGreaterThan(20)
  })
})

describe('scatter', () => {
  // 120 BPM: a 1/16 step is exactly 6000 samples at 48 kHz.
  const STEP = 6000, FADE = 96
  const [P, L16, R32, R64, REV, GAT, MUT, HLF, STP, DBL] = [0, 2, 3, 5, 6, 7, 8, 9, 10, 11]
  /** A scatter playing `steps` (padded with plain steps), in step with sample 0. */
  const scatter = (steps: number[], over: Record<string, number> = {}) => {
    const all = [...steps, ...new Array<number>(16).fill(P)].slice(0, 16)
    const fx = make('scatter', { ...Object.fromEntries(all.map((v, i) => [`s${i + 1}`, v])), speed: 1, mix: 1, ...over })
    fx.setTempo(120)
    return fx
  }
  /** x[a..b) and y[c..) agree exactly. */
  const same = (y: Float32Array, c: number, x: Float32Array, a: number, b: number) => {
    for (let i = a; i < b; i++) if (y[c + i - a] !== x[i]) return false
    return true
  }
  /** Frequency by zero crossings over [a, b). */
  const zc = (x: Float32Array, a: number, b: number) => {
    let n = 0
    for (let i = a + 1; i < b; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++
    return n / 2 / ((b - a) / SR)
  }

  it('names every step type and step length the DSP has', () => {
    expect(SCATTER_STEP_LABELS.length).toBe(dsp.SCATTER_TYPES.length)
    expect(SCATTER_STEP_SHORT.length).toBe(dsp.SCATTER_TYPES.length)
    expect(SCATTER_SPEED_LABELS.length).toBe(dsp.SCATTER_SPEEDS.length)
    expect(dsp.SCATTER_SPEEDS[SCATTER_SPEED_LABELS.indexOf('1/16')]).toBe(0.25)
    expect(SCATTER_PADS.length).toBe(8)
    expect(fxDef('scatter').params.filter(p => p.group === 'steps').length).toBe(16)
  })

  it('a pattern of plain steps is the input, bit for bit', () => {
    const x = noise(STEP * 40)
    const [L] = run(scatter([]), x)
    expect(same(L, 0, x, 0, x.length)).toBe(true)
  })

  it('a loop plays its first step live, then repeats it for the rest of the run', () => {
    const x = noise(STEP * 16)
    const [L] = run(scatter([L16, L16, L16, L16]), x)
    expect(same(L, 0, x, 0, STEP - FADE)).toBe(true)                       // live
    for (const k of [1, 2, 3]) expect(same(L, k * STEP + FADE, x, FADE, STEP - FADE), `repeat ${k}`).toBe(true)
    expect(same(L, 4 * STEP + FADE, x, 4 * STEP + FADE, 16 * STEP)).toBe(true)   // back to live
  })

  it('a roll repeats the START of its step: 1/32 twice, 1/64 four times', () => {
    const x = noise(STEP * 16)
    const [L] = run(scatter([R32, R64]), x)
    expect(same(L, STEP / 2 + FADE, x, FADE, STEP / 2 - FADE)).toBe(true)
    const q = STEP / 4
    for (const k of [1, 2, 3]) expect(same(L, STEP + k * q + FADE, x, STEP + FADE, STEP + q - FADE), `1/64 #${k}`).toBe(true)
  })

  it('reverse plays what came before the run, backwards', () => {
    const x = noise(STEP * 16)
    const [L] = run(scatter([P, P, P, P, REV, REV, REV, REV]), x)
    const s = 4 * STEP
    for (let t = FADE; t < 4 * STEP - FADE; t += 37) expect(L[s + t]).toBe(x[s - 1 - t])
  })

  it('gate passes the first half of each step; mute passes nothing', () => {
    const x = noise(STEP * 16)
    const [L] = run(scatter([GAT, MUT]), x)
    expect(same(L, FADE, x, FADE, STEP / 2 - FADE)).toBe(true)
    expect(energy(L, STEP / 2 + 1, STEP)).toBe(0)
    expect(energy(L, STEP + FADE, 2 * STEP)).toBe(0)
  })

  it('half speed drops an octave, double speed rises one, tape stop slows to nothing', () => {
    const x = sine(STEP * 32, 1000, 0.5)
    const all = (t: number) => run(scatter(new Array<number>(16).fill(t)), x)[0]
    expect(zc(all(HLF), STEP * 4, STEP * 12)).toBeCloseTo(500, -1)
    // Double speed starts a run-length back, so measure in the second bar,
    // where there is a first bar to read.
    expect(zc(all(DBL), STEP * 20, STEP * 28)).toBeCloseTo(2000, -1)
    // Tape stop over the 16-step run: speed 1 - t/T, so 500 Hz half way.
    const stop = all(STP)
    expect(Math.abs(zc(stop, STEP * 7.5, STEP * 8.5) - 500)).toBeLessThan(40)
    expect(zc(stop, STEP * 1, STEP * 2)).toBeGreaterThan(850)
    expect(db(energy(stop, STEP * 15.9, STEP * 16) / energy(stop, 0, STEP * 0.1))).toBeLessThan(-30)
  })

  it('leaves no click at a splice: the largest jump stays near the signal\'s own', () => {
    // A 100 Hz sine moves 0.0065 per sample at most; a hard splice would jump up to 1.
    const x = sine(STEP * 16, 100, 0.5)
    const glitch = fxDef('scatter').presets.find(p => p.name === 'Glitch')!
    const fx = make('scatter', { ...glitch.params, mix: 1 })
    fx.setTempo(120)
    const [L] = run(fx, x)
    let jump = 0
    for (let i = 1; i < L.length; i++) jump = Math.max(jump, Math.abs(L[i]! - L[i - 1]!))
    expect(jump).toBeLessThan(0.03)
  })

  it('locks to the song: syncBeat puts step 0 where the transport says', () => {
    const x = noise(STEP * 16)
    const fx = scatter([MUT])
    fx.syncBeat!(0, 3000)          // beat 0 is 3000 samples from now
    const [L] = run(fx, x)
    expect(same(L, 0, x, 0, 3000)).toBe(true)                 // the bar before: plain
    expect(energy(L, 3000 + FADE, 3000 + STEP)).toBe(0)       // step 0: mute
    expect(same(L, 3000 + STEP + FADE, x, 3000 + STEP + FADE, 3000 + 2 * STEP)).toBe(true)
    // A beat position: beat 1 (step 4) now puts step 0 twelve steps on.
    const fx2 = scatter([MUT])
    fx2.syncBeat!(1, 0)
    const [M] = run(fx2, x)
    expect(energy(M, 12 * STEP + FADE, 13 * STEP)).toBe(0)
    expect(energy(M, 0, STEP)).toBeGreaterThan(0)
  })

  it('follows the tempo and the step length', () => {
    const x = noise(48000 * 2)
    const fx = scatter([MUT])
    fx.setTempo(60)                // steps of 12000 samples
    const [L] = run(fx, x)
    expect(energy(L, FADE, 12000)).toBe(0)
    expect(energy(L, 12000 + FADE, 13000)).toBeGreaterThan(0)
    const [M] = run(scatter([MUT], { speed: 0 }), x)      // 1/8 steps at 120 BPM
    expect(energy(M, FADE, 12000)).toBe(0)
  })

  it('forgets its buffer while idle or bypassed, and keeps time', () => {
    const fx = scatter([P, P, P, P, REV, REV, REV, REV])
    run(fx, noise(STEP * 4))               // four steps of noise recorded
    fx.advance!(STEP * 16)                 // a bar passes unprocessed
    // In step again at step 4: the reverse run has nothing to play back.
    const [L] = run(fx, new Float32Array(STEP * 12))
    expect(energy(L)).toBe(0)
    // And the clock ran: step 0 of the NEXT bar is 12 steps on.
    const fx2 = scatter([MUT])
    fx2.advance!(STEP * 4)
    const x = noise(STEP * 16)
    const [M] = run(fx2, x)
    expect(energy(M, 12 * STEP + FADE, 13 * STEP)).toBe(0)
    expect(energy(M, 11 * STEP, 12 * STEP - FADE)).toBeGreaterThan(0)
  })

  it('punches in and out on its mix without a click (the pads)', () => {
    const x = sine(STEP * 8, 100, 0.5)
    const fx = scatter([MUT, MUT, MUT, MUT, MUT, MUT, MUT, MUT], { mix: 0 })
    const L = x.slice(), R = x.slice()
    for (let i = 0; i < L.length; i += B) {
      if (i === 96 * B) fx.set('mix', 1)       // pad down, mid-note
      if (i === 192 * B) fx.set('mix', 0)      // pad up
      fx.process(L.subarray(i, i + B), R.subarray(i, i + B), B)
    }
    expect(same(L, 0, x, 0, 96 * B)).toBe(true)
    // The mix glides (10 ms): 100 ms after the pad goes down the dry signal is 80 dB down.
    expect(db(energy(L, 96 * B + 4800, 192 * B) / energy(x, 96 * B + 4800, 192 * B))).toBeLessThan(-80)
    let jump = 0
    for (let i = 1; i < L.length; i++) jump = Math.max(jump, Math.abs(L[i]! - L[i - 1]!))
    expect(jump).toBeLessThan(0.03)
  })
})
