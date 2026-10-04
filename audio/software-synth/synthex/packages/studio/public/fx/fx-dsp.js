// Studio effects: the DSP behind every insert slot and return bus in the
// studio's mixer.
//
// Plain JavaScript with no Web Audio. fx-processor.js runs it inside an
// AudioWorklet, and scripts/render-song.ts and the tests import this same
// file in Node, so what is measured offline is exactly what plays.
//
// Every effect has one shape:
//
//   new Effect(sampleRate)
//   .set(name, value)   one parameter; the names are Effect.PARAMS and must
//                       match FX_DEFS in src/lib/fx.ts (a test holds them
//                       together); returns false for an unknown name
//   .setTempo(bpm)      for tempo-synced effects; the rest ignore it
//   .process(L, R, n)   in place, on two Float32Arrays
//   .tail()             seconds of output left after the input stops
//   .reset()            clear every buffer and filter state
//
// and, for an effect that follows the song's position (Scatter, and the
// LFO effects when synced to the tempo), optionally:
//
//   .syncBeat(beat, n)  the song is at `beat` in n samples from now
//   .advance(n)         n samples pass without process() being called
//
// Dry/wet is an equal-power crossfade (`mix` 0..1): an insert at 0.5 keeps
// the dry signal at -3 dB, and a return sets mix 1 (wet only).

const TAU = 2 * Math.PI
// Added in recirculating loops so a decaying tail never lands in denormals,
// which are hundreds of times slower to compute on x86. -400 dB: inaudible.
const TINY = 1e-20

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** One-pole lowpass pole for a cutoff in Hz: y += (1 - a)(x - y). */
const lpPole = (hz, sr) => Math.exp(-TAU * clamp(hz, 1, sr * 0.49) / sr)

// ── Building blocks ──────────────────────────────────────────────────────

class DelayLine {
  constructor(maxSamples) {
    let size = 16
    while (size < maxSamples + 4) size <<= 1
    this.buf = new Float32Array(size)
    this.mask = size - 1
    this.w = 0
  }
  push(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask }
  /** The sample pushed d pushes ago (d = 1 is the last one). */
  at(d) { return this.buf[(this.w - d) & this.mask] }
  /** Fractional read, 4-point Hermite interpolation; d >= 2. */
  frac(d) {
    const i = Math.floor(d), f = d - i
    const b = this.buf, m = this.mask, w = this.w
    const xm1 = b[(w - i + 1) & m], x0 = b[(w - i) & m]
    const x1 = b[(w - i - 1) & m], x2 = b[(w - i - 2) & m]
    const c1 = 0.5 * (x1 - xm1)
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0
  }
  clear() { this.buf.fill(0) }
}

/** Schroeder allpass over a DelayLine that stores v[n] = x + g v[n-D]. */
function allpass(line, len, g, x) {
  const d = line.at(len)
  const v = x + g * d
  line.push(v)
  return d - g * v
}

/**
 * The equal-power dry/wet pair, smoothed so a moved knob does not click.
 * Until the first sample it jumps instead: an effect set up before it has
 * played starts at its settings, not on a glide from its defaults.
 */
class Mix {
  /**
   * `law` 'power' (equal-power, for reverbs and choruses, whose wet signal
   * is unlike the dry) or 'linear' (for effects whose wet signal is a
   * changed copy of the dry - flanger, phaser, filter, drive - where equal
   * power would add 3 dB at mid mix, and a 50/50 linear sum is what digs a
   * flanger's or phaser's notches).
   */
  constructor(sr, mix, law = 'power') {
    this.k = 1 - Math.exp(-1 / (0.01 * sr))     // ~10 ms
    this.law = law
    this.live = false
    this.set(mix)
  }
  set(mix) {
    const m = clamp(mix, 0, 1)
    // Exact at the ends: a return at mix 1 passes no dry signal at all.
    if (this.law === 'linear') { this.dryT = 1 - m; this.wetT = m }
    else {
      this.dryT = m >= 1 ? 0 : Math.cos(m * Math.PI / 2)
      this.wetT = m <= 0 ? 0 : Math.sin(m * Math.PI / 2)
    }
    if (!this.live) { this.dry = this.dryT; this.wet = this.wetT }
  }
  step() {
    this.live = true
    this.dry += (this.dryT - this.dry) * this.k
    this.wet += (this.wetT - this.wet) * this.k
  }
}

// ── Chorus ───────────────────────────────────────────────────────────────

/**
 * Bucket-brigade style chorus: one modulated delay per channel, the two
 * LFOs in anti-phase at full width (the Juno-60/106 arrangement: two BBDs,
 * one triangle LFO, inverted for the second). A mono source comes out wide;
 * a stereo one keeps its image. `tone` is the BBD's anti-alias lowpass, two
 * poles on the wet signal. With feedback it becomes a flanger.
 *
 * Juno reference settings (FX_DEFS presets): I = 0.513 Hz, II = 0.863 Hz,
 * both sweeping 1.54-5.15 ms; I+II = 9.75 Hz over 3.22-3.56 ms.
 */
export class Chorus {
  static PARAMS = ['rate', 'depth', 'delay', 'feedback', 'tone', 'width', 'shape', 'mix']

  constructor(sr) {
    this.sr = sr
    this.lines = [new DelayLine(Math.ceil(sr * 0.05)), new DelayLine(Math.ceil(sr * 0.05))]
    this.rate = 0.513; this.depth = 3.6; this.delay = 3.35; this.feedback = 0
    this.tone = 7500; this.width = 1; this.shape = 0
    this.mixer = new Mix(sr, 0.5)
    this.phase = 0
    this.lp = new Float64Array(4)
    this.last = new Float64Array(2)
    this.a = lpPole(this.tone, sr)
  }
  set(name, v) {
    if (!Chorus.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    if (name === 'tone') this.a = lpPole(this.tone, this.sr)
    return true
  }
  setTempo() {}
  tail() { return (this.delay + this.depth) / 1000 + (this.feedback > 0 ? 0.2 : 0.02) }
  reset() { for (const l of this.lines) l.clear(); this.lp.fill(0); this.last.fill(0) }

  lfo(p) {
    return this.shape >= 1 ? Math.sin(TAU * p) : 1 - 4 * Math.abs(p - 0.5)   // triangle, +1 at p = 0
  }

  process(L, R, n) {
    const msr = this.sr / 1000
    const center = this.delay * msr, swing = this.depth * msr / 2
    const inc = this.rate / this.sr, off = 0.5 * clamp(this.width, 0, 1)
    const a = this.a, fb = clamp(this.feedback, 0, 0.95), lp = this.lp, mx = this.mixer
    for (let i = 0; i < n; i++) {
      mx.step()
      const p = this.phase
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i]
        let q = p + ch * off
        if (q >= 1) q -= 1
        const line = this.lines[ch]
        let w = line.frac(Math.max(2, center + swing * this.lfo(q)))
        lp[2 * ch] += (1 - a) * (w - lp[2 * ch])
        lp[2 * ch + 1] += (1 - a) * (lp[2 * ch] - lp[2 * ch + 1])
        w = lp[2 * ch + 1]
        line.push(x + fb * w + TINY)
        const y = mx.dry * x + mx.wet * w
        if (ch) R[i] = y; else L[i] = y
      }
      this.phase = p + inc >= 1 ? p + inc - 1 : p + inc
    }
  }
}

// ── Ensemble ─────────────────────────────────────────────────────────────

/**
 * String ensemble: three taps on one delay line, each swept by a slow LFO
 * and a fast one, the three 120 degrees apart (the Solina / Eminent string
 * ensemble). The slow sweep gives the chorus, the fast one the shimmer.
 * The input is summed to mono and spread: left hears taps 1 and 2, right
 * taps 3 and 2.
 */
export class Ensemble {
  static PARAMS = ['rate', 'depth', 'shimmer', 'shimmerRate', 'delay', 'tone', 'mix']

  constructor(sr) {
    this.sr = sr
    this.line = new DelayLine(Math.ceil(sr * 0.05))
    this.rate = 0.63; this.depth = 2.2; this.shimmer = 0.24; this.shimmerRate = 6.1
    this.delay = 6; this.tone = 9000
    this.mixer = new Mix(sr, 0.55)
    this.ps = 0; this.pf = 0
    this.lp = new Float64Array(2)
    this.a = lpPole(this.tone, sr)
  }
  set(name, v) {
    if (!Ensemble.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    if (name === 'tone') this.a = lpPole(this.tone, this.sr)
    return true
  }
  setTempo() {}
  tail() { return (this.delay + this.depth) / 1000 + 0.02 }
  reset() { this.line.clear(); this.lp.fill(0) }

  process(L, R, n) {
    const msr = this.sr / 1000
    const center = this.delay * msr, slow = this.depth * msr / 2, fast = this.shimmer * msr / 2
    const is = this.rate / this.sr, iff = this.shimmerRate / this.sr
    const a = this.a, mx = this.mixer, line = this.line, lp = this.lp
    const third = TAU / 3
    for (let i = 0; i < n; i++) {
      mx.step()
      const x = 0.5 * (L[i] + R[i])
      line.push(x)
      const s = TAU * this.ps, f = TAU * this.pf
      const v0 = line.frac(Math.max(2, center + slow * Math.sin(s) + fast * Math.sin(f)))
      const v1 = line.frac(Math.max(2, center + slow * Math.sin(s + third) + fast * Math.sin(f + third)))
      const v2 = line.frac(Math.max(2, center + slow * Math.sin(s - third) + fast * Math.sin(f - third)))
      lp[0] += (1 - a) * ((2 * v0 + v1) / 3 - lp[0])
      lp[1] += (1 - a) * ((2 * v2 + v1) / 3 - lp[1])
      L[i] = mx.dry * L[i] + mx.wet * lp[0]
      R[i] = mx.dry * R[i] + mx.wet * lp[1]
      this.ps += is; if (this.ps >= 1) this.ps -= 1
      this.pf += iff; if (this.pf >= 1) this.pf -= 1
    }
  }
}

// ── Delay ────────────────────────────────────────────────────────────────

/** Note values the synced delay offers, in beats (FX_DEFS labels them). */
export const DELAY_DIVISIONS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4]

/**
 * Stereo echo, synced to the song's tempo or free in milliseconds. The
 * lowcut and highcut sit in the feedback path, so each repeat is thinner and
 * darker than the last, as on a tape or BBD echo. Ping-pong sends the (mono)
 * input to the left and bounces every repeat to the other side. `wobble` is
 * a slow wow on the read position.
 */
export class TempoDelay {
  static PARAMS = ['sync', 'division', 'time', 'feedback', 'pingpong', 'lowcut', 'highcut', 'wobble', 'mix']

  constructor(sr) {
    this.sr = sr
    const max = Math.ceil(sr * 4.2)
    this.lines = [new DelayLine(max), new DelayLine(max)]
    this.sync = 1; this.division = 6; this.time = 375; this.feedback = 0.35
    this.pingpong = 0; this.lowcut = 200; this.highcut = 7000; this.wobble = 0.1
    this.bpm = 120
    this.mixer = new Mix(sr, 0.25)
    this.d = this.target()
    // A time change glides (~80 ms, a tape echo's pitch bend) once playing;
    // before that it jumps, like the mix.
    this.glide = 1 - Math.exp(-1 / (0.08 * sr))
    this.live = false
    this.wp = 0
    this.hp = new Float64Array(4)     // per channel: previous input, previous output
    this.lpS = new Float64Array(2)
    this.coef()
  }
  target() {
    const beats = DELAY_DIVISIONS[clamp(Math.round(this.division), 0, DELAY_DIVISIONS.length - 1)]
    const sec = this.sync >= 0.5 ? beats * 60 / this.bpm : this.time / 1000
    return clamp(sec * this.sr, 4, this.sr * 4)
  }
  coef() {
    this.aLp = lpPole(this.highcut, this.sr)
    this.aHp = Math.exp(-TAU * clamp(this.lowcut, 1, this.sr * 0.49) / this.sr)
  }
  set(name, v) {
    if (!TempoDelay.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    this.coef()
    if (!this.live) this.d = this.target()
    return true
  }
  setTempo(bpm) {
    if (bpm > 0) this.bpm = bpm
    if (!this.live) this.d = this.target()
  }
  tail() {
    const d = this.target() / this.sr, fb = clamp(this.feedback, 0, 0.95)
    const repeats = fb > 0.001 ? Math.log(0.001) / Math.log(fb) : 1
    return Math.min(30, d * (repeats + 1) * (this.pingpong >= 0.5 ? 2 : 1))
  }
  reset() { for (const l of this.lines) l.clear(); this.hp.fill(0); this.lpS.fill(0) }

  /** The feedback-path filters: one-pole highpass then one-pole lowpass. */
  tone(ch, x) {
    const h = this.hp, o = 2 * ch
    const y = this.aHp * (h[o + 1] + x - h[o])
    h[o] = x; h[o + 1] = y
    this.lpS[ch] += (1 - this.aLp) * (y - this.lpS[ch])
    return this.lpS[ch]
  }

  process(L, R, n) {
    const fb = clamp(this.feedback, 0, 0.95), mx = this.mixer
    const t = this.target(), ping = this.pingpong >= 0.5
    const wob = clamp(this.wobble, 0, 1) * this.sr * 0.0015, winc = 0.6 / this.sr
    const [lL, lR] = this.lines
    this.live = true
    for (let i = 0; i < n; i++) {
      mx.step()
      this.d += (t - this.d) * this.glide
      const w = wob * Math.sin(TAU * this.wp)
      this.wp += winc; if (this.wp >= 1) this.wp -= 1
      const d = Math.max(2, this.d + w)
      const eL = this.tone(0, lL.frac(d)), eR = this.tone(1, lR.frac(d))
      const xL = L[i], xR = R[i]
      if (ping) {
        lL.push(0.5 * (xL + xR) + fb * eR + TINY)
        lR.push(fb * eL + TINY)
      } else {
        lL.push(xL + fb * eL + TINY)
        lR.push(xR + fb * eR + TINY)
      }
      L[i] = mx.dry * xL + mx.wet * eL
      R[i] = mx.dry * xR + mx.wet * eR
    }
  }
}

// ── Reverb: shared input stage ───────────────────────────────────────────

/**
 * Predelay, then a lowcut and a highcut on the input. The lowcut is two
 * one-pole highpasses (12 dB/oct, a mixing desk's reverb low cut): one pole
 * at 300 Hz left a drum plate still full of kick.
 */
class ReverbInput {
  constructor(sr) {
    this.sr = sr
    this.pre = new DelayLine(Math.ceil(sr * 0.52))
    this.hx = 0; this.hy = 0; this.hx2 = 0; this.hy2 = 0; this.l = 0
    this.set(20, 100, 12000)
  }
  set(predelayMs, lowcut, highcut) {
    this.preN = Math.max(1, Math.round(clamp(predelayMs, 0, 500) * this.sr / 1000))
    this.aHp = Math.exp(-TAU * clamp(lowcut, 1, this.sr * 0.49) / this.sr)
    this.aLp = lpPole(highcut, this.sr)
  }
  step(x) {
    this.pre.push(x)
    const p = this.pre.at(this.preN)
    const h = this.aHp * (this.hy + p - this.hx)
    this.hx = p; this.hy = h
    const h2 = this.aHp * (this.hy2 + h - this.hx2)
    this.hx2 = h; this.hy2 = h2
    this.l += (1 - this.aLp) * (h2 - this.l)
    return this.l
  }
  clear() { this.pre.clear(); this.hx = this.hy = this.hx2 = this.hy2 = this.l = 0 }
}

// ── Plate reverb ─────────────────────────────────────────────────────────

// Jon Dattorro, "Effect Design, Part 1: Reverberator and Other Filters"
// (J. Audio Eng. Soc., 1997): the figure-eight plate. Lengths are samples at
// his 29761 Hz, scaled to the running rate and by `size`.
const DT_RATE = 29761
const DT_IN = [142, 107, 379, 277]
const DT_IN_G = [0.75, 0.75, 0.625, 0.625]
//            mod AP, delay, AP,   delay   (per tank half)
const DT_L = [672, 4453, 1800, 3720]
const DT_R = [908, 4217, 2656, 3163]
// Output taps: [line, position, sign]; lines 0-2 are the left half's
// delay 1, allpass 2 and delay 2, 3-5 the right half's.
const DT_OUT_L = [[3, 266, 1], [3, 2974, 1], [4, 1913, -1], [5, 1996, 1], [0, 1990, -1], [1, 187, -1], [2, 1066, -1]]
const DT_OUT_R = [[0, 353, 1], [0, 3627, 1], [1, 1228, -1], [2, 2673, 1], [3, 2111, -1], [4, 335, -1], [5, 121, -1]]
const DT_EXCURSION = 16
const MAX_SIZE = 2

export class PlateReverb {
  static PARAMS = ['predelay', 'decay', 'size', 'damping', 'highcut', 'lowcut', 'diffusion', 'mod', 'width', 'mix']

  constructor(sr) {
    this.sr = sr
    const k = sr / DT_RATE
    const cap = (len) => new DelayLine(Math.ceil(len * k * MAX_SIZE) + 64)
    this.input = new ReverbInput(sr)
    this.inAp = DT_IN.map(len => cap(len))
    this.inLen = DT_IN.map(len => Math.max(1, Math.round(len * k)))
    // [modAP, delay1, AP2, delay2] for each half
    this.lt = DT_L.map(cap)
    this.rt = DT_R.map(cap)
    this.predelay = 10; this.decay = 2.2; this.size = 1; this.damping = 0.35
    this.highcut = 12000; this.lowcut = 120; this.diffusion = 1; this.mod = 0.5; this.width = 1
    this.mixer = new Mix(sr, 0.3)
    this.lpL = 0; this.lpR = 0; this.back = 0
    this.phase = 0
    this.update()
  }
  set(name, v) {
    if (!PlateReverb.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else { this[name] = Number(v); this.update() }
    return true
  }
  setTempo() {}
  tail() { return this.predelay / 1000 + this.decay * 1.2 + 0.2 }
  reset() {
    this.input.clear()
    for (const l of [...this.inAp, ...this.lt, ...this.rt]) l.clear()
    this.lpL = this.lpR = this.back = 0
  }

  update() {
    const k = this.sr / DT_RATE * clamp(this.size, 0.5, MAX_SIZE)
    this.input.set(this.predelay, this.lowcut, this.highcut)
    this.lLen = DT_L.map(len => Math.max(4, Math.round(len * k)))
    this.rLen = DT_R.map(len => Math.max(4, Math.round(len * k)))
    this.tapsL = DT_OUT_L.map(([line, pos, sign]) => [line, Math.max(1, Math.round(pos * k)), sign])
    this.tapsR = DT_OUT_R.map(([line, pos, sign]) => [line, Math.max(1, Math.round(pos * k)), sign])
    this.exc = clamp(this.mod, 0, 1) * 2 * DT_EXCURSION * this.sr / DT_RATE
    this.inG = DT_IN_G.map(g => g * clamp(this.diffusion, 0, 1))
    // Each half passes the decay gain twice per trip, so the amplitude falls
    // by decay^2 every half-loop; choose it to reach -60 dB in `decay` s.
    // That alone measured long at short settings and short at long ones
    // (0.7 s -> 0.83, 6 s -> 5.53: the input diffusion's build-up, and the
    // interpolated modulation's high-frequency loss), a straight line
    // 0.17 + 0.893 t; inverting it puts the measured RT60 on the knob.
    const half = (this.lLen.reduce((a, b) => a + b) + this.rLen.reduce((a, b) => a + b)) / 2
    const t = Math.max(0.1, (clamp(this.decay, 0.1, 60) - 0.17) / 0.893)
    this.g = Math.min(0.9999, Math.pow(0.001, half / (2 * t * this.sr)))
    this.dd2 = clamp(this.g + 0.15, 0.25, 0.5)
    // Tank damping: 0 is 18 kHz, 0.5 about 2.3 kHz, 1 about 280 Hz.
    this.aDamp = lpPole(18000 * Math.pow(2, -6 * clamp(this.damping, 0, 1)), this.sr)
  }

  /** The tank line that output tap `line` reads (0-2 left half, 3-5 right). */
  tapLine(line) {
    return line < 3 ? this.lt[line + 1] : this.rt[line - 2]
  }

  process(L, R, n) {
    const mx = this.mixer, g = this.g, a = this.aDamp, dd1 = -0.7, dd2 = this.dd2
    const lt = this.lt, rt = this.rt, lL = this.lLen, rL = this.rLen
    const inc = 1 / this.sr, exc = this.exc
    const width = clamp(this.width, 0, 1)
    for (let i = 0; i < n; i++) {
      mx.step()
      let x = this.input.step(0.5 * (L[i] + R[i]))
      for (let k = 0; k < 4; k++) x = allpass(this.inAp[k], this.inLen[k], this.inG[k], x)

      const s = Math.sin(TAU * this.phase)
      // Left half of the figure eight.
      let y = x + this.back * g
      {
        const d = lt[0].frac(Math.max(2, lL[0] + exc * s))
        const v = y - dd1 * d
        lt[0].push(v + TINY)
        y = d + dd1 * v
      }
      lt[1].push(y); y = lt[1].at(lL[1])
      this.lpL += (1 - a) * (y - this.lpL)
      y = allpass(lt[2], lL[2], dd2, this.lpL * g)
      lt[3].push(y); const leftOut = lt[3].at(lL[3])

      // Right half.
      let z = x + leftOut * g
      {
        const d = rt[0].frac(Math.max(2, rL[0] + exc * Math.cos(TAU * this.phase)))
        const v = z - dd1 * d
        rt[0].push(v + TINY)
        z = d + dd1 * v
      }
      rt[1].push(z); z = rt[1].at(rL[1])
      this.lpR += (1 - a) * (z - this.lpR)
      z = allpass(rt[2], rL[2], dd2, this.lpR * g)
      rt[3].push(z); this.back = rt[3].at(rL[3])

      let oL = 0, oR = 0
      for (const [line, pos, sign] of this.tapsL) oL += sign * this.tapLine(line).at(pos)
      for (const [line, pos, sign] of this.tapsR) oR += sign * this.tapLine(line).at(pos)
      oL *= PLATE_GAIN; oR *= PLATE_GAIN
      const mid = 0.5 * (oL + oR), side = 0.5 * (oL - oR) * width
      L[i] = mx.dry * L[i] + mx.wet * (mid + side)
      R[i] = mx.dry * R[i] + mx.wet * (mid - side)
      this.phase += inc; if (this.phase >= 1) this.phase -= 1
    }
  }
}
// Output level: Dattorro's 0.6 per tap sum, then calibrated so steady noise
// at the default settings comes out of a 100 % wet plate at the input's
// level (see tests/fx.test.ts, "wet level").
const PLATE_GAIN = 0.6

// ── Hall and room: a feedback delay network ──────────────────────────────

// Eight delay lines mixed through a Hadamard matrix (lossless, so the decay
// is set exactly by the per-line gains), after Jot & Chaigne (1991). Each
// line's gain is chosen for the requested RT60 from its own length, and a
// one-pole filter in each loop makes the highs decay faster by `damping`.
// Two lines are slowly modulated to keep a long tail from ringing
// metallically. Lengths in ms at size 1.
const FDN_MS = [31.1, 37.3, 41.9, 47.1, 53.3, 59.9, 67.1, 73.7]
const FDN_DIFF_MS = [4.77, 3.59, 12.73, 9.31]
const FDN_DIFF_G = [0.75, 0.75, 0.625, 0.625]
const FDN_IN = [1, 1, -1, -1, 1, 1, -1, -1]
const FDN_OUT_L = [1, 1, 1, 1, -1, -1, -1, -1]
const FDN_OUT_R = [1, -1, 1, -1, 1, -1, 1, -1]
// Early reflections at size 1: [ms, gain, side (-1 left .. +1 right)].
const ER_TAPS = [
  [4.3, 0.84, -0.7], [6.1, 0.78, 0.8], [9.7, 0.66, -0.3], [12.9, 0.61, 0.5],
  [16.2, 0.55, -0.9], [19.9, 0.49, 0.2], [24.1, 0.43, 0.9], [28.8, 0.38, -0.5],
  [33.4, 0.33, 0.6], [39.1, 0.28, -0.2], [44.7, 0.24, 0.3], [51.3, 0.2, -0.8],
]
const FDN_MAX_SIZE = 2.5

export class FdnReverb {
  static PARAMS = ['predelay', 'decay', 'size', 'damping', 'early', 'diffusion', 'mod', 'lowcut', 'highcut', 'width', 'mix']

  constructor(sr, variant = 'hall') {
    this.sr = sr
    this.variant = variant
    const ms = sr / 1000
    this.lines = FDN_MS.map(t => new DelayLine(Math.ceil(t * ms * FDN_MAX_SIZE) + 64))
    this.diff = FDN_DIFF_MS.map(t => new DelayLine(Math.ceil(t * ms) + 8))
    this.diffLen = FDN_DIFF_MS.map(t => Math.max(1, Math.round(t * ms)))
    this.er = new DelayLine(Math.ceil(60 * ms * FDN_MAX_SIZE) + 8)
    this.input = new ReverbInput(sr)
    this.state = new Float64Array(8)
    this.y = new Float64Array(8)
    const room = variant === 'room'
    this.predelay = room ? 4 : 20; this.decay = room ? 0.7 : 2.8; this.size = room ? 0.45 : 1.2
    this.damping = room ? 0.5 : 0.45; this.early = room ? 0.6 : 0.3; this.diffusion = room ? 0.7 : 0.8
    this.mod = room ? 0.2 : 0.4; this.lowcut = room ? 100 : 150; this.highcut = room ? 12000 : 10000
    this.width = 1
    this.mixer = new Mix(sr, 0.3)
    this.p1 = 0; this.p2 = 0.37
    this.update()
  }
  set(name, v) {
    if (!FdnReverb.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else { this[name] = Number(v); this.update() }
    return true
  }
  setTempo() {}
  tail() { return this.predelay / 1000 + this.decay * 1.2 + 0.2 }
  reset() {
    this.input.clear(); this.er.clear()
    for (const l of [...this.lines, ...this.diff]) l.clear()
    this.state.fill(0)
  }

  update() {
    const sr = this.sr, size = clamp(this.size, 0.2, FDN_MAX_SIZE)
    this.input.set(this.predelay, this.lowcut, this.highcut)
    this.len = FDN_MS.map(t => Math.max(8, Math.round(t * size * sr / 1000)))
    const t60 = clamp(this.decay, 0.1, 60)
    const t60hf = t60 * (1 - 0.85 * clamp(this.damping, 0, 1))
    // Per line: DC gain for the RT60, Nyquist gain for the high-frequency
    // RT60, realised by k(1 - b)/(1 - b z^-1) with k the DC gain.
    this.k = new Float64Array(8); this.b = new Float64Array(8)
    for (let i = 0; i < 8; i++) {
      const gdc = Math.pow(10, -3 * this.len[i] / (sr * t60))
      const ghf = Math.pow(10, -3 * this.len[i] / (sr * t60hf))
      this.k[i] = gdc
      this.b[i] = (gdc - ghf) / (gdc + ghf)
    }
    this.diffG = FDN_DIFF_G.map(g => g * clamp(this.diffusion, 0, 1))
    this.modDepth = clamp(this.mod, 0, 1) * 0.8 * sr / 1000
    this.erTaps = ER_TAPS.map(([t, g, side]) => [
      Math.max(1, Math.round(t * size * sr / 1000)), g * clamp(this.early, 0, 1),
      Math.sqrt(0.5 * (1 - side)), Math.sqrt(0.5 * (1 + side)),
    ])
  }

  process(L, R, n) {
    const mx = this.mixer, lines = this.lines, len = this.len, k = this.k, b = this.b
    const st = this.state, y = this.y, md = this.modDepth
    const width = clamp(this.width, 0, 1)
    const i1 = 0.53 / this.sr, i2 = 0.71 / this.sr
    const norm = FDN_GAIN / Math.sqrt(8)
    for (let i = 0; i < n; i++) {
      mx.step()
      const x0 = this.input.step(0.5 * (L[i] + R[i]))
      this.er.push(x0)
      let x = x0
      for (let j = 0; j < 4; j++) x = allpass(this.diff[j], this.diffLen[j], this.diffG[j], x)

      // Read, filter.
      const m1 = md * Math.sin(TAU * this.p1), m2 = md * Math.sin(TAU * this.p2)
      for (let j = 0; j < 8; j++) {
        const raw = j === 1 ? lines[j].frac(len[j] + m1)
          : j === 6 ? lines[j].frac(len[j] + m2)
            : lines[j].at(len[j])
        st[j] = k[j] * (1 - b[j]) * raw + b[j] * st[j]
        y[j] = st[j]
      }
      // Output taps (before mixing, so left and right are uncorrelated).
      let oL = 0, oR = 0
      for (let j = 0; j < 8; j++) { oL += FDN_OUT_L[j] * y[j]; oR += FDN_OUT_R[j] * y[j] }
      // Fast Walsh-Hadamard transform, scaled to stay orthonormal.
      for (let h = 1; h < 8; h <<= 1) {
        for (let s = 0; s < 8; s += h << 1) {
          for (let j = s; j < s + h; j++) {
            const a = y[j], c = y[j + h]
            y[j] = a + c; y[j + h] = a - c
          }
        }
      }
      for (let j = 0; j < 8; j++) lines[j].push(y[j] / Math.sqrt(8) + FDN_IN[j] * x + TINY)

      let eL = 0, eR = 0
      for (const [d, g, gl, gr] of this.erTaps) { const v = this.er.at(d) * g; eL += v * gl; eR += v * gr }
      oL = oL * norm + eL * ER_GAIN
      oR = oR * norm + eR * ER_GAIN
      const mid = 0.5 * (oL + oR), side = 0.5 * (oL - oR) * width
      L[i] = mx.dry * L[i] + mx.wet * (mid + side)
      R[i] = mx.dry * R[i] + mx.wet * (mid - side)
      this.p1 += i1; if (this.p1 >= 1) this.p1 -= 1
      this.p2 += i2; if (this.p2 >= 1) this.p2 -= 1
    }
  }
}
// Output levels, calibrated so steady noise at the default settings comes
// out of a 100 % wet hall at the input's level (tests/fx.test.ts).
const FDN_GAIN = 1
const ER_GAIN = 0.35

// ── Shared: tempo-syncable LFO shapes ────────────────────────────────────

/** Note values a synced LFO offers, in beats per cycle (FX_DEFS labels them). */
export const LFO_DIVISIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32]

/** A repeatable random value in -1..1 for cycle k (S&H). */
function hashRand(k) {
  let h = Math.imul(k | 0, 2654435761) >>> 0
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13; h = Math.imul(h, 3266489917) >>> 0
  h ^= h >>> 16
  return h / 4294967296 * 2 - 1
}

/**
 * LFO value -1..1 at `pos` cycles. Shapes: 0 sine (from 0, rising),
 * 1 triangle (from the bottom), 2 square, 3 ramp down, 4 ramp up,
 * 5 sample & hold (a new random step every cycle).
 */
function lfoAt(shape, pos) {
  const p = pos - Math.floor(pos)
  switch (shape | 0) {
    case 0: return Math.sin(TAU * p)
    case 1: return 1 - 4 * Math.abs(p - 0.5)
    case 2: return p < 0.5 ? 1 : -1
    case 3: return 1 - 2 * p
    case 4: return 2 * p - 1
    default: return hashRand(Math.floor(pos))
  }
}

/**
 * Pin a synced LFO to the song: a cycle starts on the bar, so a tremolo set
 * to 1/4 dips on every beat (a sidechain pump) rather than wherever its own
 * clock happened to be when play was pressed. A free LFO is left alone.
 */
function lfoSync(fx, beat, offset) {
  if (fx.sync < 0.5) return
  const beats = LFO_DIVISIONS[clamp(Math.round(fx.division), 0, LFO_DIVISIONS.length - 1)]
  const pos = beat / beats - offset * lfoHz(fx) / fx.sr
  if (Math.abs(pos - fx.pos) > 1e-6) fx.pos = pos
}

/** Cycles per second for free (`rate` Hz) or synced (`division` at `bpm`). */
function lfoHz(fx) {
  if (fx.sync >= 0.5) {
    const beats = LFO_DIVISIONS[clamp(Math.round(fx.division), 0, LFO_DIVISIONS.length - 1)]
    return fx.bpm / 60 / beats
  }
  return fx.rate
}

/**
 * Topology-preserving-transform state-variable filter (Zavalishin): stable
 * at any cutoff and under fast modulation, which a Chamberlin SVF is not.
 */
class TptSvf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.setG(0.1, 1.414) }
  setG(g, k) {
    this.k = k
    this.a1 = 1 / (1 + g * (g + k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  /** One sample; sets .low .band .high. */
  tick(x) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.low = v2; this.band = v1; this.high = x - this.k * v1 - v2
  }
  clear() { this.ic1 = this.ic2 = 0 }
}
const svfG = (hz, sr) => Math.tan(Math.PI * clamp(hz, 10, sr * 0.49) / sr)

// ── Flanger ──────────────────────────────────────────────────────────────

/**
 * A flanger in two modes.
 *
 * Normal: one short swept delay summed with the dry signal, sweeping
 * exponentially from `manual` ms by up to +-3 octaves (`depth` 1), so the
 * comb's notches move evenly to the ear. Feedback sharpens them; NEGATIVE
 * feedback also inverts the swept signal - "negative flanging", the hollow
 * sound with a notch at DC instead of a peak.
 *
 * Through-zero (`tzf`): the tape trick. The "dry" side is itself delayed by a
 * fixed amount and the swept tap passes THROUGH it, from `manual` x depth ms
 * behind to the same ahead, so the comb sweeps all the way to its widest
 * spacing and back. Inverted (negative feedback), the two cancel completely
 * where they cross: the famous zero-point null. The whole effect is then
 * delayed by `manual` ms plus a little, as on tape.
 */
export class Flanger {
  static PARAMS = ['rate', 'sync', 'division', 'shape', 'manual', 'depth', 'feedback', 'tzf', 'spread', 'mix']

  constructor(sr) {
    this.sr = sr
    this.lines = [new DelayLine(Math.ceil(sr * 0.1)), new DelayLine(Math.ceil(sr * 0.1))]
    this.maxD = sr * 0.095
    this.rate = 0.2; this.sync = 0; this.division = 5; this.shape = 1
    this.manual = 2; this.depth = 0.7; this.feedback = 0.5; this.tzf = 0; this.spread = 90
    this.bpm = 120; this.pos = 0
    this.mixer = new Mix(sr, 0.5, 'linear')
  }
  set(name, v) {
    if (!Flanger.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    return true
  }
  setTempo(bpm) { if (bpm > 0) this.bpm = bpm }
  syncBeat(beat, offset) { lfoSync(this, beat, offset) }
  advance(n) { this.pos += n * lfoHz(this) / this.sr }
  maxDelayMs() {
    return Math.min(95, this.tzf >= 0.5 ? 2 * this.manual + 0.3 : this.manual * Math.pow(2, 3 * clamp(this.depth, 0, 1)))
  }
  tail() {
    const fb = clamp(Math.abs(this.feedback), 0, 0.95)
    const loops = fb > 0.001 ? Math.log(0.001) / Math.log(fb) : 1
    return this.maxDelayMs() / 1000 * (loops + 1) + 0.02
  }
  reset() { for (const l of this.lines) l.clear() }

  process(L, R, n) {
    const msr = this.sr / 1000, mx = this.mixer
    const fb = clamp(this.feedback, -0.95, 0.95), sign = fb < 0 ? -1 : 1
    const inc = lfoHz(this) / this.sr, off = clamp(this.spread, 0, 180) / 360
    const depth = clamp(this.depth, 0, 1), manual = clamp(this.manual, 0.05, 10)
    const tz = this.tzf >= 0.5
    // Through-zero: the reference tap sits at the centre of the sweep.
    const ref = (manual + 0.3) * msr, swing = manual * depth * msr
    for (let i = 0; i < n; i++) {
      mx.step()
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i], line = this.lines[ch]
        const l = lfoAt(this.shape, this.pos + ch * off)
        let y
        if (tz) {
          const a = line.frac(Math.max(2, ref)), b = line.frac(Math.max(2, ref + swing * l))
          line.push(x + fb * b + TINY)
          y = mx.dry * a + mx.wet * sign * b
        } else {
          const w = line.frac(clamp(manual * msr * Math.pow(2, 3 * depth * l), 2, this.maxD))
          line.push(x + fb * w + TINY)
          y = mx.dry * x + mx.wet * sign * w
        }
        if (ch) R[i] = y; else L[i] = y
      }
      this.pos += inc
    }
  }
}

// ── Phaser ───────────────────────────────────────────────────────────────

/** Allpass stage counts the phaser offers. */
const PHASER_STAGES = [4, 6, 8, 12]

/**
 * A chain of first-order allpasses whose corner sweeps exponentially around
 * `center` Hz by +-`depth` octaves, summed 50/50 with the dry signal: each
 * pair of stages digs one notch. 4 stages is an MXR Phase 90 or an EHX Small
 * Stone, 6 a Mu-Tron Bi-Phase, 12 a deep studio phaser. Feedback (the Small
 * Stone's "color") sharpens the peaks between the notches.
 */
export class Phaser {
  static PARAMS = ['rate', 'sync', 'division', 'shape', 'center', 'depth', 'feedback', 'stages', 'spread', 'mix']

  constructor(sr) {
    this.sr = sr
    this.rate = 0.4; this.sync = 0; this.division = 4; this.shape = 0
    this.center = 800; this.depth = 2; this.feedback = 0.3; this.stages = 0; this.spread = 90
    this.bpm = 120; this.pos = 0
    this.x1 = [new Float64Array(12), new Float64Array(12)]
    this.y1 = [new Float64Array(12), new Float64Array(12)]
    this.last = new Float64Array(2)
    this.a = new Float64Array(2)
    this.mixer = new Mix(sr, 0.5, 'linear')
  }
  set(name, v) {
    if (!Phaser.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    return true
  }
  setTempo(bpm) { if (bpm > 0) this.bpm = bpm }
  syncBeat(beat, offset) { lfoSync(this, beat, offset) }
  advance(n) { this.pos += n * lfoHz(this) / this.sr }
  tail() { return 0.05 }
  reset() { for (const a of [...this.x1, ...this.y1]) a.fill(0); this.last.fill(0) }

  process(L, R, n) {
    const mx = this.mixer, sr = this.sr
    const N = PHASER_STAGES[clamp(Math.round(this.stages), 0, 3)]
    const fb = clamp(this.feedback, -0.9, 0.9), inc = lfoHz(this) / sr
    const off = clamp(this.spread, 0, 180) / 360, depth = clamp(this.depth, 0, 4)
    for (let i = 0; i < n; i++) {
      mx.step()
      // The corner moves slowly; recomputing its tan every 8 samples is inaudible.
      if ((i & 7) === 0) {
        for (let ch = 0; ch < 2; ch++) {
          const f = clamp(this.center * Math.pow(2, depth * lfoAt(this.shape, this.pos + ch * off)), 20, sr * 0.45)
          const t = Math.tan(Math.PI * f / sr)
          this.a[ch] = (t - 1) / (t + 1)
        }
      }
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i], a = this.a[ch], x1 = this.x1[ch], y1 = this.y1[ch]
        let v = x + fb * this.last[ch]
        for (let k = 0; k < N; k++) {
          const y = a * v + x1[k] - a * y1[k]
          x1[k] = v; y1[k] = y + TINY; v = y
        }
        this.last[ch] = v
        const out = mx.dry * x + mx.wet * v
        if (ch) R[i] = out; else L[i] = out
      }
      this.pos += inc
    }
  }
}

// ── Tremolo / auto-pan ───────────────────────────────────────────────────

/**
 * Amplitude modulation, synced or free. Each channel's gain is
 * cos((1 - u) depth pi/2) for the LFO's u in 0..1, so with `spread` at 180
 * degrees - the right channel's LFO opposite the left's - it is an
 * equal-power auto-pan (L^2 + R^2 constant). `smooth` rounds a square's
 * edges (ms), so a stutter gate does not click.
 */
export class Tremolo {
  static PARAMS = ['rate', 'sync', 'division', 'shape', 'depth', 'spread', 'smooth', 'mix']

  constructor(sr) {
    this.sr = sr
    this.rate = 5; this.sync = 0; this.division = 1; this.shape = 0
    this.depth = 0.6; this.spread = 0; this.smooth = 2
    this.bpm = 120; this.pos = 0
    this.u = new Float64Array([1, 1])
    this.mixer = new Mix(sr, 1, 'linear')
  }
  set(name, v) {
    if (!Tremolo.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    return true
  }
  setTempo(bpm) { if (bpm > 0) this.bpm = bpm }
  syncBeat(beat, offset) { lfoSync(this, beat, offset) }
  advance(n) { this.pos += n * lfoHz(this) / this.sr }
  tail() { return 0.01 }
  reset() { this.u.fill(1) }

  process(L, R, n) {
    const mx = this.mixer, inc = lfoHz(this) / this.sr, off = clamp(this.spread, 0, 180) / 360
    const k = 1 - Math.exp(-1 / (Math.max(0.05, this.smooth) * this.sr / 1000))
    const d = clamp(this.depth, 0, 1) * Math.PI / 2
    for (let i = 0; i < n; i++) {
      mx.step()
      for (let ch = 0; ch < 2; ch++) {
        const target = 0.5 + 0.5 * lfoAt(this.shape, this.pos + ch * off)
        this.u[ch] += (target - this.u[ch]) * k
        const g = Math.cos((1 - this.u[ch]) * d)
        const x = ch ? R[i] : L[i]
        const y = mx.dry * x + mx.wet * g * x
        if (ch) R[i] = y; else L[i] = y
      }
      this.pos += inc
    }
  }
}

// ── Auto-filter ──────────────────────────────────────────────────────────

/**
 * A resonant state-variable filter (lowpass, bandpass, highpass, notch)
 * whose cutoff moves by an LFO - synced sweeps, or sample & hold for the
 * random "computer" burble - and by an envelope follower on the input, the
 * Mu-Tron III auto-wah. Both add in octaves. Resonance runs from a flat
 * Butterworth (Q 0.707) to a sharp Q of 15.
 */
export class AutoFilter {
  static PARAMS = ['type', 'cutoff', 'resonance', 'rate', 'sync', 'division', 'shape', 'lfoDepth',
    'envDepth', 'sensitivity', 'attack', 'release', 'spread', 'mix']

  constructor(sr) {
    this.sr = sr
    this.type = 0; this.cutoff = 600; this.resonance = 0.5
    this.rate = 0.5; this.sync = 1; this.division = 4; this.shape = 0; this.lfoDepth = 2
    this.envDepth = 0; this.sensitivity = 0.5; this.attack = 5; this.release = 150; this.spread = 0
    this.bpm = 120; this.pos = 0
    this.svf = [new TptSvf(), new TptSvf()]
    this.env = 0
    this.oct = new Float64Array(2)
    this.mixer = new Mix(sr, 1, 'linear')
  }
  set(name, v) {
    if (!AutoFilter.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else this[name] = Number(v)
    return true
  }
  setTempo(bpm) { if (bpm > 0) this.bpm = bpm }
  syncBeat(beat, offset) { lfoSync(this, beat, offset) }
  advance(n) { this.pos += n * lfoHz(this) / this.sr }
  tail() { return 0.1 + 0.3 * clamp(this.resonance, 0, 1) }
  reset() { for (const f of this.svf) f.clear(); this.env = 0; this.oct.fill(0) }

  process(L, R, n) {
    const sr = this.sr, mx = this.mixer, inc = lfoHz(this) / sr
    const off = clamp(this.spread, 0, 180) / 360
    const q = 0.707 * Math.pow(2, 4.4 * clamp(this.resonance, 0, 1)), k = 1 / q
    const aA = Math.exp(-1 / (Math.max(0.1, this.attack) * sr / 1000))
    const aR = Math.exp(-1 / (Math.max(1, this.release) * sr / 1000))
    const gain = Math.pow(2, 6 * clamp(this.sensitivity, 0, 1))      // detector: x1 .. x64
    const smooth = 1 - Math.exp(-1 / (0.003 * sr))                     // 3 ms on the cutoff
    const type = Math.round(this.type)
    for (let i = 0; i < n; i++) {
      mx.step()
      const lvl = Math.max(Math.abs(L[i]), Math.abs(R[i]))
      this.env = lvl > this.env ? aA * this.env + (1 - aA) * lvl : aR * this.env + (1 - aR) * lvl
      const envOct = this.envDepth * Math.min(1, this.env * gain)
      for (let ch = 0; ch < 2; ch++) {
        const target = this.lfoDepth * lfoAt(this.shape, this.pos + ch * off) + envOct
        this.oct[ch] += (target - this.oct[ch]) * smooth
        const f = this.svf[ch]
        if ((i & 7) === 0) f.setG(svfG(this.cutoff * Math.pow(2, this.oct[ch]), sr), k)
        const x = ch ? R[i] : L[i]
        f.tick(x)
        const w = type === 0 ? f.low : type === 1 ? f.band * k : type === 2 ? f.high : x - k * f.band
        const y = mx.dry * x + mx.wet * w
        if (ch) R[i] = y; else L[i] = y
      }
      this.pos += inc
    }
  }
}

// ── Drive ────────────────────────────────────────────────────────────────

// Halfband lowpass for the 2x oversampler: a 31-tap Kaiser-windowed sinc
// (beta 7, ~70 dB stopband). Only the centre and the odd-offset taps are
// nonzero, and only those are computed.
const HB = (() => {
  const N = 31, c = (N - 1) / 2, beta = 7
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t } return s }
  const taps = []
  let sum = 0
  for (let k = 0; k < N; k++) {
    const m = k - c
    const sinc = m === 0 ? 0.5 : Math.sin(Math.PI * m / 2) / (Math.PI * m)
    const h = sinc * i0(beta * Math.sqrt(1 - (m / c) ** 2)) / i0(beta)
    if (Math.abs(h) > 1e-12) { taps.push([k, h]); sum += h }
  }
  return { N, idx: Int32Array.from(taps.map(t => t[0])), h: Float64Array.from(taps.map(t => t[1] / sum)) }
})()

/** 2x up/down sampling through HB, one channel. */
class Oversampler {
  constructor() {
    this.up = new Float64Array(HB.N * 2); this.ui = 0
    this.dn = new Float64Array(HB.N * 2); this.di = 0
  }
  _push(buf, which, x) {
    const N = HB.N
    let i = (which ? this.di : this.ui) + 1
    if (i === N) i = 0
    buf[i] = buf[i + N] = x
    if (which) this.di = i; else this.ui = i
    let acc = 0
    const top = i + N, h = HB.h, idx = HB.idx
    for (let k = 0; k < h.length; k++) acc += h[k] * buf[top - idx[k]]
    return acc
  }
  /** Two 2x-rate samples for one input sample (zero-stuffed, gain 2). */
  upsample(x, out) { out[0] = 2 * this._push(this.up, 0, x); out[1] = 2 * this._push(this.up, 0, 0) }
  downsample(a, b) { this._push(this.dn, 1, a); return this._push(this.dn, 1, b) }
  clear() { this.up.fill(0); this.dn.fill(0) }
}

/**
 * Saturation at twice the sample rate (so its harmonics do not fold back),
 * loudness-matched: at Output 0 dB a -12 dBFS sine keeps its RMS at every
 * Drive, so the knob changes the colour, not the level. Tape is a symmetric
 * soft clip; Tube biases it for even harmonics (and a DC blocker takes the
 * offset back out); Fuzz is a hard, buzzy clip. `tone` is a lowpass after.
 */
export class Drive {
  static PARAMS = ['type', 'drive', 'tone', 'output', 'mix']

  constructor(sr) {
    this.sr = sr
    this.type = 0; this.drive = 9; this.tone = 12000; this.output = 0
    this.os = [new Oversampler(), new Oversampler()]
    this.tmp = new Float64Array(2)
    this.lp = new Float64Array(2)
    this.dcx = new Float64Array(2); this.dcy = new Float64Array(2)
    this.mixer = new Mix(sr, 1, 'linear')
    this.update()
  }
  shape(x) {
    const g = this.g
    switch (Math.round(this.type)) {
      case 1: return Math.tanh(g * x + 0.35) - TUBE_BIAS
      // High gain and unequal clipping on the two sides: the buzz.
      case 2: { const y = 4 * g * x; return y >= 0 ? Math.tanh(y) : 0.7 * Math.tanh(y / 0.7) }
      default: return Math.tanh(g * x)
    }
  }
  update() {
    this.g = Math.pow(10, clamp(this.drive, 0, 40) / 20)
    // Make-up gain: the -12 dBFS reference sine's RMS through the curve.
    let s = 0
    const ref = 0.25
    for (let i = 0; i < 256; i++) {
      const y = this.shape(ref * Math.sin(TAU * i / 256))
      s += y * y
    }
    let mean = 0
    for (let i = 0; i < 256; i++) mean += this.shape(ref * Math.sin(TAU * i / 256))
    mean /= 256
    const rms = Math.sqrt(Math.max(1e-12, s / 256 - mean * mean))
    this.makeup = (ref / Math.SQRT2) / rms * Math.pow(10, clamp(this.output, -24, 12) / 20)
    this.aLp = lpPole(this.tone, this.sr)
    this.aDc = Math.exp(-TAU * 10 / this.sr)
  }
  set(name, v) {
    if (!Drive.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else { this[name] = Number(v); this.update() }
    return true
  }
  setTempo() {}
  tail() { return 0.02 }
  reset() { for (const o of this.os) o.clear(); this.lp.fill(0); this.dcx.fill(0); this.dcy.fill(0) }

  process(L, R, n) {
    const mx = this.mixer, t = this.tmp, mk = this.makeup, aLp = this.aLp, aDc = this.aDc
    for (let i = 0; i < n; i++) {
      mx.step()
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i], os = this.os[ch]
        os.upsample(x, t)
        let y = os.downsample(this.shape(t[0]), this.shape(t[1]))
        // DC blocker (the tube's bias), then the tone lowpass.
        const d = y - this.dcx[ch] + aDc * this.dcy[ch]
        this.dcx[ch] = y; this.dcy[ch] = d + TINY
        this.lp[ch] += (1 - aLp) * (d - this.lp[ch])
        y = this.lp[ch] * mk
        const out = mx.dry * x + mx.wet * y
        if (ch) R[i] = out; else L[i] = out
      }
    }
  }
}
const TUBE_BIAS = Math.tanh(0.35)

// ── Lo-fi ────────────────────────────────────────────────────────────────

/**
 * A vintage sampler's signal path: drive into the converter, a sample-rate
 * reduction (zero-order hold: what a cheap sampler's DAC does, so images and
 * aliases are part of the sound), quantisation to `bits`, hiss, and a
 * lowpass on the way out. Anti-alias puts a 4-pole lowpass at 45 % of the
 * new rate in front, as the better samplers had.
 */
export class LoFi {
  static PARAMS = ['rate', 'bits', 'antialias', 'drive', 'noise', 'tone', 'mix']

  constructor(sr) {
    this.sr = sr
    this.rate = 26040; this.bits = 12; this.antialias = 0; this.drive = 0; this.noise = -96; this.tone = 14000
    this.aa = [[new TptSvf(), new TptSvf()], [new TptSvf(), new TptSvf()]]
    this.held = new Float64Array(2)
    this.ph = 1
    this.lp = new Float64Array(2)
    this.seed = 22222
    this.mixer = new Mix(sr, 1, 'linear')
    this.update()
  }
  update() {
    const r = clamp(this.rate, 200, this.sr)
    // Two Butterworth sections: Q 0.541 and 1.307 (k = 1/Q).
    for (const [a, b] of this.aa) { a.setG(svfG(0.45 * r, this.sr), 1.848); b.setG(svfG(0.45 * r, this.sr), 0.765) }
    this.aLp = lpPole(this.tone, this.sr)
    this.g = Math.pow(10, clamp(this.drive, 0, 24) / 20)
    this.q = Math.pow(2, clamp(this.bits, 1, 24) - 1)
    this.hiss = this.noise > -90 ? Math.pow(10, this.noise / 20) * Math.sqrt(3) : 0
  }
  set(name, v) {
    if (!LoFi.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else { this[name] = Number(v); this.update() }
    return true
  }
  setTempo() {}
  tail() { return 0.01 }
  reset() { for (const f of this.aa.flat()) f.clear(); this.held.fill(0); this.lp.fill(0) }

  process(L, R, n) {
    const mx = this.mixer, inc = clamp(this.rate, 200, this.sr) / this.sr
    const aa = this.antialias >= 0.5, q = this.q, g = this.g, hiss = this.hiss, aLp = this.aLp
    for (let i = 0; i < n; i++) {
      mx.step()
      this.ph += inc
      const sample = this.ph >= 1
      if (sample) this.ph -= Math.floor(this.ph)
      for (let ch = 0; ch < 2; ch++) {
        const x = ch ? R[i] : L[i]
        let v = x
        if (aa) { const [a, b] = this.aa[ch]; a.tick(v); b.tick(a.low); v = b.low }
        if (sample) {
          if (g > 1.0001) v = Math.tanh(g * v)
          if (hiss) v += hiss * ((this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0) / 4294967296 * 2 - 1)
          this.held[ch] = Math.round(clamp(v, -1, 1) * q) / q
        }
        this.lp[ch] += (1 - aLp) * (this.held[ch] - this.lp[ch])
        const y = mx.dry * x + mx.wet * this.lp[ch]
        if (ch) R[i] = y; else L[i] = y
      }
    }
  }
}

// ── Gated reverb ─────────────────────────────────────────────────────────

const GATE_TAPS = 56

/**
 * The 80s gated reverb as the AMS RMX16's "Nonlin" programs made it: not a
 * reverb with a noise gate after it (which depends on a threshold and on how
 * hard each hit is), but a dense burst of reflections that lasts exactly
 * `time` ms and stops - the same on every hit. `shape` tilts the burst:
 * 0 flat (gated), +1 falling (a truncated room), -1 rising (reverse).
 * 56 taps per side, jittered and randomly signed, scaled to unit energy, then
 * two allpasses per side fill the gaps between them.
 */
export class GatedReverb {
  static PARAMS = ['predelay', 'time', 'shape', 'diffusion', 'lowcut', 'highcut', 'width', 'mix']

  constructor(sr) {
    this.sr = sr
    this.line = new DelayLine(Math.ceil(sr * 1.4))
    this.input = new ReverbInput(sr)
    const ms = sr / 1000
    this.apLen = [[3.1, 5.3], [3.7, 4.9]].map(side => side.map(t => Math.round(t * ms)))
    this.ap = this.apLen.map(side => side.map(len => new DelayLine(len + 8)))
    this.predelay = 5; this.time = 320; this.shape = 0; this.diffusion = 0.7
    this.lowcut = 150; this.highcut = 10000; this.width = 1
    this.mixer = new Mix(sr, 0.3)
    this.update()
  }
  update() {
    this.input.set(this.predelay, this.lowcut, this.highcut)
    const T = clamp(this.time, 40, 1000) * this.sr / 1000
    const sh = clamp(this.shape, -1, 1)
    this.taps = [0, 1].map(side => {
      const pos = new Int32Array(GATE_TAPS), gain = new Float64Array(GATE_TAPS)
      let e = 0
      for (let j = 0; j < GATE_TAPS; j++) {
        const jit = 0.5 + 0.8 * (0.5 * hashRand(side * 997 + j * 7 + 3))
        const u = (j + jit) / GATE_TAPS
        pos[j] = Math.max(1, Math.round(u * T))
        // The tilt, and a short taper over the last few taps so the cut is
        // abrupt but not a click.
        const env = (1 + sh * (1 - 2 * u) * 0.9) * Math.min(1, (1 - u) * GATE_TAPS / 3)
        gain[j] = (hashRand(side * 131 + j * 17 + 5) < 0 ? -1 : 1) * env
        e += gain[j] ** 2
      }
      for (let j = 0; j < GATE_TAPS; j++) gain[j] /= Math.sqrt(e)
      return { pos, gain }
    })
    this.apG = 0.6 * clamp(this.diffusion, 0, 1)
  }
  set(name, v) {
    if (!GatedReverb.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else { this[name] = Number(v); this.update() }
    return true
  }
  setTempo() {}
  tail() { return (this.predelay + clamp(this.time, 40, 1000)) / 1000 + 0.06 }
  reset() { this.input.clear(); this.line.clear(); for (const s of this.ap) for (const l of s) l.clear() }

  process(L, R, n) {
    const mx = this.mixer, line = this.line, width = clamp(this.width, 0, 1), g = this.apG
    const [tl, tr] = this.taps
    for (let i = 0; i < n; i++) {
      mx.step()
      line.push(this.input.step(0.5 * (L[i] + R[i])))
      let oL = 0, oR = 0
      for (let j = 0; j < GATE_TAPS; j++) {
        oL += tl.gain[j] * line.at(tl.pos[j])
        oR += tr.gain[j] * line.at(tr.pos[j])
      }
      oL = allpass(this.ap[0][1], this.apLen[0][1], g, allpass(this.ap[0][0], this.apLen[0][0], g, oL))
      oR = allpass(this.ap[1][1], this.apLen[1][1], g, allpass(this.ap[1][0], this.apLen[1][0], g, oR))
      const mid = 0.5 * (oL + oR), side = 0.5 * (oL - oR) * width
      L[i] = mx.dry * L[i] + mx.wet * (mid + side)
      R[i] = mx.dry * R[i] + mx.wet * (mid - side)
    }
  }
}

// ── Shimmer reverb ───────────────────────────────────────────────────────

/** Shimmer intervals in semitones (FX_DEFS labels them). */
export const SHIMMER_INTERVALS = [12, 7, 5, 19, 24, -12]

/**
 * Pitch shifter: two taps reading a delay line at a moving delay, half a
 * window apart, each faded in and out with a sine window (constant power).
 * Up-shifting shrinks the delay at (ratio - 1) samples per sample.
 */
class PitchShifter {
  constructor(sr) {
    this.W = Math.round(sr * 0.08)
    this.line = new DelayLine(this.W + 16)
    this.p = 0
    this.ratio = 2
  }
  step(x) {
    this.line.push(x)
    this.p += (1 - this.ratio) / this.W
    this.p -= Math.floor(this.p)
    let q = this.p + 0.5
    if (q >= 1) q -= 1
    return this.line.frac(2 + this.p * this.W) * Math.sin(Math.PI * this.p) +
      this.line.frac(2 + q * this.W) * Math.sin(Math.PI * q)
  }
  clear() { this.line.clear() }
}

/**
 * A hall whose output is pitch-shifted (an octave up by default) and fed
 * back into its own input, so each pass of the tail rises another interval:
 * the ambient "shimmer". The feedback path is band-limited (300 Hz - 7 kHz)
 * so the octaves fade upward instead of piling into hiss or mud, and its
 * gain (`shimmer`) stays below 0.85, where it is stable.
 */
export class ShimmerReverb {
  static PARAMS = ['predelay', 'decay', 'size', 'damping', 'shimmer', 'interval', 'lowcut', 'highcut', 'mod', 'width', 'mix']

  constructor(sr) {
    this.sr = sr
    this.rev = new FdnReverb(sr, 'hall')
    this.rev.set('mix', 1); this.rev.set('early', 0.1)
    this.shifters = [new PitchShifter(sr), new PitchShifter(sr)]
    this.fb = [new DelayLine(512), new DelayLine(512)]
    this.fbHp = new Float64Array(4); this.fbLp = new Float64Array(2)
    this.aHp = Math.exp(-TAU * 300 / sr); this.aLp = lpPole(7000, sr)
    this.shimmer = 0.5; this.interval = 0
    this.wL = new Float32Array(128); this.wR = new Float32Array(128)
    this.mixer = new Mix(sr, 0.35)
    for (const [k, v] of Object.entries({ predelay: 30, decay: 5, size: 1.6, damping: 0.4, lowcut: 200, highcut: 9000, mod: 0.5, width: 1 })) this.set(k, v)
    this.setInterval()
  }
  setInterval() {
    const st = SHIMMER_INTERVALS[clamp(Math.round(this.interval), 0, SHIMMER_INTERVALS.length - 1)]
    for (const s of this.shifters) s.ratio = Math.pow(2, st / 12)
  }
  set(name, v) {
    if (!ShimmerReverb.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else if (name === 'shimmer') this.shimmer = clamp(Number(v), 0, 0.85)
    else if (name === 'interval') { this.interval = Number(v); this.setInterval() }
    else { this[name] = Number(v); this.rev.set(name, v) }
    return true
  }
  setTempo() {}
  tail() {
    const s = this.shimmer
    // Each pass round the loop loses (1 - s); the reverb's own decay sets
    // how long a pass takes to come back.
    return this.rev.tail() * (1 + (s > 0.001 ? 1.6 * s / (1 - s) : 0))
  }
  reset() {
    this.rev.reset()
    for (const s of this.shifters) s.clear()
    for (const l of this.fb) l.clear()
    this.fbHp.fill(0); this.fbLp.fill(0)
  }

  process(L, R, n) {
    // The feedback loop is 128 samples long, so a block may not be longer.
    if (n > 128) {
      for (let i = 0; i < n; i += 128) {
        const m = Math.min(128, n - i)
        this.process(L.subarray(i, i + m), R.subarray(i, i + m), m)
      }
      return
    }
    const wL = this.wL, wR = this.wR, s = this.shimmer, [fL, fR] = this.fb
    // The loop delay is 128 samples (2.7 ms), so a whole block of feedback
    // is already known before the block runs.
    for (let i = 0; i < n; i++) {
      wL[i] = L[i] + s * fL.at(128 - i)
      wR[i] = R[i] + s * fR.at(128 - i)
    }
    this.rev.process(wL, wR, n)
    const h = this.fbHp, l = this.fbLp, aH = this.aHp, aL = this.aLp, mx = this.mixer
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 2; ch++) {
        const w = ch ? wR[i] : wL[i]
        let y = this.shifters[ch].step(w)
        const o = 2 * ch, hp = aH * (h[o + 1] + y - h[o])
        h[o] = y; h[o + 1] = hp
        l[ch] += (1 - aL) * (hp - l[ch])
        ;(ch ? fR : fL).push(l[ch] + TINY)
      }
      mx.step()
      L[i] = mx.dry * L[i] + mx.wet * wL[i]
      R[i] = mx.dry * R[i] + mx.wet * wR[i]
    }
  }
}

// ── Scatter ──────────────────────────────────────────────────────────────

/** Step types, in the order FX_DEFS lists them. */
export const SCATTER_TYPES = ['pass', 'loop8', 'loop16', 'roll32', 'roll32t', 'roll64',
  'reverse', 'gate', 'mute', 'half', 'stop', 'double']
const SC_PASS = 0, SC_REVERSE = 6, SC_GATE = 7, SC_MUTE = 8, SC_HALF = 9, SC_STOP = 10, SC_DOUBLE = 11
/** Loop length, in steps, of types 1-5. */
const SC_LOOP = [0, 2, 1, 1 / 2, 1 / 3, 1 / 4]
/** Step length in beats (FX_DEFS labels them 1/8, 1/16, 1/32). */
export const SCATTER_SPEEDS = [0.5, 0.25, 0.125]
const SC_STEPS = 16
const SC_BUF = 1 << 19            // 10.9 s at 48 kHz, per channel
const SC_FADE = 96                // 2 ms at 48 kHz: every splice is crossfaded
// The step clock adds 1/stepLen per sample, and after a few thousand adds it
// can sit a rounding error short of the next step - which would start that
// step one sample late. A billionth of a step is 6 millionths of a sample.
const SC_EPS = 1e-9

/**
 * A step-sequenced beat mangler in the manner of the scatter on Roland's
 * grooveboxes: the audio keeps running into a buffer, and each of 16 steps,
 * locked to the song's 16ths, either lets it through or plays the buffer
 * some other way. Consecutive steps of one type form a RUN, anchored where
 * the run starts:
 *
 *   loop 1/8, 1/16     the first 2 steps / 1 step of the run play live and
 *   roll 1/32 - 1/64   are captured; the rest of the run repeats them. So a
 *                      roll repeats the START of its step - the transient
 *   reverse            the audio before the run, backwards
 *   gate               the first half of every step
 *   mute               silence
 *   half speed         from the run's start at half speed (an octave down)
 *   tape stop          slows to a standstill over the run
 *   double speed       starts one run-length back and catches up at the end
 *
 * A run ends at the pattern's last step. Every splice - a new run, a loop's
 * wrap - is crossfaded over 2 ms.
 *
 * The step clock runs on the tempo; syncBeat() pins it to the transport, and
 * advance() keeps it running (and forgets the buffer) while the effect is
 * bypassed or its chain is idle. `mix` is smoothed, so a performance pad can
 * punch the effect in and out with it while the buffer keeps recording.
 */
export class Scatter {
  static PARAMS = [...Array.from({ length: SC_STEPS }, (_, i) => `s${i + 1}`), 'speed', 'mix']

  constructor(sr) {
    this.sr = sr
    this.buf = [new Float32Array(SC_BUF), new Float32Array(SC_BUF)]
    this.n = 0                       // samples written so far (absolute)
    this.validFrom = 0               // nothing older than this may be read
    this.steps = new Int8Array(SC_STEPS)
    this.speed = 1
    this.bpm = 120
    this.sp = 0                      // position, in steps
    this.k = NaN                     // the step being played
    this.cur = null; this.prev = null
    this.fade = 0
    this.yl = 0; this.yr = 0
    this.mixer = new Mix(sr, 1, 'linear')
    this.update()
  }
  update() {
    this.stepLen = this.sr * 60 / this.bpm * SCATTER_SPEEDS[clamp(Math.round(this.speed), 0, 2)]
    let run = 0, longest = 0
    for (let i = 0; i < SC_STEPS; i++) {
      run = i > 0 && this.steps[i] === this.steps[i - 1] ? run + 1 : 1
      if (this.steps[i] !== SC_PASS) longest = Math.max(longest, run)
    }
    this.longest = longest
  }
  set(name, v) {
    if (!Scatter.PARAMS.includes(name)) return false
    if (name === 'mix') this.mixer.set(v)
    else if (name === 'speed') {
      // Keep the place in the bar when the step length changes.
      const beats = this.sp * SCATTER_SPEEDS[clamp(Math.round(this.speed), 0, 2)]
      this.speed = Number(v)
      this.sp = beats / SCATTER_SPEEDS[clamp(Math.round(this.speed), 0, 2)]
    } else this.steps[Number(name.slice(1)) - 1] = clamp(Math.round(Number(v)), 0, SCATTER_TYPES.length - 1)
    this.update()
    return true
  }
  setTempo(bpm) { if (bpm > 0) { this.bpm = bpm; this.update() } }
  /** The song is at `beat` in `offset` samples from now (negative: it was). */
  syncBeat(beat, offset) {
    const sp = beat / SCATTER_SPEEDS[clamp(Math.round(this.speed), 0, 2)] - offset / this.stepLen
    // The clock normally agrees to rounding error; leave it alone then.
    if (Math.abs(sp - this.sp) > 1e-4) this.sp = sp
  }
  /** `n` samples pass without process(): the clock runs, the buffer does not. */
  advance(n) {
    this.n += n
    this.validFrom = this.n
    this.sp += n / this.stepLen
  }
  /** A run reaches back at most its own length, and replays that far forward. */
  tail() { return this.longest ? 2 * this.longest * this.stepLen / this.sr + 0.05 : 0.01 }
  reset() { this.validFrom = this.n; this.cur = this.prev = null; this.fade = 0 }

  read(ch, q) {
    if (q < this.validFrom || q <= this.n - SC_BUF + 2) return 0
    if (q >= this.n) q = this.n
    const i = Math.floor(q), f = q - i, b = this.buf[ch]
    const a = b[i % SC_BUF]
    return f === 0 ? a : a + f * (b[(i + 1) % SC_BUF] - a)
  }

  enterStep(k) {
    this.k = k
    const idx = ((k % SC_STEPS) + SC_STEPS) % SC_STEPS
    const type = this.steps[idx], cur = this.cur
    // Reads reach back up to a run's length before its start, so a run may
    // not outgrow half the buffer.
    if (cur && cur.type === type && idx !== 0 && k === cur.lastK + 1 && this.n - cur.start < SC_BUF / 2 - 4096) {
      cur.lastK = k
      return
    }
    let steps = 1
    while (idx + steps < SC_STEPS && this.steps[idx + steps] === type) steps++
    this.prev = cur
    this.cur = { type, start: this.n, len: steps * this.stepLen, lastK: k }
    // Live into live needs no splice (and stays bit-exact).
    this.fade = cur && !(cur.type === SC_PASS && type === SC_PASS) ? SC_FADE : 0
  }

  /** One run's output for the sample at this.n, into yl / yr. */
  evalRun(run, xl, xr) {
    const t = this.n - run.start, type = run.type
    let q, g = 1
    if (type === SC_PASS) { this.yl = xl; this.yr = xr; return }
    if (type === SC_MUTE) { this.yl = 0; this.yr = 0; return }
    if (type === SC_GATE) {
      const f = (this.sp + SC_EPS - this.k) * this.stepLen
      g = clamp(Math.min(f, 0.5 * this.stepLen - f) / SC_FADE, 0, 1)
      this.yl = xl * g; this.yr = xr * g
      return
    }
    if (type < SC_REVERSE) {
      const len = SC_LOOP[type] * this.stepLen, p = t % len, d = Math.min(SC_FADE, len / 4)
      q = run.start + p
      g = Math.min(1, (len - p) / d)
      if (t >= len) g = Math.min(g, p / d)
    } else if (type === SC_REVERSE) q = run.start - 1 - t
    else if (type === SC_HALF) q = run.start + 0.5 * t
    else if (type === SC_STOP) {
      const T = run.len, u = Math.min(t, T)
      q = run.start + u - u * u / (2 * T)
      g = clamp((T - t) / (0.12 * T), 0, 1)
    } else q = run.start - run.len + 2 * t       // double speed
    this.yl = g * this.read(0, q)
    this.yr = g * this.read(1, q)
  }

  process(L, R, n) {
    const mx = this.mixer, inc = 1 / this.stepLen, [bl, br] = this.buf
    for (let i = 0; i < n; i++) {
      mx.step()
      const xl = L[i], xr = R[i], w = this.n % SC_BUF
      bl[w] = xl; br[w] = xr
      const k = Math.floor(this.sp + SC_EPS)
      if (k !== this.k) this.enterStep(k)
      this.evalRun(this.cur, xl, xr)
      let yl = this.yl, yr = this.yr
      if (this.fade > 0) {
        const a = this.fade / SC_FADE
        this.evalRun(this.prev, xl, xr)
        yl += a * (this.yl - yl); yr += a * (this.yr - yr)
        this.fade--
      }
      L[i] = mx.dry * xl + mx.wet * yl
      R[i] = mx.dry * xr + mx.wet * yr
      this.n++
      this.sp += inc
    }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────

/** Parameter names per effect kind (FX_DEFS in src/lib/fx.ts must match). */
export const EFFECT_PARAMS = {
  chorus: Chorus.PARAMS,
  ensemble: Ensemble.PARAMS,
  delay: TempoDelay.PARAMS,
  plate: PlateReverb.PARAMS,
  hall: FdnReverb.PARAMS,
  room: FdnReverb.PARAMS,
  flanger: Flanger.PARAMS,
  phaser: Phaser.PARAMS,
  tremolo: Tremolo.PARAMS,
  autofilter: AutoFilter.PARAMS,
  drive: Drive.PARAMS,
  lofi: LoFi.PARAMS,
  gated: GatedReverb.PARAMS,
  shimmer: ShimmerReverb.PARAMS,
  scatter: Scatter.PARAMS,
}

export function createEffect(kind, sr) {
  switch (kind) {
    case 'chorus': return new Chorus(sr)
    case 'ensemble': return new Ensemble(sr)
    case 'delay': return new TempoDelay(sr)
    case 'plate': return new PlateReverb(sr)
    case 'hall': return new FdnReverb(sr, 'hall')
    case 'room': return new FdnReverb(sr, 'room')
    case 'flanger': return new Flanger(sr)
    case 'phaser': return new Phaser(sr)
    case 'tremolo': return new Tremolo(sr)
    case 'autofilter': return new AutoFilter(sr)
    case 'drive': return new Drive(sr)
    case 'lofi': return new LoFi(sr)
    case 'gated': return new GatedReverb(sr)
    case 'shimmer': return new ShimmerReverb(sr)
    case 'scatter': return new Scatter(sr)
    default: return null
  }
}
