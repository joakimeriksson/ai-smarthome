// Pure-JS renderer that mirrors the AudioWorklet voice processor.
//
// Re-uses the shared DSP modules from packages/engine/src/dsp so the harness
// exercises the SAME math as the live worklet — there's no second
// implementation to drift out of sync.
//
// Renders a patch + a sequence of note events to a Float32Array.
// Faster than real-time; runs in plain Node.

import { PolyBlepSaw, PolyBlepSquare, PolyBlepTriangle, SineOsc, type PhaseOsc } from
  '../../packages/engine/src/dsp/polyblep.ts'
import { WhiteNoise, PinkNoise } from '../../packages/engine/src/dsp/noise.ts'
import { Adsr } from '../../packages/engine/src/dsp/adsr.ts'
import { Lfo } from '../../packages/engine/src/dsp/lfo.ts'
import { MultiModeFilter, svfCoeffs } from '../../packages/engine/src/dsp/filter.ts'
import type { LayerPatch, Waveform } from '../../packages/engine/src/patch.ts'

export interface NoteEvent { kind: 'on' | 'off'; t: number; note: number; velocity?: number }
export interface Param { path: string; t: number; value: number | string | boolean }

export interface RenderOptions {
  patch: LayerPatch
  events: NoteEvent[]
  params?: Param[]              // automation events
  durationSec: number
  sampleRate?: number           // default 48000
}

const noteToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12)
const clamp = (v: number, lo: number, hi: number) => v < lo ? lo : v > hi ? hi : v

class OscBank {
  saw = new PolyBlepSaw()
  square = new PolyBlepSquare()
  triangle = new PolyBlepTriangle()
  sine = new SineOsc()
  active(wave: Waveform): PhaseOsc {
    switch (wave) {
      case 'sawtooth':  return this.saw
      case 'square':    return this.square
      case 'triangle':  return this.triangle
      case 'sine':      return this.sine
      case 'noise':     return this.sine
    }
  }
  resetAll(): void {
    this.saw.reset(0); this.square.reset(0); this.triangle.reset(0); this.sine.reset(0)
  }
}

// Apply a parameter automation event to the patch (same dot-path as the
// engine). Mutates p.
function applyParam(p: LayerPatch, path: string, value: number | string | boolean): void {
  const segs = path.split('.')
  let target: Record<string, unknown> = p as unknown as Record<string, unknown>
  for (let i = 0; i < segs.length - 1; i++) {
    const next = target[segs[i]!]
    if (next && typeof next === 'object') target = next as Record<string, unknown>
    else return
  }
  target[segs[segs.length - 1]!] = value
}

export function render(opts: RenderOptions): Float32Array {
  const sr = opts.sampleRate ?? 48000
  const n = Math.floor(opts.durationSec * sr)
  const out = new Float32Array(n)

  // Deep-clone the patch so this render doesn't mutate caller's object.
  const p: LayerPatch = JSON.parse(JSON.stringify(opts.patch))

  const bank1 = new OscBank()
  const bank2 = new OscBank()
  const noiseW1 = new WhiteNoise(0xa5a5a5a5)
  const noiseW2 = new WhiteNoise(0xdeadbeef | 0)
  const noiseP = new PinkNoise(0xfeedface | 0)
  const env1 = new Adsr(sr)
  const env2 = new Adsr(sr)
  const lfo1 = new Lfo(sr)
  const lfo2 = new Lfo(sr)
  const filter = new MultiModeFilter()

  let currentNote = 60
  let targetNote = 60
  let velocity = 1
  let glideCoef = 0
  let osc1PitchOffset = 0, osc2PitchOffset = 0
  let osc1GlideCoef = 0, osc2GlideCoef = 0
  let lfo1Sample = 0, lfo2Sample = 0
  let prevOsc1 = 0
  let prevOsc2 = 0

  const setGlide = () => {
    const t = Math.max(p.glide.time, 0.0001)
    glideCoef = 1 - Math.exp(-1 / (t * sr))
  }
  const glideDecayCoef = (speed: number): number =>
    Math.exp(-1 / (Math.max(speed, 0.001) * sr))
  setGlide()

  // Sort and index events
  const noteEvents = [...opts.events].sort((a, b) => a.t - b.t)
  const paramEvents = [...(opts.params ?? [])].sort((a, b) => a.t - b.t)
  let eIdx = 0, pIdx = 0

  // Block-rate filter coefficient update — every 32 samples is a good
  // tradeoff between cost and modulation tracking for the harness (the
  // worklet uses 128, AudioWorklet's quantum).
  const BLOCK = 32

  for (let i = 0; i < n; i++) {
    const t = i / sr

    // Drain due note events
    while (eIdx < noteEvents.length && noteEvents[eIdx]!.t <= t) {
      const ev = noteEvents[eIdx]!
      if (ev.kind === 'on') {
        const fromIdle = env2.stage === 'idle'
        targetNote = ev.note
        if (fromIdle || p.glide.mode === 'off') currentNote = ev.note
        velocity = ev.velocity ?? 1
        env1.noteOn(); env2.noteOn()
        if (p.lfo1.sync) lfo1.trigger()
        if (p.lfo2.sync) lfo2.trigger()
        if (!p.osc2.sync) bank1.resetAll()
        bank2.resetAll()
        setGlide()
        osc1PitchOffset = p.osc1.glide.amount
        osc2PitchOffset = p.osc2.glide.amount
        osc1GlideCoef = glideDecayCoef(p.osc1.glide.speed)
        osc2GlideCoef = glideDecayCoef(p.osc2.glide.speed)
      } else {
        env1.noteOff(); env2.noteOff()
      }
      eIdx++
    }
    // Drain due param events
    while (pIdx < paramEvents.length && paramEvents[pIdx]!.t <= t) {
      const ev = paramEvents[pIdx]!
      applyParam(p, ev.path, ev.value)
      if (ev.path === 'glide.time' || ev.path === 'glide.mode') setGlide()
      pIdx++
    }

    // Re-derive filter coeffs at block boundaries.
    let coeffs = svfCoeffs(noteToHz(60), sr, 1) // placeholder; overwritten below
    if ((i % BLOCK) === 0) {
      const baseCutoffNote = 24 + p.filter.cutoff * 96
      const lfo1B = p.lfo1.depthB
      const lfo2B = p.lfo2.depthB
      const cutoffMod =
        p.modMatrix.lfo1ToCutoff * lfo1Sample * 60 * lfo1B +
        p.modMatrix.lfo2ToCutoff * lfo2Sample * 60 * lfo2B +
        p.modMatrix.velToCutoff * (velocity - 0.5) * 60 +
        p.filter.envAmount * env1.level * 60 +
        p.modMatrix.env1ToCutoff * (env1.level - 0.5) * 96 +
        p.filter.keyTrack * (currentNote - 60)
      const cutoffNote = clamp(baseCutoffNote + cutoffMod, 0, 132)
      const q = 0.5 + p.filter.resonance * p.filter.resonance * 24.5
      coeffs = svfCoeffs(noteToHz(cutoffNote), sr, q)
      ;(render as unknown as { __coeffs: typeof coeffs }).__coeffs = coeffs
    } else {
      coeffs = (render as unknown as { __coeffs: typeof coeffs }).__coeffs
    }

    // Glide
    currentNote += glideCoef * (targetNote - currentNote)

    // Modulators
    const e1 = env1.step(p.envFilter)
    const e2 = env2.step(p.envAmp)
    const l1 = lfo1.step(p.lfo1.rate, p.lfo1.shape, p.lfo1.delay)
    const l2 = lfo2.step(p.lfo2.rate, p.lfo2.shape, p.lfo2.delay)
    lfo1Sample = l1; lfo2Sample = l2

    osc1PitchOffset *= osc1GlideCoef
    osc2PitchOffset *= osc2GlideCoef

    // Pitch (semitones) — LFO contributions scaled by depthA
    const m = p.modMatrix
    const lfo1A = p.lfo1.depthA
    const lfo2A = p.lfo2.depthA
    const pitch1Mod = m.lfo1ToOsc1Pitch * l1 * 12 * lfo1A + m.lfo2ToOsc1Pitch * l2 * 12 * lfo2A +
      osc1PitchOffset
    const pitch2Mod =
      m.lfo1ToOsc2Pitch * l1 * 12 * lfo1A +
      m.lfo2ToOsc2Pitch * l2 * 12 * lfo2A +
      m.env1ToOsc2Pitch * (e1 - 0.5) * 24 +
      osc2PitchOffset
    const note = currentNote
    const oct1 = Math.pow(2, p.osc1.octave)
    const oct2 = Math.pow(2, p.osc2.octave)
    const f1 = noteToHz(note + pitch1Mod) * oct1
    const f2 = noteToHz(note + pitch2Mod + p.osc2.detune / 100) * oct2
    const dt1 = Math.min(f1 / sr, 0.45)
    const dt2 = Math.min(f2 / sr, 0.45)

    // PWM
    let pwm1 = p.osc1.pwm +
      m.lfo1ToOsc1Pwm * l1 * 0.45 * lfo1A +
      m.lfo2ToOsc1Pwm * l2 * 0.45 * lfo2A +
      p.mix.crossMod2 * prevOsc2 * 0.45
    let pwm2 = p.osc2.pwm +
      m.lfo1ToOsc2Pwm * l1 * 0.45 * lfo1A +
      m.lfo2ToOsc2Pwm * l2 * 0.45 * lfo2A +
      p.mix.crossMod * prevOsc1 * 0.45
    pwm1 = clamp(pwm1, 0.05, 0.95)
    pwm2 = clamp(pwm2, 0.05, 0.95)

    let s1 = 0
    switch (p.osc1.wave) {
      case 'sawtooth': s1 = bank1.saw.next(dt1); break
      case 'square':   s1 = bank1.square.next(dt1, pwm1); break
      case 'triangle': s1 = bank1.triangle.next(dt1); break
      case 'sine':     s1 = bank1.sine.next(dt1); break
      case 'noise':    s1 = noiseW1.next(); break
    }

    const osc1Wrapped = bank1.active(p.osc1.wave).wrapped
    if (p.osc2.sync && osc1Wrapped) bank2.active(p.osc2.wave).syncTo(0)

    let s2 = 0
    switch (p.osc2.wave) {
      case 'sawtooth': s2 = bank2.saw.next(dt2); break
      case 'square':   s2 = bank2.square.next(dt2, pwm2); break
      case 'triangle': s2 = bank2.triangle.next(dt2); break
      case 'sine':     s2 = bank2.sine.next(dt2); break
      case 'noise':    s2 = noiseW2.next(); break
    }

    const noiseSample = p.mix.noiseColor === 'pink' ? noiseP.next() : noiseW2.next()
    const ring = s1 * s2
    const inputAtten = 1 - p.filter.resonance * 0.6

    let mixed =
      s1 * p.mix.osc1 +
      (p.mix.ringMod ? ring * p.mix.osc2 : s2 * p.mix.osc2) +
      noiseSample * p.mix.noise
    mixed *= inputAtten

    mixed = filter.step(mixed, p.filter.mode, coeffs)

    const lfo1B = p.lfo1.depthB
    const lfo2B = p.lfo2.depthB
    const ampMod = 1 + m.lfo1ToAmp * l1 * lfo1B + m.lfo2ToAmp * l2 * lfo2B
    const velAmp = 1 + m.velToAmp * (velocity - 1)
    out[i] = mixed * e2 * ampMod * velAmp * 0.5

    prevOsc1 = s1
    prevOsc2 = s2
  }

  return out
}
