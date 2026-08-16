// Assemble every web demo in this repo into one static tree for GitHub Pages.
//
//   node scripts/build-pages.mjs [--base /ai-smarthome/] [--out _site]
//
// GitHub Pages serves one site per repository, but that site can contain any
// nesting — so each demo simply gets its own folder. Adding a demo is one
// entry in DEMOS below.
//
// Two things matter for these to work under a sub-path:
//   - Static demos must use relative URLs (all of this repo's do).
//   - Built apps must be told their base path; Vite bakes it into asset URLs.

import { cp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  const eq = process.argv.find(a => a.startsWith(`${name}=`))
  return eq ? eq.split('=').slice(1).join('=') : fallback
}

// Default matches a project Pages site at joakimeriksson.github.io/ai-smarthome/.
const rawBase = arg('--base', '/ai-smarthome/')
const BASE = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
const OUT = resolve(ROOT, arg('--out', '_site'))

/**
 * Each demo: where it lives, the folder it gets on the site, and how to build
 * it. `build` receives the absolute output dir and the base URL this demo will
 * be served from; omit it for plain static folders.
 */
const DEMOS = [
  {
    slug: 'synths',
    title: 'Software Synths',
    blurb: 'Seven instruments in a studio rack: TR-808, SID, DX7-style FM, ' +
           'wavetable, physical modelling, virtual analog, and an Elka Synthex tribute.',
    src: 'audio/software-synth',
    build: (out, base) => {
      run('node', ['scripts/build-demo.mjs', '--base', base], resolve(ROOT, 'audio/software-synth'))
      return resolve(ROOT, 'audio/software-synth/dist')
    },
    // Landing page inside the demo, rather than its bare index.
    entry: 'demo.html',
  },
  {
    slug: 'sid-tracker',
    title: 'SID Tracker',
    blurb: 'A GoatTracker2-compatible tracker for the C64 SID chip, with .SID export.',
    src: 'audio/sid-synth',
  },
  {
    slug: 'c64-chat',
    title: 'C64 Chat Client',
    blurb: 'A chat client in the guise of a Commodore 64.',
    src: 'c64-chat-client',
  },
  {
    slug: 'postit',
    title: 'JS Post-it',
    blurb: 'Sticky notes and a poster map, in the browser.',
    src: 'js-postit',
  },
  {
    slug: 'graph',
    title: 'Cytoscape Graph',
    blurb: 'Graph visualisation experiments.',
    src: 'cytoscape-graph',
  },
]

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const published = []
for (const demo of DEMOS) {
  const srcPath = resolve(ROOT, demo.src)
  if (!existsSync(srcPath)) {
    console.warn(`[pages] SKIP ${demo.slug}: ${demo.src} not found`)
    continue
  }
  const dest = resolve(OUT, demo.slug)
  const base = `${BASE}${demo.slug}/`

  let from = srcPath
  if (demo.build) {
    console.log(`[pages] building ${demo.slug}…`)
    from = demo.build(dest, base)
  }

  await cp(from, dest, {
    recursive: true,
    filter: (p) => !/node_modules|(^|\/)\.git(\/|$)/.test(p),
  })
  published.push({ ...demo, href: `${base}${demo.entry ?? ''}` })
  console.log(`[pages] ${demo.slug} -> ${demo.href ?? base}`)
}

// Jekyll would otherwise swallow any path starting with an underscore.
await writeFile(resolve(OUT, '.nojekyll'), '')

await writeFile(resolve(OUT, 'index.html'), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>ai-smarthome — demos</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: dark light }
  body { margin:0; min-height:100vh; background:#17171a; color:#e9e7e2;
         font-family:system-ui,-apple-system,sans-serif; line-height:1.5;
         display:grid; place-content:center; padding:3rem 1.5rem; gap:2rem }
  main { max-width:44rem }
  h1 { font-size:1.6rem; letter-spacing:.02em; margin:0 0 .3rem }
  .sub { color:#8a8a93; margin:0 0 2rem }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:.9rem }
  a { display:block; padding:1rem 1.2rem; border:1px solid #34343c; border-radius:6px;
      text-decoration:none; color:inherit; transition:border-color .15s }
  a:hover, a:focus-visible { border-color:#fff4e0; outline:none }
  .t { font-weight:600; margin-bottom:.2rem }
  .b { color:#8a8a93; font-size:.92rem }
  footer { color:#6a6a72; font-size:.85rem }
  @media (prefers-color-scheme: light) {
    body { background:#f6f5f2; color:#1b1b1e }
    a { border-color:#d5d3cd } .b,.sub { color:#5f5f66 }
  }
</style>
<main>
  <h1>ai-smarthome demos</h1>
  <p class="sub">Static builds, deployed from the repository.</p>
  <ul>
${published.map(d => `    <li><a href="${d.href}">
      <div class="t">${d.title}</div>
      <div class="b">${d.blurb}</div>
    </a></li>`).join('\n')}
  </ul>
  <footer>Audio demos need a click before sound starts, and HTTPS —
  AudioWorklet requires a secure context.</footer>
</main>
</html>
`)

const total = spawnSync('du', ['-sh', OUT], { encoding: 'utf8' }).stdout?.trim()
console.log(`\n[pages] ${published.length} demos in ${OUT} (${total?.split('\t')[0] ?? '?'})`)
console.log(`[pages] base "${BASE}" — set --base if the repo name differs`)
