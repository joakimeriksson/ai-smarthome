// Reference index for the TR-808 sample kit.
//
// The Michael Fischer set (1994) was recorded from a real TR-808 off the
// individual voice outputs, and its filenames encode the exact knob positions —
// which makes it a fitting target rather than merely a reference. Each knob has
// eleven marks; the set samples five of them.
//
// The encoding has one trap: "10" means position 10.0, the MAXIMUM, not 1.0.
// So the ascending order is 00, 25, 50, 75, 10.
//
// Point KIT_DIR at the kit, or set TR808_KIT. Nothing here is checked in — the
// samples are third-party, same rule as tools/compare/refs.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

export const KIT_DIR =
  process.env['TR808_KIT'] ?? resolve(homedir(), 'Downloads/Roland TR-808')

export const kitPresent = (): boolean => existsSync(KIT_DIR)

/** Knob-position codes in ascending order, with their dial values. */
export const POSITIONS: { code: string; value: number }[] = [
  { code: '00', value: 0 },
  { code: '25', value: 2.5 },
  { code: '50', value: 5 },
  { code: '75', value: 7.5 },
  { code: '10', value: 10 },      // maximum, despite reading as "one-zero"
]

/** Voice-code → the knobs it has, in filename order. */
export const VOICE_KNOBS: Record<string, string[]> = {
  BD: ['tone', 'decay'],
  SD: ['tuning', 'snappy'],
  CY: ['tone', 'decay'],
  OH: ['decay'],
  LT: ['tuning'], MT: ['tuning'], HT: ['tuning'],
  LC: ['tuning'], MC: ['tuning'], HC: ['tuning'],
  CH: [], CP: [], RS: [], CB: [], MA: [], CL: [],
}

export interface Sample {
  voice: string
  /** Dial positions 0..10, in the same order as VOICE_KNOBS[voice]. */
  knobs: number[]
  path: string
}

/** Every sample in the kit, with its knob settings decoded from the name. */
export function listSamples(voice?: string): Sample[] {
  const out: Sample[] = []
  for (const v of Object.keys(VOICE_KNOBS)) {
    if (voice && v !== voice) continue
    const dir = resolve(KIT_DIR, v)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.toUpperCase().endsWith('.WAV')) continue
      const stem = name.slice(0, -4).toUpperCase()
      const digits = stem.slice(v.length)
      const knobs: number[] = []
      let ok = true
      for (let i = 0; i < digits.length; i += 2) {
        const hit = POSITIONS.find(p => p.code === digits.slice(i, i + 2))
        if (!hit) { ok = false; break }
        knobs.push(hit.value)
      }
      if (ok && knobs.length === VOICE_KNOBS[v]!.length) {
        out.push({ voice: v, knobs, path: resolve(dir, name) })
      }
    }
  }
  return out
}

export function findSample(voice: string, ...knobs: number[]): Sample | undefined {
  return listSamples(voice).find(s =>
    s.knobs.length === knobs.length && s.knobs.every((k, i) => k === knobs[i]))
}

// ---------------------------------------------------------------------------

export interface Wav { data: Float64Array; rate: number }

/** 16-bit PCM reader; mixes to mono. */
export function readWav(path: string): Wav {
  const b = readFileSync(path)
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`not a RIFF file: ${path}`)
  let pos = 12
  let channels = 0
  let rate = 0
  let bits = 0
  let data: Buffer | null = null
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4)
    const size = b.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      channels = b.readUInt16LE(pos + 10)
      rate = b.readUInt32LE(pos + 12)
      bits = b.readUInt16LE(pos + 22)
    } else if (id === 'data') {
      data = b.subarray(pos + 8, pos + 8 + size)
    }
    pos += 8 + size + (size & 1)          // chunks are word-aligned
  }
  if (!data || !rate) throw new Error(`missing fmt/data chunk: ${path}`)
  if (bits !== 16) throw new Error(`${path}: ${bits}-bit WAV not supported`)

  const frames = Math.floor(data.length / 2 / channels)
  const out = new Float64Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += data.readInt16LE((i * channels + c) * 2) / 32768
    out[i] = s / channels
  }
  return { data: out, rate }
}
