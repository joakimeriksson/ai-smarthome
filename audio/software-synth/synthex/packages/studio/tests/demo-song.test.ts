// The demo song is the first thing anyone hears, so its failures are all
// silent ones worth guarding: a renamed preset (the track falls back to the
// init sound), a wrong note, a part mixed into inaudibility, or a mix that
// leans on the master limiter. Rendered through the real processors by
// scripts/render-song.ts, which mirrors the studio's scheduling and mixer.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEMOS } from '../src/lib/demos.ts'
import { renderProject } from '../scripts/render-song.ts'
import { defaultReturns } from '../src/lib/fx.ts'

const SR = 48000
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12))
type Render = Awaited<ReturnType<typeof renderProject>>

/** Pitch classes each song may use. */
const SCALE: Record<string, number[]> = {
  'night-drive': [9, 11, 0, 2, 4, 5, 7],                  // A natural minor
  // A major, plus the borrowed bVII (G) and bVI (F, C) chords' notes.
  'hi-score': [9, 11, 1, 2, 4, 6, 8, 7, 5, 0],
  // D natural minor (Bb in Bbmaj7 and Gm), plus the C# of the A major chord.
  'neon-rain': [2, 4, 5, 7, 9, 10, 0, 1],
  // E natural minor, plus the D# of the B major chord.
  'night-patrol': [4, 6, 7, 9, 11, 0, 2, 3],
  'rollout': [5, 7, 8, 10, 0, 1, 3],                      // F natural minor
  'skyline': [7, 9, 10, 0, 2, 3, 5],                      // G natural minor
  'afterglow': [0, 2, 3, 5, 7, 8, 10],                    // C natural minor
}

for (const demo of DEMOS) describe(`demo song: ${demo.id}`, () => {
  const project = demo.build()
  const inKey = new Set(SCALE[demo.id])
  let r: Render
  beforeAll(async () => { r = await renderProject(project, 1) }, 120_000)

  it('loads a real preset for every melodic track', () => {
    for (const t of project.tracks) {
      if (t.kind === 'drum') continue
      const bank = JSON.parse(readFileSync(resolve(__dirname, `../public/synths/${t.kind}.json`), 'utf8')) as
        { presets: { name: string }[] }
      expect(bank.presets.map(p => p.name), `${t.name}`).toContain(t.presetName)
    }
  })

  it('stays in key, chord tones included', () => {
    for (const t of project.tracks) {
      for (const s of t.steps) {
        if (s.note === null) continue
        for (const n of [s.note, ...(s.chord ?? []).map(iv => s.note! + iv)]) {
          expect(inKey.has(n % 12), `${t.name}: MIDI ${n}`).toBe(true)
        }
      }
    }
  })

  it('loops cleanly: every pattern divides the song', () => {
    const lens = project.tracks.map(t => t.kind === 'drum' ? t.drumGrid[0]!.length : t.steps.length)
    expect(r.songSteps).toBe(Math.max(...lens))
    project.tracks.forEach((t, i) => expect(r.songSteps % lens[i]!, t.name).toBe(0))
  })

  // A level above a fader's range plays, but the first touch of the fader
  // drops it (the studio's faders run 0..1, pan -1..1). Sends likewise.
  it('sets every level where its fader can show it', () => {
    for (const t of project.tracks) {
      expect(t.level, t.name).toBeLessThanOrEqual(1)
      expect(Math.abs(t.pan), t.name).toBeLessThanOrEqual(1)
      for (const [id, s] of Object.entries(t.sends ?? {})) {
        expect(typeof s === 'number' ? s : s.level, `${t.name} send ${id}`).toBeLessThanOrEqual(1)
      }
    }
    for (const b of project.buses ?? []) expect(b.level, `return ${b.id}`).toBeLessThanOrEqual(1)
  })

  // Every track, return and effect shares the studio's one audio thread;
  // past it, the browser drops blocks and the song clicks. Hi-Score needed
  // 104 % of a core here before idle SID chips stopped being clocked. The
  // bound is loose because this is wall-clock time on whatever machine runs
  // the tests.
  it('fits the audio thread with room to spare', () => {
    const cpu = [...r.stems, ...r.returns].reduce((a, s) => a + s.cpu, r.masterCpu)
    expect(cpu).toBeLessThan(0.9)
  })

  it('sends only to returns that exist', () => {
    const ids = new Set((project.buses ?? defaultReturns()).map(b => b.id))
    for (const t of project.tracks) for (const id of Object.keys(t.sends ?? {})) {
      expect(ids.has(id), `${t.name} -> ${id}`).toBe(true)
    }
  })

  it('every part is audible and nothing is broken', () => {
    const end = Math.round(r.songSteps * r.stepDur * SR)
    for (const s of r.stems) {
      let peak = 0, bad = 0
      for (let i = 0; i < end; i++) {
        const a = Math.max(Math.abs(s.L[i]!), Math.abs(s.R[i]!))
        if (!Number.isFinite(a)) bad++
        else if (a > peak) peak = a
      }
      expect(bad, `${s.name} non-finite samples`).toBe(0)
      // The quietest part is an accent (the harp's two pickups); its peaks
      // must still reach the level of the parts it answers.
      expect(db(peak), `${s.name} peak`).toBeGreaterThan(-24)
    }
  })

  it('leaves headroom: the limiter is a safety net, not part of the sound', () => {
    let peak = 0
    for (let i = 0; i < r.total; i++) peak = Math.max(peak, Math.abs(r.preLimiter.L[i]!), Math.abs(r.preLimiter.R[i]!))
    expect(db(peak)).toBeLessThan(-1)
    expect(r.limiter.activeShare).toBeLessThan(0.01)
  })
})

const project = DEMOS[0]!.build()

describe('held notes', () => {
  it('a note struck again while held is not cut by the old note-off', async () => {
    // A 4-step A3 followed at step 2 by another A3: the first note's note-off
    // (due at step 4) must not silence the second (held to step 10).
    const steps = Array.from({ length: 16 }, () => ({ note: null as number | null, velocity: 100 }))
    steps[0] = { note: 57, velocity: 100, length: 4 } as never
    steps[2] = { note: 57, velocity: 100, length: 8 } as never
    const p = {
      ...project, bpm: 120, masterLevel: 1,
      tracks: [{ ...project.tracks.find(t => t.kind === 'ws')!, steps, level: 1, pan: 0, params: {} }],
    }
    const out = await renderProject(p, 1)
    const stepS = 60 / 120 / 4
    const rms = (from: number, to: number) => {
      let e = 0; const a = Math.round(from * SR), b = Math.round(to * SR)
      for (let i = a; i < b; i++) e += out.stems[0]!.L[i]! ** 2
      return Math.sqrt(e / (b - a))
    }
    // Steps 5..9 are after the first note-off and before the second's.
    const held = rms(0.06 + 5 * stepS, 0.06 + 9 * stepS)
    const before = rms(0.06 + 2.5 * stepS, 0.06 + 3.5 * stepS)
    expect(db(held) - db(before)).toBeGreaterThan(-6)
  }, 60_000)
})
