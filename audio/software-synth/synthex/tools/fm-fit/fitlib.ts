// Fit the FM synth's factory presets against real DX7 recordings.
//
//   npm run fm-fit                 report distance for every mapped preset
//   npm run fm-fit -- optimize     coordinate-descent the numeric parameters
//
// The DX7 pack (soundpacks.com, ~/Downloads) is multisampled patches, not
// knob-labelled captures — so unlike drum-fit there is no ground-truth
// parameter mapping. Each preset here starts from the DOCUMENTED structure of
// the famous DX7 patch (E.PIANO 1's detached tine modulator, BRASS 1's
// slow-attack unison stacks) and the numbers are then fitted to the recording.
//
// Distance = time-windowed harmonic ladders + an envelope trace, both
// level-normalised. FM tones are harmonic, so a ladder at k·f0 captures the
// spectrum far more efficiently than a broadband sweep — and the WINDOWED
// ladders capture the DX7 signature: brightness that falls as the modulator
// envelopes close.

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { readWav } from '../drum-fit/kit.ts'
import { renderPreset, SR, type FmPreset } from './render.ts'
import { PRESET_SEEDS } from './seeds.ts'
export { PRESET_SEEDS }

export const PACK_DIR = process.env['DX7_PACK'] ??
  resolve(homedir(), 'Downloads/yamaha_dx7_sample_pack/Yamaha DX7 Sample Pack')

/**
 * Which recording each preset is fitted against, and at which MIDI note the
 * sample was verified to sit (harmonic-sum detection, checked by hand).
 * Multisample siblings serve as validation at other pitches.
 */
export const TARGETS: { preset: string; file: string; note: number; validate?: { file: string; note: number } }[] = [
  { preset: 'E.Piano 1', file: 'epiano1-2c.wav', note: 48, validate: { file: 'epiano1-1c.wav', note: 36 } },
  { preset: 'DX Brass', file: 'brass1c.wav', note: 48, validate: { file: 'brass3c.wav', note: 36 } },
  { preset: 'Strings', file: 'Strings1-1c.wav', note: 48 },
  { preset: 'Organ', file: 'eorgan4c.wav', note: 48 },   // fundamental is C3; C2 content is the sub drawbar
  { preset: 'Wurlitzer', file: 'wurlitzer1-2c.wav', note: 48 },
]

function goertzel(b: Float64Array, f: number, rate: number, from: number, len: number): number {
  const c = 2 * Math.cos(2 * Math.PI * f / rate)
  let s1 = 0, s2 = 0
  const end = Math.min(from + len, b.length)
  for (let i = from; i < end; i++) { const s = b[i]! + c * s1 - s2; s2 = s1; s1 = s }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - c * s1 * s2)) / Math.max(1, end - from)
}

const rms = (b: Float64Array, from: number, len: number): number => {
  let s = 0
  const end = Math.min(from + len, b.length)
  for (let i = from; i < end; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, end - from))
}

/**
 * Harmonic ladder (h1..h16 in dB, normalised to its own loudest harmonic) in
 * each analysis window. Windows are proportional so short and long samples
 * are treated alike.
 */
export function ladders(b: Float64Array, rate: number, f0: number, seconds: number): number[][] {
  const windows: [number, number][] = [
    [0.01, 0.12], [0.15, 0.45], [0.5, 0.95],
  ]
  return windows.map(([a, z]) => {
    const from = Math.round(a * seconds * rate)
    const len = Math.max(1024, Math.round((z - a) * seconds * rate))
    const mags: number[] = []
    for (let h = 1; h <= 16; h++) {
      const f = f0 * h
      mags.push(f < rate * 0.45 ? 20 * Math.log10(Math.max(1e-9, goertzel(b, f, rate, from, len))) : -180)
    }
    const mx = Math.max(...mags)
    return mags.map(v => Math.max(v - mx, -60))
  })
}

/** RMS envelope at proportional marks, dB relative to its own peak. */
export function envTrace(b: Float64Array, rate: number, seconds: number): number[] {
  const marks = [0.02, 0.06, 0.12, 0.25, 0.45, 0.7, 0.92]
  let pk = 0
  for (let i = 0; i < b.length; i += 64) pk = Math.max(pk, Math.abs(b[i]!))
  const w = Math.round(rate * 0.02)
  return marks.map(m =>
    20 * Math.log10(Math.max(1e-5, rms(b, Math.round(m * seconds * rate), w) / (pk || 1e-9))))
}

export function distance(
  ref: Float64Array, refRate: number, mine: Float64Array, f0: number, seconds: number,
): number {
  const la = ladders(ref, refRate, f0, seconds)
  const lb = ladders(mine, SR, f0, seconds)
  let spec = 0, n = 0
  for (let w = 0; w < la.length; w++) {
    for (let h = 0; h < la[w]!.length; h++) { spec += Math.abs(la[w]![h]! - lb[w]![h]!); n++ }
  }
  const ea = envTrace(ref, refRate, seconds)
  const eb = envTrace(mine, SR, seconds)
  let env = 0
  for (let i = 0; i < ea.length; i++) env += Math.abs(ea[i]! - eb[i]!)
  // Spectrum dominates; the envelope term keeps decays honest.
  return spec / n + 0.5 * (env / ea.length)
}

export function scorePreset(preset: FmPreset, file: string, note: number): number {
  const ref = readWav(resolve(PACK_DIR, file))
  const seconds = Math.min(3, ref.data.length / ref.rate)
  const mine = renderPreset(preset, note, seconds)
  return distance(ref.data, ref.rate, mine, 440 * Math.pow(2, (note - 69) / 12), seconds)
}

