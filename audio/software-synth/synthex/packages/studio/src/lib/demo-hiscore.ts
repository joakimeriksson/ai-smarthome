// "Hi-Score" — an original tune in the style of Martin Galway's Wizball
// high-score music (Ocean, 1987), written for the SID synth alone.
//
// Nothing here is transcribed. The style was measured from the real tune
// (HVSC Wizball.sid subtune 7, register dump through the SID tracker's
// PSID runner) and these are its devices, re-used with new material:
//
//   - no kick or snare: the groove is a talking bass and chord strums on a
//     3-3-2 grid, with a light noise hi-hat
//   - bass: square wave into the low-pass at full resonance, the cutoff
//     jumping on every note; long root, octave pickup
//   - chords: each hit is one ~160 ms sawtooth note sweeping up two octaves
//     and back down through the third ("Galway Strum" wave table)
//   - melody: plain square with delayed vibrato — on pitch, then +-31 cents
//     at 5.7 Hz after 240 ms (Galway ran his player 4x per frame for it)
//   - triangle sparkle ticks high above the melody
//   - a major key coloured by borrowed bVII and bVI chords
//
// Wizball's tempo grid is 83 ms; here one step is two of those (90 BPM),
// which is where nearly all of its note spacings sit.

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import * as kit from './demo-kit.ts'
import { n } from './demo-kit.ts'

const BARS = 4
const STEPS = 16 * BARS

const rests = () => kit.rests(STEPS)
const phrase = (spec: Parameters<typeof kit.phrase>[1]) => kit.phrase(STEPS, spec)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

/** Two chords per bar: | A | G D | F G | D E |, as (bass root, strum root). */
const HALF: [string, string][] = [
  ['A2', 'A3'], ['A2', 'A3'],
  ['G2', 'G3'], ['D2', 'D3'],
  ['F2', 'F3'], ['G2', 'G3'],
  ['D2', 'D3'], ['E2', 'E3'],
]

/** 3-3-2 strums: the chord lands on steps 0, 3 and 6 of every half bar. */
function strums(): NoteStep[] {
  const cells = rests()
  HALF.forEach(([, root], h) => {
    for (const [s, len, vel] of [[0, 2.6, 112], [3, 2.6, 96], [6, 1.7, 104]] as const) {
      cells[h * 8 + s] = { note: n(root), velocity: vel, length: len }
    }
  })
  return cells
}

/** Long root, octave pickup, root, fifth, octave: spacings 3-1-2-1-1. */
function bass(): NoteStep[] {
  const cells = rests()
  HALF.forEach(([root], h) => {
    const r = n(root), o = h * 8
    const hits: [number, number, number, number][] = [
      [0, r, 2.8, 116], [3, r + 12, 0.9, 92], [4, r, 1.8, 106], [6, r + 7, 0.9, 94], [7, r + 12, 0.9, 88],
    ]
    for (const [s, note, len, vel] of hits) cells[o + s] = { note, velocity: vel, length: len }
  })
  return cells
}

// The melody. Long notes are there to let the delayed vibrato bloom.
const MELODY = phrase([
  [0, 0, 'A4', 1.8, 100], [0, 2, 'C#5', 0.9, 92], [0, 3, 'E5', 4.8, 108], [0, 8, 'D5', 0.9, 90], [0, 9, 'C#5', 0.9, 90],
  [0, 10, 'B4', 1.8, 96], [0, 12, 'C#5', 3.8, 104],
  [1, 0, 'D5', 2.8, 104], [1, 3, 'B4', 0.9, 90], [1, 4, 'G4', 3.8, 100], [1, 8, 'F#4', 1.8, 94], [1, 10, 'A4', 1.8, 96],
  [1, 12, 'D5', 2.8, 104], [1, 15, 'E5', 0.9, 92],
  [2, 0, 'F5', 3.8, 108], [2, 4, 'E5', 0.9, 92], [2, 5, 'C5', 0.9, 90], [2, 6, 'A4', 1.8, 96], [2, 8, 'G4', 1.8, 96],
  [2, 10, 'B4', 1.8, 98], [2, 12, 'D5', 3.8, 104],
  [3, 0, 'F#5', 2.8, 108], [3, 3, 'E5', 0.9, 92], [3, 4, 'D5', 1.8, 98], [3, 6, 'C#5', 1.8, 98], [3, 8, 'B4', 3.8, 104],
  [3, 12, 'G#4', 1.8, 96], [3, 14, 'B4', 1.8, 100],
])

/** Triangle ticks on the fifth and root, two octaves up, between the strums. */
function sparkle(): NoteStep[] {
  const cells = rests()
  HALF.forEach(([, root], h) => {
    const r = n(root) + 36
    cells[h * 8 + 2] = { note: r + 7, velocity: 78, length: 0.15 }
    cells[h * 8 + 5] = { note: r, velocity: 70, length: 0.15 }
  })
  return cells
}

/** Noise hat on the off-beats, lighter on 2 and 4. */
function hats(): NoteStep[] {
  const cells = rests()
  // The Hubbard Hat table plays noise 6 octaves above the key: F1 -> F7,
  // where Galway's hat sits.
  const key = n('F1')
  for (let bar = 0; bar < BARS; bar++) {
    for (const [s, vel] of [[2, 96], [6, 96], [10, 96], [14, 96], [4, 58], [12, 58]] as const) {
      cells[bar * 16 + s] = { note: key, velocity: vel, length: 0.4 }
    }
  }
  return cells
}

export function hiScoreProject(): Project {
  return {
    version: 1,
    name: 'Demo — Hi-Score',
    bpm: 90,
    swing: 0,
    masterLevel: 1,
    tracks: [
      track({ kind: 'sid', name: 'Bass', presetName: 'Galway Filter Bass', steps: bass(), level: 0.55 }),
      track({ kind: 'sid', name: 'Strum', presetName: 'Galway Strum', steps: strums(), level: 0.7, pan: 0.2 }),
      track({ kind: 'sid', name: 'Melody', presetName: 'Galway Vibrato Lead', steps: MELODY, level: 0.5 }),
      track({ kind: 'sid', name: 'Sparkle', presetName: 'Triangle Sparkle', steps: sparkle(), level: 0.45, pan: -0.3 }),
      // Through the chip's own high-pass: the 6581's gate thump put more of
      // the hat at 63 Hz than at 8 kHz.
      track({
        kind: 'sid', name: 'Hat', presetName: 'Hubbard Hat', steps: hats(), level: 0.9, pan: 0.15,
        params: { filterOn: true, filterMode: 0x40, filterCutoff: 170, filterReso: 0 },
      }),
    ],
  }
}
