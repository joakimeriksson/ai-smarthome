// "Afterglow" — an original trance track, written to be played with the
// scatter pads: four on the floor, a rolling 16th-note bass in the gaps
// between the kicks, a pluck riff with a dotted-eighth echo, a pumping
// supersaw pad, and - in the second half - an acid line whose filter sweeps
// open over four bars, under a long-note lead.
//
//   138 BPM, C minor, a bar a chord:  Cm9 | Abmaj9 | Eb | Bb
//   bars 1-8    kick, rolling bass, pad, pluck; bar 8 builds
//   bars 9-16   acid line and lead on top; bar 16 drops the kick and builds
//
// Render: node --experimental-transform-types scripts/render-song.ts --demo afterglow

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import type { FxSlotSpec } from './fx.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 16
const STEPS = 16 * BARS
const BPM = 138
const bar = 4 * 60 / BPM          // seconds

const rests = () => kit.rests(STEPS)
const phrase = (spec: Parameters<typeof kit.phrase>[1]) => kit.phrase(STEPS, spec)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// ── Harmony ───────────────────────────────────────────────────────────────

type Shape = [string, number[]]
interface Chord { bass: string; pad: Shape; pluck: string[] }
const CH: Record<string, Chord> = {
  Cm: { bass: 'C2', pad: ['Eb3', [4, 7, 11]], pluck: ['C5', 'Eb5', 'G5', 'C6'] },     // Eb G Bb D
  Ab: { bass: 'Ab1', pad: ['C4', [3, 7, 10]], pluck: ['C5', 'Eb5', 'Ab5', 'C6'] },    // C Eb G Bb
  Eb: { bass: 'Eb2', pad: ['G3', [3, 8, 12]], pluck: ['Bb4', 'Eb5', 'G5', 'Bb5'] },   // G Bb Eb G
  Bb: { bass: 'Bb1', pad: ['F3', [5, 9, 12]], pluck: ['Bb4', 'D5', 'F5', 'Bb5'] },    // F Bb D F
}
const PROG = ['Cm', 'Ab', 'Eb', 'Bb']
const chordOf = (b: number) => CH[PROG[b % 4]!]!

// ── Parts ─────────────────────────────────────────────────────────────────

const KICK = 0, SNARE = 1, CH_HAT = 2, OH_HAT = 3, CLAP = 4, CRASH = 7

function drums(): number[][] {
  const g = kit.emptyGrid(STEPS)
  const hit = (ch: number, b: number, s: number, v: number) => { g[ch]![b * 16 + s] = v }
  for (let b = 0; b < BARS; b++) {
    for (const s of [0, 4, 8, 12]) hit(KICK, b, s, 124)
    for (const s of [4, 12]) hit(CLAP, b, s, 100)
    for (const s of [2, 6, 10, 14]) hit(OH_HAT, b, s, 84)
    for (let s = 1; s < 16; s += 2) hit(CH_HAT, b, s, b >= 8 ? 58 : 46)
  }
  hit(CRASH, 0, 0, 100); hit(CRASH, 8, 0, 108)
  for (const b of [7, 15]) {
    for (const s of [0, 2, 4, 6]) hit(SNARE, b, s, 60 + s * 4)
    for (let s = 8; s < 16; s++) hit(SNARE, b, s, 78 + (s - 8) * 6)
  }
  g[KICK]![15 * 16 + 8] = 0; g[KICK]![15 * 16 + 12] = 0
  return g
}

/** The rolling bass: the three 16ths after each kick, never on it. */
function bass(): NoteStep[] {
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const root = n(chordOf(b).bass)
    for (let s = 0; s < 16; s++) {
      if (s % 4 === 0) continue
      cells[b * 16 + s] = { note: root, velocity: [0, 96, 110, 100][s % 4]!, length: 0.7 }
    }
  }
  return cells
}

function pad(): NoteStep[] {
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const [root, shape] = chordOf(b).pad
    cells[b * 16] = { note: n(root), chord: [...shape], velocity: 84, length: 15.75 }
  }
  return cells
}

/** The pluck riff: x.xx.x.xx.xx.x.x, through the chord's four notes. */
function pluck(): NoteStep[] {
  const steps = [0, 2, 3, 5, 7, 8, 10, 11, 13, 15]
  const order = [2, 1, 2, 3, 2, 1, 2, 3, 2, 0]
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const tones = chordOf(b).pluck
    steps.forEach((s, k) => {
      cells[b * 16 + s] = { note: n(tones[order[k]!]!), velocity: k % 3 === 0 ? 104 : 84, length: 0.9 }
    })
  }
  return cells
}

/** The acid line, bars 9-16: 16ths on the root, the octave and the fifth. */
function acid(): NoteStep[] {
  const semis = [0, 0, 12, 0, null, 7, 0, 12, 0, 0, 12, null, 0, 12, 7, 12]
  const cells = rests()
  for (let b = 8; b < BARS; b++) {
    const root = n(chordOf(b).bass) + 12
    semis.forEach((iv, s) => {
      if (iv === null) return
      // The accents (and the longer notes) fall on the octaves.
      cells[b * 16 + s] = { note: root + iv, velocity: iv === 12 ? 118 : 88, length: iv === 12 ? 1.1 : 0.55 }
    })
  }
  return cells
}

// The lead, bars 9-16: one long note and an answer in each bar.
const LEAD = phrase([
  [8, 0, 'G5', 7.8, 106], [8, 8, 'Eb5', 3.8, 96], [8, 12, 'D5', 3.8, 98],
  [9, 0, 'C5', 7.8, 102], [9, 8, 'Eb5', 3.8, 98], [9, 12, 'Ab5', 3.8, 104],
  [10, 0, 'G5', 7.8, 106], [10, 8, 'Bb5', 3.8, 104], [10, 12, 'G5', 3.8, 98],
  [11, 0, 'F5', 11.8, 104], [11, 12, 'D5', 3.8, 96],
  [12, 0, 'G5', 7.8, 108], [12, 8, 'C6', 3.8, 110], [12, 12, 'Bb5', 3.8, 104],
  [13, 0, 'Ab5', 7.8, 106], [13, 8, 'G5', 3.8, 100], [13, 12, 'Eb5', 3.8, 98],
  [14, 0, 'G5', 7.8, 108], [14, 8, 'Bb5', 3.8, 106], [14, 12, 'Eb6', 3.8, 112],
  [15, 0, 'D6', 11.8, 112], [15, 12, 'Bb5', 3.8, 104],
])

// Risers: filtered noise opening over the two bars before each section.
const RISER = phrase([[6, 0, 'C5', 31.5, 100], [14, 0, 'C5', 31.5, 110]])

// ── Sound ─────────────────────────────────────────────────────────────────

const RETURNS = [
  ret('A', 'Hall', 0.85, { kind: 'hall', preset: 'Large hall', params: { decay: 3.2, lowcut: 250 } }),
  ret('B', 'Plate', 0.9, { kind: 'plate', preset: 'Bright plate', params: { decay: 1.2, lowcut: 350 } }),
  ret('C', 'Echo', 0.85, { kind: 'delay', preset: 'Dotted eighth', params: { pingpong: 1, feedback: 0.45, highcut: 5500 } }),
]

/** A tremolo ramping up from every beat: the sidechain pump. */
const pump = (depth: number): FxSlotSpec =>
  ({ kind: 'tremolo', params: { sync: 1, division: 2, shape: 4, depth, spread: 0, smooth: 8, mix: 1 } })

const KIT: Record<string, number> = {
  'ch.0.tone': 56, 'ch.0.decay': 0.42, 'ch.0.color': 0.4,
  'ch.1.tone': 210, 'ch.1.decay': 0.28, 'ch.1.color': 0.7, 'ch.1.level': 0.6,
  'ch.2.decay': 0.12, 'ch.3.decay': 0.28, 'ch.4.level': 0.8,
  'ch.7.type': 8, 'ch.7.tone': 300, 'ch.7.decay': 0.9, 'ch.7.level': 0.42,
}

const SUPERSAW_PAD = {
  unisonCount: 3, unisonDetune: 24, unisonSpread: 0, osc2Level: 0.8, osc2Detune: 11, portamento: false,
  filterCutoff: 2200, filterResonance: 0.1, filterEnvAmount: 0.2, filterKeyTrack: 0.3,
  filterAttack: 0.2, filterDecay: 2, filterSustain: 0.7, filterRelease: 0.4,
  ampAttack: 0.05, ampDecay: 2, ampSustain: 0.9, ampRelease: 0.35,
  ...DRY,
}

const LEAD_SOUND = {
  unisonCount: 3, unisonDetune: 20, unisonSpread: 0, osc2Level: 0.6, osc2Detune: 9, portamento: false,
  filterCutoff: 4000, filterResonance: 0.12, filterEnvAmount: 0.25, filterKeyTrack: 0.4,
  ampAttack: 0.01, ampSustain: 0.85, ampRelease: 0.35,
  'mod.0.src': 'lfo1', 'mod.0.dst': 'pitch', 'mod.0.amount': 15 / 200,
  lfo1Waveform: 0, lfo1Rate: 5.6, lfo1Sync: true, lfo1Delay: 0.3, lfo1FadeIn: 0.35,
  ...DRY,
}

const RISER_SOUND = {
  osc1Waveform: 4, osc2Level: 0, subLevel: 0, unisonCount: 1,
  filterCutoff: 300, filterResonance: 0.45, filterEnvAmount: 1, filterKeyTrack: 0,
  filterAttack: 2.6 * bar, filterDecay: 1, filterSustain: 1, filterRelease: 0.1,
  ampAttack: 2 * bar, ampDecay: 1, ampSustain: 1, ampRelease: 0.08, masterVolume: 1,
  ...DRY,
}

export function afterglowProject(): Project {
  return {
    version: 2,
    name: 'Demo — Afterglow',
    bpm: BPM,
    swing: 0,
    masterLevel: 0.9,
    buses: RETURNS,
    tracks: [
      track({ kind: 'drum', name: 'Drums', drumGrid: drums(), level: 0.68, params: KIT, sends: { B: 0.3 } }),
      track({ kind: 'va', name: 'Bass', presetName: 'Pluck Bass', steps: bass(), level: 1,
        params: { filterCutoff: 520, filterEnvAmount: 0.55, filterDecay: 0.5, ampDecay: 0.7, ampSustain: 0.7, subLevel: 0.8, masterVolume: 1 } }),
      track({ kind: 'va', name: 'Pad', presetName: 'Supersaw Lead', steps: pad(), level: 0.4, params: SUPERSAW_PAD,
        inserts: [{ kind: 'chorus', preset: 'Juno II', params: { mix: 0.35 } }, pump(0.85)], sends: { A: 0.4 } }),
      track({ kind: 'va', name: 'Pluck', presetName: 'Laser Harp', steps: pluck(), level: 0.5, pan: 0.15,
        params: { ...DRY, 'mod.0.amount': 0 }, sends: { C: 0.45, A: 0.25 } }),
      // The acid line's filter sweeps over four bars (an auto-filter synced
      // to the song), so the second half of the track opens up and closes.
      track({ kind: 'va', name: 'Acid', presetName: 'Acid Lead', steps: acid(), level: 0.8, pan: -0.2,
        // Opened up from the preset's 500 Hz: the line was all body, no bite.
        params: { ...DRY, filterCutoff: 900, filterSustain: 0.25 },
        inserts: [
          { kind: 'drive', preset: 'Tube crunch', params: { drive: 10 } },
          { kind: 'autofilter', preset: 'Synced LP sweep', params: { cutoff: 3000, resonance: 0.4, lfoDepth: 2, division: 6 } },
        ], sends: { C: 0.2, A: 0.15 } }),
      track({ kind: 'va', name: 'Lead', presetName: 'Supersaw Lead', steps: LEAD, level: 0.6, params: LEAD_SOUND,
        sends: { C: 0.35, A: 0.35 } }),
      track({ kind: 'va', name: 'Riser', presetName: 'Init', steps: RISER, level: 1, params: RISER_SOUND, sends: { A: 0.4 } }),
    ],
  }
}
