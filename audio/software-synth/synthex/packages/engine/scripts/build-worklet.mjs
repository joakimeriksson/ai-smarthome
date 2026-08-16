// Bundle the Synthex voice worklet into a plain .js file that a browser can
// hand straight to audioWorklet.addModule().
//
// This exists because Vite has no first-class AudioWorklet support. The old
// approach — `new URL('./worklets/voice-processor.ts', import.meta.url)` —
// works in dev (Vite transpiles on request) but in a production build Rollup
// inlines the file as a base64 data URL with MIME `video/mp2t` (what `.ts`
// maps to) containing UNTRANSPILED TypeScript. addModule() then fails on
// `import type`, and the built app renders but makes no sound. Nothing throws
// at build time, so it is invisible until you deploy.
//
// esbuild bundles voice-processor.ts with its imports (voice-core, patch) and
// strips the types, producing one self-contained ES module. It is written into
// each app's public/ dir so Vite copies it verbatim and the URL stays stable
// and relative — which also keeps sub-path deploys (project Pages sites)
// working.

import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = resolve(HERE, '..')
const SYNTHEX = resolve(ENGINE, '../..')

const ENTRY = resolve(ENGINE, 'src/worklets/voice-processor.ts')
const OUT = resolve(ENGINE, 'dist-worklet/synthex-voice-processor.js')

/** Every app that hosts the Synthex engine needs the worklet beside it. */
const CONSUMERS = [
  resolve(SYNTHEX, 'packages/app/public/synthex-voice-processor.js'),
  resolve(SYNTHEX, 'packages/studio/public/worklets/synthex-voice-processor.js'),
]

await mkdir(dirname(OUT), { recursive: true })
await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  // AudioWorkletGlobalScope has no window/document; keep the output plain.
  platform: 'neutral',
  legalComments: 'none',
})

for (const dest of CONSUMERS) {
  await mkdir(dirname(dest), { recursive: true })
  await copyFile(OUT, dest)
}

console.log(`[build-worklet] synthex-voice-processor.js -> ${CONSUMERS.length} apps`)
