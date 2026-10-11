// The demo song.
//
// The studio boots into this, so the first thing it does is play music
// rather than ask for work. It is written to show every engine doing what
// it is best at, in one 4-bar synthwave loop in A minor:
//
//   Am7 | Fmaj7 | Cmaj7 | G(add9)
//
//   Drums  TR-808 kit: four on the floor, clap-layered backbeat, 16th hats,
//          a crash into the top and a snare roll out of bar 4
//   Bass   Jupiter-style saw pluck bass, octave-bouncing eighths
//   Pad    PPG wave pad holding the chords (chorus and hall from the preset)
//   Arp    DX7 tine e-piano, up-and-down 16ths through a dotted-8th delay
//   Lead   C64 SID PWM lead with the preset's pulse-width sweep tables
//   Harp   Karplus-Strong harp answering the lead at the end of bars 2 and 4
//
// Written out by hand rather than generated, so it's a tune and not a lucky
// roll — the dice are for after you've heard what the thing does. Render it
// offline with `node --experimental-transform-types scripts/render-song.ts`.

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import { DRUM } from './generate.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 4
const STEPS = 16 * BARS
const BPM = 104

const rests = () => kit.rests(STEPS)
const emptyGrid = () => kit.emptyGrid(STEPS)
const phrase = (spec: Parameters<typeof kit.phrase>[1]) => kit.phrase(STEPS, spec)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// Chord shapes as intervals above the root (see NoteStep.chord).
const M7 = [4, 7, 11], m7 = [3, 7, 10], add9 = [4, 7, 14]

/** The progression, one chord per bar, with each part's register choices. */
const BAR: { bass: string; pad: [string, number[]]; arp: string[] }[] = [
  { bass: 'A1', pad: ['A3', m7],   arp: ['A4', 'C5', 'E5', 'G5', 'A5'] },
  { bass: 'F1', pad: ['F3', M7],   arp: ['F4', 'A4', 'C5', 'E5', 'F5'] },
  { bass: 'C2', pad: ['C4', M7],   arp: ['G4', 'C5', 'E5', 'G5', 'B5'] },
  { bass: 'G1', pad: ['G3', add9], arp: ['G4', 'B4', 'D5', 'G5', 'A5'] },
]

// ── Parts ────────────────────────────────────────────────────────────────

const CRASH = 7   // the cowbell channel, re-typed as a cymbal in the kit below

function drums(): number[][] {
  const g = emptyGrid()
  const hit = (ch: number, step: number, vel: number) => { g[ch]![step] = vel }
  for (let bar = 0; bar < BARS; bar++) {
    const o = bar * 16
    for (const s of [0, 4, 8, 12]) hit(DRUM.KICK, o + s, 120)
    for (const s of [4, 12]) { hit(DRUM.SNARE, o + s, 100); hit(DRUM.CLAP, o + s, 88) }
    for (let s = 0; s < 16; s++) {
      if (s % 4 === 2) hit(DRUM.OH_HAT, o + s, 58)            // the "and"s open up
      else hit(DRUM.CH_HAT, o + s, s % 2 === 0 ? 72 : 42)     // 16ths, eighths accented
    }
  }
  hit(CRASH, 0, 96)
  // Snare roll out of bar 4, back into the crash.
  const last = (BARS - 1) * 16
  for (const [s, v] of [[12, 100], [13, 62], [14, 80], [15, 108]] as const) hit(DRUM.SNARE, last + s, v)
  hit(DRUM.CLAP, last + 12, 0)
  hit(DRUM.OH_HAT, last + 14, 0)
  hit(DRUM.CH_HAT, last + 13, 0); hit(DRUM.CH_HAT, last + 15, 0)
  return g
}

/** Octave-bouncing eighths on the root, with a 16th pickup into each bar. */
function bass(): NoteStep[] {
  const cells = rests()
  BAR.forEach(({ bass: root }, bar) => {
    const lo = n(root), hi = lo + 12, o = bar * 16
    for (let s = 0; s < 16; s += 2) {
      const up = s % 4 === 2
      cells[o + s] = { note: up ? hi : lo, velocity: up ? 92 : 116, length: 1.6 }
    }
    cells[o + 15] = { note: hi, velocity: 70, length: 0.8 }
  })
  return cells
}

function pad(): NoteStep[] {
  const cells = rests()
  BAR.forEach(({ pad: [root, shape] }, bar) => {
    cells[bar * 16] = { note: n(root), chord: [...shape], velocity: 84, length: 15.75 }
  })
  return cells
}

/** Up-and-down through five chord tones, twice a bar; beats accented. */
function arp(): NoteStep[] {
  const order = [0, 1, 2, 3, 4, 3, 2, 1]
  const cells = rests()
  BAR.forEach(({ arp: tones }, bar) => {
    for (let s = 0; s < 16; s++) {
      cells[bar * 16 + s] = {
        note: n(tones[order[s % 8]!]!),
        velocity: s % 4 === 0 ? 104 : 80,
        length: 0.55,
      }
    }
  })
  return cells
}

// The hook: steps down to the root, climbs back, and lifts into bar 1 again.
const LEAD = phrase([
  [0, 0, 'E5', 5.75, 104], [0, 6, 'D5', 1.75, 88], [0, 8, 'C5', 3.75, 96], [0, 12, 'D5', 1.75, 86], [0, 14, 'E5', 1.75, 92],
  [1, 0, 'C5', 9.75, 100], [1, 10, 'A4', 1.75, 84], [1, 12, 'C5', 3.5, 92],
  [2, 0, 'G5', 5.75, 106], [2, 6, 'E5', 1.75, 90], [2, 8, 'D5', 3.75, 96], [2, 12, 'C5', 1.75, 86], [2, 14, 'D5', 1.75, 90],
  [3, 0, 'B4', 5.75, 98], [3, 6, 'G4', 1.75, 84], [3, 8, 'A4', 3.75, 92], [3, 12, 'B4', 1.75, 88], [3, 14, 'D5', 1.75, 96],
])

// Answers the lead where it rests: a rising pluck at the end of bars 2 and 4.
const HARP = phrase([
  [1, 12, 'A5', 1, 96], [1, 13, 'C6', 1, 102], [1, 14, 'E6', 1, 108], [1, 15, 'A6', 3, 116],
  [3, 12, 'G5', 1, 96], [3, 13, 'B5', 1, 102], [3, 14, 'D6', 1, 108], [3, 15, 'E6', 3, 116],
])

// ── Sound: presets plus the edits this arrangement needs ───────────────────

/**
 * TR-808 kit from the "808 Classic" bank entry, with a tighter kick (the
 * long boom and the bass were both peaking at 63 Hz), the backbeat brought
 * forward, and channel 8 re-typed as a crash.
 */
const KIT: Record<string, number> = {
  'ch.0.tone': 52, 'ch.0.decay': 0.5, 'ch.0.color': 0.3,
  'ch.1.color': 0.65, 'ch.1.decay': 0.5, 'ch.1.level': 0.9, 'ch.4.level': 0.85,
  'ch.2.decay': 0.25, 'ch.3.decay': 0.55,
  'ch.7.type': 8, 'ch.7.tone': 300, 'ch.7.decay': 0.85, 'ch.7.level': 0.42,
}

// The mix, DAW-style: every synth dry into three shared returns, chorus as
// inserts. A: a concert hall for the pad and the harp; B: a bright plate for
// the kit's backbeat and the lead; C: a dotted-eighth ping-pong echo, synced,
// for the arp and the harp's pickups.
const RETURNS = [
  ret('A', 'Hall', 0.85, { kind: 'hall', preset: 'Concert hall', params: { decay: 2.4, predelay: 25 } }),
  // Low cut at 250 Hz: the kit sends its kick too, and a plate full of
  // 50 Hz is rumble (it measured louder there than in the mids).
  ret('B', 'Plate', 0.8, { kind: 'plate', preset: 'Bright plate', params: { decay: 1.8, lowcut: 250 } }),
  ret('C', 'Echo', 0.8, { kind: 'delay', preset: 'Dotted eighth', params: { pingpong: 1, feedback: 0.4, highcut: 5000 } }),
]

export function demoProject(): Project {
  return {
    version: 2,
    name: 'Demo — Night Drive',
    bpm: BPM,
    swing: 0,
    masterLevel: 0.9,
    buses: RETURNS,
    tracks: [
      track({ kind: 'drum', name: 'Drums', drumGrid: drums(), level: 0.72, params: KIT, sends: { B: 0.14 } }),
      // The DX7 FM Bass is close to a sine this low (-26 dB at 250 Hz); the
      // saw pluck keeps the line audible on small speakers.
      track({ kind: 'va', name: 'Bass', presetName: 'Pluck Bass', steps: bass(), level: 0.62 }),
      // Wave Pad's filter opened from 4 kHz: at 4 kHz the pad sat 40 dB down
      // above 1 kHz and added only 250 Hz weight to the mix.
      // The pad's own chorus and reverb become a string ensemble and the hall.
      track({ kind: 'ws', name: 'Pad', presetName: 'Wave Pad', steps: pad(), level: 0.36,
        params: { ...DRY, filterCutoff: 9000 },
        inserts: [{ kind: 'ensemble', preset: 'String ensemble' }], sends: { A: 0.4 } }),
      track({
        kind: 'fm', name: 'Arp', presetName: 'E.Piano 2', steps: arp(), level: 0.9, pan: 0.15,
        // An MXR Phase 90 on the e-piano, under the echo.
        params: DRY, inserts: [{ kind: 'phaser', preset: 'Phase 90' }],
        sends: { C: 0.42, A: 0.2 },
      }),
      // The SID is mono; a Juno chorus spreads it.
      track({
        kind: 'sid', name: 'Lead', presetName: 'Galway PWM Lead', steps: LEAD, level: 0.62, pan: -0.1,
        inserts: [{ kind: 'chorus', preset: 'Juno II', params: { mix: 0.3 } }], sends: { B: 0.22, C: 0.16 },
      }),
      track({
        kind: 'pm', name: 'Harp', presetName: 'Harp', steps: HARP, level: 1, pan: -0.3,
        params: { ...DRY, masterVolume: 1 }, sends: { C: 0.4, A: 0.35 },
      }),
    ],
  }
}
