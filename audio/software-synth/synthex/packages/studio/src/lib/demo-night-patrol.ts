// "Night Patrol" — an original piece in the manner of Jan Hammer's mid-80s
// TV scoring (Miami Vice, 1984-89), for the studio's synths. No theme, riff
// or chord sequence from that music is used; these are its devices, with new
// material:
//
//   - the lead played like a guitar on a monosynth: notes SCOOPED up into
//     from a tone below, held notes BENT up a whole step (NoteStep.scoop /
//     bendUp, the VA's per-voice bend), a little overdrive, late vibrato and
//     a dotted-eighth echo
//   - a driving sequenced bass: straight 16ths on the root, octave kicks
//   - drums with a big backbeat: long snare layered with the 808 clap
//     (the gated-reverb era), 16th hats, a crash into each section, a tom
//     fill back to the top
//   - brass stabs that anticipate each chord on the last 8th of the bar,
//     DX7-style bells and a pad underneath
//   - dark minor harmony with the harmonic minor's major V (B, with D#):
//       intro  Em  Em  C   D
//       theme  Em  C   Am  B  | Em  C  D  B
//       climax C   D   Em  B   (tom fill into the loop)
//
// 118 BPM, 16 bars: 32.5 s.
// Render: node --experimental-transform-types scripts/render-song.ts --demo night-patrol

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 16
const STEPS = 16 * BARS
const BPM = 118

const rests = () => kit.rests(STEPS)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// ── Harmony ───────────────────────────────────────────────────────────────

type Shape = [string, number[]]
const CH: Record<string, { bass: string; stab: Shape }> = {
  Em: { bass: 'E2', stab: ['E4', [3, 7]] },       // E G B
  C: { bass: 'C2', stab: ['C4', [4, 7]] },         // C E G
  D: { bass: 'D2', stab: ['D4', [4, 7]] },         // D F# A
  Am: { bass: 'A1', stab: ['A3', [3, 7, 12]] },    // A C E A
  B: { bass: 'B1', stab: ['B3', [4, 7]] },         // B D# F#
}
const PROG = ['Em', 'Em', 'C', 'D', 'Em', 'C', 'Am', 'B', 'Em', 'C', 'D', 'B', 'C', 'D', 'Em', 'B']
const chordOf = (bar: number) => CH[PROG[bar % BARS]!]!

// ── Parts ─────────────────────────────────────────────────────────────────

/** Straight 16ths on the root, the octave on the "e" of beats 2 and 4. */
function bass(): NoteStep[] {
  const cells = rests()
  for (let bar = 0; bar < BARS; bar++) {
    const root = n(chordOf(bar).bass)
    for (let s = 0; s < 16; s++) {
      const up = s === 5 || s === 13
      const vel = s % 4 === 0 ? 116 : s % 2 === 0 ? 92 : 78
      cells[bar * 16 + s] = { note: up ? root + 12 : root, velocity: vel, length: 0.6 }
    }
  }
  return cells
}

/** Held chords under everything, softly. */
function pad(): NoteStep[] {
  const cells = rests()
  for (let bar = 0; bar < BARS; bar++) {
    const [root, shape] = chordOf(bar).stab
    cells[bar * 16] = { note: n(root) - 12, chord: [...shape, 12], velocity: 70, length: 15.75 }
  }
  return cells
}

/**
 * Brass stabs from the theme on: the downbeat, and the last 8th of the bar
 * anticipating the NEXT chord.
 */
function stabs(): NoteStep[] {
  const cells = rests()
  for (let bar = 4; bar < BARS; bar++) {
    const [root, shape] = chordOf(bar).stab
    cells[bar * 16] = { note: n(root), chord: [...shape], velocity: 104, length: 1.5 }
    if (bar < BARS - 1) {
      const [nr, ns] = chordOf(bar + 1).stab
      cells[bar * 16 + 14] = { note: n(nr), chord: [...ns], velocity: 96, length: 1.2 }
    }
  }
  return cells
}

/** Bells: rising 8th-note chord tones in the intro's second half and the climax. */
function bells(): NoteStep[] {
  const cells = rests()
  for (const bar of [2, 3, 12, 13, 14, 15]) {
    const [root, shape] = chordOf(bar).stab
    const tones = [0, ...shape, 12, ...shape.map(iv => iv + 12)].map(iv => n(root) + 12 + iv)
    for (let k = 0; k < 8; k++) {
      cells[bar * 16 + 2 * k] = { note: tones[k % tones.length]!, velocity: k === 0 ? 92 : 74, length: 1.6 }
    }
  }
  return cells
}

/** Lead notes: [bar, step, note, length, velocity, scoop?, bendUp?]. */
type LeadNote = [number, number, string, number, number, number?, number?]
function lead(spec: LeadNote[]): NoteStep[] {
  const cells = rests()
  for (const [bar, step, note, len, vel, scoop, bend] of spec) {
    const cell: NoteStep = { note: n(note), velocity: vel, length: len }
    if (scoop) cell.scoop = scoop
    if (bend) cell.bendUp = bend
    cells[bar * 16 + step] = cell
  }
  return cells
}

// The melody. Every bend lands on a chord tone (D->E over C, G->A over D,
// A->B over Em); scoops start phrases and the climax's high notes.
const LEAD = lead([
  // theme, first half
  [4, 0, 'B4', 3.8, 100, 2], [4, 4, 'E5', 2.8, 104], [4, 7, 'D5', 0.9, 90], [4, 8, 'E5', 5.8, 108], [4, 14, 'G5', 1.8, 98],
  [5, 0, 'G5', 3.8, 104], [5, 4, 'E5', 1.8, 94], [5, 6, 'D5', 1.8, 92], [5, 8, 'C5', 3.8, 98], [5, 12, 'D5', 3.8, 100, 0, 2],
  [6, 0, 'E5', 5.8, 104, 1], [6, 6, 'C5', 1.8, 92], [6, 8, 'A4', 3.8, 96], [6, 12, 'B4', 1.8, 94], [6, 14, 'C5', 1.8, 96],
  [7, 0, 'B4', 7.8, 106, 2], [7, 8, 'A4', 3.8, 94], [7, 12, 'D#5', 3.8, 104],
  // theme, second half: higher, and bending
  [8, 0, 'E5', 3.8, 108, 2], [8, 4, 'G5', 3.8, 104], [8, 8, 'B5', 5.8, 112, 1], [8, 14, 'A5', 1.8, 98],
  [9, 0, 'G5', 5.8, 106], [9, 6, 'E5', 1.8, 94], [9, 8, 'D5', 7.8, 104, 0, 2],
  [10, 0, 'F#5', 3.8, 104, 2], [10, 4, 'A5', 3.8, 108], [10, 8, 'G5', 7.8, 106, 0, 2],
  [11, 0, 'F#5', 5.8, 104], [11, 6, 'D#5', 1.8, 94], [11, 8, 'B4', 7.8, 100, 2],
  // climax
  [12, 0, 'C6', 5.8, 112, 2], [12, 6, 'B5', 1.8, 100], [12, 8, 'G5', 3.8, 104], [12, 12, 'E5', 3.8, 100],
  [13, 0, 'D6', 5.8, 114, 2], [13, 6, 'C6', 1.8, 100], [13, 8, 'G5', 7.8, 106, 0, 2],
  [14, 0, 'A5', 7.8, 110, 0, 2], [14, 8, 'E6', 7.8, 116, 2],
  [15, 0, 'D#6', 7.8, 112, 1], [15, 8, 'B5', 7.8, 106],
])

// Drum channels (the 808 kit, re-typed below): kick, snare, closed and open
// hat, clap, low tom, high tom, crash.
const KICK = 0, SNARE = 1, CH_HAT = 2, OH_HAT = 3, CLAP = 4, LO_TOM = 5, HI_TOM = 6, CRASH = 7

function drums(): number[][] {
  const g = kit.emptyGrid(STEPS)
  const hit = (ch: number, bar: number, s: number, v: number) => { g[ch]![bar * 16 + s] = v }
  for (let bar = 0; bar < BARS; bar++) {
    for (const [s, v] of [[0, 124], [6, 100], [8, 118]] as const) hit(KICK, bar, s, v)
    for (let s = 0; s < 16; s++) if (s !== 14) hit(CH_HAT, bar, s, s % 4 === 0 ? 84 : s % 2 === 0 ? 70 : 50)
    hit(OH_HAT, bar, 14, 72)
    if (bar >= 2) for (const s of [4, 12]) { hit(SNARE, bar, s, 110); hit(CLAP, bar, s, 96) }
  }
  for (const bar of [0, 4, 12]) hit(CRASH, bar, 0, 100)
  // A short snare pickup into the second half of the theme.
  for (const [s, v] of [[13, 70], [14, 86], [15, 100]] as const) hit(SNARE, 7, s, v)
  // Tom fill back to the top of the loop.
  const last = BARS - 1
  for (let s = 8; s < 16; s++) { g[CH_HAT]![last * 16 + s] = 0; g[OH_HAT]![last * 16 + s] = 0 }
  g[SNARE]![last * 16 + 12] = 0; g[CLAP]![last * 16 + 12] = 0
  for (const [s, ch, v] of [[8, HI_TOM, 96], [9, HI_TOM, 88], [10, HI_TOM, 100], [11, LO_TOM, 92],
    [12, LO_TOM, 104], [13, LO_TOM, 96], [14, SNARE, 112], [15, SNARE, 120]] as const) hit(ch, last, s, v)
  return g
}

// ── Sound ─────────────────────────────────────────────────────────────────

// The 80s TV-studio desk: a hall for the pad, stabs and bells (A), the
// decade's gated reverb on the kit's backbeat (B: a burst that stops dead,
// low cut high so the kick stays out of it), and a synced dotted-eighth echo
// on the lead and bells (C).
const RETURNS = [
  ret('A', 'Hall', 0.8, { kind: 'hall', preset: 'Concert hall', params: { decay: 2.2, lowcut: 200 } }),
  ret('B', 'Gated', 1, { kind: 'gated', preset: 'Big 80s', params: { lowcut: 300 } }),
  ret('C', 'Echo', 0.8, { kind: 'delay', preset: 'Dotted eighth', params: { feedback: 0.35, highcut: 5500 } }),
]

/**
 * The monosynth lead on the VA: saw with a little square, one voice, a
 * mildly resonant filter with a quick snap, overdrive (loudness-matched, so
 * it colours rather than boosts), vibrato after 0.4 s, echo and hall.
 */
const LEAD_SOUND = {
  unisonCount: 1, osc1Waveform: 0, osc2Waveform: 1, osc2Level: 0.3, osc2Detune: 6, driftAmount: 0.2,
  filterCutoff: 1800, filterResonance: 0.28, filterEnvAmount: 0.35, filterKeyTrack: 0.5,
  filterAttack: 0.005, filterDecay: 0.6, filterSustain: 0.55, filterRelease: 0.4,
  ampAttack: 0.006, ampDecay: 1, ampSustain: 0.9, ampRelease: 0.35,
  'mod.0.src': 'lfo1', 'mod.0.dst': 'pitch', 'mod.0.amount': 22 / 200,   // +-22 cents
  lfo1Waveform: 0, lfo1Rate: 5.6, lfo1Sync: true, lfo1Delay: 0.4, lfo1FadeIn: 0.35,
  // The overdrive stays in the synth: it is part of the lead's voice.
  ...DRY, 'fx.dist.enabled': true, 'fx.dist.drive': 3,
}

/** 808 kit: tight kick, long bright snare for the clap to sit in, two toms, a crash. */
const KIT: Record<string, number> = {
  'ch.0.tone': 50, 'ch.0.decay': 0.45, 'ch.0.color': 0.35, 'ch.0.level': 0.8,
  'ch.1.tone': 190, 'ch.1.decay': 0.85, 'ch.1.color': 0.75, 'ch.1.level': 0.85,
  'ch.4.level': 0.8,
  'ch.5.type': 5, 'ch.5.tone': 95, 'ch.5.decay': 0.6,
  'ch.6.type': 5, 'ch.6.tone': 160, 'ch.6.decay': 0.55, 'ch.6.level': 0.75,
  'ch.7.type': 8, 'ch.7.tone': 300, 'ch.7.decay': 0.9, 'ch.7.level': 0.4,
}

export function nightPatrolProject(): Project {
  return {
    version: 2,
    name: 'Demo — Night Patrol',
    bpm: BPM,
    swing: 0,
    masterLevel: 0.99,   // tracks scaled so the lead's fader sits at 1.0, the top of its range
    buses: RETURNS,
    tracks: [
      track({ kind: 'drum', name: 'Drums', drumGrid: drums(), level: 0.6, params: KIT, sends: { B: 0.55 } }),
      track({ kind: 'va', name: 'Bass', presetName: 'Pluck Bass', steps: bass(), level: 0.65,
        inserts: [{ kind: 'drive', preset: 'Tape warmth' }] }),
      // A Juno chorus in place of the preset's own, then the hall.
      track({ kind: 'fm', name: 'Pad', presetName: 'Warm Pad', steps: pad(), level: 0.32, params: DRY,
        inserts: [{ kind: 'chorus', preset: 'Juno II', params: { mix: 0.4 } }], sends: { A: 0.45 } }),
      track({ kind: 'fm', name: 'Stabs', presetName: 'DX Brass', steps: stabs(), level: 0.91, params: DRY,
        sends: { A: 0.3 } }),
      track({
        kind: 'fm', name: 'Bells', presetName: 'Bright Bell', steps: bells(), level: 0.42, pan: 0.3,
        params: DRY, sends: { A: 0.4, C: 0.3 },
      }),
      track({ kind: 'va', name: 'Lead', presetName: 'Supersaw Lead', steps: LEAD, level: 1.0, pan: -0.1, params: LEAD_SOUND,
        sends: { C: 0.35, A: 0.22 } }),
    ],
  }
}
