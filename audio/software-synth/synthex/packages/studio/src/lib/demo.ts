// The demo song.
//
// The studio used to boot to empty grids, which means the first thing it does
// is ask you for work. This is the fix: a short A-minor-pentatonic loop across
// drums, bass and a SID lead, so pressing one key makes music.
//
// Written out by hand rather than generated, so it's actually a tune and not
// a lucky roll — the dice are for after you've heard what the thing does.

import type { Project, ProjectTrack } from './project.ts'
import { SCALES, degreeToMidi, euclid, DRUM } from './generate.ts'

const STEPS = 16
const ROOT_LEAD = 69   // A4
const ROOT_BASS = 33   // A1
const PENT = SCALES.minorPentatonic

const rests = (): { note: number | null; velocity: number }[] =>
  Array.from({ length: STEPS }, () => ({ note: null, velocity: 100 }))

/** Place scale degrees at given steps: [step, degree, velocity?]. */
function line(root: number, spec: [number, number, number?][]) {
  const cells = rests()
  for (const [step, degree, vel] of spec) {
    cells[step] = { note: degreeToMidi(root, PENT, degree), velocity: vel ?? 100 }
  }
  return cells
}

function grid(rows: [number, boolean[], number][]): number[][] {
  const g = Array.from({ length: 8 }, () => new Array<number>(STEPS).fill(0))
  for (const [ch, hits, vel] of rows) {
    for (let i = 0; i < STEPS; i++) if (hits[i]) g[ch]![i] = vel
  }
  return g
}

const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>): ProjectTrack => ({
  level: 0.8, pan: 0, muted: false, soloed: false, gate: 0.8, transpose: 0,
  steps: rests(), drumGrid: grid([]),
  ...t,
})

// Backbeat snare, four-on-the-floor kick, offbeat open hat.
const beat = grid([
  [DRUM.KICK,   euclid(STEPS, 4), 115],
  [DRUM.SNARE,  [4, 12].reduce((a, i) => (a[i] = true, a), new Array<boolean>(STEPS).fill(false)), 100],
  [DRUM.CH_HAT, euclid(STEPS, 8), 62],
  [DRUM.OH_HAT, euclid(STEPS, 2, 2), 55],
])

export function demoProject(): Project {
  return {
    version: 1,
    name: 'Demo — Six Worlds',
    bpm: 112,
    swing: 0.12,
    masterLevel: 0.8,
    tracks: [
      track({ kind: 'drum', name: 'Drums', drumGrid: beat, level: 0.85 }),

      // Root-driven bass with a walk up on the last beat.
      track({
        kind: 'va', name: 'Bass', level: 0.75, gate: 0.55,
        steps: line(ROOT_BASS, [
          [0, 0, 115], [3, 0, 85], [6, 1], [8, 0, 110], [11, 0, 85], [13, 2], [14, 3], [15, 4],
        ]),
      }),

      // SID lead — the hook. Sparse, syncopated, ends on the fifth.
      track({
        kind: 'sid', name: 'SID Lead', level: 0.7, gate: 0.9,
        steps: line(ROOT_LEAD, [
          [0, 0, 110], [2, 2], [4, 4, 105], [7, 2], [8, 3, 108], [10, 2], [12, 1], [14, 2, 95],
        ]),
      }),

      // Karplus-Strong pad an octave down, long gate, quiet — glue.
      track({
        kind: 'pm', name: 'Strings', level: 0.5, gate: 1,
        steps: line(ROOT_LEAD - 12, [[0, 0, 80], [8, 2, 75]]),
      }),
    ],
  }
}
