// "Rollout" — an original liquid drum & bass roller, written to be played
// with the scatter pads: a busy two-step break with ghost notes and a 16th
// shaker (rolls and loops have transients to grab on every step), a held
// Reese bass (reverse and tape stop have something to bend), and rhythmic
// e-piano and marimba parts above.
//
//   174 BPM, F minor, two bars a chord:  Fm9 | Dbmaj9 | Abmaj7 | Eb(add9)
//   bars 1-8   the groove: break, Reese, pad, e-piano stabs, marimba
//   bars 9-16  the same with a lead on top; a snare roll leads back round
//
// Render: node --experimental-transform-types scripts/render-song.ts --demo rollout

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 16
const STEPS = 16 * BARS
const BPM = 174

const rests = () => kit.rests(STEPS)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// ── Harmony ───────────────────────────────────────────────────────────────

type Shape = [string, number[]]
interface Chord { bass: string; pad: Shape; keys: Shape }
// The keys play rootless voicings: the third, fifth, seventh and ninth.
const CH: Record<string, Chord> = {
  Fm: { bass: 'F1', pad: ['F3', [3, 7, 10, 14]], keys: ['Ab3', [4, 7, 11]] },    // Ab C Eb G
  Db: { bass: 'Db2', pad: ['Db3', [4, 7, 11, 14]], keys: ['F3', [3, 7, 10]] },   // F Ab C Eb
  Ab: { bass: 'Ab1', pad: ['Ab3', [4, 7, 11]], keys: ['C4', [3, 7, 10]] },       // C Eb G Bb
  Eb: { bass: 'Eb2', pad: ['Eb3', [4, 7, 14]], keys: ['Bb3', [3, 7, 10]] },      // Bb Db F Ab
}
const PROG = ['Fm', 'Fm', 'Db', 'Db', 'Ab', 'Ab', 'Eb', 'Eb']
const chordOf = (bar: number) => CH[PROG[bar % 8]!]!

// ── Parts ─────────────────────────────────────────────────────────────────

const KICK = 0, SNARE = 1, CH_HAT = 2, OH_HAT = 3, SHAKER = 5, RIM = 6, CRASH = 7

/** The two-step: kick on 1 and the "and" of 3, snare on 2 and 4. */
function drums(): number[][] {
  const g = kit.emptyGrid(STEPS)
  const hit = (ch: number, bar: number, s: number, v: number) => { g[ch]![bar * 16 + s] = v }
  for (let bar = 0; bar < BARS; bar++) {
    hit(KICK, bar, 0, 122); hit(KICK, bar, 10, 112)
    hit(SNARE, bar, 4, 116); hit(SNARE, bar, 12, 118)
    // Every other bar pushes: an extra kick before the second snare's kick,
    // and ghost notes on the rim around the backbeat.
    if (bar % 2 === 1) { hit(KICK, bar, 7, 92); hit(RIM, bar, 9, 60); hit(RIM, bar, 15, 54) } else { hit(RIM, bar, 7, 58) }
    for (let s = 0; s < 16; s += 2) hit(CH_HAT, bar, s, s % 4 === 0 ? 86 : 66)
    for (let s = 0; s < 16; s++) hit(SHAKER, bar, s, s % 2 === 0 ? 52 : 34)
    if (bar % 4 === 3) { g[CH_HAT]![bar * 16 + 14] = 0; hit(OH_HAT, bar, 14, 76) }
  }
  hit(CRASH, 0, 0, 100); hit(CRASH, 8, 0, 104)
  // Bar 8: a three-stroke pickup. Bar 16: a full roll back to the top.
  for (const [s, v] of [[13, 70], [14, 88], [15, 106]] as const) hit(SNARE, 7, s, v)
  for (const [s, v] of [[8, 64], [9, 70], [10, 78], [11, 86], [13, 100], [14, 110], [15, 122]] as const) hit(SNARE, 15, s, v)
  g[KICK]![15 * 16 + 10] = 0
  return g
}

/**
 * The Reese: long roots, re-struck on the break's kicks; the second bar of
 * each chord answers with the octave and the fifth.
 */
function reese(): NoteStep[] {
  const cells = rests()
  const put = (bar: number, s: number, note: number, length: number, velocity: number) => {
    cells[bar * 16 + s] = { note, velocity, length }
  }
  for (let bar = 0; bar < BARS; bar++) {
    const root = n(chordOf(bar).bass)
    put(bar, 0, root, 5.6, 112)
    if (bar % 2 === 0) { put(bar, 6, root, 3.6, 98); put(bar, 10, root, 5.6, 106) } else {
      put(bar, 6, root, 1.7, 98); put(bar, 8, root + 12, 1.7, 100); put(bar, 10, root, 3.6, 106); put(bar, 14, root + 7, 1.7, 96)
    }
  }
  return cells
}

function pad(): NoteStep[] {
  const cells = rests()
  for (let bar = 0; bar < BARS; bar += 2) {
    const [root, shape] = chordOf(bar).pad
    cells[bar * 16] = { note: n(root), chord: [...shape], velocity: 80, length: 31.5 }
  }
  return cells
}

/** E-piano stabs, off the beat: a different figure in each bar of the chord. */
function keys(): NoteStep[] {
  const cells = rests()
  for (let bar = 0; bar < BARS; bar++) {
    const [root, shape] = chordOf(bar).keys
    const hits = bar % 2 === 0 ? [[0, 2.6, 100], [6, 1.8, 84], [11, 3.6, 94]] : [[3, 1.8, 88], [8, 2.6, 96], [14, 1.8, 84]]
    for (const [s, len, vel] of hits) cells[bar * 16 + s!] = { note: n(root), chord: [...shape], velocity: vel!, length: len! }
  }
  return cells
}

/** Marimba: the chord's notes an octave up, 3-3-2 across the bar. */
function marimba(): NoteStep[] {
  const cells = rests()
  for (let bar = 0; bar < BARS; bar++) {
    const [root, shape] = chordOf(bar).keys
    const tones = [0, ...shape].map(iv => n(root) + 12 + iv)
    ;[0, 3, 6, 8, 11, 14].forEach((s, k) => {
      cells[bar * 16 + s] = { note: tones[(k + bar) % tones.length]!, velocity: k % 3 === 0 ? 100 : 80, length: 1.2 }
    })
  }
  return cells
}

// The lead, bars 9-16: [bar, step, note, length, velocity, scoop?].
type LeadNote = [number, number, string, number, number, number?]
function lead(spec: LeadNote[]): NoteStep[] {
  const cells = rests()
  for (const [bar, step, note, len, vel, scoop] of spec) {
    const cell: NoteStep = { note: n(note), velocity: vel, length: len }
    if (scoop) cell.scoop = scoop
    cells[bar * 16 + step] = cell
  }
  return cells
}
const LEAD = lead([
  [8, 0, 'C5', 5.8, 100, 2], [8, 6, 'Eb5', 1.8, 90], [8, 8, 'F5', 7.8, 106],
  [9, 0, 'G5', 3.8, 104], [9, 4, 'F5', 3.8, 96], [9, 8, 'Eb5', 3.8, 94], [9, 12, 'C5', 3.8, 92],
  [10, 0, 'F5', 5.8, 102, 2], [10, 6, 'Ab5', 1.8, 94], [10, 8, 'C6', 7.8, 110],
  [11, 0, 'Bb5', 3.8, 102], [11, 4, 'Ab5', 3.8, 96], [11, 8, 'F5', 7.8, 98],
  [12, 0, 'Eb5', 5.8, 102, 2], [12, 6, 'G5', 1.8, 94], [12, 8, 'C6', 7.8, 110],
  [13, 0, 'Bb5', 3.8, 104], [13, 4, 'Ab5', 3.8, 98], [13, 8, 'G5', 3.8, 96], [13, 12, 'Eb5', 3.8, 92],
  [14, 0, 'F5', 5.8, 104, 2], [14, 6, 'G5', 1.8, 96], [14, 8, 'Bb5', 7.8, 110],
  [15, 0, 'Ab5', 3.8, 102], [15, 4, 'G5', 3.8, 98], [15, 8, 'Eb5', 3.8, 96], [15, 12, 'C5', 3.8, 94],
])

// ── Sound ─────────────────────────────────────────────────────────────────

// A hall for the pad, keys and lead; a tight drum room for the break (low
// cut high, so the kick stays dry); a dotted-eighth echo for the marimba,
// keys and lead.
const RETURNS = [
  ret('A', 'Hall', 0.8, { kind: 'hall', preset: 'Concert hall', params: { decay: 2.4, lowcut: 250 } }),
  ret('B', 'Room', 0.9, { kind: 'room', preset: 'Drum room', params: { lowcut: 300 } }),
  ret('C', 'Echo', 0.8, { kind: 'delay', preset: 'Dotted eighth', params: { pingpong: 1, feedback: 0.38, highcut: 5000 } }),
]

/** A tight, high-tuned kit: punchy kick, cracking snare, a maraca for the shaker. */
const KIT: Record<string, number> = {
  'ch.0.tone': 62, 'ch.0.decay': 0.32, 'ch.0.color': 0.45,
  'ch.1.tone': 235, 'ch.1.decay': 0.42, 'ch.1.color': 0.75, 'ch.1.level': 0.9,
  'ch.2.decay': 0.16, 'ch.3.decay': 0.4,
  'ch.5.type': 9, 'ch.5.level': 0.5,
  'ch.6.level': 0.5,
  'ch.7.type': 8, 'ch.7.tone': 320, 'ch.7.decay': 0.9, 'ch.7.level': 0.4,
}

/**
 * The Reese: two saws 22 cents apart, doubled and detuned again, a sine
 * under them, through a low filter that a slow free LFO keeps moving, then
 * a little drive. The beating between the saws is the sound.
 */
const REESE = {
  osc2Waveform: 0, osc2Octave: 0, osc2Level: 0.9, osc2Detune: 22, subLevel: 0.7,
  unisonCount: 2, unisonDetune: 14, unisonSpread: 0, portamento: false, driftAmount: 0.4,
  filterCutoff: 340, filterResonance: 0.25, filterEnvAmount: 0.3, filterKeyTrack: 0,
  filterAttack: 0.004, filterDecay: 0.8, filterSustain: 0.6, filterRelease: 0.3,
  ampAttack: 0.004, ampDecay: 2, ampSustain: 0.9, ampRelease: 0.12,
  'mod.1.src': 'lfo2', 'mod.1.dst': 'cutoff', 'mod.1.amount': 0.22, lfo2Waveform: 0, lfo2Rate: 0.31, lfo2Sync: false,
  ...DRY, 'fx.dist.enabled': true, 'fx.dist.drive': 2.5,
}

const LEAD_SOUND = {
  unisonCount: 2, unisonDetune: 12, unisonSpread: 0, osc2Level: 0.5, osc2Detune: 7, portamento: false,
  filterCutoff: 3200, filterResonance: 0.15, filterEnvAmount: 0.3, filterKeyTrack: 0.5,
  ampAttack: 0.01, ampSustain: 0.85, ampRelease: 0.35,
  'mod.0.src': 'lfo1', 'mod.0.dst': 'pitch', 'mod.0.amount': 16 / 200,
  lfo1Waveform: 0, lfo1Rate: 5.4, lfo1Sync: true, lfo1Delay: 0.25, lfo1FadeIn: 0.3,
  ...DRY,
}

export function rolloutProject(): Project {
  return {
    version: 2,
    name: 'Demo — Rollout',
    bpm: BPM,
    swing: 0,
    masterLevel: 0.9,
    buses: RETURNS,
    tracks: [
      track({ kind: 'drum', name: 'Break', drumGrid: drums(), level: 0.7, params: KIT, sends: { B: 0.4 } }),
      track({ kind: 'va', name: 'Reese', presetName: 'Deep Sub', steps: reese(), level: 0.85, params: REESE }),
      track({ kind: 'ws', name: 'Pad', presetName: 'Wave Pad', steps: pad(), level: 0.26,
        params: { ...DRY, filterCutoff: 7000 },
        inserts: [{ kind: 'ensemble', preset: 'String ensemble' }], sends: { A: 0.45 } }),
      track({ kind: 'fm', name: 'Keys', presetName: 'E.Piano 1', steps: keys(), level: 0.8, pan: -0.15,
        params: DRY, inserts: [{ kind: 'chorus', preset: 'Juno I', params: { mix: 0.3 } }], sends: { A: 0.25, C: 0.2 } }),
      track({ kind: 'fm', name: 'Marimba', presetName: 'Marimba', steps: marimba(), level: 0.6, pan: 0.25,
        params: DRY, sends: { C: 0.35, A: 0.15 } }),
      track({ kind: 'va', name: 'Lead', presetName: 'Supersaw Lead', steps: LEAD, level: 0.7, params: LEAD_SOUND,
        sends: { C: 0.3, A: 0.3 } }),
    ],
  }
}
