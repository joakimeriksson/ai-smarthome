// Full Synthex voice processor — Phase 2+ DSP.
//
// Per voice: 2 DCOs (saw/tri/sq+PWM/sine/noise), hard sync (1→2), ring mod,
// cross-mod (OSC1 → OSC2 PWM), 4-input mixer, multi-mode SVF filter,
// 2 ADSR envelopes, 2 LFOs, fixed mod matrix per PLAN §3.3.
//
// Block-rate filter coefficient update; sample-rate everything else.
// All scratch buffers preallocated. No allocations in `process()`.

import { PolyBlepSaw, PolyBlepSquare, PolyBlepTriangle, SineOsc, type PhaseOsc } from '../dsp/polyblep.ts'
import { WhiteNoise, PinkNoise } from '../dsp/noise.ts'
import { Adsr, type AdsrParams } from '../dsp/adsr.ts'
import { Lfo } from '../dsp/lfo.ts'
import { MultiModeFilter, svfCoeffs } from '../dsp/filter.ts'
import type { LayerPatch, Waveform, FilterMode, ModSlot } from '../patch.ts'

declare const sampleRate: number
declare const registerProcessor: (
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
) => void

interface AudioWorkletProcessor {
  readonly port: MessagePort
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean
}
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor
}

// ---------------------------------------------------------------------------
// Message contract (main thread → worklet)
// ---------------------------------------------------------------------------

interface NoteOnMsg { type: 'noteOn'; note: number; velocity: number }
interface NoteOffMsg { type: 'noteOff' }
interface PatchMsg { type: 'patch'; patch: LayerPatch }
interface ParamMsg { type: 'param'; path: string; value: number | string | boolean }
interface JoyMsg { type: 'joy'; x: number; y: number }
interface PitchBendMsg { type: 'bend'; semitones: number }
type InMsg = NoteOnMsg | NoteOffMsg | PatchMsg | ParamMsg | JoyMsg | PitchBendMsg

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noteToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12)
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

// One instance of every shape per oscillator slot, kept alive so changing
// `wave` mid-note doesn't reset state for the new shape and we avoid runtime
// allocations.
class OscBank {
  readonly saw = new PolyBlepSaw()
  readonly square = new PolyBlepSquare()
  readonly triangle = new PolyBlepTriangle()
  readonly sine = new SineOsc()

  // Returns the currently-selected oscillator's phase mirror (used for sync).
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

function defaultPatch(): LayerPatch {
  const z = (): Record<ModSlot, number> => ({
    lfo1ToOsc1Pitch: 0, lfo1ToOsc2Pitch: 0, lfo1ToCutoff: 0,
    lfo1ToOsc1Pwm: 0,   lfo1ToOsc2Pwm: 0,   lfo1ToAmp: 0,
    lfo2ToOsc1Pitch: 0, lfo2ToOsc2Pitch: 0, lfo2ToCutoff: 0,
    lfo2ToOsc1Pwm: 0,   lfo2ToOsc2Pwm: 0,   lfo2ToAmp: 0,
    env1ToCutoff: 1,    env1ToOsc2Pitch: 0,
    joyXToLfo1Depth: 0, joyXToLfo2Depth: 0,
    joyYToCutoff: 0,    joyYToLfoFiltDepth: 0,
    velToAmp: 0, velToCutoff: 0, velToEnv1: 0,
  })
  return {
    osc1: { wave: 'sawtooth', octave: 0, pwm: 0.5, glide: { amount: 0, speed: 0.05 } },
    osc2: { wave: 'sawtooth', octave: 0, detune: 0, pwm: 0.5, sync: false, glide: { amount: 0, speed: 0.05 } },
    mix: { osc1: 0.5, osc2: 0.5, noise: 0, noiseColor: 'white', ringMod: false, crossMod: 0, crossMod2: 0 },
    filter: { mode: 'lp24', cutoff: 0.6, resonance: 0.2, envAmount: 0.3, keyTrack: 0.5 },
    envFilter: { a: 0.005, d: 0.4, s: 0.4, r: 0.3 },
    envAmp:    { a: 0.005, d: 0.2, s: 0.8, r: 0.3 },
    lfo1: { shape: 'tri', rate: 5.0, sync: false, delay: 0, depthA: 1, depthB: 1 },
    lfo2: { shape: 'tri', rate: 0.4, sync: false, delay: 0, depthA: 1, depthB: 1 },
    modMatrix: z(),
    velocity: { amp: 0, cutoff: 0, env1: 0 },
    glide: { time: 0, mode: 'off' },
    keyAssign: 'poly',
    multiTrigger: true,
    pan: 0,
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

class SynthexVoiceProcessor extends AudioWorkletProcessor {
  private patch: LayerPatch = defaultPatch()
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
  private glideCoef = 0

  // Per-osc Synthex Glide: a one-shot pitch envelope that triggers on every
  // note-on. `pitchOffset` starts at the patch's `glide.amount` (signed
  // semitones) and decays exponentially to 0 with `glide.speed` time-constant.
  private osc1PitchOffset = 0
  private osc2PitchOffset = 0
  private osc1GlideCoef = 0
  private osc2GlideCoef = 0

  // Latched LFO samples used in block-rate filter coeff computation.
  private lfo1Sample = 0
  private lfo2Sample = 0

  constructor() {
    super()
    this.env1 = new Adsr(sampleRate)
    this.env2 = new Adsr(sampleRate)
    this.lfo1 = new Lfo(sampleRate)
    this.lfo2 = new Lfo(sampleRate)
    this.port.onmessage = (ev: MessageEvent<InMsg>): void => this.handle(ev.data)
  }

  private handle(msg: InMsg): void {
    switch (msg.type) {
      case 'noteOn': {
        const fromIdle = this.env2.stage === 'idle'
        this.targetNote = msg.note
        if (fromIdle || this.patch.glide.mode === 'off') {
          this.currentNote = msg.note
        }
        this.velocity = msg.velocity
        // Multi-trigger off + still sustaining = legato (don't retrigger envs)
        const retrigger = fromIdle || this.patch.multiTrigger
        if (retrigger) {
          this.env1.noteOn()
          this.env2.noteOn()
        }
        if (this.patch.lfo1.sync) this.lfo1.trigger()
        if (this.patch.lfo2.sync) this.lfo2.trigger()
        // Hard restart: reset oscillator phases for repeatable transients.
        if (!this.patch.osc2.sync) this.bank1.resetAll()
        this.bank2.resetAll()
        this.computeGlideCoef()
        // Trigger Synthex Glide on each osc — instant load, then decay.
        this.osc1PitchOffset = this.patch.osc1.glide.amount
        this.osc2PitchOffset = this.patch.osc2.glide.amount
        this.osc1GlideCoef = this.glideDecayCoef(this.patch.osc1.glide.speed)
        this.osc2GlideCoef = this.glideDecayCoef(this.patch.osc2.glide.speed)
        return
      }
      case 'noteOff':
        this.env1.noteOff()
        this.env2.noteOff()
        return
      case 'patch':
        this.patch = msg.patch
        this.computeGlideCoef()
        return
      case 'param':
        this.setParamPath(msg.path, msg.value)
        return
      case 'joy':
        this.joyX = msg.x
        this.joyY = msg.y
        return
      case 'bend':
        this.pitchBendSemis = msg.semitones
        return
    }
  }

  private setParamPath(path: string, value: number | string | boolean): void {
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

  private computeGlideCoef(): void {
    const t = Math.max(this.patch.glide.time, 0.0001)
    this.glideCoef = 1 - Math.exp(-1 / (t * sampleRate))
  }

  // Per-sample multiplier that decays the Glide pitch offset toward 0 over
  // `speed` seconds (one-pole). Speed is the time-constant — after that many
  // seconds the offset drops to ~37% of its starting value.
  private glideDecayCoef(speed: number): number {
    const t = Math.max(speed, 0.001)
    return Math.exp(-1 / (t * sampleRate))
  }

  // -------------------------------------------------------------------------

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    if (!out || out.length === 0) return true
    const ch = out[0]
    if (!ch) return true
    const n = ch.length

    if (this.env2.stage === 'idle') {
      ch.fill(0)
      return true
    }

    const p = this.patch
    const m = p.modMatrix

    // Filter coefficients — block-rate. Cutoff in note-number units.
    const baseCutoffNote = 24 + p.filter.cutoff * 96
    // LFO contribution to cutoff uses each LFO's depthB (filter/amp side)
    const lfo1B = p.lfo1.depthB
    const lfo2B = p.lfo2.depthB
    const cutoffMod =
      m.lfo1ToCutoff * this.lfo1Sample * 60 * lfo1B +
      m.lfo2ToCutoff * this.lfo2Sample * 60 * lfo2B +
      m.joyYToCutoff * this.joyY * 48 +
      m.velToCutoff * (this.velocity - 0.5) * 60 +
      p.filter.envAmount * this.env1.level * 60 +
      m.env1ToCutoff * (this.env1.level - 0.5) * 96 +
      p.filter.keyTrack * (this.currentNote - 60)
    const cutoffNote = clamp(baseCutoffNote + cutoffMod, 0, 132)
    // Q: 0..1 → 0.5..25. Above ~10 the filter is on the verge of self-osc;
    // at 25 it self-oscillates cleanly. Compensate input gain so output
    // doesn't blow up at high Q (resonance peak gain ≈ Q at the corner).
    const q = 0.5 + p.filter.resonance * p.filter.resonance * 24.5
    const coeffs = svfCoeffs(noteToHz(cutoffNote), sampleRate, q)
    const filterMode: FilterMode = p.filter.mode
    // Input attenuation: drop input as resonance climbs so the resonant peak
    // stays roughly within unity. Empirical curve.
    const inputAtten = 1 - p.filter.resonance * 0.6

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
    // LFO depth-A multipliers (pitch + PWM destinations)
    const lfo1A = p.lfo1.depthA
    const lfo2A = p.lfo2.depthA

    let prevOsc1 = 0
    let prevOsc2 = 0

    for (let i = 0; i < n; i++) {
      this.currentNote += this.glideCoef * (this.targetNote - this.currentNote)

      const e1 = this.env1.step(p.envFilter as AdsrParams)
      const e2 = this.env2.step(p.envAmp as AdsrParams)
      const l1 = this.lfo1.step(p.lfo1.rate, p.lfo1.shape, p.lfo1.delay) *
        (1 + m.joyXToLfo1Depth * this.joyX)
      const l2 = this.lfo2.step(p.lfo2.rate, p.lfo2.shape, p.lfo2.delay) *
        (1 + m.joyXToLfo2Depth * this.joyX)
      this.lfo1Sample = l1
      this.lfo2Sample = l2

      // Synthex Glide: decay each per-osc pitch offset toward 0.
      this.osc1PitchOffset *= this.osc1GlideCoef
      this.osc2PitchOffset *= this.osc2GlideCoef

      // LFO pitch contributions are scaled by depthA (Synthex split routing).
      const pitch1Mod =
        m.lfo1ToOsc1Pitch * l1 * 12 * lfo1A +
        m.lfo2ToOsc1Pitch * l2 * 12 * lfo2A +
        this.osc1PitchOffset
      const pitch2Mod =
        m.lfo1ToOsc2Pitch * l1 * 12 * lfo1A +
        m.lfo2ToOsc2Pitch * l2 * 12 * lfo2A +
        m.env1ToOsc2Pitch * (e1 - 0.5) * 24 +
        this.osc2PitchOffset
      const note = this.currentNote + this.pitchBendSemis
      const f1 = noteToHz(note + pitch1Mod) * oct1
      const f2 = noteToHz(note + pitch2Mod + detuneSemis) * oct2
      const dt1 = Math.min(f1 / sampleRate, 0.45)
      const dt2 = Math.min(f2 / sampleRate, 0.45)

      // PWM mod via LFO uses depthA. Cross-mod is bidirectional.
      let pwm1 = p.osc1.pwm +
        m.lfo1ToOsc1Pwm * l1 * 0.45 * lfo1A +
        m.lfo2ToOsc1Pwm * l2 * 0.45 * lfo2A +
        crossMod2Amt * prevOsc2 * 0.45
      let pwm2 = p.osc2.pwm +
        m.lfo1ToOsc2Pwm * l1 * 0.45 * lfo1A +
        m.lfo2ToOsc2Pwm * l2 * 0.45 * lfo2A +
        crossModAmt * prevOsc1 * 0.45
      pwm1 = clamp(pwm1, 0.05, 0.95)
      pwm2 = clamp(pwm2, 0.05, 0.95)

      // Generate osc1
      let s1 = 0
      switch (wave1) {
        case 'sawtooth': s1 = this.bank1.saw.next(dt1); break
        case 'square':   s1 = this.bank1.square.next(dt1, pwm1); break
        case 'triangle': s1 = this.bank1.triangle.next(dt1); break
        case 'sine':     s1 = this.bank1.sine.next(dt1); break
        case 'noise':    s1 = this.noiseW1.next(); break
      }

      // Hard sync: when osc1 wrapped, force osc2 phase = 0.
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
      mixed *= inputAtten   // attenuate as resonance rises (prevents blow-up)

      mixed = this.filter.step(mixed, filterMode, coeffs)

      // Amp LFO uses depthB (filter/amp side of the split).
      const ampMod = 1 + m.lfo1ToAmp * l1 * lfo1B + m.lfo2ToAmp * l2 * lfo2B
      const velAmp = 1 + m.velToAmp * (this.velocity - 1)
      ch[i] = mixed * e2 * ampMod * velAmp * 0.5

      prevOsc1 = s1
      prevOsc2 = s2
    }

    return true
  }
}

registerProcessor('synthex-voice', SynthexVoiceProcessor)
