import { describe, it, expect } from 'vitest'
import { VoiceCore } from '../src/dsp/voice-core'
import { PRESETS } from '../src/presets/factory'

const SR = 44100
const rmsDb = (x: Float32Array, from: number, to: number): number => {
  let s = 0
  for (let i = from; i < to; i++) s += x[i]! * x[i]!
  return 20 * Math.log10(Math.sqrt(s / (to - from)) + 1e-9)
}
const ms = (t: number): number => Math.round(t * SR / 1000)

describe('VoiceCore', () => {
  it('Take-off starts without a click', () => {
    // Slot 42 opens its HP12 in a 2 ms attack. As first decoded, its envelope
    // put the filter at the engine's clamp for seconds (the sound 30 dB
    // thinner than the hardware's), and with the coefficients recomputed only
    // per 128-sample block the first block played through a filter still set
    // for the envelope at 0 while the amp was already up: a 3 ms burst ~25 dB
    // above the following sound. Either fix alone removes it; both are in.
    const takeOff = PRESETS.find(p => p.patch.name === 'Take-off')!
    const v = new VoiceCore(SR, takeOff.patch.upper)
    const out = new Float32Array(ms(60))
    v.noteOn(48, 1)
    v.render(out, 0, out.length)
    const onset = rmsDb(out, 0, ms(3))
    const body = rmsDb(out, ms(10), ms(60))
    expect(onset).toBeLessThan(body + 3)
  })

  it('the amp envelope opens after the filter envelope has started (AMP_ONSET_DELAY)', () => {
    // On the recording Take-off's first 2 ms hold nothing of the raw square:
    // the VCA opens once the filter envelope has done its fastest attack.
    // With both envelopes started together the engine put a 1 ms tick on
    // every note, 13 dB above the sound that followed.
    const takeOff = PRESETS.find(p => p.patch.name === 'Take-off')!
    const v = new VoiceCore(SR, takeOff.patch.upper)
    const out = new Float32Array(ms(60))
    v.noteOn(48, 1)
    v.render(out, 0, out.length)
    expect(rmsDb(out, 0, ms(1))).toBeLessThan(rmsDb(out, ms(10), ms(60)) - 40)
    expect(v.idle).toBe(false)
  })

  it('retriggering a sounding voice keeps the oscillator phase (no step)', () => {
    const base = PRESETS.find(p => p.patch.name === 'Chunky Synth')!.patch.upper
    const patch = { ...base, osc1: { ...base.osc1, wave: 'sine' as const }, osc2: { ...base.osc2, wave: 'sine' as const },
      filter: { ...base.filter, cutoff: 1, resonance: 0, envAmount: 0 }, lfo1: { ...base.lfo1, delay: 0 },
      modMatrix: { ...base.modMatrix, lfo1ToOsc1Pwm: 0, lfo1ToOsc2Pwm: 0 },
      envAmp: { a: 0.001, d: 0.1, s: 1, r: 0.5 } }
    const v = new VoiceCore(SR, patch)
    const out = new Float32Array(ms(400))
    v.noteOn(69, 1)
    v.render(out, 0, ms(200))
    v.noteOff()
    v.render(out, ms(200), ms(50))
    v.noteOn(69, 1)              // stolen while still in release
    v.render(out, ms(250), ms(150))
    let maxStep = 0
    for (let i = ms(249); i < ms(252); i++) maxStep = Math.max(maxStep, Math.abs(out[i]! - out[i - 1]!))
    // A 440 Hz sine at this level moves at most ~0.03 per sample; a phase
    // reset would jump by the full amplitude.
    expect(maxStep).toBeLessThan(0.05)
  })
})
