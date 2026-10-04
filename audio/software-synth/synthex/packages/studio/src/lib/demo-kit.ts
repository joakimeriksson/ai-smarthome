// Helpers for writing the built-in demo songs by hand (demo.ts, demo-hiscore.ts).

import type { ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import type { FxSlotSpec, ProjectBus } from './fx.ts'

const PC: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

/** 'A4' -> 69; sharps or flats ('Bb2'). */
export function n(name: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad note ${name}`)
  return PC[m[1]!]! + (Number(m[2]) + 1) * 12
}

export const rests = (len: number): NoteStep[] =>
  Array.from({ length: len }, () => ({ note: null, velocity: 100 }))

/**
 * Notes as [bar, step, note, length in steps, velocity?, aftertouch?].
 * Lengths stop a hair short of the next note so a held line re-articulates
 * cleanly; aftertouch (0..1) is NoteStep.pressure — the player leaning in.
 */
export function phrase(len: number, spec: [number, number, string, number, number?, number?][]): NoteStep[] {
  const cells = rests(len)
  for (const [bar, step, note, hold, vel, press] of spec) {
    cells[bar * 16 + step] = press
      ? { note: n(note), velocity: vel ?? 100, length: hold, pressure: press }
      : { note: n(note), velocity: vel ?? 100, length: hold }
  }
  return cells
}

/** An empty 8-channel drum grid, `len` steps wide. */
export const emptyGrid = (len: number): number[][] =>
  Array.from({ length: 8 }, () => new Array<number>(len).fill(0))

/** A project track with the defaults filled in. */
export function track(len: number, t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>): ProjectTrack {
  return {
    level: 0.8, pan: 0, muted: false, soloed: false, gate: 0.8, transpose: 0,
    steps: rests(len), drumGrid: emptyGrid(len), presetName: null, params: {},
    ...t,
  }
}

/**
 * A synth's own chorus, delay and reverb switched off, so its sound goes
 * through the studio's inserts and returns instead: one shared reverb for
 * the song, not one per synth.
 */
export const DRY: Record<string, boolean> = {
  'fx.chorus.enabled': false, 'fx.delay.enabled': false, 'fx.reverb.enabled': false,
}

/** A return bus. */
export function ret(id: string, name: string, level: number, ...inserts: FxSlotSpec[]): ProjectBus {
  return { id, name, level, pan: 0, muted: false, inserts }
}
