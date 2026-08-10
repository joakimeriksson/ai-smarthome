// Render a single drum voice offline, and map TR-808 knob positions onto our
// channel parameters.
//
// The processor is loaded with the AudioWorklet globals stubbed and process()
// called directly — the same technique the drum-voices tests use, and far more
// reliable than trying to make a browser render offline.

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SR = 44100

export interface Channel {
  type: number; tone: number; decay: number; color: number; level: number; pan: number
  /** Snare only: TONE crossfade between its two oscillators. */
  blend?: number
}
interface Proc {
  channels: Channel[]
  masterVolume: number
  drumVoices: { trigger(v: number): void }[]
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}

let Processor: (new () => Proc) | null = null

/**
 * Which processor to measure. Defaults to the live one; point TR808_PROCESSOR
 * at another copy to A/B a change honestly — comparing scores across a metric
 * change is meaningless unless both sides are measured the same way.
 */
export const PROCESSOR_PATH =
  process.env['TR808_PROCESSOR'] ?? resolve(HERE, '../../../js/drum-processor.js')

export async function loadProcessor(): Promise<void> {
  if (Processor) return
  const g = globalThis as unknown as Record<string, unknown>
  g['sampleRate'] = SR
  g['AudioWorkletProcessor'] = class {
    port = { onmessage: null, postMessage() { /* host side */ } }
  }
  g['registerProcessor'] = (_n: string, cls: new () => Proc) => { Processor = cls }
  await import(PROCESSOR_PATH)
}

/**
 * Render one voice alone.
 *
 * masterVolume is left low on purpose: at unity the output stage's saturation
 * colours the result, and we are measuring the voice, not the bus.
 */
export function renderVoice(
  type: number, over: Partial<Channel> = {}, seconds = 1.5,
): Float64Array {
  if (!Processor) throw new Error('call loadProcessor() first')
  const p = new Processor()
  p.channels = p.channels.map((c, i) =>
    i === 0 ? { ...c, type, level: 1, pan: 0, ...over } : { ...c, level: 0 })
  p.masterVolume = 0.02
  p.drumVoices[0]!.trigger(1)

  const total = Math.round(SR * seconds)
  const out = new Float64Array(total)
  const l = new Float32Array(128)
  const r = new Float32Array(128)
  for (let i = 0; i < total; i += 128) {
    l.fill(0); r.fill(0)
    p.process([], [[l, r]])
    for (let j = 0; j < Math.min(128, total - i); j++) out[i + j] = l[j]!
  }
  return out
}

/** Dial position 0..10 → our 0..1 parameter. */
const dial = (v: number): number => v / 10

/**
 * Our voice-type index and channel settings for a given TR-808 voice and knob
 * positions. This is the correspondence the fit is measured against: get it
 * wrong and a good score means nothing.
 */
export function voiceSetup(
  voice: string, knobs: number[],
): { type: number; params: Partial<Channel> } | null {
  const k = (i: number): number => knobs[i] ?? 5
  switch (voice) {
    // BD's first knob is TONE (attack character), second is DECAY. The pitch is
    // not on the panel at all — it is fixed by the bridged-T network.
    case 'BD': return { type: 0, params: { tone: 50, color: dial(k(0)), decay: dial(k(1)) } }
    // Per the circuit: SD's pitch never moves; TONE crossfades the two
    // oscillators (blend), SNAPPY scales the noise (color).
    case 'SD': return { type: 1, params: { tone: 172, blend: dial(k(0)), color: dial(k(1)), decay: 0.45 } }
    case 'CH': return { type: 2, params: { tone: 300, decay: 0.3, color: 0.5 } }
    case 'OH': return { type: 3, params: { tone: 300, decay: dial(k(0)), color: 0.5 } }
    case 'CP': return { type: 4, params: { tone: 200, decay: 0.5, color: 0.4 } }
    case 'LT': return { type: 5, params: { tone: 82 + k(0) * 1.8, decay: 0.5, color: 0.4 } }
    case 'MT': return { type: 5, params: { tone: 125 + k(0) * 2.9, decay: 0.5, color: 0.4 } }
    case 'HT': return { type: 5, params: { tone: 171 + k(0) * 4.2, decay: 0.5, color: 0.4 } }
    case 'RS': return { type: 6, params: { tone: 436, decay: 0.35, color: 0.5 } }
    case 'CB': return { type: 7, params: { tone: 540, decay: 0.45, color: 0.5 } }
    case 'CY': return { type: 8, params: { tone: 300, color: dial(k(0)), decay: dial(k(1)) } }
    case 'MA': return { type: 9, params: { tone: 300, decay: 0.3, color: 0.5 } }
    // Congas are the tom circuit tuned up (the 808 panel literally switches
    // between them); claves shares the rimshot circuit. Tuning ranges are the
    // measured f0 of the kit's samples at knob 0 and 10.
    case 'LC': return { type: 10, params: { tone: 185 + k(0) * 4.0, decay: 0.5, color: 0 } }
    case 'MC': return { type: 10, params: { tone: 259 + k(0) * 6.1, decay: 0.5, color: 0 } }
    case 'HC': return { type: 10, params: { tone: 375 + k(0) * 9.1, decay: 0.5, color: 0 } }
    case 'CL': return { type: 11, params: { tone: 2423, decay: 0.5, color: 0 } }
    default: return null
  }
}
