<script lang="ts">
  import type { Step, Track, LayerTarget } from '../lib/sequencer'

  interface Props {
    tracks: Track[]
    activeTrack: number
    bpm: number
    playing: boolean
    currentStep: number
    onstepchange: (track: number, i: number, s: Step) => void
    ontrackchange: (track: number, t: Partial<Track>) => void
    onactivetrack: (i: number) => void
    onbpm: (bpm: number) => void
    onplay: () => void
    onstop: () => void
  }
  let {
    tracks, activeTrack, bpm, playing, currentStep,
    onstepchange, ontrackchange, onactivetrack, onbpm, onplay, onstop,
  }: Props = $props()

  let track = $derived(tracks[activeTrack]!)
  let steps = $derived(track.steps)

  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  function noteName(n: number): string {
    return NOTES[n % 12]! + (Math.floor(n / 12) - 1)
  }

  function cycleStep(i: number, s: Step) {
    if (s.kind === 'rest') {
      onstepchange(activeTrack, i, { kind: 'note', note: 60, tie: false })
    } else {
      onstepchange(activeTrack, i, { kind: 'rest' })
    }
  }
  function bumpNote(i: number, s: Step, delta: number) {
    if (s.kind !== 'note') return
    const n = Math.max(24, Math.min(96, s.note + delta))
    onstepchange(activeTrack, i, { ...s, note: n })
  }
  function toggleTie(i: number, s: Step) {
    if (s.kind !== 'note') return
    onstepchange(activeTrack, i, { ...s, tie: !s.tie })
  }
  function setTarget(t: LayerTarget) {
    ontrackchange(activeTrack, { target: t })
  }
  function setEnabled(v: boolean) {
    ontrackchange(activeTrack, { enabled: v })
  }
</script>

<div class="seq">
  <div class="bar">
    <button class="play" onclick={playing ? onstop : onplay}>
      {playing ? '■ Stop' : '▶ Play'}
    </button>
    <label class="bpm">
      BPM
      <input type="number" min="40" max="240" value={bpm}
             oninput={(e) => onbpm(Number((e.target as HTMLInputElement).value))} />
    </label>
    <div class="track-tabs">
      {#each tracks as _, i (i)}
        <button class:active={i === activeTrack} class:on={tracks[i]!.enabled}
                onclick={() => onactivetrack(i)}>T{i + 1}</button>
      {/each}
    </div>
    <label class="opt"><input type="checkbox" checked={track.enabled}
      onchange={(e) => setEnabled((e.target as HTMLInputElement).checked)} /> On</label>
    <div class="layer-sw">
      <button class:active={track.target === 'upper'} onclick={() => setTarget('upper')}>U</button>
      <button class:active={track.target === 'lower'} onclick={() => setTarget('lower')}>L</button>
    </div>
  </div>
  <div class="grid" style="--n:{steps.length}">
    {#each steps as s, i (i)}
      <div class="step" class:cur={i === currentStep && playing}>
        <button class="cell" onclick={() => cycleStep(i, s)}>
          {#if s.kind === 'rest'}—
          {:else}{noteName(s.note)}{/if}
        </button>
        {#if s.kind === 'note'}
          <div class="ctrls">
            <button onclick={() => bumpNote(i, s, 1)} aria-label="Up">▲</button>
            <button onclick={() => bumpNote(i, s, -1)} aria-label="Down">▼</button>
            <button class="tie" class:on={s.tie} onclick={() => toggleTie(i, s)} aria-label="Tie">⌒</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .seq {
    background: linear-gradient(180deg, var(--cream-light) 0%, var(--cream) 30%, var(--cream-deep) 100%);
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08);
  }
  .bar {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .play {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: var(--cream-light);
    border: 1px solid rgba(0, 0, 0, 0.3);
    padding: 0.32rem 0.85rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.78rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    border-radius: 2px;
    cursor: pointer;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      inset 0 -1px 0 rgba(0, 0, 0, 0.3);
  }
  .play:hover { filter: brightness(1.05); }
  .bpm {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .bpm input {
    width: 3.6rem;
    background: #1a0606;
    border: 1px solid #000;
    color: var(--led);
    border-radius: 2px;
    padding: 0.18rem 0.35rem;
    font-family: 'DSEG7 Classic', 'Share Tech Mono', monospace;
    font-size: 0.85rem;
    text-align: center;
    text-shadow: 0 0 3px var(--led-glow);
    box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.7);
  }

  .track-tabs {
    display: flex;
    gap: 2px;
    background: linear-gradient(180deg, #5e5645, #2a241c);
    padding: 2px;
    border-radius: 3px;
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.5);
  }
  .track-tabs button {
    background: linear-gradient(180deg, #f5efdc 0%, #d8ceb2 60%, #b3a786 100%);
    border: 0;
    color: var(--ink);
    padding: 0.22rem 0.55rem;
    border-radius: 2px;
    cursor: pointer;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.7rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  }
  .track-tabs button.on { color: var(--orange); }
  .track-tabs button.active {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: var(--cream-light);
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
    transform: translateY(1px);
  }
  .opt {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.62rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-soft);
    display: inline-flex;
    gap: 0.3rem;
    align-items: center;
  }
  .layer-sw {
    display: flex;
    gap: 2px;
    background: linear-gradient(180deg, #5e5645, #2a241c);
    padding: 2px;
    border-radius: 3px;
  }
  .layer-sw button {
    background: linear-gradient(180deg, #f5efdc 0%, #d8ceb2 60%, #b3a786 100%);
    border: 0;
    color: var(--ink);
    padding: 0.22rem 0.55rem;
    border-radius: 2px;
    cursor: pointer;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.7rem;
  }
  .layer-sw button.active {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: var(--cream-light);
    transform: translateY(1px);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    gap: 3px;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 2px;
    background: linear-gradient(180deg, var(--cream-light), var(--cream-deep));
    padding: 3px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
    position: relative;
  }
  .step.cur {
    border-color: var(--orange);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      0 0 0 1px var(--orange),
      0 0 6px var(--led-glow);
  }
  .cell {
    background: transparent;
    border: 0;
    color: var(--ink);
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.72rem;
    padding: 0.32rem 0;
    cursor: pointer;
    border-radius: 1px;
  }
  .cell:hover { background: rgba(214, 90, 28, 0.12); }
  .ctrls {
    display: flex;
    gap: 2px;
    justify-content: center;
  }
  .ctrls button {
    background: rgba(0, 0, 0, 0.08);
    border: 0;
    color: var(--ink-soft);
    padding: 0.1rem 0.3rem;
    border-radius: 1px;
    cursor: pointer;
    font-size: 0.65rem;
  }
  .ctrls button:hover { background: rgba(0, 0, 0, 0.15); color: var(--ink); }
  .ctrls .tie.on { color: var(--orange); }
</style>
