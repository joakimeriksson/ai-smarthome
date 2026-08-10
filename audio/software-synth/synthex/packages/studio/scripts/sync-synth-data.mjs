// Extract each standalone synth's factory presets AND its editable parameter
// list into public/synths/<kind>.json, so the studio's instrument editor can
// offer the same sounds and the same controls.
//
// Same contract as sync-worklets: the originals in ../../../js/ are the single
// source of truth and are never modified. This runs on predev/prebuild, so a
// preset added to a standalone synth appears in the studio on the next start.
//
// The presets are plain data literals, but they are JS (unquoted keys, comments,
// trailing commas), not JSON — so we brace-match the literal out of the source
// and evaluate it. Regex slicing of JS is a trap this repo has been bitten by
// before; matching brackets while skipping strings and comments is the fix.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../../../js')
const PAGES = resolve(HERE, '../../../../')
const DEST = resolve(HERE, '../public/synths')

/**
 * Where each synth keeps its factory bank, and what shape it is in.
 * VA is the odd one: a name-keyed object of flat params, layered over a
 * defaults object, rather than an array of {name, params, fx}.
 */
const SOURCES = [
  { kind: 'va',   file: 'main.js',       decl: 'PRESETS',         shape: 'va-object',
    page: 'va-synth.html' },
  { kind: 'ws', page: 'ws-synth.html',   file: 'ws-main.js',    decl: 'FACTORY_PRESETS', shape: 'array',
    helpers: ['sliderToFreq', 'sliderToTime', 'sliderToLFORate'] },
  // Some banks are built with local helpers; those get pulled into the
  // evaluation scope so the literal can be run as written.
  { kind: 'sid', page: 'sid-synth.html',  file: 'sid-main.js',   decl: 'FACTORY_PRESETS', shape: 'array',
    helpers: ['mkTable'] },
  { kind: 'fm', page: 'fm-synth.html',   file: 'fm-main.js',    decl: 'FACTORY_PRESETS', shape: 'array',
    helpers: ['op', 'opOff', 'sliderToTime'] },
  { kind: 'pm', page: 'pm-synth.html',   file: 'pm-main.js',    decl: 'FACTORY_PRESETS', shape: 'array' },
  // The drum bank is patterns, not sounds — the 808's voices are edited live
  // and its presets are rhythms. The studio loads them into the step grid.
  { kind: 'drum', page: 'drum-machine.html', file: 'drum-main.js',  decl: 'FACTORY_PRESETS', shape: 'patterns' },
]

/**
 * Return the source text of the literal assigned to `const <name> =`, by
 * balancing brackets from the opening one. Skips string and comment bodies so
 * a brace inside `"{"` or a `// }` comment cannot end the match early.
 */
function extractLiteral(src, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*[[{]`)
  const m = decl.exec(src)
  if (!m) return null
  const start = m.index + m[0].length - 1
  const OPEN = { '[': ']', '{': '}' }
  const stack = [src[start]]
  let i = start + 1
  while (i < src.length && stack.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i)
      if (i < 0) break
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i)
      if (i < 0) break
      i += 2
      continue
    }
    if (c === '[' || c === '{') stack.push(c)
    else if (c === ']' || c === '}') {
      if (OPEN[stack[stack.length - 1]] !== c) return null   // unbalanced
      stack.pop()
    }
    i++
  }
  return stack.length ? null : src.slice(start, i)
}

/** Source text of a top-level `function name(...) {...}` declaration. */
function extractFunction(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src)
  if (!m) return null
  // Balance the parameter list first, then the body — a default value like
  // `opts = {}` would otherwise be mistaken for the opening brace.
  let i = src.indexOf('(', m.index)
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) { i++; break }
  }
  const open = src.indexOf('{', i)
  if (open < 0) return null
  depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1)
  }
  return null
}

/** Evaluate a data-only literal from our own source tree. */
function evalLiteral(text, preamble = '') {
  return new Function(`"use strict"; ${preamble} return (${text});`)()
}

/** Normalise every synth's bank to [{ name, params, fx }]. */
function normalise(raw, shape, defaults) {
  if (shape === 'va-object') {
    return Object.entries(raw).map(([name, params]) => ({
      name,
      // VA presets are sparse patches over a defaults object; the studio has
      // no defaults of its own, so bake them in here.
      params: { ...defaults, ...params },
      fx: {},
    }))
  }
  if (shape === 'patterns') {
    // Tempo and swing belong to the studio transport, so they are dropped —
    // but the kit (per-channel voice tunings) is part of the sound and comes
    // along, sparse per-channel overrides as-is.
    return raw
      .filter(p => Array.isArray(p.pattern))
      .map(p => ({
        name: p.name,
        pattern: p.pattern,
        ...(Array.isArray(p.kit) ? { kit: p.kit } : {}),
      }))
  }
  return raw.map(p => ({
    name: p.name,
    params: p.params ?? {},
    fx: p.fx ?? {},
    // SID presets may carry GT2 tables (PWM sweeps, arps, filter runs). The
    // tables ARE the sound for those presets — dropping them here left the
    // studio playing a static tone where the page played a sweep.
    ...(p.tables ? { tables: p.tables } : {}),
  }))
}

/**
 * Map DOM element id → engine parameter name, from the page's own binder
 * calls. The standalone UI is the authority on what is editable and what it
 * is called, so the studio does not maintain a second list that could drift.
 */
function bindingMap(src) {
  const map = new Map()
  const call = /bind(?:Slider|Select|Checkbox)\(\s*'([^']+)'\s*,\s*'([^']+)'\s*(,)?/g
  for (const m of src.matchAll(call)) {
    // A third argument is an options object holding the value transform.
    let opts = null
    if (m[3]) {
      const from = src.indexOf('{', m.index + m[0].length - 1)
      const before = src.slice(m.index + m[0].length, from < 0 ? undefined : from)
      // Only an object literal counts; `bindSlider(a, b, someVar)` does not occur.
      if (from >= 0 && !/[)\n]/.test(before)) opts = extractLiteralAt(src, from)
    }
    map.set(m[1], { param: m[2], opts })
  }
  return map
}

/** Same balanced scan as extractLiteral, starting from a known bracket index. */
function extractLiteralAt(src, start) {
  const OPEN = { '[': ']', '{': '}' }
  const stack = [src[start]]
  let i = start + 1
  while (i < src.length && stack.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; i += 2; continue }
    if (c === '[' || c === '{') stack.push(c)
    else if (c === ']' || c === '}') {
      if (OPEN[stack[stack.length - 1]] !== c) return null
      stack.pop()
    }
    i++
  }
  return stack.length ? null : src.slice(start, i)
}

/**
 * A slider's position is not always the value the engine receives — most go
 * through a mapping (`filterCutoff` is `20 * 1000**v`, i.e. 0.85 means 7 kHz,
 * not 0.85 Hz). Sending raw positions would silently mistune every synth.
 *
 * Rather than re-implementing 66 transforms, or shipping their source to be
 * eval'd at runtime, evaluate each one here at every position the slider can
 * actually reach. The step attribute makes that set finite, so the table is
 * exact — including the `Math.round(...)` transforms an interpolated curve
 * would get wrong.
 */
const MAX_POSITIONS = 4096

function valueTable(optsSrc, preamble, min, max, step) {
  if (!optsSrc) return null
  let fn
  try {
    const opts = evalLiteral(optsSrc, preamble)
    fn = opts.transform ?? opts.map
    if (typeof fn !== 'function') return { suffix: opts.suffix, decimals: opts.decimals }
  } catch {
    return null
  }
  const count = Math.floor((max - min) / (step || 1)) + 1
  if (!Number.isFinite(count) || count < 1 || count > MAX_POSITIONS) return null
  const values = []
  for (let i = 0; i < count; i++) {
    const v = fn(min + i * step)
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    // Trim float noise so the JSON stays small.
    values.push(Number(v.toPrecision(10)))
  }
  let opts = {}
  try { opts = evalLiteral(optsSrc, preamble) } catch { /* already validated */ }
  return { values, suffix: opts.suffix, decimals: opts.decimals }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const stripTags = (html) => html
  .replace(/<[^>]*>/g, '')
  .replace(/&(\w+|#\d+);/g, (m, e) => ENTITIES[e] ?? m)
  .replace(/\s+/g, ' ')
  .trim()

/**
 * Read the page's controls in document order, tagging each with the panel it
 * sits in. The markup is regular (`.panel > .panel-title`, then
 * `.control-row > label + input|select`), so a positional scan is enough — and
 * unlike a regex over whole blocks it cannot swallow a neighbouring section.
 */
function extractParams(html, bindings, preamble) {
  // Panel title offsets, so each control can be attributed to the nearest one.
  const panels = []
  for (const m of html.matchAll(/class="panel-title"[^>]*>([\s\S]*?)<\/div>/g)) {
    panels.push({ at: m.index, title: stripTags(m[1]) })
  }

  // Sub-headings within a panel. Without these, VA's three ADSR blocks arrive
  // as nine controls all called A/D/S/R with nothing to say which envelope is
  // which. The pages spell them two ways: a `.section-label` class (ws, sid)
  // and a bold inline-styled div (va).
  const subs = []
  const SUB = [
    /class="section-label"[^>]*>([^<]{1,40})<\/div>/g,
    /<div style="[^"]*font-weight:\s*700[^"]*"[^>]*>([^<]{1,40})<\/div>/g,
  ]
  for (const re of SUB) {
    for (const m of html.matchAll(re)) subs.push({ at: m.index, title: stripTags(m[1]) })
  }
  subs.sort((a, b) => a.at - b.at)

  const nearestBefore = (list, idx) => {
    let hit = null
    for (const e of list) { if (e.at < idx) hit = e; else break }
    return hit
  }
  const groupAt = (idx) => {
    const panel = nearestBefore(panels, idx)
    const sub = nearestBefore(subs, idx)
    // A sub-heading only applies inside the panel it appears in.
    if (sub && panel && sub.at > panel.at) return `${panel.title} · ${sub.title}`
    return panel?.title ?? ''
  }

  const out = []
  const seen = new Set()
  const row = /<div class="(?:control-row|checkbox-row)"[^>]*>([\s\S]*?)<\/div>/g

  for (const m of html.matchAll(row)) {
    const body = m[1]
    const label = stripTags((/<label[^>]*>([\s\S]*?)<\/label>/.exec(body) ?? [])[1] ?? '')

    const range = /<input[^>]*type="range"[^>]*>/.exec(body)
    const select = /<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/.exec(body)
    const check = /<input[^>]*type="checkbox"[^>]*id="([^"]+)"[^>]*>/.exec(body)

    const attr = (tag, name) => (new RegExp(`${name}="([^"]*)"`).exec(tag) ?? [])[1]

    if (range) {
      const id = attr(range[0], 'id')
      const bound = bindings.get(id)
      if (!bound || seen.has(bound.param)) continue
      seen.add(bound.param)
      const min = Number(attr(range[0], 'min') ?? 0)
      const max = Number(attr(range[0], 'max') ?? 1)
      const step = Number(attr(range[0], 'step') ?? 0.01)
      const table = valueTable(bound.opts, preamble, min, max, step)
      out.push({
        param: bound.param, label: label || id, group: groupAt(m.index), type: 'range',
        min, max, step,
        default: Number(attr(range[0], 'value') ?? 0),
        ...(table?.values ? { values: table.values } : {}),
        ...(table?.suffix ? { suffix: table.suffix } : {}),
        ...(table?.decimals !== undefined ? { decimals: table.decimals } : {}),
      })
    } else if (select) {
      const bound = bindings.get(select[1])
      const param = bound?.param
      if (!param || seen.has(param)) continue
      seen.add(param)
      const options = [...select[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
        .map(o => ({ value: o[1], label: stripTags(o[2]) }))
      if (!options.length) continue
      out.push({ param, label: label || select[1], group: groupAt(m.index), type: 'select', options })
    } else if (check) {
      const bound = bindings.get(check[1])
      const param = bound?.param
      if (!param || seen.has(param)) continue
      seen.add(param)
      out.push({
        param, label: label || stripTags(body) || check[1],
        group: groupAt(m.index), type: 'toggle',
      })
    }
  }
  return out
}

/**
 * The drum machine addresses its voices per channel (`ch.<n>.<field>`) from a
 * template the page builds at runtime, so there is nothing static for the
 * binder scan to find. Its controls are declared here instead, marked
 * `perChannel` so the editor renders a channel picker above them. Ranges match
 * the template in js/drum-main.js.
 */
const DRUM_PARAMS = [
  { param: 'type',  label: 'Type',  group: 'Voice', type: 'select', perChannel: true,
    options: ['Kick', 'Snare', 'Closed HH', 'Open HH', 'Clap', 'Tom', 'Rim', 'Cowbell',
      'Cymbal', 'Maraca', 'Conga', 'Claves']
      .map((label, i) => ({ value: String(i), label })) },
  { param: 'tone',  label: 'Tone',  group: 'Voice', type: 'range', perChannel: true,
    min: 20, max: 800, step: 1, default: 200 },
  { param: 'decay', label: 'Decay', group: 'Voice', type: 'range', perChannel: true,
    min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { param: 'color', label: 'Color', group: 'Voice', type: 'range', perChannel: true,
    min: 0, max: 1, step: 0.01, default: 0.5 },
  // Snare only: TONE crossfade between its two oscillators. Ignored by the
  // other voice types.
  { param: 'blend', label: 'Blend', group: 'Voice', type: 'range', perChannel: true,
    min: 0, max: 1, step: 0.01, default: 0.5 },
  { param: 'level', label: 'Level', group: 'Voice', type: 'range', perChannel: true,
    min: 0, max: 1, step: 0.01, default: 0.8 },
  { param: 'pan',   label: 'Pan',   group: 'Voice', type: 'range', perChannel: true,
    min: -1, max: 1, step: 0.01, default: 0 },
]

async function main() {
  await mkdir(DEST, { recursive: true })
  const index = []

  for (const { kind, file, page, decl, shape, helpers = [] } of SOURCES) {
    let src
    try {
      src = await readFile(resolve(SRC, file), 'utf8')
    } catch (err) {
      console.warn(`[sync-synth-data] ${kind}: cannot read ${file} (${err.message}) — skipped`)
      continue
    }

    const literal = extractLiteral(src, decl)
    if (!literal) {
      console.warn(`[sync-synth-data] ${kind}: no balanced "${decl}" literal in ${file} — skipped`)
      continue
    }

    let bank
    let helperSrc = ''
    try {
      helperSrc = helpers
        .map(h => extractFunction(src, h))
        .filter(Boolean)
        .join('\n')
      const raw = evalLiteral(literal, helperSrc)
      const defaults = shape === 'va-object'
        ? evalLiteral(extractLiteral(src, 'PRESET_DEFAULTS') ?? '{}')
        : {}
      bank = normalise(raw, shape, defaults)
    } catch (err) {
      console.warn(`[sync-synth-data] ${kind}: ${decl} did not evaluate (${err.message}) — skipped`)
      continue
    }

    let params = []
    if (kind === 'drum') params = DRUM_PARAMS
    else try {
      const html = await readFile(resolve(PAGES, page), 'utf8')
      params = extractParams(html, bindingMap(src), helperSrc)
    } catch (err) {
      console.warn(`[sync-synth-data] ${kind}: no controls from ${page} (${err.message})`)
    }

    await writeFile(
      resolve(DEST, `${kind}.json`),
      JSON.stringify({ kind, presets: bank, params }, null, 1),
    )
    index.push(`${kind}:${bank.length}p/${params.length}c`)
  }

  console.log(`[sync-synth-data] wrote ${index.length} synths → public/synths/ (${index.join(', ')})`)
}

await main()
