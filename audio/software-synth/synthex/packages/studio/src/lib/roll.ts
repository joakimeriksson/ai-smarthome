// Piano-roll edits on a step pattern.
//
// A melodic track stores one NoteStep per 16th: a root, optional chord
// intervals above it, and one velocity and length for the lot. So the roll
// can show and edit any number of notes per step, with one rule the data
// imposes: notes that START on the same step share a length and a velocity.
// Every function here edits the array in place and says whether it changed.

import type { NoteStep } from './track.svelte.ts'

export const PITCH_MIN = 12      // C0
export const PITCH_MAX = 108     // C8

export interface RollNote {
  step: number
  pitch: number
  /** Steps it holds: the step's own length, or the track's gate. */
  len: number
  velocity: number
}

/**
 * The MIDI notes a step sounds, low to high, each once: a chord that lists
 * an interval twice (two voices on one pitch) is one note here, and an edit
 * to that step stores it as one.
 */
export function pitchesOf(s: NoteStep): number[] {
  if (s.note === null) return []
  const root = s.note
  return [...new Set([root, ...(s.chord ?? []).map(iv => root + iv)])].sort((a, b) => a - b)
}

export function rollNotes(steps: NoteStep[], gate: number): RollNote[] {
  return steps.flatMap((s, step) =>
    pitchesOf(s).map(pitch => ({ step, pitch, len: s.length ?? gate, velocity: s.velocity })))
}

/** Empty a step, taking its expression with it. */
function clear(s: NoteStep): void {
  s.note = null
  delete s.chord; delete s.length
  delete s.pressure; delete s.pressureAt; delete s.scoop; delete s.bendUp
}

/** Store a set of notes as root + intervals; none empties the step. */
function setPitches(s: NoteStep, pitches: number[]): void {
  const p = [...new Set(pitches)].sort((a, b) => a - b)
  const root = p[0]
  if (root === undefined) { clear(s); return }
  s.note = root
  if (p.length > 1) s.chord = p.slice(1).map(x => x - root)
  else delete s.chord
}

const inRange = (pitch: number) => pitch >= PITCH_MIN && pitch <= PITCH_MAX

/** Add a note; on a step that already sounds, it joins the chord. */
export function addNote(steps: NoteStep[], step: number, pitch: number,
  init: { velocity?: number; length?: number } = {}): boolean {
  const s = steps[step]
  if (!s || !inRange(pitch)) return false
  const have = pitchesOf(s)
  if (have.includes(pitch)) return false
  if (!have.length) {
    clear(s)
    s.velocity = init.velocity ?? 100
    if (init.length !== undefined) s.length = init.length
  }
  setPitches(s, [...have, pitch])
  return true
}

export function removeNote(steps: NoteStep[], step: number, pitch: number): boolean {
  const s = steps[step]
  if (!s) return false
  const have = pitchesOf(s)
  if (!have.includes(pitch)) return false
  setPitches(s, have.filter(p => p !== pitch))
  return true
}

/**
 * Move one note in pitch, in time, or both. A note that was its step's only
 * one takes the step's expression (aftertouch, bends) along; one pulled out
 * of a chord takes only its length and velocity. Landing on a step that
 * already sounds, it joins that chord and adopts its length.
 */
export function moveNote(steps: NoteStep[], step: number, pitch: number, toStep: number, toPitch: number): boolean {
  const from = steps[step], to = steps[toStep]
  if (!from || !to || !inRange(toPitch) || (step === toStep && pitch === toPitch)) return false
  const have = pitchesOf(from)
  if (!have.includes(pitch) || (step === toStep ? have : pitchesOf(to)).includes(toPitch)) return false
  const rest = have.filter(p => p !== pitch)
  if (step === toStep) { setPitches(from, [...rest, toPitch]); return true }
  if (to.note === null) {
    const { chord: _chord, ...carried } = from
    const moved: NoteStep = rest.length
      ? { note: toPitch, velocity: from.velocity, ...(from.length !== undefined ? { length: from.length } : {}) }
      : { ...carried, note: toPitch }
    clear(to)
    Object.assign(to, moved)
  } else {
    setPitches(to, [...pitchesOf(to), toPitch])
  }
  setPitches(from, rest)
  return true
}

/** Hold a step's notes for `length` steps (never less than a quarter step). */
export function setLength(steps: NoteStep[], step: number, length: number): boolean {
  const s = steps[step]
  if (!s || s.note === null) return false
  const len = Math.max(0.25, Math.min(steps.length, length))
  if (s.length === len) return false
  s.length = len
  return true
}

export function setVelocity(steps: NoteStep[], step: number, velocity: number): boolean {
  const s = steps[step]
  if (!s || s.note === null) return false
  const v = Math.max(1, Math.min(127, Math.round(velocity)))
  if (s.velocity === v) return false
  s.velocity = v
  return true
}
