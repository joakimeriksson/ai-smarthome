// Musical pattern generation.
//
// The dice buttons live or die on this file: a random pattern that ignores
// key and rhythm is noise, and nobody presses the button twice. Everything
// here is scale-locked and rhythmically weighted so a re-roll lands on
// something playable, while still surprising you.
//
// Pure logic, no audio — unit tested in tests/generate.test.ts.

export type ScaleName = 'minorPentatonic' | 'majorPentatonic' | 'naturalMinor' | 'dorian' | 'major'

/** Semitone offsets from the root. Pentatonics first — hardest to make sound wrong. */
export const SCALES: Record<ScaleName, number[]> = {
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  naturalMinor:    [0, 2, 3, 5, 7, 8, 10],
  dorian:          [0, 2, 3, 5, 7, 9, 10],
  major:           [0, 2, 4, 5, 7, 9, 11],
}

export const SCALE_LABELS: Record<ScaleName, string> = {
  minorPentatonic: 'Minor pentatonic',
  majorPentatonic: 'Major pentatonic',
  naturalMinor:    'Natural minor',
  dorian:          'Dorian',
  major:           'Major',
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/**
 * Snap a scale degree (which may run past one octave, or negative) to a MIDI
 * note. Degree 0 is the root at `rootMidi`; degree 5 in a 5-note scale is the
 * root an octave up.
 */
export function degreeToMidi(rootMidi: number, scale: number[], degree: number): number {
  const n = scale.length
  // Floor division so negative degrees walk downward correctly.
  const octave = Math.floor(degree / n)
  const idx = degree - octave * n
  return rootMidi + octave * 12 + scale[idx]!
}

/** Nearest in-scale note at or below `midi` — used when scale-locking edits. */
export function snapToScale(midi: number, rootMidi: number, scale: number[]): number {
  const rel = midi - rootMidi
  const octave = Math.floor(rel / 12)
  const within = rel - octave * 12
  let best = scale[0]!
  let bestDist = Infinity
  for (const s of scale) {
    const d = Math.abs(s - within)
    if (d < bestDist) { bestDist = d; best = s }
  }
  return rootMidi + octave * 12 + best
}

/**
 * Euclidean rhythm — spreads `pulses` hits as evenly as possible over
 * `steps`. This is why one knob can produce a musical drum part: 3-in-8 is
 * a tresillo, 5-in-8 a cinquillo, 4-in-16 four-on-the-floor.
 * Bjorklund's algorithm, expressed as the simpler "bucket" form.
 */
export function euclid(steps: number, pulses: number, rotate = 0): boolean[] {
  const out = new Array<boolean>(steps).fill(false)
  if (steps <= 0) return out
  const p = Math.max(0, Math.min(steps, pulses))
  if (p === 0) return out
  for (let i = 0; i < p; i++) {
    // Even distribution. ceil (not floor) is what reproduces the canonical
    // Bjorklund figures — E(3,8) becomes the tresillo x..x..x. rather than
    // x.x..x.., and E(4,16) the expected four-on-the-floor.
    const pos = Math.ceil((i * steps) / p)
    out[(pos + rotate + steps) % steps] = true
  }
  return out
}

// --- Randomness --------------------------------------------------------------
// A seedable generator so a roll can be reproduced (and tested).

export interface Rng { (): number }

export function makeRng(seed: number): Rng {
  // mulberry32 — small, fast, good enough for musical choices.
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!

// --- Melodic patterns --------------------------------------------------------

export interface NoteCell { note: number | null; velocity: number }

export interface RiffOptions {
  steps?: number
  rootMidi?: number
  scale?: number[]
  /** 0..1 — how many steps carry a note. */
  density?: number
  /** Degrees the melody is allowed to roam over, relative to the root. */
  span?: number
  /** Bias toward the root/fifth on strong beats. */
  tonal?: boolean
}

/**
 * Generate a riff. Two ideas keep it musical:
 *  - strong beats (every 4th step) prefer the root or fifth,
 *  - motion between notes is mostly stepwise, so it sings instead of leaping.
 */
export function riff(rng: Rng, opts: RiffOptions = {}): NoteCell[] {
  const steps = opts.steps ?? 16
  const rootMidi = opts.rootMidi ?? 57            // A3
  const scale = opts.scale ?? SCALES.minorPentatonic
  const density = opts.density ?? 0.55
  const span = opts.span ?? scale.length + 3
  const tonal = opts.tonal ?? true

  const cells: NoteCell[] = []
  let degree = 0
  for (let i = 0; i < steps; i++) {
    const strong = i % 4 === 0
    // Strong beats sound more often than weak ones.
    const chance = strong ? Math.min(1, density + 0.3) : density * 0.8
    if (rng() > chance) {
      cells.push({ note: null, velocity: 100 })
      continue
    }
    if (strong && tonal && rng() < 0.6) {
      // Anchor: root or fifth-ish degree, possibly an octave away.
      degree = pick(rng, [0, 0, Math.floor(scale.length / 2)])
      if (rng() < 0.25) degree += scale.length
    } else {
      // Mostly stepwise motion, occasional leap.
      const move = rng() < 0.75
        ? pick(rng, [-2, -1, -1, 1, 1, 2])
        : pick(rng, [-4, -3, 3, 4])
      degree = Math.max(-scale.length, Math.min(span, degree + move))
    }
    cells.push({
      note: degreeToMidi(rootMidi, scale, degree),
      velocity: strong ? 110 : 80 + Math.floor(rng() * 25),
    })
  }
  // Guarantee a downbeat — a riff that starts on silence feels broken.
  if (cells[0] && cells[0].note === null) {
    cells[0] = { note: degreeToMidi(rootMidi, scale, 0), velocity: 110 }
  }
  return cells
}

/** Bass line: sparser, lower, anchored hard to the root. */
export function bassLine(rng: Rng, opts: RiffOptions = {}): NoteCell[] {
  return riff(rng, {
    steps: opts.steps ?? 16,
    rootMidi: opts.rootMidi ?? 33,   // A1
    scale: opts.scale ?? SCALES.minorPentatonic,
    density: opts.density ?? 0.4,
    span: 4,
    tonal: true,
  })
}

// --- Drum patterns -----------------------------------------------------------

/** Channel order matches DRUM_CHANNELS in instruments.ts. */
export const DRUM = {
  KICK: 0, SNARE: 1, CH_HAT: 2, OH_HAT: 3, CLAP: 4, TOM: 5, RIM: 6, COWBELL: 7,
} as const

/**
 * A drum grid built from euclidean parts per channel, with the kick and
 * snare kept close to convention so it reads as a beat rather than a puzzle.
 */
export function drumGrid(rng: Rng, steps = 16, channels = 8): number[][] {
  const grid: number[][] = Array.from({ length: channels }, () => new Array<number>(steps).fill(0))
  // Velocity matters now: the 808 engine's accent bus opens a voice up on a
  // hard hit, so a 45 and a 110 differ in brightness, not only in volume.
  // `vel` can be one number or a cycling accent pattern.
  const put = (ch: number, hits: boolean[], vel: number | number[]) => {
    if (ch >= channels) return
    let k = 0
    for (let i = 0; i < steps; i++) {
      if (!hits[i]) continue
      grid[ch]![i] = Array.isArray(vel) ? vel[k++ % vel.length]! : vel
    }
  }
  const offbeats = (period: number, phase: number) => {
    const hits = new Array<boolean>(steps).fill(false)
    for (let i = phase; i < steps; i += period) hits[i] = true
    return hits
  }

  // Style first, details after — a beat reads as a style, not as independent
  // per-lane dice rolls.
  const style = pick(rng, ['fourfloor', 'boombap', 'electro', 'clave', 'fourfloor', 'boombap'])

  if (style === 'fourfloor') {
    put(DRUM.KICK, offbeats(4, 0), 118)
    // Clap or snare backbeat, sometimes both layered.
    put(rng() < 0.5 ? DRUM.CLAP : DRUM.SNARE, offbeats(8, 4), 105)
    if (rng() < 0.3) put(DRUM.RIM, offbeats(8, 4), 60)
    put(DRUM.OH_HAT, offbeats(4, 2), 92)
    put(DRUM.CH_HAT, euclid(steps, 16), [50, 32, 40, 32])
    if (rng() < 0.5) put(DRUM.COWBELL, euclid(steps, pick(rng, [3, 5]), Math.floor(rng() * steps)), 55)
  } else if (style === 'boombap') {
    // Downbeat kick plus 1-3 syncopated kicks off the euclidean grid.
    const kick = new Array<boolean>(steps).fill(false)
    kick[0] = true
    const extras = euclid(steps, pick(rng, [3, 4]), pick(rng, [3, 6, 7]))
    for (let i = 2; i < steps; i++) if (extras[i] && i % 4 !== 0) kick[i] = true
    put(DRUM.KICK, kick, [127, 95, 88])
    // Backbeat with ghost notes around it.
    const snare = new Array<boolean>(steps).fill(false)
    for (let i = 4; i < steps; i += 8) snare[i] = true
    put(DRUM.SNARE, snare, 112)
    if (rng() < 0.6) {
      const ghosts = new Array<boolean>(steps).fill(false)
      ghosts[pick(rng, [7, 11, 15])] = true
      put(DRUM.SNARE, ghosts, 42)
    }
    put(DRUM.CH_HAT, euclid(steps, 8), [85, 55])
    if (rng() < 0.5) put(DRUM.OH_HAT, offbeats(16, pick(rng, [10, 14])), 80)
  } else if (style === 'electro') {
    const kick = new Array<boolean>(steps).fill(false)
    kick[0] = true
    for (const i of [7, 10]) if (rng() < 0.8) kick[i] = true
    if (rng() < 0.4) kick[13] = true
    put(DRUM.KICK, kick, [127, 85, 100])
    put(DRUM.SNARE, offbeats(8, 4), 108)
    put(DRUM.CLAP, offbeats(8, 4), 88)
    put(DRUM.CH_HAT, euclid(steps, 16), [80, 45, 60, 45])
    put(DRUM.OH_HAT, offbeats(8, 2), 85)
    put(DRUM.COWBELL, euclid(steps, pick(rng, [2, 3]), Math.floor(rng() * steps)), 78)
    if (rng() < 0.5) put(DRUM.RIM, euclid(steps, 3, pick(rng, [3, 5])), 65)
  } else {
    // Clave: the son 3-2 on rim, congas on tom, a sparse kick underneath.
    const kick = new Array<boolean>(steps).fill(false)
    kick[0] = true
    kick[8] = rng() < 0.7
    put(DRUM.KICK, kick, 105)
    const clave = new Array<boolean>(steps).fill(false)
    for (const i of [0, 3, 6, 10, 12]) clave[i] = true
    put(DRUM.RIM, clave, 95)
    // Tumbao-ish tom line: slaps on the "and"s with an accent at the turn.
    const tom = new Array<boolean>(steps).fill(false)
    for (const i of [2, 6, 10, 13, 14]) if (i === 14 || rng() < 0.8) tom[i] = true
    put(DRUM.TOM, tom, [72, 62, 72, 62, 100])
    put(DRUM.COWBELL, offbeats(4, 0), 82)
    put(DRUM.CH_HAT, euclid(steps, 8), [48, 34])
    if (rng() < 0.5) put(DRUM.CLAP, offbeats(16, 12), 70)
  }
  return grid
}
