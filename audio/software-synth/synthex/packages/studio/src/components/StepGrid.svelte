<script lang="ts">
  // Pattern editor for the focused track. Melodic tracks get one note per
  // step (click to toggle, drag vertically to pitch it); percussion tracks
  // get the 8-channel × 16-step grid.
  import { DRUM_CHANNELS, drumChannelName, instrumentDef } from '../lib/instruments.ts'
  import type { Track } from '../lib/track.svelte.ts'

  interface Props {
    track: Track | null
    currentStep: number
    playing: boolean
    onchange: () => void
  }
  let { track, currentStep, playing, onchange }: Props = $props()

  // The lane wears its instrument's colour — six sound-worlds, six identities.
  const accent = $derived(track ? instrumentDef(track.kind).accent : 'var(--accent)')

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`

  function toggleNote(i: number) {
    if (!track) return
    const s = track.steps[i]
    if (!s) return
    s.note = s.note === null ? 60 : null
    onchange()
  }

  function bumpNote(i: number, delta: number) {
    if (!track) return
    const s = track.steps[i]
    if (!s || s.note === null) return
    s.note = Math.max(12, Math.min(108, s.note + delta))
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

{#if !track}
  <div class="empty">Add a track to start writing a pattern.</div>
{:else if track.isPercussion}
  <div class="drum-grid" style="--accent:{accent}">
    {#each DRUM_CHANNELS as _, ch (ch)}
      <div class="row">
        <!-- Kits may re-type a channel (OH Hat → Conga); the label follows. -->
        <span class="row-label">{drumChannelName(ch, track.params)}</span>
        <div class="cells">
          {#each track.drumGrid[ch] ?? [] as v, i (i)}
            <button
              class="cell drum"
              class:on={v > 0}
              class:beat={i % 4 === 0}
              class:cur={playing && i === currentStep}
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
  </div>
{:else}
  <div class="note-row" style="--accent:{accent}">
    {#each track.steps as s, i (i)}
      <div class="note-cell" class:beat={i % 4 === 0} class:cur={playing && i === currentStep}>
        <button
          class="cell note"
          class:on={s.note !== null}
          onclick={() => toggleNote(i)}
          onwheel={(e) => { e.preventDefault(); bumpNote(i, e.deltaY < 0 ? 1 : -1) }}
        >{s.note === null ? '·' : noteName(s.note)}</button>
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
  .cells { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; }
  .cells > :nth-child(4n + 1) { margin-left: 5px; }
  .cells > :nth-child(1) { margin-left: 0; }
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

  .note-row { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; }
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
  .cell.note.on { background: var(--accent); color: #08080a; border-color: var(--accent); font-weight: 700; }
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
</style>
