<script lang="ts">
  // One channel strip: meter, fader, pan, mute/solo, focus, remove.
  import type { Track } from '../lib/track.svelte.ts'
  import { instrumentDef, INSTRUMENTS, type InstrumentKind } from '../lib/instruments.ts'

  interface Props {
    track: Track
    focused: boolean
    meter: number
    onfocus: () => void
    onchange: () => void
    onremove: () => void
    onroll: () => void
    onswap: (kind: InstrumentKind) => void
    onedit: () => void
    editing: boolean
  }
  let { track, focused, meter, onfocus, onchange, onremove, onroll, onswap, onedit, editing }: Props = $props()

  const def = $derived(instrumentDef(track.kind))
  let rolling = $state(false)

  function roll() {
    onroll()
    // Brief tick so the die visibly reacts — the button should feel physical.
    rolling = true
    setTimeout(() => (rolling = false), 260)
  }
</script>

<div class="strip" class:focused style="--accent:{def.accent}; --chassis:{def.chassis}; --ink:{def.ink}">
  <!-- Faceplate: painted in the instrument's own panel material, so the rack
       reads as six different machines rather than six tinted copies. -->
  <div class="face">
    <button class="name" onclick={onfocus} title="Play this track from the keyboard">
      {track.name}
    </button>

    <!-- Swap the sound engine, keep the pattern. -->
    <select
      class="swap"
      aria-label="Instrument for {track.name}"
      title="Play this pattern on another instrument"
      value={track.kind}
      onchange={(e) => onswap((e.target as HTMLSelectElement).value as InstrumentKind)}
    >
      {#each INSTRUMENTS as inst (inst.kind)}
        <option value={inst.kind}>{inst.name}</option>
      {/each}
    </select>
  </div>

  <div class="meter-row">
    <div class="meter"><div class="fill" style="height:{Math.round(meter * 100)}%"></div></div>
    <input
      class="fader"
      type="range" min="0" max="1" step="0.01"
      value={track.level}
      oninput={(e) => { track.level = Number((e.target as HTMLInputElement).value); onchange() }}
    />
  </div>

  <label class="knob-row">
    <span>PAN</span>
    <input
      type="range" min="-1" max="1" step="0.01"
      value={track.pan}
      oninput={(e) => { track.pan = Number((e.target as HTMLInputElement).value); onchange() }}
    />
  </label>

  <button class="edit" class:on={editing} onclick={onedit}
    title="Edit this instrument's sound">EDIT</button>

  <div class="btns">
    <button class="m" class:on={track.muted}
      onclick={() => { track.muted = !track.muted; onchange() }}>M</button>
    <button class="s" class:on={track.soloed}
      onclick={() => { track.soloed = !track.soloed; onchange() }}>S</button>
    <button class="dice" class:rolling onclick={roll}
      title="Roll a new pattern for this track" aria-label="Roll pattern">⚄</button>
    <button class="x" onclick={onremove} aria-label="Remove track">×</button>
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0 0 0.5rem;
    background: linear-gradient(180deg, #202024, #191920);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    min-width: 98px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }
  .strip.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 0 14px -4px var(--accent);
  }

  /* The painted faceplate — the instrument's own material, mounted in the
     rack. Rack screws at the corners because it is bolted in, not floating. */
  .face {
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--chassis) 100%, #fff 8%),
      var(--chassis));
    padding: 0.35rem 0.45rem 0.4rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.5);
    box-shadow: inset 0 -3px 6px rgba(0, 0, 0, 0.25);
    position: relative;
  }
  .face::before,
  .face::after {
    content: '';
    position: absolute;
    top: 4px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #cfcfd4, #6a6a72 60%, #34343a);
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.6);
  }
  .face::before { left: 4px; }
  .face::after { right: 4px; }

  .name {
    display: block;
    width: 100%;
    background: transparent;
    border: 0;
    color: var(--ink);
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 0 0 0.25rem;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
    /* A silkscreened rule in the machine's lit colour: the second cue that
       separates plates whosematerials are close (cream 808 / bone lab). */
    border-bottom: 2px solid var(--accent);
    margin-bottom: 0.3rem;
  }

  .knob-row,
  .btns,
  .edit,
  .meter-row { margin-inline: 0.45rem; }

  .edit {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #b6b6be;
    border-radius: 2px;
    padding: 3px 0;
    font-family: inherit;
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    cursor: pointer;
  }
  .edit:hover { border-color: var(--accent); color: var(--accent); }
  .edit.on { background: var(--accent); border-color: var(--accent); color: #101013; }

  .meter-row { display: flex; gap: 0.4rem; align-items: stretch; height: 88px; }
  .meter {
    width: 8px;
    background: #0a0a0c;
    border-radius: 2px;
    display: flex;
    flex-direction: column-reverse;
    overflow: hidden;
  }
  .fill { background: linear-gradient(180deg, #ff5a3c 0%, #ffcc33 22%, var(--accent) 45%); transition: height 60ms linear; }
  .fader {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 20px;
    accent-color: var(--accent);
  }
  .knob-row { display: flex; flex-direction: column; gap: 2px; }
  .knob-row span { font-size: 0.52rem; letter-spacing: 0.12em; color: #8b8b96; }
  .knob-row input { width: 100%; accent-color: var(--accent); }
  .btns { display: flex; gap: 3px; }
  .btns button {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 0;
    color: var(--dim);
    border-radius: 2px;
    font-size: 0.6rem;
    font-weight: 700;
    padding: 3px 0;
    cursor: pointer;
  }
  .btns button:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
  .btns .m.on { background: #ff4444; color: #fff; }
  .btns .s.on { background: #ffcc00; color: #000; }
  .btns .dice { font-size: 0.8rem; line-height: 1; }
  .btns .dice:hover { color: var(--accent); }
  .btns .dice.rolling {
    background: var(--accent);
    color: #08080a;
    animation: dice-roll 260ms ease-out;
  }
  @keyframes dice-roll {
    from { transform: rotate(-160deg) scale(0.8); }
    to   { transform: rotate(0deg) scale(1); }
  }

  /* Silkscreened onto the faceplate, so it takes the plate's ink, not the
     rack's. */
  .swap {
    width: 100%;
    background: rgba(0, 0, 0, 0.22);
    color: var(--ink);
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 2px;
    padding: 2px 3px;
    font-family: inherit;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .swap:hover { border-color: var(--accent); }
</style>
