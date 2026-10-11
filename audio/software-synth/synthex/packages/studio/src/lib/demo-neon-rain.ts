// "Neon Rain" — an original piece in the manner of Vangelis's early-80s film
// scoring (Blade Runner, 1982), for the studio's synths. No theme or line
// from that score is used; these are its devices, with new material:
//
//   - Yamaha CS-80 brass: detuned saws whose filter starts all but closed
//     and opens across the whole chord (3 s of a 3.75 s bar), resonance up
//     so the sweep is heard passing through the harmonics; slow shimmer
//     vibrato
//   - the same closed-to-open sweep on every long tone, at different speeds
//     so they never breathe together: lead notes ~1 s, the drone 2.5 s, the
//     air pad 5.5 s (it never quite opens before the next chord closes it),
//     plus a very slow free-running LFO on the pads' cutoff so no two passes
//     of the loop sound quite alike
//   - a singing lead that glides between notes (the CS-80's portamento /
//     ribbon) and blooms into vibrato after the note has settled
//   - a low pedal drone under the chords, bells, and very large reverb
//   - no drum kit: distant low booms, and a tom build into the turnaround
//   - modal minor harmony with added ninths and a suspended dominant:
//       Dm(add9) | Bbmaj7 | Gm(add9) | Asus4 A
//   - rain: band-passed noise from the SID, held under everything
//
//   - the lead "leans in" on chosen long notes: aftertouch (NoteStep.pressure)
//     opens its filter partway through the note, the way a CS-80 player
//     presses into a key
//
// 64 BPM: one bar is 3.75 s; the 16 bars below run a minute.

import type { Project, ProjectTrack } from './project.ts'
import type { NoteStep } from './track.svelte.ts'
import * as kit from './demo-kit.ts'
import { n, DRY, ret } from './demo-kit.ts'

const BARS = 16
const STEPS = 16 * BARS
const BPM = 64

const rests = () => kit.rests(STEPS)
const phrase = (spec: Parameters<typeof kit.phrase>[1]) => kit.phrase(STEPS, spec)
const track = (t: Partial<ProjectTrack> & Pick<ProjectTrack, 'kind' | 'name'>) => kit.track(STEPS, t)

// ── Form: 16 bars, a minute ──────────────────────────────────────────────
//
//   bars  1-4   intro       drone, air and rain; the brass enters in bar 3
//   bars  5-8   theme       the lead's melody over Dm(add9) | Bbmaj7 | Gm(add9) | Asus4 A
//   bars  9-12  rise        Bbmaj7 | Fmaj7 | Gm(add9) | Asus4 A, the lead climbs and
//                           leans into its long notes (aftertouch opens the filter)
//   bars 13-16  return      the theme again, now pressed harder, into the loop

type Shape = [string, number[]]
const Dm9: Shape = ['D3', [3, 7, 14]], Bbmaj7: Shape = ['Bb2', [4, 7, 11]], Gm9: Shape = ['G2', [3, 7, 14]]
const Fmaj7: Shape = ['F2', [4, 7, 11]], Asus4: Shape = ['A2', [5, 7, 12]], A: Shape = ['A2', [4, 7, 12]]

/** One entry per bar: the brass shape(s), the air's upper structure, the drone root. */
const BARS_SPEC: { brass: Shape[]; air: Shape; drone: string }[] = [
  // intro
  { brass: [], air: ['A4', [3, 7]], drone: 'D2' },
  { brass: [], air: ['D5', [3, 7]], drone: 'Bb1' },
  { brass: [Dm9], air: ['A4', [3, 7]], drone: 'D2' },
  { brass: [Bbmaj7], air: ['D5', [3, 7]], drone: 'Bb1' },
  // theme
  { brass: [Dm9], air: ['A4', [3, 7]], drone: 'D2' },
  { brass: [Bbmaj7], air: ['D5', [3, 7]], drone: 'Bb1' },
  { brass: [Gm9], air: ['Bb4', [4, 7]], drone: 'G1' },
  { brass: [Asus4, A], air: ['A4', [7, 12]], drone: 'A1' },
  // rise
  { brass: [Bbmaj7], air: ['D5', [3, 7]], drone: 'Bb1' },
  { brass: [Fmaj7], air: ['C5', [4, 7]], drone: 'F1' },
  { brass: [Gm9], air: ['Bb4', [4, 7]], drone: 'G1' },
  { brass: [Asus4, A], air: ['A4', [7, 12]], drone: 'A1' },
  // return
  { brass: [Dm9], air: ['A4', [3, 7]], drone: 'D2' },
  { brass: [Bbmaj7], air: ['D5', [3, 7]], drone: 'Bb1' },
  { brass: [Gm9], air: ['Bb4', [4, 7]], drone: 'G1' },
  { brass: [Asus4, A], air: ['A4', [7, 12]], drone: 'A1' },
]

function brass(): NoteStep[] {
  const cells = rests()
  BARS_SPEC.forEach(({ brass: shapes }, bar) => {
    const len = 16 / Math.max(1, shapes.length)
    shapes.forEach(([root, shape], k) => {
      // The entry in bar 3 comes in softer; the return is the fullest.
      const vel = bar < 4 ? 78 : bar >= 12 ? 100 : 92
      cells[bar * 16 + k * len] = { note: n(root), chord: [...shape], velocity: vel, length: len - 0.25 }
    })
  })
  return cells
}

function air(): NoteStep[] {
  const cells = rests()
  BARS_SPEC.forEach(({ air: [root, shape] }, bar) => {
    cells[bar * 16] = { note: n(root), chord: [...shape], velocity: 76, length: 15.75 }
  })
  return cells
}

// The pedal: each chord's root two octaves down, held through the bar.
function drone(): NoteStep[] {
  const cells = rests()
  BARS_SPEC.forEach(({ drone: root }, bar) => {
    cells[bar * 16] = { note: n(root), velocity: bar % 4 === 3 ? 100 : 96, length: 15.75 }
  })
  return cells
}

// The lead: [bar, step, note, length, velocity, aftertouch]. It rests
// through the intro, sings the theme plainly, then climbs in the rise and
// leans into the long notes — the filter opening mid-note, as a CS-80
// player does by pressing into the key — and presses hardest in the return.
const LEAD = phrase([
  // theme (bars 5-8)
  [4, 0, 'D5', 5.8, 96], [4, 6, 'E5', 1.8, 84], [4, 8, 'F5', 5.8, 100], [4, 14, 'E5', 1.8, 86],
  [5, 0, 'D5', 7.8, 94], [5, 8, 'A4', 7.8, 88],
  [6, 0, 'Bb4', 3.8, 92], [6, 4, 'A4', 1.8, 84], [6, 6, 'G4', 1.8, 84], [6, 8, 'D5', 7.8, 100, 0.45],
  [7, 0, 'E5', 7.8, 104], [7, 8, 'C#5', 7.8, 96],
  // rise (bars 9-12)
  [8, 0, 'D5', 3.8, 96], [8, 4, 'F5', 3.8, 100], [8, 8, 'A5', 7.8, 108, 0.8],
  [9, 0, 'G5', 1.8, 92], [9, 2, 'A5', 1.8, 96], [9, 4, 'C6', 7.8, 112, 1], [9, 12, 'A5', 3.8, 98],
  [10, 0, 'Bb5', 5.8, 104, 0.6], [10, 6, 'A5', 1.8, 90], [10, 8, 'G5', 3.8, 94], [10, 12, 'D5', 3.8, 92],
  [11, 0, 'E5', 7.8, 104, 0.7], [11, 8, 'C#5', 7.8, 96],
  // return (bars 13-16)
  [12, 0, 'D5', 5.8, 100], [12, 6, 'E5', 1.8, 88], [12, 8, 'F5', 5.8, 106, 0.7], [12, 14, 'E5', 1.8, 90],
  [13, 0, 'D5', 7.8, 100, 0.5], [13, 8, 'A4', 7.8, 92],
  [14, 0, 'Bb4', 3.8, 96], [14, 4, 'A4', 1.8, 88], [14, 6, 'G4', 1.8, 88], [14, 8, 'D5', 7.8, 108, 0.9],
  [15, 0, 'E5', 7.8, 112, 1], [15, 8, 'C#5', 7.8, 100, 0.4],
])

// Bells: at the start of each section, and answering the lead in the rise.
const BELLS = phrase([
  [0, 0, 'A5', 4, 104], [2, 8, 'F5', 4, 96],
  [4, 0, 'A5', 4, 120], [5, 8, 'F5', 4, 108], [6, 0, 'D6', 4, 116], [7, 8, 'E5', 4, 108],
  [8, 0, 'F5', 4, 116], [9, 8, 'E6', 4, 112], [10, 0, 'D6', 4, 116], [11, 8, 'E5', 4, 108],
  [12, 0, 'A5', 4, 124], [14, 0, 'D6', 4, 118], [15, 8, 'E5', 4, 110],
])

// Rain: one long band-passed noise note under the whole minute.
const RAIN = phrase([[0, 0, 'C5', STEPS - 0.5, 90]])

/** Booms at section starts and on the third bar of each, a tom build into each section. */
function booms(): number[][] {
  const g = kit.emptyGrid(STEPS)
  const KICK = 0, TOM = 5, CRASH = 7
  const hit = (ch: number, bar: number, step: number, v: number) => { g[ch]![bar * 16 + step] = v }
  hit(KICK, 0, 0, 92)
  for (const [bar, v] of [[4, 120], [6, 104], [8, 116], [10, 104], [12, 124], [14, 108]] as const) hit(KICK, bar, 0, v)
  for (const bar of [4, 8, 12]) hit(CRASH, bar, 0, 52)
  for (const bar of [7, 11, 15]) {
    for (const [s, v] of [[0, 64], [4, 78], [8, 94], [12, 112]] as const) hit(TOM, bar, s, v)
  }
  return g
}

// ── Sound ─────────────────────────────────────────────────────────────────

// One enormous hall for everything (return A), and a dotted-eighth echo
// synced to the song (C, 0.7 s at 64 BPM) for the lead and the bells — where
// each synth used to run its own reverb and delay. B is a shimmer: the
// bells and the air rise an octave on each pass of its tail.
const RETURNS = [
  // Low cut at 220 Hz: at 150 the hall added 3 dB of 250 Hz mud to the mix.
  ret('A', 'Hall', 0.75, { kind: 'hall', preset: 'Large hall',
    params: { decay: 6.5, size: 2, predelay: 45, damping: 0.5, mod: 0.6, early: 0.15, highcut: 8000, lowcut: 220 } }),
  ret('B', 'Shimmer', 0.7, { kind: 'shimmer', preset: 'Cathedral shimmer', params: { lowcut: 300, highcut: 8000 } }),
  ret('C', 'Echo', 0.9, { kind: 'delay', preset: 'Dotted eighth',
    params: { feedback: 0.42, pingpong: 1, highcut: 4500, wobble: 0.2 } }),
]
/** LFO 1 to pitch as a vibrato that waits `delay` s, then fades in. */
const vibrato = (cents: number, hz: number, delay: number, fade: number): Record<string, number | string | boolean> => ({
  'mod.0.src': 'lfo1', 'mod.0.dst': 'pitch', 'mod.0.amount': cents / 200,   // amount 1 = +-2 st
  lfo1Waveform: 0, lfo1Rate: hz, lfo1Sync: true, lfo1Delay: delay, lfo1FadeIn: fade,
})

/**
 * A slow, free-running LFO 2 on the filter cutoff: `oct` octaves either way
 * over one `seconds`-long cycle. Free-running (no reset per note), so it
 * drifts against the 15 s loop instead of repeating with it.
 */
const drift = (slot: number, oct: number, seconds: number): Record<string, number | string | boolean> => ({
  [`mod.${slot}.src`]: 'lfo2', [`mod.${slot}.dst`]: 'cutoff', [`mod.${slot}.amount`]: oct / 4,  // amount 1 = +-4 oct
  lfo2Waveform: 0, lfo2Rate: 1 / seconds, lfo2Sync: false,
})

/**
 * CS-80 brass on the VA: three detuned saws. The filter starts at 150 Hz
 * (little more than the fundamentals) and keeps opening for the whole
 * chord: two envelopes whose attacks (7 s and 8 s) are longer than the
 * 3.75 s bar, so the exponential never reaches its fast-then-flat top — at
 * 2.6 s they had it all but open within the first second (measured). The
 * release closes it again. Resonance up, so the sweep is heard.
 */
const CS80_BRASS = {
  // unisonSpread 0: one filter per voice instead of a stereo pair — a third
  // less CPU on the studio's shared audio thread (where an overrun is heard
  // as clicks); the chorus and hall give the width.
  unisonCount: 3, unisonDetune: 10, unisonSpread: 0, osc2Level: 0.7, osc2Detune: 9,
  filterCutoff: 150, filterResonance: 0.32, filterEnvAmount: 1, filterKeyTrack: 0.4,
  filterAttack: 7, filterDecay: 6, filterSustain: 0.9, filterRelease: 3.5,
  'mod.2.src': 'modEnv', 'mod.2.dst': 'cutoff', 'mod.2.amount': 0.3,
  modAttack: 8, modDecay: 6, modSustain: 1, modRelease: 3.5,
  ampAttack: 0.35, ampDecay: 3, ampSustain: 0.85, ampRelease: 3.5, driftAmount: 0.5,
  ...vibrato(8, 4.6, 0.9, 1.2),
  ...drift(1, 0.25, 9),
  ...DRY,
}

/**
 * A singing lead: saw + square, gliding, vibrato after a third of a second.
 * Each note opens from dark (330 Hz) over about a second as the vibrato
 * arrives, so a long note blooms twice over. One voice and a light square
 * 4 cents off: the preset's unison and 15-cent detune, and a square as loud
 * in its fundamental as the saw, beat the fundamental away (dips to -14 dB
 * every 0.1-0.7 s) — a hollow wobble that hid the bloom.
 */
const CS80_LEAD = {
  unisonCount: 1, osc1Waveform: 0, osc2Waveform: 1, osc2Level: 0.15, osc2Detune: 4,
  filterCutoff: 330, filterResonance: 0.28, filterEnvAmount: 0.7, filterKeyTrack: 0.5,
  filterAttack: 1.1, filterDecay: 5, filterSustain: 0.9, filterRelease: 2,
  ampAttack: 0.08, ampSustain: 0.9, ampRelease: 2, portamento: true, portamentoTime: 0.12,
  ...vibrato(17, 5.2, 0.35, 0.5),
  // Aftertouch opens the filter up to 1.6 octaves further and lifts the
  // level a little, on the notes the score presses (NoteStep.pressure).
  'mod.1.src': 'pressure', 'mod.1.dst': 'cutoff', 'mod.1.amount': 0.4,
  'mod.2.src': 'pressure', 'mod.2.dst': 'amp', 'mod.2.amount': 0.25,
  ...DRY,
}

/** 808 kit tuned down into timpani and distant thunder. */
const BOOM_KIT: Record<string, number> = {
  'ch.0.tone': 40, 'ch.0.decay': 1, 'ch.0.color': 0.15,
  'ch.5.tone': 62, 'ch.5.decay': 0.9, 'ch.5.color': 0.3,
  'ch.7.type': 8, 'ch.7.tone': 220, 'ch.7.decay': 1, 'ch.7.level': 0.35,
}

export function neonRainProject(): Project {
  return {
    version: 2,
    name: 'Demo — Neon Rain',
    bpm: BPM,
    swing: 0,
    masterLevel: 1,
    buses: RETURNS,
    tracks: [
      // Distant thunder is distant because it is in the hall.
      track({ kind: 'drum', name: 'Booms', drumGrid: booms(), level: 0.42, params: BOOM_KIT, sends: { A: 0.35 } }),
      track({
        kind: 'va', name: 'Drone', presetName: 'Deep Sub', steps: drone(), level: 0.9,
        // Resonant low-pass opening from 80 Hz to ~850 Hz over 2.5 s: the pedal growls in.
        params: {
          ampAttack: 0.8, ampRelease: 3, 'fx.dist.enabled': false, ...DRY,
          filterCutoff: 80, filterResonance: 0.4, filterEnvAmount: 0.85,
          filterAttack: 2.5, filterDecay: 5, filterSustain: 0.8, filterRelease: 3,
        },
        sends: { A: 0.22 },
      }),
      // A slow, wide chorus in place of the synth's own, then the hall.
      track({ kind: 'va', name: 'Brass', presetName: 'Brass Stab', steps: brass(), level: 0.55, params: CS80_BRASS,
        inserts: [{ kind: 'chorus', preset: 'Slow & wide', params: { rate: 0.35, mix: 0.3 } }], sends: { A: 0.5 } }),
      // Slowest sweep of all: 300 Hz opening over 5.5 s, longer than the
      // chord, and a 14 s free LFO on top.
      track({ kind: 'ws', name: 'Air', presetName: 'Ethereal', steps: air(), level: 0.42, pan: 0.2,
        params: {
          filterCutoff: 300, filterResonance: 0.3, filterEnvAmount: 0.85,
          fltA: 5.5, fltD: 6, fltS: 0.8, fltR: 6, ...drift(0, 0.3, 14), ...DRY,
        },
        inserts: [{ kind: 'ensemble', preset: 'Lush' }], sends: { A: 0.55, B: 0.3 } }),
      track({ kind: 'va', name: 'Lead', presetName: 'Supersaw Lead', steps: LEAD, level: 0.75, params: CS80_LEAD,
        sends: { A: 0.45, C: 0.3 } }),
      track({
        kind: 'fm', name: 'Bells', presetName: 'Tubular Bell', steps: BELLS, level: 1, pan: -0.25,
        params: DRY, sends: { A: 0.55, C: 0.35, B: 0.35 },
      }),
      // Space Noise band-passes at 0x40, which is a rumble; opened up it hisses.
      track({
        kind: 'sid', name: 'Rain', presetName: 'Space Noise', steps: RAIN, level: 0.42, pan: -0.1,
        params: { filterCutoff: 170, filterReso: 6 }, sends: { A: 0.3 },
        // A jet sweep through the rain, synced to four bars (15 s here).
        inserts: [{ kind: 'flanger', preset: 'Synced 2 bars', params: { division: 6, feedback: 0.7, manual: 1.5, depth: 0.9 } }],
      }),
    ],
  }
}
