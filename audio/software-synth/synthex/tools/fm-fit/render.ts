// Offline renderer for the FM synth — same worklet-stubbing technique as
// drum-fit. FM is deterministic, so single renders are trustworthy.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SR = 44100

export interface FmOp {
  on: boolean; ratio: number; fine: number; level: number
  attack: number; decay: number; sustain: number; release: number; velSens: number
}
export interface FmPreset {
  algorithm: number
  feedback: number
  ops: FmOp[]
  lfoRate?: number; lfoWaveform?: number; lfoPitchDepth?: number; lfoAmpDepth?: number
}

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}

let Processor: (new () => Proc) | null = null

export async function loadFm(): Promise<void> {
  if (Processor) return
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['currentTime'] = 0
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (name: string, cls: new () => Proc) => {
    if (name === 'fm-synth-processor') Processor = cls
  }
  await import(resolve(HERE, '../../../js/fm-processor.js'))
}

/**
 * Render a preset holding a note for most of the window, releasing near the
 * end — matching how the pack's samples were played. FX are disabled: the
 * recordings are dry enough that fitting through a reverb would fit the
 * reverb, not the patch.
 */
export function renderPreset(preset: FmPreset, note: number, seconds: number): Float64Array {
  if (!Processor) throw new Error('call loadFm() first')
  const p = new Processor()
  const msg = (m: unknown) => p.port.onmessage!({ data: m })
  msg({ type: 'preset', params: { ...preset, ops: preset.ops.map(o => ({ ...o })) }, fx: {} })
  msg({ type: 'param', param: 'fx.chorus.enabled', value: false })
  msg({ type: 'param', param: 'fx.delay.enabled', value: false })
  msg({ type: 'param', param: 'fx.reverb.enabled', value: false })
  msg({ type: 'noteOn', voice: 0, note, velocity: 100 })

  const total = Math.round(SR * seconds)
  const releaseAt = Math.round(total * 0.85)
  const out = new Float64Array(total)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  let released = false
  for (let i = 0; i < total; i += 128) {
    if (!released && i >= releaseAt) { msg({ type: 'noteOff', voice: 0 }); released = true }
    l.fill(0); r.fill(0)
    p.process([], [[l, r]])
    for (let k = 0; k < Math.min(128, total - i); k++) out[i + k] = l[k]!
  }
  return out
}
