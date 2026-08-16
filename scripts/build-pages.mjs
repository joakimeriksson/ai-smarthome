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
 * Landing-page copy. Written from what is observably in this repository —
 * deliberately no invented credentials, job titles or claims. Edit freely;
 * nothing else reads these fields.
 */
const PROFILE = {
  name: 'Joakim Eriksson',
  tagline: 'Audio DSP, embedded systems and machine learning.',
  intro:
    'I build things that make sound and things that sense the world — ' +
    'synthesiser engines modelled from real hardware, embedded and IoT ' +
    'experiments, and applied machine learning. Most of it lives in one ' +
    'repository and most of it started as a question I wanted answered.',
  // Areas actually present in the repo, for the closing note.
  also: [
    'Home Assistant integrations and MQTT plumbing',
    'MicroPython and embedded devices',
    'Computer vision experiments (MediaPipe, PoseNet, YOLO)',
    'Reverse-engineering Roland synth patch formats',
  ],
  github: 'https://github.com/joakimeriksson/ai-smarthome',
}

/**
 * Accent per demo, borrowed from the instrument each one is about, so the
 * cards carry the work's identity instead of an invented palette.
 */

/**
 * Each demo: where it lives, the folder it gets on the site, and how to build
 * it. `build` receives the absolute output dir and the base URL this demo will
 * be served from; omit it for plain static folders.
 *
 * Only demos listed here are published. The repo holds other web experiments
 * (c64-chat-client, js-postit, cytoscape-graph) that are deliberately left
 * out — add an entry to publish one.
 */
const DEMOS = [
  {
    slug: 'synths',
    title: 'Software Synths',
    blurb: 'Seven instruments in a studio rack: TR-808, SID, DX7-style FM, ' +
           'wavetable, physical modelling, virtual analog, and an Elka Synthex tribute.',
    src: 'audio/software-synth',
    accent: '#e8531f',            // the TR-808's orange
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
    accent: '#8f88ff',            // C64 screen blue
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

// Landing page. The demos carry strong hardware identities of their own, so
// this stays deliberately quiet — near-black, one typographic voice, and the
// only colour is a rule per card in that instrument's own accent. Monospace
// for metadata, which is the vernacular of the subject.
const esc = (t) => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

await writeFile(resolve(OUT, 'index.html'), `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${esc(PROFILE.name)} — projects</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(PROFILE.tagline)}">
<style>
  *,*::before,*::after { box-sizing:border-box }
  :root {
    --bg:#131316; --ink:#eceae5; --dim:#8e8e97; --line:#2c2c34; --lift:#1a1a1f;
    --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme:light) {
    :root { --bg:#faf9f6; --ink:#1a1a1d; --dim:#5e5e66; --line:#e0ded7; --lift:#fff }
  }
  html { -webkit-text-size-adjust:100% }
  body {
    margin:0; background:var(--bg); color:var(--ink); line-height:1.6;
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:clamp(15px,.5vw + 14px,17px);
  }
  .wrap { max-width:46rem; margin:0 auto; padding:clamp(3rem,10vw,6rem) 1.5rem 4rem }
  header { margin-bottom:clamp(2.5rem,6vw,4rem) }
  h1 { font-size:clamp(1.9rem,4vw,2.6rem); line-height:1.15; margin:0 0 .5rem;
       letter-spacing:-.02em; font-weight:650 }
  .tagline { font-family:var(--mono); font-size:.82rem; letter-spacing:.02em;
             color:var(--dim); margin:0 0 1.4rem }
  .intro { margin:0; max-width:38rem; color:var(--ink) }
  h2 { font-family:var(--mono); font-size:.72rem; font-weight:500; letter-spacing:.18em;
       text-transform:uppercase; color:var(--dim); margin:0 0 1rem;
       padding-bottom:.6rem; border-bottom:1px solid var(--line) }
  .demos { display:grid; gap:.9rem; margin:0 0 clamp(2.5rem,6vw,4rem); padding:0; list-style:none }
  .demos a {
    display:block; padding:1.15rem 1.3rem; background:var(--lift);
    border:1px solid var(--line); border-left:3px solid var(--accent);
    border-radius:5px; text-decoration:none; color:inherit;
    transition:transform .16s ease, border-color .16s ease;
  }
  .demos a:hover, .demos a:focus-visible {
    transform:translateX(3px); border-color:var(--accent); outline:none;
  }
  .demos .t { font-weight:600; margin-bottom:.25rem }
  .demos .b { color:var(--dim); font-size:.94rem }
  .also { margin:0 0 clamp(2.5rem,6vw,4rem); padding:0; list-style:none;
          display:grid; gap:.45rem; color:var(--dim); font-size:.94rem }
  .also li::before { content:'—'; color:var(--line); margin-right:.6rem }
  footer { border-top:1px solid var(--line); padding-top:1.4rem;
           font-family:var(--mono); font-size:.76rem; color:var(--dim);
           display:flex; flex-wrap:wrap; gap:.4rem 1.2rem }
  footer a { color:inherit }
  footer a:hover { color:var(--ink) }
  @media (prefers-reduced-motion:reduce) { *{transition:none!important;transform:none!important} }
</style>
<div class="wrap">
  <header>
    <h1>${esc(PROFILE.name)}</h1>
    <p class="tagline">${esc(PROFILE.tagline)}</p>
    <p class="intro">${esc(PROFILE.intro)}</p>
  </header>

  <h2>Live demos</h2>
  <ul class="demos">
${published.map(d => `    <li><a href="${d.href}" style="--accent:${d.accent ?? '#8e8e97'}">
      <div class="t">${esc(d.title)}</div>
      <div class="b">${esc(d.blurb)}</div>
    </a></li>`).join('\n')}
  </ul>

  <h2>Also in this repository</h2>
  <ul class="also">
${PROFILE.also.map(a => `    <li>${esc(a)}</li>`).join('\n')}
  </ul>

  <footer>
    <span><a href="${PROFILE.github}">Source on GitHub</a></span>
    <span>Audio needs a click to start, and HTTPS.</span>
  </footer>
</div>
</html>
`)

const total = spawnSync('du', ['-sh', OUT], { encoding: 'utf8' }).stdout?.trim()
console.log(`\n[pages] ${published.length} demos in ${OUT} (${total?.split('\t')[0] ?? '?'})`)
console.log(`[pages] base "${BASE}" — set --base if the repo name differs`)
