<script lang="ts">
  // Piano roll for a melodic track: pitch up the side, 16ths along the top,
  // every note a bar as long as it holds. Click an empty cell to place a
  // note (drag right to draw its length), drag a note to move it, drag its
  // right edge to resize, click it to remove it. A step that already sounds
  // takes further notes as a chord - see lib/roll.ts for the one rule the
  // pattern data imposes (notes starting together share length and velocity).
  // The lane underneath sets each step's velocity.
  import { untrack } from 'svelte'
  import type { Track, NoteStep } from '../lib/track.svelte.ts'
  import {
    PITCH_MAX, PITCH_MIN, addNote, moveNote, removeNote, rollNotes, setLength, setVelocity, pitchesOf,
  } from '../lib/roll.ts'

  interface Props {
    track: Track
    playhead: number
    playing: boolean
    onchange: () => void
    /** Audition: the note under the pointer, on and off. */
    onnote?: ((note: number, down: boolean) => void) | undefined
  }
  let { track, playhead, playing, onchange, onnote }: Props = $props()

  const ROW = 12, KEYS = 46, RULER = 16, VEL = 46
  const VISIBLE_ROWS = 25               // two octaves and a note
  const VISIBLE_STEPS = 64              // four bars across before it scrolls
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12)
  const nameOf = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`
  const pitches = Array.from({ length: PITCH_MAX - PITCH_MIN + 1 }, (_, i) => PITCH_MAX - i)

  let width = $state(1000)
  let scroller = $state<HTMLDivElement>()
  let grid = $state<HTMLDivElement>()
  let lane = $state<HTMLDivElement>()

  const len = $derived(track.steps.length)
  const col = $derived(Math.max(14, (width - KEYS - 2) / Math.min(len, VISIBLE_STEPS)))
  const notes = $derived(rollNotes(track.steps, track.gate))
  const onsets = $derived(track.steps.flatMap((s, i) => (s.note === null ? [] : [{ step: i, velocity: s.velocity }])))
  const top = (pitch: number) => (PITCH_MAX - pitch) * ROW

  // A new track in view: bring its notes to the middle of the window.
  $effect(() => {
    void track.id
    untrack(() => {
      if (!scroller) return
      const all = track.steps.flatMap(pitchesOf)
      const mid = all.length ? (Math.min(...all) + Math.max(...all)) / 2 : 60
      scroller.scrollTop = top(mid) - (VISIBLE_ROWS * ROW) / 2
      scroller.scrollLeft = 0
    })
  })

  // Turn the page when the playhead leaves it (but not under a drag).
  $effect(() => {
    if (!playing || !scroller || drag) return
    const x = playhead * col, view = scroller.clientWidth - KEYS
    if (x < scroller.scrollLeft || x >= scroller.scrollLeft + view) scroller.scrollLeft = x
  })

  // ── Editing ─────────────────────────────────────────────────────────────

  interface Drag {
    mode: 'move' | 'size'
    /** Where the note was when the drag began, and the pattern then. */
    step: number
    pitch: number
    origin: NoteStep[]
    /** Pointer position inside the note, in steps, and on the page. */
    grab: number
    x0: number
    y0: number
    /** Placed by this press, so a plain click must not remove it again. */
    fresh: boolean
    moved: boolean
    target: string
  }
  // Raw: the snapshot inside must stay a plain array (structuredClone refuses a proxy).
  let drag = $state.raw<Drag | null>(null)
  /** New notes take the last length drawn; until one is, the track's gate. */
  let lastLength: number | undefined
  let sounding: number | null = null

  function sound(pitch: number | null) {
    if (sounding === pitch) return
    if (sounding !== null) onnote?.(sounding, false)
    if (pitch !== null) onnote?.(pitch, true)
    sounding = pitch
  }

  function cellAt(e: PointerEvent) {
    const r = grid!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / col
    return {
      fx,
      step: Math.max(0, Math.min(len - 1, Math.floor(fx))),
      pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, PITCH_MAX - Math.floor((e.clientY - r.top) / ROW))),
    }
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !grid) return
    const { fx, step, pitch } = cellAt(e)
    const hit = notes.find(n => n.pitch === pitch && n.step === step)
      ?? [...notes].reverse().find(n => n.pitch === pitch && fx >= n.step && fx < n.step + n.len)
    grid.setPointerCapture(e.pointerId)
    const base = { x0: e.clientX, y0: e.clientY, moved: false, target: '' }
    if (hit) {
      const nearEnd = (hit.step + hit.len - fx) * col < 7 && hit.len * col >= 14
      drag = { ...base, mode: nearEnd ? 'size' : 'move', step: hit.step, pitch: hit.pitch,
        grab: fx - hit.step, fresh: false, origin: $state.snapshot(track.steps) }
    } else {
      if (addNote(track.steps, step, pitch, lastLength === undefined ? {} : { length: lastLength })) onchange()
      drag = { ...base, mode: 'size', step, pitch, grab: 0, fresh: true, origin: $state.snapshot(track.steps) }
    }
    sound(pitch)
  }

  function move(e: PointerEvent) {
    if (!drag) return
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return
    const { fx, pitch } = cellAt(e)
    const toStep = Math.max(0, Math.min(len - 1, Math.round(fx - drag.grab)))
    const length = Math.max(1, Math.ceil(fx - drag.step))
    const target = drag.mode === 'size' ? `${length}` : `${toStep}:${pitch}`
    if (target === drag.target) return
    drag.target = target
    drag.moved = true
    // Always from the pattern as the drag found it: a note dragged across a
    // chord must not come out the other side with the chord's length.
    track.steps = structuredClone(drag.origin)
    if (drag.mode === 'size') {
      setLength(track.steps, drag.step, length)
      lastLength = length
    } else {
      moveNote(track.steps, drag.step, drag.pitch, toStep, pitch)
      sound(pitch)
    }
    onchange()
  }

  function up() {
    if (!drag) return
    if (!drag.moved && !drag.fresh && removeNote(track.steps, drag.step, drag.pitch)) onchange()
    drag = null
    sound(null)
  }

  // ── Velocity lane ───────────────────────────────────────────────────────

  let painting = false
  function paint(e: PointerEvent) {
    if (!lane) return
    const r = lane.getBoundingClientRect()
    const step = Math.floor((e.clientX - r.left) / col)
    if (setVelocity(track.steps, step, (1 - (e.clientY - r.top) / r.height) * 127)) onchange()
  }
</script>

<div class="roll" bind:clientWidth={width}>
  <div class="scroll" bind:this={scroller} style="height:{RULER + VISIBLE_ROWS * ROW + VEL}px">
    <div class="inner" style="width:{KEYS + len * col}px">
      <div class="ruler" style="height:{RULER}px">
        <span class="corner" style="width:{KEYS}px"></span>
        {#each { length: Math.ceil(len / 16) } as _, b (b)}
          <span class="barno" style="left:{KEYS + b * 16 * col}px">{b + 1}</span>
        {/each}
      </div>

      <div class="body">
        <div class="keys" style="width:{KEYS}px">
          {#each pitches as p (p)}
            <button class="key" class:black={isBlack(p)} class:c={p % 12 === 0} style="height:{ROW}px"
              aria-label={nameOf(p)}
              onpointerdown={() => sound(p)} onpointerup={() => sound(null)} onpointerleave={() => sound(null)}
            >{p % 12 === 0 ? nameOf(p) : ''}</button>
          {/each}
        </div>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="grid" bind:this={grid}
          style="width:{len * col}px; height:{pitches.length * ROW}px; --col:{col}px; --row:{ROW}px"
          onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
          {#each pitches as p (p)}
            {#if isBlack(p) || p % 12 === 0}
              <div class="stripe" class:c={p % 12 === 0} style="top:{top(p)}px; height:{ROW}px"></div>
            {/if}
          {/each}
          {#each notes as n (`${n.step}:${n.pitch}`)}
            <div class="note" class:held={drag?.step === n.step && drag.pitch === n.pitch}
              style="left:{n.step * col}px; top:{top(n.pitch)}px; width:{Math.max(5, Math.min(n.len, len - n.step) * col - 1)}px;
                height:{ROW - 1}px; --v:{n.velocity / 127}"
            >{#if n.len * col > 30}{nameOf(n.pitch)}{/if}</div>
          {/each}
          {#if playing}<div class="head" style="left:{playhead * col}px"></div>{/if}
        </div>
      </div>

      <div class="vel" style="height:{VEL}px">
        <span class="corner" style="width:{KEYS}px">VEL</span>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="lane" bind:this={lane} style="width:{len * col}px; --col:{col}px"
          onpointerdown={(e) => { painting = true; lane?.setPointerCapture(e.pointerId); paint(e) }}
          onpointermove={(e) => { if (painting) paint(e) }}
          onpointerup={() => (painting = false)} onpointercancel={() => (painting = false)}>
          {#each onsets as o (o.step)}
            <span class="bar" style="left:{o.step * col + 1}px; width:{Math.min(col - 3, 9)}px; height:{(o.velocity / 127) * 100}%"></span>
          {/each}
        </div>
      </div>
    </div>
  </div>
  <p class="hint">Click to place a note, drag right to draw its length · drag a note to move it, its right edge to
    resize · click a note to remove it · notes on one step share a length</p>
</div>

<style>
  .roll { min-width: 0; }
  .scroll {
    overflow: auto; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px; background: #101014;
    overscroll-behavior: contain;
  }
  .inner { position: relative; }

  .ruler {
    position: sticky; top: 0; z-index: 4; display: flex;
    background: #1b1b21; border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  }
  .corner {
    position: sticky; left: 0; z-index: 5; flex: none; background: #1b1b21;
    border-right: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.52rem; letter-spacing: 0.14em; color: var(--dim);
    display: flex; align-items: center; justify-content: center;
  }
  .barno {
    position: absolute; top: 0; padding-left: 4px; line-height: 16px;
    font-family: 'Share Tech Mono', monospace; font-size: 0.6rem; color: var(--dim);
    border-left: 1px solid rgba(255, 255, 255, 0.3);
  }

  .body { display: flex; }
  .keys { position: sticky; left: 0; z-index: 3; flex: none; display: flex; flex-direction: column; }
  .key {
    box-sizing: border-box; padding: 0 3px 0 0; margin: 0; border: 0; cursor: pointer;
    border-bottom: 1px solid rgba(0, 0, 0, 0.28); border-right: 1px solid rgba(255, 255, 255, 0.14);
    background: #d9d6cc; color: #33333a; text-align: right;
    font-family: 'Share Tech Mono', monospace; font-size: 0.5rem; line-height: 11px;
  }
  .key.black { background: #23232a; border-bottom-color: #23232a; }
  .key.c { border-bottom-color: rgba(0, 0, 0, 0.75); }
  .key:hover { filter: brightness(1.2); }

  /* Steps, beats and bars as three weights of line; rows as a fourth. */
  .grid {
    position: relative; flex: none; cursor: crosshair; touch-action: none; overflow: hidden;
    background-image:
      linear-gradient(90deg, rgba(255, 255, 255, 0.3) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.13) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
      linear-gradient(0deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
    background-size:
      calc(var(--col) * 16) 100%, calc(var(--col) * 4) 100%, var(--col) 100%, 100% var(--row);
  }
  .stripe { position: absolute; left: 0; right: 0; background: rgba(0, 0, 0, 0.3); pointer-events: none; }
  /* Each octave starts on a brighter line under its C. */
  .stripe.c { background: none; border-bottom: 1px solid rgba(255, 255, 255, 0.16); box-sizing: border-box; }
  .note {
    position: absolute; box-sizing: border-box; pointer-events: none; overflow: hidden;
    border-radius: 2px; border: 1px solid color-mix(in srgb, var(--accent) 60%, #000);
    /* Velocity as brightness: a ghost note should not look like an accent. */
    background: color-mix(in srgb, var(--accent) calc(35% + var(--v) * 65%), #17171c);
    box-shadow: inset -3px 0 0 rgba(0, 0, 0, 0.28);
    color: #08080a; font-family: 'Share Tech Mono', monospace; font-size: 0.5rem; line-height: 10px;
    padding-left: 2px; white-space: nowrap;
  }
  .note.held { outline: 1px solid #fff; }
  .head {
    position: absolute; top: 0; bottom: 0; width: 2px; pointer-events: none;
    background: var(--accent); box-shadow: 0 0 8px var(--accent);
  }

  .vel {
    position: sticky; bottom: 0; z-index: 4; display: flex;
    background: #15151a; border-top: 1px solid rgba(255, 255, 255, 0.14);
  }
  .vel .corner { background: #15151a; }
  .lane {
    position: relative; flex: none; cursor: ns-resize; touch-action: none;
    background-image: linear-gradient(90deg, rgba(255, 255, 255, 0.13) 1px, transparent 1px);
    background-size: calc(var(--col) * 4) 100%;
  }
  .bar { position: absolute; bottom: 0; background: var(--accent); border-radius: 1px 1px 0 0; pointer-events: none; }

  .hint { margin: 0.5rem 0 0; font-size: 0.66rem; color: var(--dim); }
</style>
