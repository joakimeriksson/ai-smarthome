<script lang="ts">
  // A return bus or the master: its effects, meter, fader; returns also pan,
  // mute, rename and remove. A return wears the faceplate of its first
  // effect, so a hall return reads as the hall unit it is.
  import type { Bus } from '../lib/mixer.svelte.ts'
  import { lookOf } from '../lib/fx.ts'
  import FxRack from './FxRack.svelte'

  interface Props {
    bus: Bus
    meter: number
    selectedFx: string | null
    onfx: (slotId: string) => void
    onchange: () => void
    onremove?: () => void
  }
  let { bus, meter, selectedFx, onfx, onchange, onremove }: Props = $props()

  const first = $derived(bus.chain.slots[0])
  const look = $derived(first ? lookOf(first.kind)
    : { chassis: '#2a2a30', ink: '#e9e7e2', accent: '#cfe8d4' })
</script>

<div class="strip" class:master={bus.isMaster}
  style="--chassis:{look.chassis}; --ink:{look.ink}; --lamp:{look.accent}">
  <div class="face">
    {#if bus.isMaster}
      <span class="name">MASTER</span>
    {:else}
      <span class="letter">RETURN {bus.id}</span>
      <input class="name edit" value={bus.name} aria-label="Return {bus.id} name"
        onchange={(e) => { bus.name = (e.target as HTMLInputElement).value }} />
    {/if}
  </div>

  <div class="inner">
    <FxRack chain={bus.chain} selected={selectedFx} onselect={onfx}
      addLabel={bus.isMaster ? '+ insert' : '+ effect'} />

    <div class="meter-row">
      <div class="meter"><div class="fill" style="height:{Math.round(meter * 100)}%"></div></div>
      <input class="fader" type="range" min="0" max="1" step="0.01" value={bus.level}
        aria-label="{bus.name} level"
        oninput={(e) => { bus.level = Number((e.target as HTMLInputElement).value); onchange() }} />
    </div>

    {#if !bus.isMaster}
      <label class="knob-row">
        <span>PAN</span>
        <input type="range" min="-1" max="1" step="0.01" value={bus.pan}
          oninput={(e) => { bus.pan = Number((e.target as HTMLInputElement).value); onchange() }} />
      </label>
      <div class="btns">
        <button class="m" class:on={bus.muted} onclick={() => { bus.muted = !bus.muted; onchange() }}>M</button>
        <button class="x" onclick={onremove} aria-label="Remove return {bus.id}">×</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #1c1c21, #16161b);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    min-width: 92px;
    width: 92px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  .strip.master { border-color: rgba(255, 255, 255, 0.16); }
  .face {
    background: linear-gradient(180deg, color-mix(in srgb, var(--chassis) 100%, #fff 8%), var(--chassis));
    padding: 0.3rem 0.4rem 0.35rem;
    border-bottom: 2px solid var(--lamp);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .letter { font-size: 0.48rem; letter-spacing: 0.18em; color: var(--ink); opacity: 0.7; }
  .name {
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--ink);
    text-transform: uppercase;
  }
  .name.edit {
    width: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    font-family: inherit;
  }
  .name.edit:focus { outline: 1px solid var(--lamp); }
  .inner { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.4rem; flex: 1; }
  .meter-row { display: flex; gap: 0.4rem; height: 88px; }
  .meter { width: 8px; background: #0a0a0c; border-radius: 2px; display: flex; flex-direction: column-reverse; overflow: hidden; }
  .fill { background: linear-gradient(180deg, #ff5a3c 0%, #ffcc33 22%, var(--lamp) 45%); transition: height 60ms linear; }
  .fader { writing-mode: vertical-lr; direction: rtl; width: 20px; accent-color: var(--lamp); }
  .knob-row { display: flex; flex-direction: column; gap: 2px; }
  .knob-row span { font-size: 0.52rem; letter-spacing: 0.12em; color: #8b8b96; }
  .knob-row input { width: 100%; accent-color: var(--lamp); }
  .btns { display: flex; gap: 3px; }
  .btns button {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 0;
    color: #8a8a93;
    border-radius: 2px;
    font-size: 0.6rem;
    font-weight: 700;
    padding: 3px 0;
    cursor: pointer;
  }
  .btns button:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }
  .btns .m.on { background: #ff4444; color: #fff; }
</style>
