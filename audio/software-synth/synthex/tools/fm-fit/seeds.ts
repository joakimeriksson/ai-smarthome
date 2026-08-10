// Starting parameters for the fit — the guesswork layer, kept separate so the
// reasoning is inspectable.
//
// There is no parameter ground truth for the pack, but the famous DX7 patches
// have documented STRUCTURE, which seeds the search in the right basin:
//   - E.PIANO 1: three carrier+modulator pairs (our algorithm 6); two 1:1
//     body pairs, and the "tine" — a pair whose modulator sits near ratio 14
//     with a very fast decay, so the attack is bright and the body is not.
//   - BRASS: 1:1 stacks whose MODULATOR attack is slow (~60-100 ms) — the
//     brightness swells after the note starts; that swell IS the brass.
//   - STRINGS: 1:1 pairs, slow attack everywhere, pairs finely detuned
//     against each other for the ensemble shimmer.
//   - E.ORGAN: additive (algorithm 7): drawbar-style carriers at 1, 2, 3, 4
//     with organ envelopes (instant on, full sustain).
//   - WURLITZER: like the e-piano but reedier — hotter 1:1 modulator (more
//     bark), tine higher and quieter.
// The numbers are then fitted by tools/fm-fit/optimize.ts.

import type { FmPreset, FmOp } from './render.ts'

const op = (
  ratio: number, fine: number, level: number,
  attack: number, decay: number, sustain: number, release: number,
): FmOp => ({ on: true, ratio, fine, level, attack, decay, sustain, release, velSens: 0 })

export const PRESET_SEEDS: Record<string, FmPreset> = {
  'E.Piano 1': {
    algorithm: 6, feedback: 0.24,
    ops: [
    op(1, 1, 1, 0.001, 1.496, 0, 0.4),
    op(1, 1, 1, 0.03, 0.765, 0.25, 0.3),
    op(1, 1.001, 0.315, 0.014, 0.6, 0, 0.4),
    op(14, 1, 0.171, 0.001, 0.013, 0, 0.1),
    op(1, 0.999, 0.21, 0.01, 1.53, 0.15, 0.4),
    op(1, 1, 0.3, 0.03, 0.51, 0.25, 0.3),
    ],
    lfoRate: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
  },
  'DX Brass': {
    algorithm: 6, feedback: 0.44,
    ops: [
    op(1, 1, 0.95, 0.084, 0.48, 0.48, 0.15),
    op(1, 1, 1, 0.028, 0.18, 0.264, 0.15),
    op(1, 1.003, 0.826, 0.08, 0.48, 0.8, 0.15),
    op(1, 1, 0.42, 0.2, 0.5, 0.5, 0.15),
    op(1, 0.997, 0.425, 0.05, 0.48, 0.48, 0.15),
    op(1, 1, 0.55, 0.09, 0.5, 0.5, 0.15),
    ],
    lfoRate: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
  },
  'Strings': {
    // The recording swells for ~1.5 s (RMS peaks 70% through the note) and
    // keeps a low modulation index — energy is nearly all in h1-h3.
    algorithm: 6, feedback: 0.25,
    ops: [
      op(1, 1, 0.9, 1.3, 1.2, 0.9, 0.6),
      op(1, 1, 0.35, 1.5, 1.0, 0.6, 0.6),
      op(1, 1.004, 0.6, 1.2, 1.2, 0.9, 0.6),
      op(3, 1, 0.2, 1.6, 0.9, 0.5, 0.6),
      op(1, 0.996, 0.5, 1.4, 1.2, 0.9, 0.6),
      op(1, 1, 0.3, 1.5, 1.0, 0.6, 0.6),
    ],
    lfoRate: 5.5, lfoPitchDepth: 0.05, lfoAmpDepth: 0,
  },
  'Organ': {
    // The recording is a Hammond-style registration: partials at 0.5, 1, 1.5,
    // 4, 6 and 8 x the fundamental (the 1.5 is the giveaway — that is a
    // drawbar, not an FM harmonic). Levels seeded from the measured ladder.
    algorithm: 7, feedback: 0,
    ops: [
      op(0.5, 1, 0.12, 0.004, 0.1, 1.0, 0.05),
      op(1, 1, 0.9, 0.004, 0.1, 1.0, 0.05),
      op(1.5, 1, 0.85, 0.004, 0.1, 1.0, 0.05),
      op(4, 1, 0.12, 0.004, 0.1, 1.0, 0.05),
      op(6, 1, 0.5, 0.004, 0.1, 1.0, 0.05),
      op(8, 1, 0.42, 0.004, 0.1, 1.0, 0.05),
    ],
    lfoRate: 6.5, lfoPitchDepth: 0.01, lfoAmpDepth: 0.12,
  },
  'Wurlitzer': {
    algorithm: 6, feedback: 0.768,
    ops: [
    op(1, 1, 0.791, 0.042, 0.432, 0, 0.35),
    op(1, 1, 1, 0.042, 0.744, 0.06, 0.3),
    op(1, 1.002, 0.392, 0.001, 0.384, 0, 0.35),
    op(7, 1, 0.416, 0.001, 0.051, 0.144, 0.1),
    op(1, 1, 0.245, 0.015, 0.336, 0, 0.35),
    op(1, 1, 0.496, 0.02, 0.722, 0.3, 0.3),
    ],
    lfoRate: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
  },
}
