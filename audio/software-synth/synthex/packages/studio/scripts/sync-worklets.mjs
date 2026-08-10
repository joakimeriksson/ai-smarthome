// Copy the standalone synths' AudioWorklet processors into the studio's
// public/ dir so the host can `addModule()` them.
//
// The originals in ../../../js/ remain the single source of truth — the
// standalone pages keep loading them directly and are never modified. This
// script runs on `predev` / `prebuild`, so edits to a processor show up in
// the studio on the next start.

import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
// packages/studio/scripts → software-synth/js
const SRC = resolve(HERE, '../../../../js')
const DEST = resolve(HERE, '../public/worklets')

// Processors plus the shared DSP library they import.
const WANTED = /(-processor|dsp-lib)\.js$/

async function main() {
  await mkdir(DEST, { recursive: true })
  let names
  try {
    names = (await readdir(SRC)).filter(n => WANTED.test(n))
  } catch (err) {
    console.error(`[sync-worklets] cannot read ${SRC}:`, err.message)
    console.error('[sync-worklets] studio will start, but vanilla instruments will fail to load.')
    return
  }
  for (const name of names) {
    await copyFile(resolve(SRC, name), resolve(DEST, name))
  }
  console.log(`[sync-worklets] copied ${names.length} files (processors + dsp-lib) → public/worklets/`)
}

await main()
