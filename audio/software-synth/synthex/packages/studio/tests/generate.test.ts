// The generator is what makes the dice button worth pressing, so the
// musical invariants are worth asserting: notes stay in key, rhythms stay
// even, and a roll always produces something you can hear.

import { describe, it, expect } from 'vitest'
import {
  euclid, degreeToMidi, snapToScale, makeRng, riff, bassLine, drumGrid,
  SCALES, DRUM,
} from '../src/lib/generate.ts'

describe('euclid', () => {
  it('places exactly the requested number of pulses', () => {
    for (const [steps, pulses] of [[16, 4], [16, 5], [8, 3], [16, 1], [12, 7]]) {
      const hits = euclid(steps!, pulses!)
      expect(hits.filter(Boolean).length).toBe(pulses)
    }
  })

  it('produces the classic four-on-the-floor for 4-in-16', () => {
    expect(euclid(16, 4)).toEqual([
      true, false, false, false, true, false, false, false,
      true, false, false, false, true, false, false, false,
    ])
  })

  it('produces the tresillo for 3-in-8', () => {
    // Hits on 1, 4, 7 — the standard 3-against-8 figure.
    expect(euclid(8, 3)).toEqual([true, false, false, true, false, false, true, false])
  })

  it('spreads pulses evenly (no two gaps differ by more than one step)', () => {
    const hits = euclid(16, 5)
    const idx = hits.flatMap((h, i) => (h ? [i] : []))
    const gaps = idx.map((v, i) => (i === 0 ? v + 16 - idx[idx.length - 1]! : v - idx[i - 1]!))
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  })

  it('rotates without changing the pulse count', () => {
    const a = euclid(16, 5)
    const b = euclid(16, 5, 3)
    expect(b.filter(Boolean).length).toBe(a.filter(Boolean).length)
    expect(b).not.toEqual(a)
  })

  it('handles the degenerate cases', () => {
    expect(euclid(16, 0).some(Boolean)).toBe(false)
    expect(euclid(16, 99).every(Boolean)).toBe(true)
    expect(euclid(0, 4)).toEqual([])
  })
})

describe('scale mapping', () => {
  it('maps degrees within and beyond one octave', () => {
    const pent = SCALES.minorPentatonic       // [0,3,5,7,10]
    expect(degreeToMidi(57, pent, 0)).toBe(57)
    expect(degreeToMidi(57, pent, 1)).toBe(60)
    expect(degreeToMidi(57, pent, 5)).toBe(69)   // root, one octave up
    expect(degreeToMidi(57, pent, 6)).toBe(72)
  })

  it('walks downward for negative degrees', () => {
    const pent = SCALES.minorPentatonic
    expect(degreeToMidi(57, pent, -1)).toBe(55)  // 10 semitones below the octave
    expect(degreeToMidi(57, pent, -5)).toBe(45)  // root, one octave down
  })

  it('snaps arbitrary notes into the scale', () => {
    const pent = SCALES.minorPentatonic
    for (const midi of [57, 58, 59, 61, 63, 66, 70]) {
      const snapped = snapToScale(midi, 57, pent)
      expect(pent).toContain(((snapped - 57) % 12 + 12) % 12)
    }
  })
})

describe('riff', () => {
  it('only emits notes that are in the given scale', () => {
    const scale = SCALES.naturalMinor
    for (let seed = 1; seed <= 30; seed++) {
      const cells = riff(makeRng(seed), { rootMidi: 57, scale })
      for (const c of cells) {
        if (c.note === null) continue
        expect(scale).toContain(((c.note - 57) % 12 + 12) % 12)
      }
    }
  })

  it('always starts on a note, so a roll is never silent on the downbeat', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(riff(makeRng(seed))[0]!.note).not.toBeNull()
    }
  })

  it('produces a sane number of notes for the requested density', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sparse = riff(makeRng(seed), { density: 0.2 }).filter(c => c.note !== null).length
      const dense = riff(makeRng(seed), { density: 0.9 }).filter(c => c.note !== null).length
      expect(sparse).toBeGreaterThan(0)
      expect(dense).toBeGreaterThanOrEqual(sparse)
      expect(dense).toBeLessThanOrEqual(16)
    }
  })

  it('is reproducible for a given seed', () => {
    expect(riff(makeRng(42))).toEqual(riff(makeRng(42)))
    expect(riff(makeRng(42))).not.toEqual(riff(makeRng(43)))
  })

  it('keeps the bass low and sparse', () => {
    const cells = bassLine(makeRng(7))
    const notes = cells.filter(c => c.note !== null).map(c => c.note!)
    expect(Math.max(...notes)).toBeLessThan(57)   // below A3
    expect(notes.length).toBeLessThanOrEqual(12)
  })
})

describe('drumGrid', () => {
  it('always lands a kick on the downbeat', () => {
    for (let seed = 1; seed <= 30; seed++) {
      expect(drumGrid(makeRng(seed))[DRUM.KICK]![0]).toBeGreaterThan(0)
    }
  })

  it('fills the requested shape with velocities in range', () => {
    const grid = drumGrid(makeRng(3), 16, 8)
    expect(grid).toHaveLength(8)
    for (const row of grid) {
      expect(row).toHaveLength(16)
      for (const v of row) expect(v).toBeGreaterThanOrEqual(0)
      for (const v of row) expect(v).toBeLessThanOrEqual(127)
    }
  })

  it('always produces an audible beat with more than one voice', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const grid = drumGrid(makeRng(seed))
      const voices = grid.filter(row => row.some(v => v > 0)).length
      expect(voices).toBeGreaterThanOrEqual(2)
    }
  })

  it('never writes outside the channel count', () => {
    const grid = drumGrid(makeRng(11), 16, 4)
    expect(grid).toHaveLength(4)
  })
})
