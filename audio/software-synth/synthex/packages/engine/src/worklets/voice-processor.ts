// AudioWorklet host for one Synthex voice.
//
// Deliberately thin: everything that makes sound lives in dsp/voice-core.ts,
// shared with the offline renderer used by the comparison harness. This file
// only translates MessagePort traffic into VoiceCore calls and hands it the
// output buffer.

import { VoiceCore } from '../dsp/voice-core.ts'
import type { LayerPatch, ModSlot, JoystickPerformance } from '../patch.ts'

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
interface PerfMsg { type: 'perf'; perf: JoystickPerformance }
interface PitchBendMsg { type: 'bend'; semitones: number }
type InMsg = NoteOnMsg | NoteOffMsg | PatchMsg | ParamMsg | JoyMsg | PerfMsg | PitchBendMsg

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
    glide: { time: 0, amount: 0, mode: 'off', osc1: true, osc2: true },
    keyAssign: 'poly',
    multiTrigger: true,
    pan: 0,
  }
}

class SynthexVoiceProcessor extends AudioWorkletProcessor {
  private readonly core: VoiceCore

  constructor() {
    super()
    this.core = new VoiceCore(sampleRate, defaultPatch())
    this.port.onmessage = (ev: MessageEvent<InMsg>): void => this.handle(ev.data)
  }

  private handle(msg: InMsg): void {
    switch (msg.type) {
      case 'noteOn': this.core.noteOn(msg.note, msg.velocity); return
      case 'noteOff': this.core.noteOff(); return
      case 'patch': this.core.setPatch(msg.patch); return
      case 'param': this.core.setParam(msg.path, msg.value); return
      case 'joy': this.core.setJoy(msg.x, msg.y); return
      case 'perf': this.core.setPerformance(msg.perf); return
      case 'bend': this.core.setPitchBend(msg.semitones); return
    }
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const ch = outputs[0]?.[0]
    if (!ch) return true
    this.core.render(ch, 0, ch.length)
    return true
  }
}

registerProcessor('synthex-voice', SynthexVoiceProcessor)
