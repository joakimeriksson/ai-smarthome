<script lang="ts">
  // A chain's insert slots, top to bottom in signal order: each a small
  // faceplate with a bypass LED; click the name to open it in the editor.
  import type { FxChain } from '../lib/mixer.svelte.ts'
  import { FX_DEFS, FX_FAMILIES, lookOf, type FxKind } from '../lib/fx.ts'

  interface Props {
    chain: FxChain
    /** The slot open in the editor, if it is in this chain. */
    selected: string | null
    onselect: (slotId: string) => void
    /** What the add menu says ("+ insert", "+ effect"). */
    addLabel?: string
  }
  let { chain, selected, onselect, addLabel = '+ insert' }: Props = $props()

  function add(e: Event) {
    const el = e.target as HTMLSelectElement
    const kind = el.value as FxKind
    el.value = ''
    if (!kind) return
    onselect(chain.add(kind).id)
  }
</script>

<div class="rack">
  {#each chain.slots as slot (slot.id)}
    {@const look = lookOf(slot.kind)}
    <div class="slot" class:sel={selected === slot.id} class:off={slot.bypass}
      style="--chassis:{look.chassis}; --ink:{look.ink}; --lamp:{look.accent}">
      <button class="led" aria-label="{slot.bypass ? 'Enable' : 'Bypass'} {slot.name}"
        title={slot.bypass ? 'Bypassed — click to enable' : 'On — click to bypass'}
        onclick={() => chain.setBypass(slot.id, !slot.bypass)}></button>
      <button class="nm" onclick={() => onselect(slot.id)}
        title="{slot.name}{slot.preset ? ` — ${slot.preset}` : ''}">{slot.name}</button>
    </div>
  {/each}
  <select class="add" value="" aria-label="Add an effect" onchange={add}>
    <option value="">{addLabel}</option>
    {#each FX_FAMILIES as f (f.family)}
      <optgroup label={f.label}>
        {#each FX_DEFS.filter(d => d.family === f.family) as d (d.kind)}<option value={d.kind}>{d.name}</option>{/each}
      </optgroup>
    {/each}
  </select>
</div>

<style>
  .rack { display: flex; flex-direction: column; gap: 2px; }
  .slot {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 17px;
    padding: 0 4px;
    border-radius: 2px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--chassis) 100%, #fff 7%), var(--chassis));
    border: 1px solid rgba(0, 0, 0, 0.45);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
  }
  .slot.sel { border-color: var(--lamp); box-shadow: 0 0 0 1px var(--lamp); }
  .led {
    flex: none;
    width: 7px;
    height: 7px;
    padding: 0;
    border-radius: 50%;
    border: 0;
    cursor: pointer;
    background: var(--lamp);
    box-shadow: 0 0 5px var(--lamp);
  }
  .slot.off .led { background: #3a3a40; box-shadow: none; }
  .slot.off .nm { opacity: 0.45; text-decoration: line-through; }
  .nm {
    flex: 1;
    min-width: 0;
    background: none;
    border: 0;
    padding: 0;
    color: var(--ink);
    font-family: inherit;
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .add {
    height: 17px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px dashed rgba(255, 255, 255, 0.14);
    border-radius: 2px;
    color: #8b8b96;
    font-family: inherit;
    font-size: 0.54rem;
    letter-spacing: 0.08em;
    padding: 0 2px;
    cursor: pointer;
  }
  .add:hover { color: #e9e7e2; border-color: rgba(255, 255, 255, 0.3); }
</style>
