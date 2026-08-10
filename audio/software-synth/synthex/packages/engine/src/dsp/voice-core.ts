// One Synthex voice — the single implementation of the per-sample DSP.
//
// This used to live inline in worklets/voice-processor.ts, with a hand-copied
// twin in tools/compare/render.ts. The twin drifted: the whole joystick
// performance system landed in the worklet and never reached the renderer,
// which quietly meant the comparison harness stopped rendering what the app
// actually plays. Both now drive this class, so that can't recur.
//
// The class is host-agnostic: it takes its sample rate in the constructor
// (no `sampleRate` global) and writes into a caller-supplied buffer, so the
// AudioWorklet, the offline renderer and tests all use identical code.
//
// No allocation in render() — every buffer is created up front.

import { PolyBlepSaw, PolyBlepSquare, PolyBlepTriangle, SineOsc, type PhaseOsc } from './polyblep.ts'
import { WhiteNoise, PinkNoise } from './noise.ts'
import { Adsr, type AdsrParams } from './adsr.ts'
import { Lfo } from './lfo.ts'
import { MultiModeFilter, svfCoeffs, type SvfCoeffs } from './filter.ts'
import type { LayerPatch, Waveform, JoystickPerformance } from '../patch.ts'

const noteToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Filter coefficients are recomputed every this many samples. 128 matches the
 * AudioWorklet render quantum, so the offline renderer reproduces the app's
 * modulation stepping exactly (it used to use 32 and was subtly more precise
 * than the thing it was measuring).
 */
export const COEFF_BLOCK = 128

// One instance of every shape per oscillator slot, kept alive so changing
// `wave` mid-note doesn't reset state for the new shape and we avoid runtime
// allocations.
class OscBank {
  readonly saw = new PolyBlepSaw()
  readonly square = new PolyBlepSquare()
  readonly triangle = new PolyBlepTriangle()
  readonly sine = new SineOsc()

  active(wave: Waveform): PhaseOsc {
    switch (wave) {
      case 'sawtooth':  return this.saw
      case 'square':    return this.square
      case 'triangle':  return this.triangle
      case 'sine':      return this.sine
      case 'noise':     return this.sine // unused for noise; keep type-stable
    }
  }

  resetAll(): void {
    this.saw.reset(0)
    this.square.reset(0)
    this.triangle.reset(0)
    this.sine.reset(0)
  }
}

export const defaultPerformance = (): JoystickPerformance =>
  ({ bendOsc: 0.3, bendFilt: 0.3, lfo2Osc: 0.5, lfo2Filt: 0.5 })

export class VoiceCore {
  patch: LayerPatch

  private readonly sr: number
  private readonly bank1 = new OscBank()
  private readonly bank2 = new OscBank()
  private readonly noiseW1 = new WhiteNoise()
  private readonly noiseW2 = new WhiteNoise(0xdeadbeef | 0)
  private readonly noiseP = new PinkNoise(0xfeedface | 0)

  private readonly env1: Adsr
  private readonly env2: Adsr
  private readonly lfo1: Lfo
  private readonly lfo2: Lfo
  private readonly filter = new MultiModeFilter()

  private currentNote = 60
  private targetNote = 60
  private velocity = 1
  private pitchBendSemis = 0
  private joyX = 0
  private joyY = 0
  /** Joystick depths — panel controls, not patch memory (see patch.ts). */
  private perf: JoystickPerformance = defaultPerformance()
  private glideCoef = 0

  // Glide pitch envelope: on note-on, `pitchOffset` is set to the glide
  // amount (semitones) and decays exponentially to 0 each sample. Fed by
  // Panel Glide (glide.amount/time) and the per-osc glides.
  private osc1PitchOffset = 0
  private osc2PitchOffset = 0
  private osc1GlideCoef = 0
  private osc2GlideCoef = 0

  // Latched LFO samples used in the block-rate filter coeff computation.
  private lfo1Sample = 0
  private lfo2Sample = 0

  // Carried across render() calls so cross-mod is continuous regardless of
  // how the host chunks its buffers.
  private prevOsc1 = 0
  private prevOsc2 = 0
  private blockPhase = 0
  private coeffs: SvfCoeffs
  private inputAtten = 1

  constructor(sampleRate: number, patch: LayerPatch) {
    this.sr = sampleRate
    this.patch = patch
    this.env1 = new Adsr(sampleRate)
    this.env2 = new Adsr(sampleRate)
    this.lfo1 = new Lfo(sampleRate)
    this.lfo2 = new Lfo(sampleRate)
    this.coeffs = svfCoeffs(noteToHz(84), sampleRate, 0.7)
    this.computeGlideCoef()
  }

  get idle(): boolean { return this.env2.stage === 'idle' }

  // --- Control -------------------------------------------------------------

  setPatch(p: LayerPatch): void {
    this.patch = p
    this.computeGlideCoef()
  }

  /** Dot-path parameter write, e.g. `filter.cutoff` or `modMatrix.lfo1ToCutoff`. */
  setParam(path: string, value: number | string | boolean): void {
    const segs = path.split('.')
    let target: Record<string, unknown> = this.patch as unknown as Record<string, unknown>
    for (let i = 0; i < segs.length - 1; i++) {
      const next = target[segs[i]!]
      if (next && typeof next === 'object') target = next as Record<string, unknown>
      else return
    }
    target[segs[segs.length - 1]!] = value
    if (path === 'glide.time' || path === 'glide.mode') this.computeGlideCoef()
  }

  setJoy(x: number, y: number): void { this.joyX = x; this.joyY = y }
  setPerformance(perf: JoystickPerformance): void { this.perf = perf }
  setPitchBend(semitones: number): void { this.pitchBendSemis = semitones }

  noteOn(note: number, velocity: number): void {
    const fromIdle = this.env2.stage === 'idle'
    const mode = this.patch.glide.mode
    this.targetNote = note
    // Only 'portamento' slides between notes; everything else jumps.
    if (!(mode === 'portamento' && !fromIdle)) this.currentNote = note
    this.velocity = velocity

    if (fromIdle || this.patch.multiTrigger) {
      this.env1.noteOn()
      this.env2.noteOn()
    }
    if (this.patch.lfo1.sync) this.lfo1.trigger()
    if (this.patch.lfo2.sync) this.lfo2.trigger()
    if (!this.patch.osc2.sync) this.bank1.resetAll()
    this.bank2.resetAll()
    this.computeGlideCoef()

    // Per-osc glide always fires if its amount is set; Panel Glide adds on
    // top for whichever oscillators it is routed to.
    const g = this.patch.glide
    this.osc1PitchOffset = this.patch.osc1.glide.amount
    this.osc2PitchOffset = this.patch.osc2.glide.amount
    this.osc1GlideCoef = this.glideDecayCoef(this.patch.osc1.glide.speed)
    this.osc2GlideCoef = this.glideDecayCoef(this.patch.osc2.glide.speed)
    if (mode === 'glide') {
      if (g.osc1) { this.osc1PitchOffset += g.amount; this.osc1GlideCoef = this.glideDecayCoef(g.time) }
      if (g.osc2) { this.osc2PitchOffset += g.amount; this.osc2GlideCoef = this.glideDecayCoef(g.time) }
    }
  }

  noteOff(): void {
    this.env1.noteOff()
    this.env2.noteOff()
  }

  private computeGlideCoef(): void {
    const t = Math.max(this.patch.glide.time, 0.0001)
    this.glideCoef = 1 - Math.exp(-1 / (t * this.sr))
  }

  /**
   * Per-sample multiplier decaying the Glide pitch offset toward 0 over
   * `speed` seconds — after that many seconds it is at ~37% of its start.
   */
  private glideDecayCoef(speed: number): number {
    return Math.exp(-1 / (Math.max(speed, 0.001) * this.sr))
  }

  // --- Audio ---------------------------------------------------------------

  /** Recompute the block-rate filter coefficients from current modulation. */
  private updateCoeffs(): void {
    const p = this.patch
    const m = p.modMatrix
    const baseCutoffNote = 24 + p.filter.cutoff * 96
    const cutoffMod =
      m.lfo1ToCutoff * this.lfo1Sample * 60 * p.lfo1.depthB +
      m.lfo2ToCutoff * this.lfo2Sample * 60 * p.lfo2.depthB +
      m.joyYToCutoff * this.joyY * 48 +
      // Joystick vertical bend, routed by horizontal position: held toward
      // TO FILTER (right), up opens the filter and down closes it. Held left,
      // the same motion bends pitch instead (see joyPitch in render()).
      this.joyY * this.perf.bendFilt * 60 * ((1 + this.joyX) / 2) +
      // Joystick right: LFO2 → cutoff (wah-wah), depth from TO FILTER slider.
      Math.max(0, this.joyX) * this.perf.lfo2Filt * this.lfo2Sample * 60 +
      m.velToCutoff * (this.velocity - 0.5) * 60 +
      p.filter.envAmount * this.env1.level * 60 +
      m.env1ToCutoff * (this.env1.level - 0.5) * 96 +
      p.filter.keyTrack * (this.currentNote - 60)
    const cutoffNote = clamp(baseCutoffNote + cutoffMod, 0, 132)
    // Q: 0..1 → 0.5..25. Above ~10 the filter verges on self-oscillation.
    const q = 0.5 + p.filter.resonance * p.filter.resonance * 24.5
    this.coeffs = svfCoeffs(noteToHz(cutoffNote), this.sr, q)
    // Drop input as resonance climbs so the peak stays near unity.
    this.inputAtten = 1 - p.filter.resonance * 0.6
  }

  /**
   * Render `length` samples into `out` starting at `offset`. Safe to call
   * with any chunk size — coefficient updates are driven by an internal
   * sample counter, so output does not depend on how the host slices time.
   */
  render(out: Float32Array, offset: number, length: number): void {
    if (this.idle) {
      out.fill(0, offset, offset + length)
      return
    }

    const p = this.patch
    const m = p.modMatrix
    const oct1 = Math.pow(2, p.osc1.octave)
    const oct2 = Math.pow(2, p.osc2.octave)
    const ringEnabled = p.mix.ringMod
    const crossModAmt = p.mix.crossMod    // OSC1 → OSC2 PWM
    const crossMod2Amt = p.mix.crossMod2  // OSC2 → OSC1 PWM
    const noiseColor = p.mix.noiseColor
    const detuneSemis = p.osc2.detune / 100
    const wave1 = p.osc1.wave
    const wave2 = p.osc2.wave
    const osc1Active = this.bank1.active(wave1)
    const osc2Active = this.bank2.active(wave2)
    const lfo1A = p.lfo1.depthA
    const lfo2A = p.lfo2.depthA
    const lfo1B = p.lfo1.depthB
    const lfo2B = p.lfo2.depthB
    const filterMode = p.filter.mode

    for (let i = 0; i < length; i++) {
      if (this.blockPhase === 0) this.updateCoeffs()
      this.blockPhase = (this.blockPhase + 1) % COEFF_BLOCK

      this.currentNote += this.glideCoef * (this.targetNote - this.currentNote)

      const e1 = this.env1.step(p.envFilter as AdsrParams)
      const e2 = this.env2.step(p.envAmp as AdsrParams)
      const l1 = this.lfo1.step(p.lfo1.rate, p.lfo1.shape, p.lfo1.delay) *
        (1 + m.joyXToLfo1Depth * this.joyX)
      const l2 = this.lfo2.step(p.lfo2.rate, p.lfo2.shape, p.lfo2.delay) *
        (1 + m.joyXToLfo2Depth * this.joyX)
      this.lfo1Sample = l1
      this.lfo2Sample = l2

      this.osc1PitchOffset *= this.osc1GlideCoef
      this.osc2PitchOffset *= this.osc2GlideCoef

      // Joystick (manual §§2-4): horizontal position routes the vertical
      // bend — left bends pitch (±7 st × BEND slider), right moves the
      // cutoff instead, centre splits both. Left also fades LFO2 into pitch.
      const joyPitch =
        this.joyY * this.perf.bendOsc * 7 * ((1 - this.joyX) / 2) +
        Math.max(0, -this.joyX) * this.perf.lfo2Osc * l2 * 2
      const pitch1Mod =
        m.lfo1ToOsc1Pitch * l1 * 12 * lfo1A +
        m.lfo2ToOsc1Pitch * l2 * 12 * lfo2A +
        joyPitch +
        this.osc1PitchOffset
      const pitch2Mod =
        m.lfo1ToOsc2Pitch * l1 * 12 * lfo1A +
        m.lfo2ToOsc2Pitch * l2 * 12 * lfo2A +
        m.env1ToOsc2Pitch * (e1 - 0.5) * 24 +
        joyPitch +
        this.osc2PitchOffset
      const note = this.currentNote + this.pitchBendSemis
      const f1 = noteToHz(note + pitch1Mod) * oct1
      const f2 = noteToHz(note + pitch2Mod + detuneSemis) * oct2
      const dt1 = Math.min(f1 / this.sr, 0.45)
      const dt2 = Math.min(f2 / this.sr, 0.45)

      let pwm1 = p.osc1.pwm +
        m.lfo1ToOsc1Pwm * l1 * 0.45 * lfo1A +
        m.lfo2ToOsc1Pwm * l2 * 0.45 * lfo2A +
        crossMod2Amt * this.prevOsc2 * 0.45
      let pwm2 = p.osc2.pwm +
        m.lfo1ToOsc2Pwm * l1 * 0.45 * lfo1A +
        m.lfo2ToOsc2Pwm * l2 * 0.45 * lfo2A +
        crossModAmt * this.prevOsc1 * 0.45
      pwm1 = clamp(pwm1, 0.05, 0.95)
      pwm2 = clamp(pwm2, 0.05, 0.95)

      let s1 = 0
      switch (wave1) {
        case 'sawtooth': s1 = this.bank1.saw.next(dt1); break
        case 'square':   s1 = this.bank1.square.next(dt1, pwm1); break
        case 'triangle': s1 = this.bank1.triangle.next(dt1); break
        case 'sine':     s1 = this.bank1.sine.next(dt1); break
        case 'noise':    s1 = this.noiseW1.next(); break
      }

      // Hard sync: when osc1 wraps, force osc2 phase to 0.
      if (p.osc2.sync && osc1Active.wrapped) osc2Active.syncTo(0)

      let s2 = 0
      switch (wave2) {
        case 'sawtooth': s2 = this.bank2.saw.next(dt2); break
        case 'square':   s2 = this.bank2.square.next(dt2, pwm2); break
        case 'triangle': s2 = this.bank2.triangle.next(dt2); break
        case 'sine':     s2 = this.bank2.sine.next(dt2); break
        case 'noise':    s2 = this.noiseW2.next(); break
      }

      const noiseSample = noiseColor === 'pink' ? this.noiseP.next() : this.noiseW2.next()
      const ring = s1 * s2

      let mixed =
        s1 * p.mix.osc1 +
        (ringEnabled ? ring * p.mix.osc2 : s2 * p.mix.osc2) +
        noiseSample * p.mix.noise
      mixed *= this.inputAtten

      mixed = this.filter.step(mixed, filterMode, this.coeffs)

      const ampMod = 1 + m.lfo1ToAmp * l1 * lfo1B + m.lfo2ToAmp * l2 * lfo2B
      const velAmp = 1 + m.velToAmp * (this.velocity - 1)
      out[offset + i] = mixed * e2 * ampMod * velAmp * 0.5

      this.prevOsc1 = s1
      this.prevOsc2 = s2
    }
  }
}
