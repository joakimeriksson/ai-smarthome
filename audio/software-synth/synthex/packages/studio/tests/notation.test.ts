// A step pattern as written music: values, ties, accidentals, beams.
import { describe, it, expect } from 'vitest'
import { chooseClef, engrave, keySignature, pieces, spell } from '../src/lib/notation.ts'
import type { NoteStep } from '../src/lib/track.svelte.ts'
import { DEMOS } from '../src/lib/demos.ts'

const empty = (n = 16): NoteStep[] => Array.from({ length: n }, () => ({ note: null, velocity: 100 }))
const pattern = (n: number, notes: Record<number, Partial<NoteStep> & { note: number }>): NoteStep[] => {
  const s = empty(n)
  for (const [i, v] of Object.entries(notes)) s[Number(i)] = { velocity: 100, ...v }
  return s
}
const LETTERS = 'FCGDAEB'
const name = (midi: number, fifths: number) => {
  const { letter, acc } = spell(midi, fifths)
  return LETTERS[letter] + (acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc))
}
/** A bar as text: "4 C#5+E5~" is a quarter-note chord tied on; "r2" an 8th rest. */
const show = (steps: NoteStep[], fifths = 0) => engrave(steps, fifths).bars.map(b => b.events.map(e =>
  e.notes.length ? `${e.tieIn ? '~' : ''}${e.dur}@${e.start}${e.tieOut ? '~' : ''}` : `r${e.dur}@${e.start}`).join(' '))

describe('spelling', () => {
  it('names the notes of a key as the key does, and the others by convention', () => {
    expect([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].map(m => name(m, 0)))
      .toEqual(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'])
    // F minor (four flats): its own notes are flats, the raised 7th a natural.
    expect([65, 67, 68, 70, 72, 73, 75, 76].map(m => name(m, -4))).toEqual(['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb', 'E'])
    expect([64, 66, 68, 69, 71, 73, 75, 74].map(m => name(m, 4))).toEqual(['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#', 'D'])
  })
  it('puts a note on the staff by its letter, not its pitch', () => {
    expect(spell(60, 0).pos).toBe(28)                         // C4
    expect(name(59, -6)).toBe('Cb')
    expect(spell(59, -6).pos).toBe(28)                        // Cb4 is written as a C4
    expect(spell(61, 0).pos).toBe(28)                         // C#4 too
    expect(spell(63, 0).pos).toBe(30)                         // Eb4: the treble staff's bottom line
  })
  it('finds each dance demo\'s key signature', () => {
    const sig = (id: string) => keySignature(DEMOS.find(d => d.id === id)!.build().tracks.flatMap(t => (t.steps?.length ? [t.steps] : [])))
    expect(sig('rollout')).toBe(-4)       // F minor
    expect(sig('skyline')).toBe(-2)       // G minor
    expect(sig('afterglow')).toBe(-3)     // C minor
    expect(keySignature([pattern(16, { 0: { note: 60 }, 1: { note: 64 }, 2: { note: 67 } })])).toBe(0)
    expect(keySignature([pattern(16, { 0: { note: 62 }, 1: { note: 66 }, 2: { note: 69 }, 3: { note: 73 } })])).toBe(2)
    expect(keySignature([])).toBe(0)
  })
})

describe('note values', () => {
  it('cuts a span so that every beat stays visible', () => {
    expect(pieces(0, 16, false)).toEqual([[0, 16]])
    expect(pieces(0, 12, false)).toEqual([[0, 12]])           // dotted half
    expect(pieces(0, 12, true)).toEqual([[0, 8], [8, 4]])     // rests take no dot
    expect(pieces(4, 12, false)).toEqual([[4, 8]])            // quarter, HALF, quarter
    expect(pieces(4, 16, false)).toEqual([[4, 4], [8, 8]])    // never hide the half bar for longer
    expect(pieces(4, 12, true)).toEqual([[4, 4], [8, 4]])
    expect(pieces(2, 8, false)).toEqual([[2, 2], [4, 4]])
    expect(pieces(1, 4, false)).toEqual([[1, 3]])             // 16th, then a dotted 8th
    expect(pieces(1, 4, true)).toEqual([[1, 1], [2, 2]])
    expect(pieces(0, 3, true)).toEqual([[0, 2], [2, 1]])
    expect(pieces(3, 9, false)).toEqual([[3, 1], [4, 4], [8, 1]])
  })

  it('writes held notes with ties across beats and bar lines', () => {
    expect(show(pattern(32, { 2: { note: 60, length: 6 } }))).toEqual(['r2@0 2@2~ ~4@4 r8@8', 'r16@0'])
    expect(show(pattern(32, { 12: { note: 60, length: 8 } }))).toEqual(['r8@0 r4@8 4@12~', '~4@0 r4@4 r8@8'])
    expect(show(pattern(16, { 0: { note: 60, length: 15.75 } }))).toEqual(['16@0'])
    expect(show(pattern(16, { 0: { note: 60, length: 0.6 }, 1: { note: 62, length: 0.6 } }))[0]).toMatch(/^1@0 1@1 r2@2/)
  })

  it('ends a note where the next one starts', () => {
    expect(show(pattern(16, { 0: { note: 60, length: 8 }, 4: { note: 64, length: 2 } }))).toEqual(['4@0 2@4 r2@6 r8@8'])
  })

  it('writes gated notes out to the beat', () => {
    expect(show(pattern(16, { 0: { note: 60 }, 8: { note: 62 }, 10: { note: 64 }, 13: { note: 65 } })))
      .toEqual(['4@0 r4@4 2@8 2@10 r1@12 3@13'])
  })

  it('tiles every bar of every demo with values that can be written', () => {
    for (const demo of DEMOS) {
      const p = demo.build()
      const fifths = keySignature(p.tracks.flatMap(t => (t.steps?.length ? [t.steps] : [])))
      for (const t of p.tracks) {
        if (!t.steps?.length) continue
        const score = engrave(t.steps, fifths)
        expect(score.bars.length).toBe(t.steps.length / 16)
        const flat = score.bars.flatMap((b, i) => b.events.map(e => ({ ...e, at: i * 16 + e.start })))
        score.bars.forEach((bar, b) => {
          let at = 0
          for (const e of bar.events) {
            expect(e.start, `${demo.id} ${t.name} bar ${b + 1}`).toBe(at)
            expect(e.notes.length ? [1, 2, 3, 4, 8, 12, 16] : [1, 2, 4, 8, 16]).toContain(e.dur)
            // Nothing crosses a beat it does not start on.
            if (e.start % 4) expect(e.start % 4 + e.dur).toBeLessThanOrEqual(4)
            at += e.dur
          }
          expect(at).toBe(16)
        })
        flat.forEach((e, i) => {
          const next = flat[i + 1]
          if (e.tieOut) {
            expect(next?.tieIn).toBe(true)
            expect(next!.notes.map(n => n.midi)).toEqual(e.notes.map(n => n.midi))
          } else if (next) expect(next.tieIn).toBe(false)
        })
        // Every note of the pattern starts where it is written, on the pitches it plays.
        t.steps.forEach((s, i) => {
          const e = flat.find(x => x.at === i)
          if (s.note === null) { if (e?.notes.length) expect(e.tieIn).toBe(true); return }
          expect(e?.tieIn, `${demo.id} ${t.name} step ${i}`).toBe(false)
          expect(e!.notes.map(n => n.midi)).toEqual([...new Set([s.note, ...(s.chord ?? []).map(iv => s.note! + iv)])].sort((a, b) => a - b))
        })
      }
    }
  })
})

describe('accidentals, beams and clefs', () => {
  it('draws an accidental once per bar, and cancels it', () => {
    const s = pattern(32, { 0: { note: 66 }, 4: { note: 66 }, 8: { note: 65 }, 12: { note: 66 }, 16: { note: 66 }, 20: { note: 65 } })
    const shown = engrave(s, 0).bars.map(b => b.events.filter(e => e.notes.length).map(e => (e.notes[0]!.show ? e.notes[0]!.acc : null)))
    expect(shown).toEqual([[1, null, 0, 1], [1, 0]])
    // In G major the F# is the key's: only the F natural is marked, and then the F# after it.
    const inG = engrave(s, 1).bars.map(b => b.events.filter(e => e.notes.length).map(e => (e.notes[0]!.show ? e.notes[0]!.acc : null)))
    expect(inG).toEqual([[null, null, 0, 1], [null, 0]])
  })
  it('does not repeat an accidental on a tied note', () => {
    const bars = engrave(pattern(32, { 12: { note: 66, length: 8 } }), 0).bars
    expect(bars[0]!.events.at(-1)!.notes[0]!.show).toBe(true)
    expect(bars[1]!.events[0]!.notes[0]!.show).toBe(false)
  })
  it('beams the short notes of a beat, and stops at a rest or the beat', () => {
    const s = pattern(16, {
      0: { note: 60, length: 1 }, 1: { note: 62, length: 1 }, 2: { note: 64, length: 1 }, 3: { note: 65, length: 1 },
      4: { note: 60, length: 2 }, 6: { note: 62, length: 2 },
      8: { note: 60, length: 1 }, 10: { note: 62, length: 1 }, 11: { note: 64, length: 1 },
      12: { note: 60, length: 4 },
    })
    const beams = engrave(s, 0).bars[0]!.events.filter(e => e.notes.length).map(e => e.beam)
    expect(beams).toEqual([0, 0, 0, 0, 1, 1, -1, 2, 2, -1])
  })
  it('picks the clef that keeps the part on the staff', () => {
    expect(chooseClef(pattern(16, { 0: { note: 67 } }))).toEqual({ sign: 'treble', octave: 0 })
    expect(chooseClef(pattern(16, { 0: { note: 48 } }))).toEqual({ sign: 'bass', octave: 0 })
    expect(chooseClef(pattern(16, { 0: { note: 29 } }))).toEqual({ sign: 'bass', octave: -1 })
    expect(chooseClef(pattern(16, { 0: { note: 91 } }))).toEqual({ sign: 'treble', octave: 1 })
    expect(chooseClef(empty())).toEqual({ sign: 'treble', octave: 0 })
    // Middle C: one ledger line below the treble staff, one above the bass; an octave mark moves it by 7.
    expect(engrave(pattern(16, { 0: { note: 60 } }), 0).bars[0]!.events[0]!.notes[0]!.line).toBe(-2)
    expect(engrave(pattern(16, { 0: { note: 59 } }), 0).bars[0]!.events[0]!.notes[0]!.line).toBe(9)
    expect(engrave(pattern(16, { 0: { note: 29 } }), 0).bars[0]!.events[0]!.notes[0]!.line).toBe(-1)   // F1 written as F2
  })
})
