<script lang="ts">
  // The focused track's pattern as sheet music. Read-only: lib/notation.ts
  // decides what is written (values, ties, accidentals, beams) and this
  // places it. Time runs evenly across each bar - a 16th is always the same
  // width - so the playhead moves at a steady pace and a note sits where it
  // would in the piano roll.
  //
  // Clefs, rests, noteheads and accidentals are glyphs from Noto Music
  // (loaded in index.html), which draws them for a staff whose bottom line
  // is the text baseline at a font size of four staff spaces. Stems, beams,
  // flags, ties and ledger lines are drawn here.
  import type { Track } from '../lib/track.svelte.ts'
  import { engrave, SIGNATURE_LINES, type ScoreEvent } from '../lib/notation.ts'

  interface Props { track: Track; fifths: number; playhead: number; playing: boolean }
  let { track, fifths, playhead, playing }: Props = $props()

  const S = 9, H = S / 2            // a staff space, and the half space between note positions
  const HEAD = 0.6 * S              // half a notehead's width
  const STEM = 3.5 * S
  const G = {
    treble: '\u{1D11E}', bass: '\u{1D122}', rest4: '\u{1D13D}', rest2: '\u{1D13E}', rest1: '\u{1D13F}',
    black: '\u{1D158}', open: '\u{1D157}', whole: '\u{1D15D}',
  }
  const ACCIDENTAL: Record<number, string> = { 0: '♮', 1: '♯', [-1]: '♭', 2: '\u{1D12A}', [-2]: '\u{1D12B}' }

  let width = $state(1000)

  type Line = [x1: number, y1: number, x2: number, y2: number, w: number]
  type Glyph = [x: number, y: number, ch: string]
  interface Drawn {
    /** Pattern steps it sounds over, for the highlight. */
    from: number
    to: number
    rest: boolean
    lines: Line[]
    glyphs: Glyph[]
    dots: [number, number][]
    shapes: string[]
  }

  const L = $derived.by(() => {
    const { clef, bars } = engrave(track.steps, fifths)
    const perSystem = width >= 880 ? 4 : width >= 460 ? 2 : 1
    const all = bars.flatMap(b => b.events.flatMap(e => e.notes.map(n => n.line)))
    const hi = Math.max(8, ...all), lo = Math.min(0, ...all)
    const top = (hi - 8) * H + 4.6 * S                 // system top to the staff's top line
    const systemH = top + 4 * S - lo * H + 4.6 * S
    const sig = Math.abs(fifths)
    const headW = 4.1 * S + sig * S + 2.7 * S          // clef, key signature, time signature
    const barW = (width - headW - 2) / perSystem
    const padL = 2.3 * S
    const stepW = (barW - padL - 0.5 * S) / 16
    const systemOf = (b: number) => Math.floor(b / perSystem)
    const barX = (b: number) => headW + (b % perSystem) * barW
    const xOf = (b: number, step: number) => barX(b) + padL + step * stepW
    const yOf = (b: number, line: number) => systemOf(b) * systemH + top + (8 - line) * H

    const staff: Line[] = [], fixed: Glyph[] = [], shapes: string[] = [], ties: string[] = []
    const texts: { x: number; y: number; t: string; cls: string }[] = []
    const events: Drawn[] = []
    const systems = Math.ceil(bars.length / perSystem)

    for (let s = 0; s < systems; s++) {
      const b = s * perSystem, last = Math.min(bars.length, b + perSystem) - 1
      const right = barX(last) + barW
      for (let l = 0; l <= 8; l += 2) staff.push([0, yOf(b, l), right, yOf(b, l), 1])
      staff.push([0, yOf(b, 8), 0, yOf(b, 0), 1])
      fixed.push([0.5 * S, yOf(b, 0), G[clef.sign]])
      if (clef.octave) texts.push({ x: clef.sign === 'treble' ? 1.75 * S : 1.6 * S,
        y: clef.octave > 0 ? yOf(b, 8) - 2.5 * S : yOf(b, 0) + 2.1 * S, t: '8', cls: 'ottava' })
      const sigLines = fifths > 0 ? SIGNATURE_LINES.sharps : SIGNATURE_LINES.flats
      for (let i = 0; i < sig; i++) {
        fixed.push([3.6 * S + i * S, yOf(b, sigLines[i]! - (clef.sign === 'bass' ? 2 : 0)) + H, ACCIDENTAL[Math.sign(fifths)]!])
      }
      if (s === 0) for (const l of [4, 0]) texts.push({ x: 4.1 * S + sig * S + 0.9 * S, y: yOf(b, l) - 0.12 * S, t: '4', cls: 'time' })
      texts.push({ x: headW + 2, y: yOf(b, 8) - 1.2 * S - (hi - 8) * H, t: String(b + 1), cls: 'barno' })
    }

    bars.forEach((bar, b) => {
      const y = (line: number) => yOf(b, line)
      const final = b === bars.length - 1
      const bx = barX(b) + barW
      staff.push([bx, y(8), bx, y(0), final ? 3 : 1])
      if (final) staff.push([bx - 4, y(8), bx - 4, y(0), 1])
      if (bar.empty) {
        // A whole-bar rest hangs from the fourth line, in the middle of the bar.
        shapes.push(rect(barX(b) + barW / 2 - 0.65 * S, y(6), 1.3 * S, 0.5 * S))
        return
      }

      // Stem direction: away from the staff's middle, by the note furthest
      // from it - taken over the whole beam for beamed notes.
      const groups = new Map<number, ScoreEvent[]>()
      for (const e of bar.events) if (e.beam >= 0) groups.set(e.beam, [...(groups.get(e.beam) ?? []), e])
      const stemUp = (evs: ScoreEvent[]) => {
        const lines = evs.flatMap(e => e.notes.map(n => n.line))
        return 4 - Math.min(...lines) > Math.max(...lines) - 4
      }
      const stemX = (e: ScoreEvent, up: boolean) => xOf(b, e.start) + (up ? HEAD - 0.6 : -HEAD + 0.6)
      /** Where a stem of the standard length would end. */
      const tipOf = (e: ScoreEvent, up: boolean) =>
        up ? y(e.notes[e.notes.length - 1]!.line) - STEM : y(e.notes[0]!.line) + STEM

      const tips = new Map<ScoreEvent, number>(), ups = new Map<ScoreEvent, boolean>()
      for (const evs of groups.values()) {
        const up = stemUp(evs), d = up ? 1 : -1
        const first = evs[0]!, last = evs[evs.length - 1]!
        const x0 = stemX(first, up), x1 = stemX(last, up)
        // The beam leans the way the notes go, by a staff space at most, and
        // sits where no stem comes out shorter than standard.
        const lean = Math.max(-S, Math.min(S, tipOf(last, up) - tipOf(first, up))) / (x1 - x0)
        const gaps = evs.map(e => tipOf(e, up) - (tipOf(first, up) + lean * (stemX(e, up) - x0)))
        const base = tipOf(first, up) + (up ? Math.min(...gaps) : Math.max(...gaps))
        const at = (x: number) => base + lean * (x - x0)
        const beam = (xa: number, xb: number, off: number) =>
          `M${xa} ${at(xa) + off} L${xb} ${at(xb) + off} L${xb} ${at(xb) + off + d * 0.5 * S} L${xa} ${at(xa) + off + d * 0.5 * S}Z`
        shapes.push(beam(x0 - 0.6, x1 + 0.6, 0))
        evs.forEach((e, i) => {
          tips.set(e, at(stemX(e, up))); ups.set(e, up)
          if (e.dur !== 1) return
          const x = stemX(e, up), next = evs[i + 1], prev = evs[i - 1]
          if (next?.dur === 1) shapes.push(beam(x - 0.6, stemX(next, up) + 0.6, d * 0.75 * S))
          else if (prev?.dur !== 1) shapes.push(beam(prev ? x - 0.95 * S : x - 0.6, prev ? x + 0.6 : x + 0.95 * S, d * 0.75 * S))
        })
      }

      bar.events.forEach((e, i) => {
        const cx = xOf(b, e.start)
        const out: Drawn = { from: b * 16 + e.start, to: b * 16 + e.start + e.dur, rest: !e.notes.length,
          lines: [], glyphs: [], dots: [], shapes: [] }
        events.push(out)
        if (out.rest) {
          // A half rest sits on the middle line; the shorter ones are glyphs.
          if (e.dur === 8) out.shapes.push(rect(cx - 0.2 * S, y(4) - 0.5 * S, 1.3 * S, 0.5 * S))
          else out.glyphs.push([cx + 0.2 * S, y(0), e.dur === 4 ? G.rest4 : e.dur === 2 ? G.rest2 : G.rest1])
          return
        }
        const up = ups.get(e) ?? stemUp([e]), d = up ? 1 : -1
        ups.set(e, up)
        const ns = e.notes, low = ns[0]!, high = ns[ns.length - 1]!

        // Two notes a step apart cannot share a column: the upper one moves
        // to the right of an up stem, the lower to the left of a down stem.
        const aside = ns.map(() => false)
        if (up) { for (let k = 1; k < ns.length; k++) aside[k] = ns[k]!.line - ns[k - 1]!.line === 1 && !aside[k - 1] }
        else { for (let k = ns.length - 2; k >= 0; k--) aside[k] = ns[k + 1]!.line - ns[k]!.line === 1 && !aside[k + 1] }
        const anyAside = aside.includes(true)
        const leftEdge = cx - HEAD - (anyAside && !up ? 2 * HEAD : 0)
        const rightEdge = cx + HEAD + (anyAside && up ? 2 * HEAD : 0)
        const head = e.dur === 16 ? G.whole : e.dur >= 8 ? G.open : G.black
        ns.forEach((n, k) => out.glyphs.push([cx + (aside[k] ? d * (2 * HEAD - 1.2) : 0), y(n.line) + H, head]))

        for (let l = 10; l <= high.line; l += 2) out.lines.push([leftEdge - 0.35 * S, y(l), rightEdge + 0.35 * S, y(l), 1])
        for (let l = -2; l >= low.line; l -= 2) out.lines.push([leftEdge - 0.35 * S, y(l), rightEdge + 0.35 * S, y(l), 1])

        // Accidentals from the top down, stepping left where two would touch.
        const columns: number[] = []
        for (let k = ns.length - 1; k >= 0; k--) {
          const n = ns[k]!
          if (!n.show) continue
          let c = columns.findIndex(l => l - n.line >= 6)
          if (c < 0) c = columns.length
          columns[c] = n.line
          out.glyphs.push([leftEdge - 0.7 * S - c * 0.95 * S, y(n.line) + H, ACCIDENTAL[n.acc] ?? ''])
        }

        if (e.dur === 3 || e.dur === 12) {
          // A dot beside a note on a line moves up into the space.
          for (const n of ns) out.dots.push([rightEdge + 0.55 * S, y(n.line) - (n.line % 2 === 0 ? H : 0)])
        }

        if (e.dur < 16) {
          const sx = stemX(e, up)
          // Unbeamed, a stem far from the staff still reaches the middle line.
          const tip = tips.get(e) ?? (up ? Math.min(tipOf(e, up), y(4)) : Math.max(tipOf(e, up), y(4)))
          out.lines.push([sx, y(up ? low.line : high.line) - d * 0.15 * S, sx, tip, 1.2])
          if (e.beam < 0 && e.dur < 4) {
            for (let k = 0; k < (e.dur === 1 ? 2 : 1); k++) out.shapes.push(flag(sx - 0.6, tip + d * k * 0.85 * S, d))
          }
        }

        if (e.tieOut) {
          const next = bar.events[i + 1] ?? bars[b + 1]?.events[0]
          const nb = bar.events[i + 1] ? b : b + 1
          if (next) for (const n of ns) {
            const ty = y(n.line) + d * 0.6 * S
            const x1 = rightEdge + (e.dur === 3 || e.dur === 12 ? 1.1 * S : 2)
            const x2 = xOf(nb, next.start) - HEAD - 2
            if (systemOf(nb) === systemOf(b)) ties.push(arc(x1, x2, ty, d))
            else {
              ties.push(arc(x1, barX(b) + barW - 1, ty, d))
              ties.push(arc(headW + 0.4 * S, x2, yOf(nb, n.line) + d * 0.6 * S, d))
            }
          }
        }
      })
    })

    const cursorAt = (step: number) => {
      const b = Math.floor(step / 16)
      return b < bars.length
        ? { x: xOf(b, step % 16) - HEAD - 2, y1: yOf(b, 8) - 1.5 * S, y2: yOf(b, 0) + 1.5 * S } : null
    }
    return { height: systems * systemH, staff, fixed, texts, events, shapes, ties, cursorAt }
  })
  // Kept out of the layout, which must not be redone on every step played.
  const cursor = $derived(playing ? L.cursorAt(playhead) : null)

  function rect(x: number, y: number, w: number, h: number) { return `M${x} ${y}h${w}v${h}h${-w}Z` }

  /** A tie: a shallow arc that bulges away from the stem. */
  function arc(x1: number, x2: number, y: number, d: number) {
    const depth = d * Math.min(0.8 * S, 1.5 + (x2 - x1) * 0.1)
    return `M${x1} ${y}Q${(x1 + x2) / 2} ${y + depth * 2} ${x2} ${y}`
  }

  /** A flag hanging from a stem's tip (d = 1 for an up stem, -1 for a down one). */
  function flag(x: number, y: number, d: number) {
    const u = (n: number) => n * S, v = (n: number) => n * S * d
    return `M${x} ${y}c${u(0.15)} ${v(1.3)} ${u(1.3)} ${v(1.5)} ${u(0.85)} ${v(3)}`
      + `c${u(0.3)} ${v(-1.2)} ${u(-0.4)} ${v(-1.6)} ${u(-0.85)} ${v(-1.9)}Z`
  }
</script>

<div class="score" bind:clientWidth={width}>
  <svg {width} height={L.height} role="img" aria-label="Sheet music for {track.name}">
    <g class="staff">
      {#each L.staff as [x1, y1, x2, y2, w], i (i)}<line {x1} {y1} {x2} {y2} stroke-width={w} />{/each}
    </g>
    {#each L.fixed as [x, y, ch], i (i)}<text class="glyph" {x} {y}>{ch}</text>{/each}
    {#each L.texts as t, i (i)}<text class={t.cls} x={t.x} y={t.y}>{t.t}</text>{/each}
    {#each L.shapes as d, i (i)}<path class="ink" {d} />{/each}
    {#each L.ties as d, i (i)}<path class="tie" {d} />{/each}
    {#each L.events as e, i (i)}
      <g class="event" class:rest={e.rest} class:on={playing && !e.rest && playhead >= e.from && playhead < e.to}>
        {#each e.lines as [x1, y1, x2, y2, w], k (k)}<line {x1} {y1} {x2} {y2} stroke-width={w} />{/each}
        {#each e.glyphs as [x, y, ch], k (k)}<text class="glyph mid" {x} {y}>{ch}</text>{/each}
        {#each e.dots as [cx, cy], k (k)}<circle {cx} {cy} r={0.17 * S} />{/each}
        {#each e.shapes as d, k (k)}<path {d} />{/each}
      </g>
    {/each}
    {#if cursor}<line class="cursor" x1={cursor.x} x2={cursor.x} y1={cursor.y1} y2={cursor.y2} />{/if}
  </svg>
  <p class="hint">Read as one voice in 4/4: a note is written until the next one starts, and short gated notes
    are written out to the beat. Edit in the piano roll or the step view.</p>
</div>

<style>
  .score { min-width: 0; }
  svg {
    display: block; background: #101014; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px;
    --ink: #e9e6dc;
  }
  .staff line { stroke: rgba(233, 230, 220, 0.45); }
  /* 36px = four staff spaces: the size Noto Music's glyphs are drawn for. */
  .glyph { font-family: 'Noto Music', 'Bravura Text', 'Apple Symbols', 'Segoe UI Symbol', serif; font-size: 36px; fill: var(--ink); }
  .glyph.mid { text-anchor: middle; }
  .ink { fill: var(--ink); }
  .tie { fill: none; stroke: var(--ink); stroke-width: 1.3; stroke-linecap: round; }
  .event line { stroke: var(--ink); }
  .event path, .event circle { fill: var(--ink); }
  .event.rest .glyph, .event.rest path { fill: rgba(233, 230, 220, 0.7); }
  /* What is sounding now lights up in the track's colour. */
  .event.on .glyph, .event.on path, .event.on circle { fill: var(--accent); }
  .event.on line { stroke: var(--accent); }
  .time { font-family: 'Saira Condensed', sans-serif; font-weight: 700; font-size: 24px; fill: var(--ink); text-anchor: middle; }
  .ottava { font-family: 'Saira Condensed', sans-serif; font-style: italic; font-weight: 600; font-size: 11px; fill: var(--ink); text-anchor: middle; }
  .barno { font-family: 'Share Tech Mono', monospace; font-size: 9px; fill: var(--dim); }
  .cursor { stroke: var(--accent); stroke-width: 1.5; opacity: 0.8; }
  .hint { margin: 0.5rem 0 0; font-size: 0.66rem; color: var(--dim); }
</style>
