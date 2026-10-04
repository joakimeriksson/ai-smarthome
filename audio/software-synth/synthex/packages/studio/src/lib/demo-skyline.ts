// "Skyline" — an original progressive-house track, written to be played with
// the scatter pads: four on the floor with claps and offbeat hats, supersaw
// chord stabs and a pad that PUMP on every beat (a tremolo synced to the
// quarter note, the sidechain sound), an offbeat bass, a 16th-note arp, and
// a noise riser with a snare roll into each section.
//
//   126 BPM, G minor, a bar a chord:  Gm9 | Ebmaj9 | Bb | F
//   bars 1-4    kick, bass, chords, pad
//   bars 5-8    the arp comes in; bar 8 builds
//   bars 9-16   the lead over all of it; bar 16 drops the kick and builds
//
// Render: node --experimental-transform-types scripts/render-song.ts --demo skyline

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import type { FxSlotSpec } from './fx.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 16
const STEPS = 16 * BARS
const BPM = 126
const bar = 4 * 60 / BPM          // seconds

const rests = () => kit.rests(STEPS)
const phrase = (spec: Parameters<typeof kit.phrase>[1]) => kit.phrase(STEPS, spec)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// ── Harmony ───────────────────────────────────────────────────────────────

type Shape = [string, number[]]
interface Chord { bass: string; stab: Shape; arp: string[] }
const CH: Record<string, Chord> = {
  Gm: { bass: 'G1', stab: ['Bb3', [4, 7, 11]], arp: ['G4', 'Bb4', 'D5', 'G5'] },    // Bb D F A
  Eb: { bass: 'Eb2', stab: ['G3', [3, 7, 10]], arp: ['G4', 'Bb4', 'Eb5', 'G5'] },   // G Bb D F
  Bb: { bass: 'Bb1', stab: ['Bb3', [4, 7, 12]], arp: ['F4', 'Bb4', 'D5', 'F5'] },   // Bb D F Bb
  F: { bass: 'F2', stab: ['A3', [3, 8, 12]], arp: ['F4', 'A4', 'C5', 'F5'] },       // A C F A
}
const PROG = ['Gm', 'Eb', 'Bb', 'F']
const chordOf = (b: number) => CH[PROG[b % 4]!]!

// ── Parts ─────────────────────────────────────────────────────────────────

const KICK = 0, SNARE = 1, CH_HAT = 2, OH_HAT = 3, CLAP = 4, SHAKER = 5, CRASH = 7

function drums(): number[][] {
  const g = kit.emptyGrid(STEPS)
  const hit = (ch: number, b: number, s: number, v: number) => { g[ch]![b * 16 + s] = v }
  for (let b = 0; b < BARS; b++) {
    for (const s of [0, 4, 8, 12]) hit(KICK, b, s, 124)
    for (const s of [4, 12]) hit(CLAP, b, s, 104)
    for (const s of [2, 6, 10, 14]) hit(OH_HAT, b, s, b >= 8 ? 86 : 74)
    for (let s = 1; s < 16; s += 2) hit(CH_HAT, b, s, s % 4 === 3 ? 56 : 44)
    if (b >= 8) for (let s = 0; s < 16; s++) hit(SHAKER, b, s, s % 2 === 0 ? 46 : 32)
  }
  hit(CRASH, 0, 0, 100); hit(CRASH, 8, 0, 108)
  // The builds: 8ths, then 16ths, getting louder. Bar 16 drops the kick
  // for its second half, so the crash lands on the loop's first beat.
  for (const b of [7, 15]) {
    for (const s of [0, 2, 4, 6]) hit(SNARE, b, s, 58 + s * 4)
    for (let s = 8; s < 16; s++) hit(SNARE, b, s, 76 + (s - 8) * 6)
  }
  g[KICK]![15 * 16 + 8] = 0; g[KICK]![15 * 16 + 12] = 0
  return g
}

/** Offbeat 8ths on the root, the octave as a pickup into the next bar. */
function bass(): NoteStep[] {
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const root = n(chordOf(b).bass)
    for (const s of [2, 6, 10, 14]) cells[b * 16 + s] = { note: root, velocity: s === 2 ? 112 : 100, length: 1.6 }
    cells[b * 16 + 15] = { note: root + 12, velocity: 78, length: 0.7 }
  }
  return cells
}

/** Supersaw stabs: x..x..x...x.x... */
function stabs(): NoteStep[] {
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const [root, shape] = chordOf(b).stab
    for (const [s, len, vel] of [[0, 2.5, 108], [3, 2.5, 92], [6, 3.4, 100], [10, 1.6, 90], [12, 3.4, 100]] as const) {
      cells[b * 16 + s] = { note: n(root), chord: [...shape], velocity: vel, length: len }
    }
  }
  return cells
}

function pad(): NoteStep[] {
  const cells = rests()
  for (let b = 0; b < BARS; b++) {
    const [root, shape] = chordOf(b).stab
    cells[b * 16] = { note: n(root) - 12, chord: [...shape], velocity: 78, length: 15.75 }
  }
  return cells
}

/** 16ths up and down the chord from bar 5; the beat is accented. */
function arp(): NoteStep[] {
  const order = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 2, 1]
  const cells = rests()
  for (let b = 4; b < BARS; b++) {
    const tones = chordOf(b).arp
    for (let s = 0; s < 16; s++) {
      cells[b * 16 + s] = { note: n(tones[order[s]!]!) + 12, velocity: s % 4 === 0 ? 104 : s % 2 === 0 ? 84 : 70, length: 0.6 }
    }
  }
  return cells
}

// The lead, bars 9-16.
const LEAD = phrase([
  [8, 0, 'D5', 2.8, 106], [8, 3, 'D5', 2.8, 96], [8, 6, 'Bb4', 1.8, 92], [8, 8, 'D5', 3.8, 102], [8, 12, 'F5', 3.8, 104],
  [9, 0, 'G5', 5.8, 110], [9, 6, 'F5', 1.8, 96], [9, 8, 'Eb5', 3.8, 100], [9, 12, 'D5', 3.8, 98],
  [10, 0, 'D5', 2.8, 104], [10, 3, 'D5', 2.8, 96], [10, 6, 'Bb4', 1.8, 92], [10, 8, 'D5', 3.8, 102], [10, 12, 'F5', 3.8, 104],
  [11, 0, 'A5', 5.8, 110], [11, 6, 'G5', 1.8, 98], [11, 8, 'F5', 7.8, 104],
  [12, 0, 'Bb5', 2.8, 110], [12, 3, 'Bb5', 2.8, 100], [12, 6, 'A5', 1.8, 96], [12, 8, 'G5', 3.8, 104], [12, 12, 'D5', 3.8, 98],
  [13, 0, 'G5', 5.8, 108], [13, 6, 'F5', 1.8, 96], [13, 8, 'Eb5', 3.8, 100], [13, 12, 'G5', 3.8, 104],
  [14, 0, 'F5', 2.8, 106], [14, 3, 'F5', 2.8, 98], [14, 6, 'D5', 1.8, 94], [14, 8, 'F5', 3.8, 104], [14, 12, 'Bb5', 3.8, 110],
  [15, 0, 'A5', 5.8, 112], [15, 6, 'C6', 1.8, 104], [15, 8, 'A5', 7.8, 108],
])

// Risers: filtered noise opening over the two bars before each section.
const RISER = phrase([[6, 0, 'G4', 31.5, 100], [14, 0, 'G4', 31.5, 110]])

// ── Sound ─────────────────────────────────────────────────────────────────

const RETURNS = [
  ret('A', 'Hall', 0.8, { kind: 'hall', preset: 'Concert hall', params: { decay: 2.6, lowcut: 250 } }),
  ret('B', 'Plate', 0.9, { kind: 'plate', preset: 'Bright plate', params: { decay: 1.2, lowcut: 350 } }),
  ret('C', 'Echo', 0.8, { kind: 'delay', preset: 'Dotted eighth', params: { pingpong: 1, feedback: 0.4, highcut: 5000 } }),
]

/**
 * The pump: a tremolo synced to the quarter note, ramping up from the beat,
 * so the part ducks as each kick hits and swells back - what a compressor
 * sidechained to the kick does to a house pad.
 */
const pump = (depth: number): FxSlotSpec =>
  ({ kind: 'tremolo', params: { sync: 1, division: 2, shape: 4, depth, spread: 0, smooth: 8, mix: 1 } })

const KIT: Record<string, number> = {
  'ch.0.tone': 54, 'ch.0.decay': 0.48, 'ch.0.color': 0.35,
  'ch.1.tone': 200, 'ch.1.decay': 0.3, 'ch.1.color': 0.7, 'ch.1.level': 0.6,
  'ch.2.decay': 0.14, 'ch.3.decay': 0.3, 'ch.4.level': 0.85,
  'ch.5.type': 9, 'ch.5.level': 0.45,
  'ch.7.type': 8, 'ch.7.tone': 300, 'ch.7.decay': 0.9, 'ch.7.level': 0.42,
}

/**
 * Three detuned voices of two saws: the stab. One filter per voice (spread
 * 0) and three voices, not four, to stay light on the studio's one audio
 * thread; the chorus after it does the widening.
 */
const SUPERSAW = {
  unisonCount: 3, unisonDetune: 26, unisonSpread: 0, osc2Level: 0.8, osc2Detune: 12, portamento: false,
  filterCutoff: 2600, filterResonance: 0.12, filterEnvAmount: 0.35, filterKeyTrack: 0.3,
  filterAttack: 0.003, filterDecay: 0.5, filterSustain: 0.35, filterRelease: 0.3,
  ampAttack: 0.004, ampDecay: 0.6, ampSustain: 0.7, ampRelease: 0.18,
  ...DRY,
}

const LEAD_SOUND = {
  unisonCount: 3, unisonDetune: 18, unisonSpread: 0, osc2Level: 0.6, osc2Detune: 9, portamento: false,
  filterCutoff: 4200, filterResonance: 0.12, filterEnvAmount: 0.25, filterKeyTrack: 0.4,
  ampAttack: 0.006, ampSustain: 0.85, ampRelease: 0.3,
  'mod.0.src': 'lfo1', 'mod.0.dst': 'pitch', 'mod.0.amount': 14 / 200,
  lfo1Waveform: 0, lfo1Rate: 5.5, lfo1Sync: true, lfo1Delay: 0.3, lfo1FadeIn: 0.3,
  ...DRY,
}

/** Noise through a resonant filter that opens for two bars and stops dead. */
const RISER_SOUND = {
  osc1Waveform: 4, osc2Level: 0, subLevel: 0, unisonCount: 1,
  filterCutoff: 300, filterResonance: 0.45, filterEnvAmount: 1, filterKeyTrack: 0,
  filterAttack: 2.6 * bar, filterDecay: 1, filterSustain: 1, filterRelease: 0.1,
  ampAttack: 2 * bar, ampDecay: 1, ampSustain: 1, ampRelease: 0.08, masterVolume: 1,
  ...DRY,
}

export function skylineProject(): Project {
  return {
    version: 2,
    name: 'Demo — Skyline',
    bpm: BPM,
    swing: 0,
    masterLevel: 0.9,
    buses: RETURNS,
    tracks: [
      track({ kind: 'drum', name: 'Drums', drumGrid: drums(), level: 0.68, params: KIT, sends: { B: 0.3 } }),
      // Pluck Bass held on rather than plucked, with more sub: it measured
      // 14 dB under the kick at 63 Hz as the preset stands.
      track({ kind: 'va', name: 'Bass', presetName: 'Pluck Bass', steps: bass(), level: 1,
        params: { filterCutoff: 600, filterDecay: 1, filterSustain: 0.3, ampDecay: 1.4, ampSustain: 0.8, subLevel: 0.8, masterVolume: 1 } }),
      track({ kind: 'va', name: 'Chords', presetName: 'Supersaw Lead', steps: stabs(), level: 0.5, params: SUPERSAW,
        inserts: [{ kind: 'chorus', preset: 'Juno I', params: { mix: 0.35 } }, pump(0.75)], sends: { A: 0.3, C: 0.15 } }),
      // An FM pad: half the cost of the wavetable one, and it is pumped and
      // under the chords, where the difference would not be heard.
      track({ kind: 'fm', name: 'Pad', presetName: 'Warm Pad', steps: pad(), level: 0.4,
        params: DRY,
        inserts: [{ kind: 'ensemble', preset: 'String ensemble' }, pump(0.9)], sends: { A: 0.4 } }),
      // Laser Harp without its pitch zap: a plain two-octave pluck.
      track({ kind: 'va', name: 'Arp', presetName: 'Laser Harp', steps: arp(), level: 0.55, pan: 0.2,
        params: { ...DRY, 'mod.0.amount': 0 }, sends: { C: 0.4, A: 0.2 } }),
      track({ kind: 'va', name: 'Lead', presetName: 'Supersaw Lead', steps: LEAD, level: 0.6, pan: -0.1, params: LEAD_SOUND,
        sends: { C: 0.3, A: 0.3 } }),
      track({ kind: 'va', name: 'Riser', presetName: 'Init', steps: RISER, level: 1, params: RISER_SOUND, sends: { A: 0.4 } }),
    ],
  }
}
