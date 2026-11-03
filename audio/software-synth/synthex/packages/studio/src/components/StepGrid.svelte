<script lang="ts">
  // Pattern editor for the focused track. Percussion tracks get the
  // 8-channel grid, all bars on one line. Melodic tracks have three views of
  // one pattern: the piano roll, sheet music (read-only), and the step row -
  // one note per step (click to toggle, scroll to pitch it), which names a
  // step's chord and marks its aftertouch, and shows a tie on the steps a
  // note holds through.
  import { DRUM_CHANNELS, MINIPOPS_KEYS, drumChannelName, instrumentDef } from '../lib/instruments.ts'
  import { BAR_CHOICES, type Track, type NoteStep } from '../lib/track.svelte.ts'
  import PianoRoll from './PianoRoll.svelte'
  import ScoreView from './ScoreView.svelte'

  interface Props {
    track: Track | null
    currentStep: number
    playing: boolean
    onchange: () => void
    /** How a melodic pattern is shown. */
    view?: 'roll' | 'score' | 'steps'
    /** The song's key signature, for the score (sharps > 0, flats < 0). */
    fifths?: number
    /** Audition a note from the piano roll. */
    onnote?: (note: number, down: boolean) => void
  }
  let { track, currentStep, playing, onchange, view = 'steps', fifths = 0, onnote }: Props = $props()

  // The lane wears its instrument's colour — six sound-worlds, six identities.
  const accent = $derived(track ? instrumentDef(track.kind).accent : 'var(--accent)')

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`

  // Chord suffix from the intervals above the root; unknown shapes show "+n".
  const CHORD_NAMES: Record<string, string> = {
    '4,7': '', '3,7': 'm', '3,6': 'dim', '4,8': 'aug', '2,7': 'sus2', '5,7': 'sus4',
    '4,7,11': 'maj7', '3,7,10': 'm7', '4,7,10': '7', '4,7,14': 'add9', '3,7,14': 'm(9)',
    '4,7,11,14': 'maj9', '3,7,10,14': 'm9', '7': '5', '7,12': '5', '12': '8va',
    '5,7,12': 'sus4', '4,7,12': '', '3,7,12': 'm',
  }
  function chordName(s: NoteStep): string {
    if (!s.chord?.length) return ''
    return CHORD_NAMES[s.chord.join(',')] ?? `+${s.chord.length}`
  }

  const len = $derived(track?.length ?? 16)
  const playhead = $derived(len ? currentStep % len : 0)
  const bars = $derived(Math.max(1, Math.round(len / 16)))
  // Drum grids wrap every four bars: 256 cells on one line are 5 px wide.
  const PAGE = 64
  const pages = $derived(Array.from({ length: Math.ceil(len / PAGE) }, (_, p) => p))

  // Steps that a previous note is still holding through: drawn as a tie.
  const held = $derived.by(() => {
    const out = new Array<boolean>(track?.steps.length ?? 0).fill(false)
    if (!track || track.isPercussion) return out
    track.steps.forEach((s, i) => {
      if (s.note === null || !s.length) return
      for (let k = 1; k < Math.round(s.length) && i + k < out.length; k++) {
        if (track!.steps[i + k]!.note !== null) break
        out[i + k] = true
      }
    })
    return out
  })

  /** Resize the pattern to n bars; growing repeats the bars already there. */
  function setBars(n: number) {
    if (!track || n === bars) return
    const want = n * 16
    const grow = <T,>(arr: T[], clone: (x: T) => T) =>
      Array.from({ length: want }, (_, i) => clone(arr[i % arr.length]!))
    if (track.isPercussion) track.drumGrid = track.drumGrid.map(row => grow(row, v => v))
    else track.steps = grow(track.steps, st => (st.chord ? { ...st, chord: [...st.chord] } : { ...st }))
    onchange()
  }

  function toggleNote(i: number) {
    if (!track) return
    const s = track.steps[i]
    if (!s) return
    if (s.note === null) s.note = 60
    else { s.note = null; delete s.chord; delete s.length }
    onchange()
  }

  function bumpNote(i: number, delta: number) {
    if (!track) return
    const s = track.steps[i]
    if (!s || s.note === null) return
    s.note = Math.max(12, Math.min(108, s.note + delta))
    onchange()
  }

  // Rhythm box: which section the lever is on and which keys are down live
  // in the track's params, like any other edit, so they save with the project.
  const section = $derived(Number(track?.params['section'] ?? 0) === 1 ? 1 : 0)
  const keyDown = (k: number) => track?.params[`key.${k}`] === true
  function toggleKey(k: number) {
    if (!track) return
    track.setParam(`key.${k}`, !keyDown(k))
    onchange()
  }
  function setSection(s: 0 | 1) {
    if (!track) return
    track.setParam('section', s)
    onchange()
  }

  function toggleDrum(ch: number, i: number) {
    if (!track) return
    const row = track.drumGrid[ch]
    if (!row) return
    row[i] = row[i] ? 0 : 100
    onchange()
  }
</script>

{#if track && !track.isRhythmBox}
  <div class="bars" style="--accent:{accent}">
    <span>BARS</span>
    {#each BAR_CHOICES as b (b)}
      <button class:on={bars === b} onclick={() => setBars(b)}
        title="{b} bar{b > 1 ? 's' : ''} ({b * 16} steps)">{b}</button>
    {/each}
  </div>
{/if}
{#if !track}
  <div class="empty">Add a track to start writing a pattern.</div>
{:else if track.isRhythmBox}
  <div class="rbox" style="--accent:{accent}">
    <div class="lever" role="group" aria-label="Rhythm section">
      <button class:on={section === 0} onclick={() => setSection(0)} title="Upper rhythms">A</button>
      <button class:on={section === 1} onclick={() => setSection(1)} title="Lower rhythms">B</button>
    </div>
    <div class="rkeys">
      {#each MINIPOPS_KEYS as pair, k (k)}
        <button class="rkey" class:on={keyDown(k)} class:cur={playing && false}
          aria-pressed={keyDown(k)} onclick={() => toggleKey(k)}
          title="{pair[0]} / {pair[1]} — press several keys to combine rhythms">
          <span class:live={section === 0}>{pair[0]}</span>
          <span class:live={section === 1}>{pair[1]}</span>
        </button>
      {/each}
    </div>
    <p class="hint">A preset rhythm box: it runs its own two-bar clock from the transport's first step. Press several keys to combine rhythms; the quijada, guiro and tambourine sliders are in the instrument editor.</p>
  </div>
{:else if track.isPercussion}
  <div class="drum-grid" style="--accent:{accent}; --cols:{Math.min(len, PAGE)}">
    {#each pages as page (page)}
    {#if pages.length > 1}<span class="page-label">bars {page * 4 + 1}–{Math.min(bars, page * 4 + 4)}</span>{/if}
    {#each DRUM_CHANNELS as _, ch (ch)}
      <div class="row">
        <!-- Kits may re-type a channel (OH Hat → Conga); the label follows. -->
        <span class="row-label">{drumChannelName(ch, track.params)}</span>
        <div class="cells">
          {#each (track.drumGrid[ch] ?? []).slice(page * PAGE, (page + 1) * PAGE) as v, j (j)}
            {@const i = page * PAGE + j}
            <button
              class="cell drum"
              class:on={v > 0}
              class:beat={i % 4 === 0}
              class:bar={i % 16 === 0 && j > 0}
              class:cur={playing && i === playhead}
              aria-label="{drumChannelName(ch, track.params)} step {i + 1}, velocity {v}"
              onclick={() => toggleDrum(ch, i)}
            >
              <!-- Velocity as fill height: an accent that hits at 60 should
                   not look identical to one that hits at 100. -->
              <span class="hit" style="height:{Math.round((v / 127) * 100)}%"></span>
            </button>
          {/each}
        </div>
      </div>
    {/each}
    {/each}
  </div>
{:else if view === 'roll'}
  <div style="--accent:{accent}">
    <PianoRoll {track} {playhead} {playing} {onchange} {onnote} />
  </div>
{:else if view === 'score'}
  <div style="--accent:{accent}">
    <ScoreView {track} {fifths} {playhead} {playing} />
  </div>
{:else}
  <div class="note-row" style="--accent:{accent}">
    {#each track.steps as s, i (i)}
      <div class="note-cell" class:beat={i % 4 === 0} class:cur={playing && i === playhead}>
        <button
          class="cell note"
          class:on={s.note !== null}
          class:tie={held[i]}
          onclick={() => toggleNote(i)}
          onwheel={(e) => { e.preventDefault(); bumpNote(i, e.deltaY < 0 ? 1 : -1) }}
          title={s.pressure ? `aftertouch to ${Math.round(s.pressure * 100)} %` : undefined}
        >{#if s.note === null}{held[i] ? '─' : '·'}{:else}{noteName(s.note)}{#if s.chord?.length}<small>{chordName(s)}</small>{/if}{#if s.pressure}<small class="at">↗</small>{/if}{/if}</button>
        {#if s.note !== null}
          <div class="nudge">
            <button onclick={() => bumpNote(i, 1)} aria-label="Up">▲</button>
            <button onclick={() => bumpNote(i, -1)} aria-label="Down">▼</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <p class="hint">Click a step to place a note · scroll or ▲▼ to change pitch</p>
{/if}

<style>
  .empty {
    color: var(--dim);
    font-size: 0.85rem;
    padding: 1.5rem;
    text-align: center;
  }
  .drum-grid { display: flex; flex-direction: column; gap: 3px; }
  .row { display: grid; grid-template-columns: 4.5rem 1fr; align-items: center; gap: 0.5rem; }
  .row-label {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dim);
    text-align: right;
  }
  /* Bars are separated so the beat is countable without reading numbers. */
  .cells { display: grid; grid-template-columns: repeat(var(--cols, 16), 1fr); gap: 3px; }
  .cells > :nth-child(4n + 1) { margin-left: 5px; }
  .cells > :nth-child(1) { margin-left: 0; }
  /* A bar line rather than a wider gap: with 64 columns a margin would
     squeeze the bar's first cell into a sliver. */
  .cells > .bar { box-shadow: -5px 0 0 -3px rgba(255, 255, 255, 0.4); }
  .cell {
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: #17171c;
    border-radius: 2px;
    cursor: pointer;
    padding: 0;
  }
  .cell.drum {
    height: 22px;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
  }
  /* The downbeat of each quarter sits on a lighter field. */
  .cell.beat { border-color: rgba(255, 255, 255, 0.2); background: #1f1f26; }
  .hit {
    display: block;
    width: 100%;
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--accent) 100%, #fff 25%), var(--accent));
    transition: height 80ms ease;
  }
  .cell.drum.on { border-color: var(--accent); }
  .cell:hover { border-color: rgba(255, 255, 255, 0.35); }
  .cell.cur {
    box-shadow: 0 0 0 1px var(--accent) inset, 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .note-row { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; row-gap: 10px; }
  .note-row > :nth-child(4n + 1) { margin-left: 5px; }
  .note-row > :nth-child(1) { margin-left: 0; }
  .note-cell { display: flex; flex-direction: column; gap: 2px; }
  .note-cell.beat .cell.note { border-color: rgba(255, 255, 255, 0.2); background: #1f1f26; }
  .note-cell.cur .cell.note {
    box-shadow: 0 0 0 1px var(--accent) inset, 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .cell.note {
    height: 30px;
    color: var(--dim);
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.66rem;
  }
  /* Written as descendants of .note-cell so they outrank the beat shading
     above: Svelte adds its scope class to every compound selector, so
     '.note-cell.beat .cell.note' out-specified a plain '.cell.note.on' and a
     note placed on a beat was drawn unlit. */
  .note-cell .cell.note.on { background: var(--accent); color: #08080a; border-color: var(--accent); font-weight: 700; }
  .cell.note small { display: block; font-size: 0.56rem; line-height: 1; opacity: 0.8; }
  .cell.note small.at { display: inline; margin-left: 2px; font-size: 0.7rem; opacity: 1; }
  .page-label {
    font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim);
    margin: 6px 0 0 4.5rem;
  }
  .page-label:first-child { margin-top: 0; }
  .note-cell .cell.note.tie {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, #17171c);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .bars {
    display: flex; align-items: center; gap: 4px; justify-content: flex-end;
    margin: 0 0 0.5rem; font-size: 0.6rem; letter-spacing: 0.14em; color: var(--dim);
  }
  .bars span { margin-right: 4px; }
  .bars button {
    width: 22px; height: 18px; padding: 0; cursor: pointer;
    background: #17171c; color: var(--dim);
    border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 2px;
    font-family: 'Share Tech Mono', monospace; font-size: 0.66rem;
  }
  .bars button.on { background: var(--accent); color: #08080a; border-color: var(--accent); }
  .nudge { display: flex; gap: 2px; }
  .nudge button {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 0;
    color: var(--dim);
    font-size: 0.5rem;
    line-height: 1;
    padding: 2px 0;
    border-radius: 2px;
    cursor: pointer;
  }
  .nudge button:hover { background: rgba(255, 255, 255, 0.16); color: #fff; }
  .hint { color: var(--dim); font-size: 0.7rem; margin: 0.5rem 0 0; }

  /* The Mini Pops' front: the lever, then the ten ivory keys with each
     key's two rhythm names, the live section's name lit. */
  .rbox { display: flex; flex-direction: column; gap: 0.5rem; }
  .lever { display: flex; gap: 3px; }
  .lever button {
    width: 2rem; height: 1.4rem; cursor: pointer; padding: 0;
    background: #17171c; color: var(--dim);
    border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 2px;
    font-family: 'Share Tech Mono', monospace; font-size: 0.7rem;
  }
  .lever button.on { background: var(--accent); color: #08080a; border-color: var(--accent); font-weight: 700; }
  .rkeys { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
  .rkey {
    display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center;
    min-height: 3.2rem; padding: 0.3rem 0.1rem; cursor: pointer;
    background: linear-gradient(180deg, #f1ebdd, #d8d1c1); color: #6a645a;
    border: 1px solid #8f887a; border-radius: 3px;
    box-shadow: 0 3px 0 #9a9385, 0 4px 4px rgba(0, 0, 0, 0.5);
    font-size: 0.55rem; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.15;
  }
  .rkey span { opacity: 0.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .rkey span.live { opacity: 1; color: #1a1a1c; font-weight: 700; }
  .rkey.on {
    transform: translateY(2px);
    background: linear-gradient(180deg, #ddd6c6, #cfc8b8);
    box-shadow: 0 1px 0 #9a9385, inset 0 2px 4px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--accent);
  }
</style>
