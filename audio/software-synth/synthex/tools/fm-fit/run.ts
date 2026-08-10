// CLI for the FM fit — see fitlib.ts for the measurement machinery.
// Kept separate from the library so optimize.ts can import the library
// without a circular top-level-await deadlock through this file.

import { existsSync } from 'node:fs'
import { loadFm } from './render.ts'
import { PACK_DIR, TARGETS, PRESET_SEEDS, scorePreset } from './fitlib.ts'

if (!existsSync(PACK_DIR)) {
  console.error(`[fm-fit] no DX7 pack at ${PACK_DIR} (set DX7_PACK)`)
  process.exit(1)
}
await loadFm()

if (process.argv.includes('optimize')) {
  const { optimize } = await import('./optimize.ts')
  await optimize()
} else {
  console.log('preset       target                    fit dB   validation')
  for (const t of TARGETS) {
    const seed = PRESET_SEEDS[t.preset]
    if (!seed) continue
    const d = scorePreset(seed, t.file, t.note)
    let val = ''
    if (t.validate) {
      val = scorePreset(seed, t.validate.file, t.validate.note).toFixed(2) + ` (${t.validate.file})`
    }
    console.log(`${t.preset.padEnd(12)} ${t.file.padEnd(24)} ${d.toFixed(2).padStart(7)}   ${val}`)
  }
}
