// Piano-roll edits: the roll shows any number of notes per step, the pattern
// stores a root plus intervals with one length and velocity per step.
import { describe, it, expect } from 'vitest'
import { addNote, moveNote, pitchesOf, removeNote, rollNotes, setLength, setVelocity, PITCH_MAX } from '../src/lib/roll.ts'
import type { NoteStep } from '../src/lib/track.svelte.ts'
import { DEMOS } from '../src/lib/demos.ts'

const empty = (n = 16): NoteStep[] => Array.from({ length: n }, () => ({ note: null, velocity: 100 }))

describe('piano roll edits', () => {
  it('reads a chord step as its notes, low to high', () => {
    expect(pitchesOf({ note: 60, velocity: 100, chord: [7, 3] })).toEqual([60, 63, 67])
    expect(pitchesOf({ note: null, velocity: 100 })).toEqual([])
    expect(pitchesOf({ note: 45, velocity: 100, chord: [3, 12, 12] })).toEqual([45, 48, 57])   // a doubled voice, once
    const notes = rollNotes([{ note: 60, velocity: 90, chord: [4], length: 3 }, { note: 62, velocity: 70 }], 0.5)
    expect(notes).toEqual([
      { step: 0, pitch: 60, len: 3, velocity: 90 }, { step: 0, pitch: 64, len: 3, velocity: 90 },
      { step: 1, pitch: 62, len: 0.5, velocity: 70 },     // no length of its own: the gate
    ])
  })

  it('places a note, and stacks further ones on the step as a chord', () => {
    const s = empty()
    expect(addNote(s, 4, 64, { length: 2, velocity: 80 })).toBe(true)
    expect(s[4]).toEqual({ note: 64, velocity: 80, length: 2 })
    expect(addNote(s, 4, 67)).toBe(true)
    expect(s[4]).toEqual({ note: 64, velocity: 80, length: 2, chord: [3] })
    // A note under the root becomes the root; the notes sounding stay the same.
    expect(addNote(s, 4, 60, { length: 9 })).toBe(true)
    expect(s[4]).toEqual({ note: 60, velocity: 80, length: 2, chord: [4, 7] })
    expect(addNote(s, 4, 60)).toBe(false)               // already there
    expect(addNote(s, 4, PITCH_MAX + 1)).toBe(false)    // off the keyboard
    expect(addNote(s, 99, 60)).toBe(false)
  })

  it('removes one note of a chord, and empties the step with the last', () => {
    const s = empty()
    s[0] = { note: 60, velocity: 100, chord: [4, 7], length: 4, pressure: 0.8, scoop: 2 }
    expect(removeNote(s, 0, 60)).toBe(true)
    expect(pitchesOf(s[0]!)).toEqual([64, 67])
    expect(s[0]!.pressure).toBe(0.8)
    removeNote(s, 0, 64)
    expect(s[0]).toEqual({ note: 67, velocity: 100, length: 4, pressure: 0.8, scoop: 2 })
    removeNote(s, 0, 67)
    expect(s[0]).toEqual({ note: null, velocity: 100 })   // its length and expression go with it
    expect(removeNote(s, 0, 67)).toBe(false)
  })

  it('moves a lone note with everything it carries', () => {
    const s = empty()
    s[2] = { note: 60, velocity: 90, length: 3, pressure: 0.7, pressureAt: 0.5 }
    expect(moveNote(s, 2, 60, 6, 65)).toBe(true)
    expect(s[2]).toEqual({ note: null, velocity: 90 })
    expect(s[6]).toEqual({ note: 65, velocity: 90, length: 3, pressure: 0.7, pressureAt: 0.5 })
    expect(moveNote(s, 6, 65, 6, 67)).toBe(true)          // pitch only
    expect(s[6]!.note).toBe(67)
    expect(s[6]!.pressure).toBe(0.7)
  })

  it('pulls a note out of a chord with only its length and velocity', () => {
    const s = empty()
    s[0] = { note: 60, velocity: 90, chord: [4, 7], length: 4, pressure: 0.7 }
    expect(moveNote(s, 0, 64, 8, 64)).toBe(true)
    expect(s[0]).toEqual({ note: 60, velocity: 90, chord: [7], length: 4, pressure: 0.7 })
    expect(s[8]).toEqual({ note: 64, velocity: 90, length: 4 })
  })

  it('joins the chord of a step that already sounds, at that step\'s length', () => {
    const s = empty()
    s[0] = { note: 60, velocity: 90, length: 8 }
    s[4] = { note: 67, velocity: 70, length: 2 }
    expect(moveNote(s, 0, 60, 4, 60)).toBe(true)
    expect(s[0]!.note).toBe(null)
    expect(s[4]).toEqual({ note: 60, velocity: 70, length: 2, chord: [7] })
  })

  it('refuses a move onto a note that is already there, or off the keyboard', () => {
    const s = empty()
    s[0] = { note: 60, velocity: 90, chord: [4] }
    s[4] = { note: 64, velocity: 90 }
    const before = structuredClone(s)
    expect(moveNote(s, 0, 60, 0, 64)).toBe(false)
    expect(moveNote(s, 0, 64, 4, 64)).toBe(false)
    expect(moveNote(s, 0, 60, 0, 5)).toBe(false)
    expect(moveNote(s, 0, 61, 1, 61)).toBe(false)          // no such note
    expect(moveNote(s, 0, 60, 0, 60)).toBe(false)
    expect(s).toEqual(before)
  })

  it('sets length and velocity within their limits', () => {
    const s = empty()
    s[0] = { note: 60, velocity: 90 }
    expect(setLength(s, 0, 6)).toBe(true)
    expect(s[0]!.length).toBe(6)
    expect(setLength(s, 0, 6)).toBe(false)
    setLength(s, 0, 999); expect(s[0]!.length).toBe(16)
    setLength(s, 0, 0); expect(s[0]!.length).toBe(0.25)
    expect(setLength(s, 1, 2)).toBe(false)                 // a rest has no length
    setVelocity(s, 0, 300); expect(s[0]!.velocity).toBe(127)
    setVelocity(s, 0, -4); expect(s[0]!.velocity).toBe(1)
    expect(setVelocity(s, 1, 80)).toBe(false)
  })

  it('can rebuild every demo pattern note by note', () => {
    for (const demo of DEMOS) {
      for (const t of demo.build().tracks) {
        if (!t.steps?.length) continue
        const built = empty(t.steps.length)
        for (const n of rollNotes(t.steps, 0.8)) {
          const src = t.steps[n.step]!
          addNote(built, n.step, n.pitch, { velocity: n.velocity, ...(src.length !== undefined ? { length: src.length } : {}) })
        }
        built.forEach((s, i) => {
          expect(pitchesOf(s), `${demo.id} ${t.name} step ${i}`).toEqual(pitchesOf(t.steps![i]!))
          expect(s.length).toBe(t.steps![i]!.note === null ? undefined : t.steps![i]!.length)
        })
      }
    }
  })
})
