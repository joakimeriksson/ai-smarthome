// A step pattern as written music: which notes and rests to draw, where on
// the staff, with which accidentals, ties and beams. Pure data - the score
// view (ScoreView.svelte) only places what this returns.
//
// The pattern is read as ONE voice in 4/4 with the 16th as its smallest
// value, so two things are simplified on the way:
//   - a note ends, at the latest, where the next one starts (the roll shows
//     the overlap; the staff does not);
//   - a note with no length of its own (it plays for the track's gate) is
//     written to the next note or the end of its beat, whichever comes first,
//     the way a staccato line is written in full values - not as a 16th and
//     a string of rests.
// Lengths the pattern does spell out are rounded to the nearest 16th.

import type { NoteStep } from './track.svelte.ts'
import { pitchesOf } from './roll.ts'

export interface Clef {
  sign: 'treble' | 'bass'
  /** The part sounds this many octaves above (+1, 8va) or below (-1, 8vb) what is written. */
  octave: -1 | 0 | 1
}

export interface ScoreNote {
  midi: number
  /** Half-spaces above the staff's bottom line: 0 is that line, 8 the top one. */
  line: number
  /** Sharps (+) or flats (-) on the note. */
  acc: number
  /** Whether the accidental is drawn: it differs from the key, or from earlier in the bar. */
  show: boolean
}

export interface ScoreEvent {
  /** 16ths from the start of the bar, and 16ths long: 1, 2, 3, 4, 8, 12 or 16. */
  start: number
  dur: number
  /** Low to high; none for a rest. */
  notes: ScoreNote[]
  tieIn: boolean
  tieOut: boolean
  /** Events of one bar sharing a number are beamed together; -1 for none. */
  beam: number
}

export interface ScoreBar {
  events: ScoreEvent[]
  /** Nothing but rests: drawn as one whole-bar rest. */
  empty: boolean
}

export interface Score { fifths: number; clef: Clef; bars: ScoreBar[] }

/** Staff lines (as `ScoreNote.line`) of a treble key signature; the bass clef's sit 2 lower. */
export const SIGNATURE_LINES = { sharps: [8, 5, 9, 6, 3, 7, 4], flats: [4, 7, 3, 6, 2, 5, 1] }

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const LETTER_STEP = [3, 0, 4, 1, 5, 2, 6]    // F C G D A E B, as steps above C
const BOTTOM_LINE = { treble: 30, bass: 18 } // E4 and G2, counting letters from C0

/**
 * The key signature (sharps > 0, flats < 0) that leaves the fewest notes
 * needing an accidental - across every pattern given, so the tracks of a
 * song share one. Ties go to the plainer signature.
 */
export function keySignature(patterns: NoteStep[][]): number {
  const count = new Array<number>(12).fill(0)
  for (const steps of patterns) for (const s of steps) for (const p of pitchesOf(s)) count[p % 12]!++
  let best = 0, bestMiss = Infinity
  for (const k of [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6]) {
    const tonic = ((k * 7) % 12 + 12) % 12
    const miss = count.reduce((sum, c, pc) => sum + (MAJOR.includes((pc - tonic + 12) % 12) ? 0 : c), 0)
    if (miss < bestMiss) { best = k; bestMiss = miss }
  }
  return best
}

/**
 * Name a MIDI note in a key. Each pitch class has one spelling within the
 * twelve fifths from three below the key to eight above it: in C that is
 * Eb Bb F C G D A E B F# C# G# - the key's own notes, flats for the lowered
 * 3rd and 7th, sharps for the raised 1st, 4th and 5th.
 */
export function spell(midi: number, fifths: number): { letter: number; acc: number; pos: number } {
  let f = (((midi % 12) + 12) % 12) * 7 % 12
  while (f > fifths + 8) f -= 12
  while (f < fifths - 3) f += 12
  const letter = (((f + 1) % 7) + 7) % 7          // index into F C G D A E B
  const acc = Math.floor((f + 1) / 7)
  // The letter's octave is that of the note without its accidental (Cb4 is a C).
  const pos = (Math.floor((midi - acc) / 12) - 1) * 7 + LETTER_STEP[letter]!
  return { letter, acc, pos }
}

/** What the key signature puts on a letter (index into F C G D A E B). */
function keyAccidental(letter: number, fifths: number): number {
  if (fifths > 0) return letter < fifths ? 1 : 0
  return letter >= 7 + fifths ? -1 : 0
}

/** The clef that keeps the pattern's middle note on the staff. */
export function chooseClef(steps: NoteStep[]): Clef {
  const all = steps.flatMap(pitchesOf).sort((a, b) => a - b)
  const mid = all[all.length >> 1]
  if (mid === undefined || (mid >= 60 && mid < 81)) return { sign: 'treble', octave: 0 }
  if (mid >= 81) return { sign: 'treble', octave: 1 }
  return { sign: 'bass', octave: mid < 40 ? -1 : 0 }
}

/**
 * Cut a span of a bar (in 16ths) into values that can be written, keeping
 * every beat visible: a value starts on a beat and lasts whole beats, or
 * stays inside one. Rests never take a dot, and never hide the half bar.
 */
export function pieces(start: number, end: number, rest: boolean): [number, number][] {
  const out: [number, number][] = []
  let p = start
  while (p < end) {
    const inBeat = p % 4, left = end - p
    let d: number
    if (inBeat) {
      d = Math.min(left, 4 - inBeat)
      if (rest && inBeat === 1 && d > 1) d = 1        // a 16th rest, then the 8th's own rest
    } else if (left < 4) {
      d = rest && left === 3 ? 2 : left
    } else {
      const beat = p / 4, beats = Math.floor(left / 4)
      if (beat === 0) d = beats === 4 ? 16 : beats === 3 ? (rest ? 8 : 12) : beats * 4
      else if (beat === 1) d = beats === 2 && !rest ? 8 : 4
      else d = beats >= 2 ? 8 : 4
    }
    out.push([p, d])
    p += d
  }
  return out
}

export function engrave(steps: NoteStep[], fifths: number, clef: Clef = chooseClef(steps)): Score {
  const total = steps.length
  const bars: ScoreBar[] = Array.from({ length: Math.ceil(total / 16) }, () => ({ events: [], empty: true }))
  const bottom = BOTTOM_LINE[clef.sign] + 7 * clef.octave

  /** Write [from, to) - a rest, or the notes sounding - across the bars it spans. */
  const write = (from: number, to: number, pitches: number[]) => {
    const made: ScoreEvent[] = []
    for (let at = from; at < to;) {
      const b = Math.floor(at / 16), stop = Math.min(to, (b + 1) * 16)
      for (const [start, dur] of pieces(at - b * 16, stop - b * 16, !pitches.length)) {
        const e: ScoreEvent = {
          start, dur, tieIn: false, tieOut: false, beam: -1,
          notes: pitches.map(midi => {
            const { acc, pos } = spell(midi, fifths)
            return { midi, line: pos - bottom, acc, show: false }
          }),
        }
        bars[b]!.events.push(e)
        made.push(e)
      }
      at = stop
    }
    if (pitches.length) made.forEach((e, i) => { e.tieIn = i > 0; e.tieOut = i < made.length - 1 })
  }

  const onsets = steps.flatMap((s, i) => (s.note === null ? [] : [i]))
  let cursor = 0
  onsets.forEach((i, k) => {
    const s = steps[i]!
    const wanted = s.length !== undefined ? i + Math.max(1, Math.round(s.length)) : (Math.floor(i / 4) + 1) * 4
    const end = Math.min(wanted, onsets[k + 1] ?? total, total)
    write(cursor, i, [])
    write(i, end, pitchesOf(s))
    cursor = end
  })
  write(cursor, total, [])

  for (const bar of bars) {
    bar.empty = bar.events.every(e => !e.notes.length)
    // Accidentals: an alteration holds for its line until the bar ends.
    const inForce = new Map<number, number>()
    for (const e of bar.events) {
      if (e.tieIn) continue                       // the tie carries it
      for (const n of e.notes) {
        const { letter } = spell(n.midi, fifths)
        n.show = n.acc !== (inForce.get(n.line) ?? keyAccidental(letter, fifths))
        inForce.set(n.line, n.acc)
      }
    }
    // Beams: neighbouring notes shorter than a beat, within one beat.
    let group = -1
    let prev: ScoreEvent | null = null
    for (const e of bar.events) {
      const short = e.notes.length > 0 && e.dur < 4
      if (short && prev && prev.start + prev.dur === e.start && Math.floor(prev.start / 4) === Math.floor(e.start / 4)) {
        if (prev.beam < 0) prev.beam = ++group
        e.beam = prev.beam
      }
      prev = short ? e : null
    }
  }
  return { fifths, clef, bars }
}
