// The production build must ship a loadable Synthex worklet.
//
// This guards a failure that was invisible everywhere else: Vite inlined
// `voice-processor.ts` as a base64 data URL with MIME `video/mp2t`, containing
// untranspiled TypeScript. The build succeeded, the app rendered, typecheck
// passed, every other test passed — and the deployed synth made no sound,
// because addModule() cannot parse `import type`.
//
// Runs against the prebuilt artifact (engine/scripts/build-worklet.mjs), and
// skips when it has not been built yet.

import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKLET = resolve(__dirname, '../../engine/dist-worklet/synthex-voice-processor.js')
const built = existsSync(WORKLET)

// Locally the artifact may simply not have been built yet, so these skip. In
// CI they must not: a skipped guard is indistinguishable from a passing one in
// the summary, and this is the guard standing between a broken worklet and a
// deployed silent synth. Fail loudly instead, and tell the pipeline what to fix.
if (!built && process.env['CI']) {
  throw new Error(
    'Synthex worklet not built. CI must run the build before the tests — ' +
    '`npm run build-worklet --workspace @synthex/engine`.',
  )
}

describe.skipIf(!built)('built Synthex worklet', () => {
  it('is plain JavaScript with no TypeScript syntax left', () => {
    const src = readFileSync(WORKLET, 'utf8')
    expect(src).not.toMatch(/^import type/m)
    expect(src).not.toMatch(/\bdeclare const\b/)
    // Bundled, so nothing may remain to resolve at load time.
    expect(src).not.toMatch(/from ['"]\.\.?\//)
    expect(src).toMatch(/registerProcessor/)
  })

  // One import for both checks: Node caches ES modules by path, so a second
  // `import` returns the cached module and registerProcessor never fires
  // again — the class would come back undefined.
  interface Voice {
    port: { onmessage: ((e: { data: unknown }) => void) | null }
    process(i: unknown[], o: Float32Array[][], p: unknown): boolean
  }
  let registered: { name: string; cls: new () => Voice } | null = null

  beforeAll(async () => {
    const g = globalThis as unknown as Record<string, unknown>
    g['sampleRate'] = 44100
    g['currentTime'] = 0
    g['AudioWorkletProcessor'] = class {
      port = { onmessage: null, postMessage() { /* host side */ } }
    }
    g['registerProcessor'] = (name: string, cls: new () => Voice) => {
      registered = { name, cls }
    }
    await import(WORKLET)
  })

  it('evaluates and registers its processor, as addModule() requires', () => {
    expect(registered).not.toBeNull()
    expect(registered!.name).toBe('synthex-voice')
  })

  it('renders audio for a note', () => {
    const v = new registered!.cls()
    v.port.onmessage!({ data: { type: 'noteOn', note: 69, velocity: 100 } })
    const l = new Float32Array(128)
    const r = new Float32Array(128)
    let peak = 0
    for (let i = 0; i < 400; i++) {
      l.fill(0); r.fill(0)
      v.process([], [[l, r]], {})
      for (const s of l) peak = Math.max(peak, Math.abs(s))
    }
    expect(peak).toBeGreaterThan(0.001)
  })
})
