// Assemble everything into one static folder that any host can serve.
//
//   node scripts/build-demo.mjs [--base /some/path/]
//
// Layout (the studio's cross-links assume exactly this shape):
//   dist/                 index.html + the six synth pages, css/, js/
//   dist/synthex/         the Synthex app
//   dist/studio/          the studio
//
// Everything is static — no server code — but it MUST be served over HTTPS or
// from localhost: AudioWorklet requires a secure context, so a plain http://
// host will render the pages and produce no sound at all.

import { cp, mkdir, rm, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SYNTHEX = resolve(ROOT, 'synthex')
const OUT = resolve(ROOT, 'dist')

const baseArg = process.argv.find(a => a.startsWith('--base'))
const BASE = baseArg ? (baseArg.split('=')[1] ?? process.argv[process.argv.indexOf(baseArg) + 1]) : '/'
const base = BASE.endsWith('/') ? BASE : `${BASE}/`

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

// ── 1. The six standalone pages: already static, copy as-is ────────────────
const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html'))
for (const f of pages) await cp(resolve(ROOT, f), resolve(OUT, f))
for (const dir of ['css', 'js']) await cp(resolve(ROOT, dir), resolve(OUT, dir), { recursive: true })
console.log(`[demo] ${pages.length} pages + css/ + js/`)

// ── 2. Synthex app ─────────────────────────────────────────────────────────
run('npm', ['run', 'build', '--workspace', '@synthex/app'], SYNTHEX,
  { VITE_BASE: `${base}synthex/` })
await cp(resolve(SYNTHEX, 'packages/app/dist'), resolve(OUT, 'synthex'), { recursive: true })
console.log('[demo] synthex app')

// ── 3. Studio ──────────────────────────────────────────────────────────────
run('npm', ['run', 'build', '--workspace', '@synthex/studio'], SYNTHEX, {
  VITE_BASE: `${base}studio/`,
  // Sibling links, resolved from the studio's own directory.
  VITE_SYNTHEX_URL: `${base}synthex/`,
  VITE_PAGES_URL: base,
})
await cp(resolve(SYNTHEX, 'packages/studio/dist'), resolve(OUT, 'studio'), { recursive: true })
console.log('[demo] studio')

// ── 4. Sanity checks — the failures worth catching are all silent ──────────
const problems = []
const worklets = [
  'synthex/synthex-voice-processor.js',
  'studio/worklets/synthex-voice-processor.js',
  'studio/worklets/sid-processor.js',
  'studio/synths/sid.json',
  'js/dsp-lib.js',
]
for (const w of worklets) {
  if (!existsSync(resolve(OUT, w))) problems.push(`missing ${w}`)
}
if (problems.length) {
  console.error('[demo] PROBLEMS:\n  ' + problems.join('\n  '))
  process.exitCode = 1
} else {
  console.log('[demo] all worklets and data present')
}

// A landing page is nicer than a directory listing.
await writeFile(resolve(OUT, 'demo.html'), `<!doctype html>
<meta charset="utf-8"><title>Software Synths — demo</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { background:#17171a; color:#e9e7e2; font-family:system-ui,sans-serif;
         display:grid; place-content:center; min-height:100vh; margin:0; gap:1rem }
  a { color:#fff4e0; font-size:1.2rem; text-decoration:none;
      border:1px solid #3a3a42; padding:.7rem 1.2rem; border-radius:4px; display:block }
  a:hover { border-color:#fff4e0 }
  p { color:#8a8a93; max-width:32rem; line-height:1.5 }
</style>
<h1>Software Synths</h1>
<a href="${base}studio/">Studio — all instruments in one rack</a>
<a href="${base}synthex/">Synthex — Elka Synthex tribute</a>
<a href="${base}index.html">The six standalone synths</a>
<p>Audio needs a click to start (browser autoplay policy) and an HTTPS
connection (AudioWorklet requires a secure context).</p>
`)

console.log(`\n[demo] ready: ${OUT}  (base "${base}")`)
console.log('[demo] serve over HTTPS — AudioWorklet needs a secure context')
