// Offline renderer for the comparison harness.
//
// Sequencing only: it schedules note/param events and asks VoiceCore — the
// SAME class the AudioWorklet runs — for the audio. There is no second copy
// of the DSP here any more. (There was, and it drifted: the joystick
// performance system reached the worklet and never reached this file, so the
// harness silently stopped rendering what the app plays.)

import { VoiceCore } from '../../packages/engine/src/dsp/voice-core.ts'
import { CHORUS_PRESETS } from '../../packages/engine/src/fx/chorus.ts'
import type { LayerPatch, ChorusParams, JoystickPerformance } from '../../packages/engine/src/patch.ts'

export interface NoteEvent { kind: 'on' | 'off'; t: number; note: number; velocity?: number }
export interface Param { path: string; t: number; value: number | string | boolean }

export interface RenderOptions {
  patch: LayerPatch
  events: NoteEvent[]
  params?: Param[] | undefined  // automation events
  durationSec: number
  sampleRate?: number           // default 48000
  fx?: { chorus?: ChorusParams } | undefined  // post-voice FX (matches the app's FX bus)
  /** Joystick depths, if a scenario exercises the performance section. */
  performance?: JoystickPerformance | undefined
  /** Static joystick position, x/y in -1..1. */
  joy?: { x: number; y: number } | undefined
}

// Single-tap chorus post-pass mirroring StereoChorus (fx/chorus.ts): one
// LFO-modulated fractional delay + dry, i.e. one channel of the stereo pair —
// which is exactly what a mono capture of the app records.
function applyChorus(buf: Float32Array, sr: number, p: ChorusParams): void {
  if (!p.enabled) return
  const preset = CHORUS_PRESETS[p.mode]
  const rate = preset.rate * (0.5 + p.rate)
  const depth = preset.depth * (0.5 + p.depth)
  const baseDelay = 0.012
  const wet = p.mix
  const dry = 1 - p.mix * 0.5
  const maxDelay = Math.ceil((baseDelay + depth + 0.001) * sr)
  const line = new Float32Array(maxDelay + 2)
  let w = 0
  const twoPi = 2 * Math.PI
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!
    line[w] = x
    const delaySec = baseDelay + depth * Math.sin((twoPi * rate * i) / sr)
    const d = delaySec * sr
    const di = Math.floor(d)
    const frac = d - di
    const r0 = (w - di + line.length) % line.length
    const r1 = (r0 - 1 + line.length) % line.length
    const delayed = line[r0]! * (1 - frac) + line[r1]! * frac
    buf[i] = x * dry + delayed * wet
    w = (w + 1) % line.length
  }
}

export function render(opts: RenderOptions): Float32Array {
  const sr = opts.sampleRate ?? 48000
  const n = Math.floor(opts.durationSec * sr)
  const out = new Float32Array(n)

  // Deep-clone so a render never mutates the caller's patch.
  const patch: LayerPatch = JSON.parse(JSON.stringify(opts.patch))
  const core = new VoiceCore(sr, patch)
  if (opts.performance) core.setPerformance(opts.performance)
  if (opts.joy) core.setJoy(opts.joy.x, opts.joy.y)

  const noteEvents = [...opts.events].sort((a, b) => a.t - b.t)
  const paramEvents = [...(opts.params ?? [])].sort((a, b) => a.t - b.t)
  let eIdx = 0, pIdx = 0

  // Render in runs that end at the next event, so events land on the exact
  // sample they were scheduled for while the core still sees long chunks.
  let i = 0
  while (i < n) {
    const t = i / sr
    while (eIdx < noteEvents.length && noteEvents[eIdx]!.t <= t) {
      const ev = noteEvents[eIdx]!
      if (ev.kind === 'on') core.noteOn(ev.note, ev.velocity ?? 1)
      else core.noteOff()
      eIdx++
    }
    while (pIdx < paramEvents.length && paramEvents[pIdx]!.t <= t) {
      const ev = paramEvents[pIdx]!
      core.setParam(ev.path, ev.value)
      pIdx++
    }

    // Next sample index at which something happens.
    const nextT = Math.min(
      eIdx < noteEvents.length ? noteEvents[eIdx]!.t : Infinity,
      pIdx < paramEvents.length ? paramEvents[pIdx]!.t : Infinity,
    )
    const nextI = nextT === Infinity ? n : Math.min(n, Math.max(i + 1, Math.ceil(nextT * sr)))
    core.render(out, i, nextI - i)
    i = nextI
  }

  if (opts.fx?.chorus) applyChorus(out, sr, opts.fx.chorus)

  return out
}
