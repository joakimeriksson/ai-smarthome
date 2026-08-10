// Coordinate descent over each preset's numeric parameters, scored against
// its DX7 recording. Structure (algorithm, which ops are on, near-integer
// ratios) is fixed by the seed; this only moves the numbers.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRESET_SEEDS } from './seeds.ts'
import { TARGETS, scorePreset } from './fitlib.ts'
import type { FmPreset } from './render.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Parameter paths to optimise, with how to mutate each. */
interface Knob {
  get(p: FmPreset): number
  set(p: FmPreset, v: number): void
  candidates(v: number): number[]
  name: string
}

function knobsFor(p: FmPreset): Knob[] {
  const out: Knob[] = []
  const scale = (f: number[]) => (v: number) => f.map(m => v * m).filter(x => x > 1e-4)
  // Ensemble movement: the recordings have vibrato/tremolo (Leslie on the
  // organ, section shimmer on the strings) that static spectra cannot match.
  out.push({
    name: 'lfoRate',
    get: q => q.lfoRate ?? 0,
    set: (q, v) => { q.lfoRate = v },
    candidates: v => (v < 0.1 ? [4, 5.5, 7] : [v * 0.8, v * 1.2]),
  })
  out.push({
    name: 'lfoPitchDepth',
    get: q => q.lfoPitchDepth ?? 0,
    set: (q, v) => { q.lfoPitchDepth = v },
    candidates: v => (v < 0.005 ? [0.01, 0.03, 0.08] : [v * 0.6, v * 1.5]),
  })
  out.push({
    name: 'lfoAmpDepth',
    get: q => q.lfoAmpDepth ?? 0,
    set: (q, v) => { q.lfoAmpDepth = v },
    candidates: v => (v < 0.005 ? [0.05, 0.15] : [v * 0.6, v * 1.5]),
  })
  out.push({
    name: 'feedback',
    get: q => q.feedback,
    set: (q, v) => { q.feedback = Math.min(1, v) },
    candidates: v => (v < 0.05 ? [0.05, 0.15] : scale([0.6, 0.8, 1.25, 1.6])(v)),
  })
  p.ops.forEach((o, i) => {
    if (!o.on) return
    out.push({
      name: `op${i}.level`,
      get: q => q.ops[i]!.level,
      set: (q, v) => { q.ops[i]!.level = Math.min(1, v) },
      candidates: scale([0.7, 0.85, 1.18, 1.4]),
    })
    out.push({
      name: `op${i}.decay`,
      get: q => q.ops[i]!.decay,
      set: (q, v) => { q.ops[i]!.decay = v },
      candidates: scale([0.6, 0.8, 1.25, 1.7]),
    })
    out.push({
      name: `op${i}.attack`,
      get: q => q.ops[i]!.attack,
      set: (q, v) => { q.ops[i]!.attack = v },
      candidates: v => (v <= 0.002 ? [0.001, 0.01, 0.03] : scale([0.5, 0.7, 1.4, 2])(v)),
    })
    out.push({
      name: `op${i}.fine`,
      get: q => q.ops[i]!.fine,
      set: (q, v) => { q.ops[i]!.fine = v },
      candidates: v => [v - 0.004, v - 0.002, v + 0.002, v + 0.004]
        .filter(x => x > 0.985 && x < 1.015),
    })
    out.push({
      name: `op${i}.sustain`,
      get: q => q.ops[i]!.sustain,
      set: (q, v) => { q.ops[i]!.sustain = Math.min(1, v) },
      candidates: v => (v < 0.03 ? [0, 0.1, 0.25] : scale([0.6, 0.8, 1.2])(v)),
    })
  })
  return out
}

export async function optimize(): Promise<void> {
  const fitted: Record<string, FmPreset> = {}
  for (const t of TARGETS) {
    const seed = PRESET_SEEDS[t.preset]
    if (!seed) continue
    // Resume from the previous best when it exists, so successive runs refine
    // rather than restart.
    let best: FmPreset = JSON.parse(JSON.stringify(seed)) as FmPreset
    const prevPath = resolve(HERE, 'out/fitted.json')
    if (existsSync(prevPath)) {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8')) as Record<string, FmPreset>
      if (prev[t.preset]) {
        const cand = prev[t.preset]!
        if (scorePreset(cand, t.file, t.note) < scorePreset(best, t.file, t.note)) best = cand
      }
    }
    let bestScore = scorePreset(best, t.file, t.note)
    console.log(`\n${t.preset}: seed ${bestScore.toFixed(2)} dB`)

    for (let round = 0; round < 3; round++) {
      let improved = false
      for (const knob of knobsFor(best)) {
        const cur = knob.get(best)
        for (const cand of knob.candidates(cur)) {
          const trial = JSON.parse(JSON.stringify(best)) as FmPreset
          knob.set(trial, cand)
          const s = scorePreset(trial, t.file, t.note)
          if (s < bestScore - 0.01) {
            best = trial
            bestScore = s
            improved = true
            console.log(`  ${knob.name} -> ${cand.toFixed(3)}  ${s.toFixed(2)} dB`)
          }
        }
      }
      if (!improved) break
    }
    console.log(`  final ${bestScore.toFixed(2)} dB`)
    if (t.validate) {
      console.log(`  validation ${scorePreset(best, t.validate.file, t.validate.note).toFixed(2)} dB (${t.validate.file})`)
    }
    fitted[t.preset] = best
  }
  const outDir = resolve(HERE, 'out')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'fitted.json'), JSON.stringify(fitted, null, 2))
  console.log(`\nwrote ${resolve(outDir, 'fitted.json')}`)
}
