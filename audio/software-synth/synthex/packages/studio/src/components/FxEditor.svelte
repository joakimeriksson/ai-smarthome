<script lang="ts">
  // One effect pulled forward out of its chain: presets, bypass, order, and
  // every parameter, generated from FX_DEFS.
  import type { FxChain } from '../lib/mixer.svelte.ts'
  import { fxDef, lookOf, resolveParams, SCATTER_STEP_SHORT, type FxParamSpec } from '../lib/fx.ts'

  interface Props {
    chain: FxChain
    slotId: string
    /** Where the effect sits, e.g. "Pad · insert 2" or "Return A". */
    where: string
    onclose: () => void
    /** Steps since play, and whether the transport runs: the pattern's playhead. */
    step?: number
    playing?: boolean
  }
  let { chain, slotId, where, onclose, step = 0, playing = false }: Props = $props()

  const slot = $derived(chain.slots.find(s => s.id === slotId) ?? null)
  const index = $derived(chain.slots.findIndex(s => s.id === slotId))
  const def = $derived(slot ? fxDef(slot.kind) : null)
  const look = $derived(slot ? lookOf(slot.kind) : null)
  /** The preset's own values moved since it was chosen (or loaded that way). */
  const edited = $derived.by(() => {
    if (!slot?.preset) return false
    const base = resolveParams({ kind: slot.kind, preset: slot.preset }, chain.context)
    // A performance effect's mix is played (the scatter pads punch it in
    // and out), so it does not count as an edit to the pattern.
    const played = def?.family === 'performance' ? 'mix' : ''
    return Object.entries(base).some(([k, v]) => k !== played && Math.abs((slot.params[k] ?? v) - v) > 1e-9)
  })

  // A step pattern (Scatter) is drawn as one row of 16 cells, not 16 menus.
  const stepParams = $derived(def?.params.filter(p => p.group === 'steps') ?? [])
  const knobParams = $derived(def?.params.filter(p => p.group !== 'steps') ?? [])
  /** The cell being played: song 16ths scaled by the Step length (1/8, 1/16, 1/32). */
  const playCell = $derived.by(() => {
    if (!playing || !slot || !stepParams.length) return -1
    const perSixteenth = [0.5, 1, 2][Math.round(slot.params['speed'] ?? 1)] ?? 1
    return Math.floor(step * perSixteenth) % stepParams.length
  })

  // Log-scaled controls move in equal ratios, like a frequency knob.
  const toPos = (p: FxParamSpec, v: number) =>
    p.log ? Math.log(v / p.min) / Math.log(p.max / p.min) : (v - p.min) / (p.max - p.min)
  const fromPos = (p: FxParamSpec, pos: number) => {
    const v = p.log ? p.min * Math.pow(p.max / p.min, pos) : p.min + pos * (p.max - p.min)
    return Math.round(v / p.step) * p.step
  }

  function fmt(p: FxParamSpec, v: number): string {
    if (p.options) return p.options[Math.round(v)] ?? String(v)
    if (p.id === 'mix') return `${Math.round(v * 100)}%`
    if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : v >= 10 ? `${Math.round(v)}` : v.toFixed(2)
    if (p.unit === 's') return v.toFixed(v < 10 ? 2 : 1)
    if (p.unit === 'ms') return v.toFixed(v < 10 ? 2 : 0)
    if (p.unit === '°') return `${Math.round(v)}`
    if (p.unit === 'dB') return v <= -95.9 && p.id === 'noise' ? 'off' : v.toFixed(1)
    if (p.unit === 'bit' || p.unit === 'oct') return v.toFixed(p.unit === 'bit' ? 1 : 2)
    return v.toFixed(2)
  }

  /** The delay's free time only counts when it is not synced, and vice versa. */
  /**
   * Controls the current settings make irrelevant, shown dimmed: a synced
   * effect's free Rate (or the delay's Time), a free one's Note value.
   */
  function inactive(p: FxParamSpec): boolean {
    if (!slot || !def?.params.some(x => x.id === 'sync')) return false
    const synced = (slot.params['sync'] ?? 0) >= 0.5
    return ((p.id === 'time' || p.id === 'rate') && synced) || (p.id === 'division' && !synced)
  }
</script>

{#if slot && def && look}
  <div class="fx" style="--chassis:{look.chassis}; --ink:{look.ink}; --lamp:{look.accent}">
    <header>
      <div class="who">
        <span class="badge">{where}</span>
        <h3>{def.name}</h3>
      </div>
      <label class="pick">
        PRESET
        <select value={slot.preset ?? ''}
          onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) chain.applyPreset(slot.id, v) }}>
          <option value="">{slot.preset ? '—' : 'edited'}</option>
          {#each def.presets as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
        </select>
        {#if edited}<span class="mod" title="Parameters changed from the preset">edited</span>{/if}
      </label>
      <button class="tool" class:lit={!slot.bypass} onclick={() => chain.setBypass(slot.id, !slot.bypass)}
        title="Bypass">{slot.bypass ? 'BYPASSED' : 'ON'}</button>
      <button class="tool" disabled={index <= 0} onclick={() => chain.move(slot.id, -1)}
        title="Earlier in the chain" aria-label="Move up">▲</button>
      <button class="tool" disabled={index >= chain.slots.length - 1} onclick={() => chain.move(slot.id, 1)}
        title="Later in the chain" aria-label="Move down">▼</button>
      <button class="tool rm" onclick={() => { chain.remove(slot.id); onclose() }} title="Remove this effect">REMOVE</button>
      <button class="close" onclick={onclose} aria-label="Close">×</button>
    </header>

    {#if stepParams.length}
      <div class="steps">
        {#each stepParams as p, i (p.id)}
          {@const v = Math.round(slot.params[p.id] ?? p.def)}
          <label class="cell" class:set={v !== 0} class:beat={i % 4 === 0} class:cur={i === playCell}
            title="{p.label}: {p.options?.[v]}">
            <span>{SCATTER_STEP_SHORT[v] ?? v}</span>
            <!-- The native menu, invisible over the cell: full names to choose from. -->
            <select aria-label={p.label} value={String(v)}
              onchange={(e) => chain.setParam(slot.id, p.id, Number((e.target as HTMLSelectElement).value))}>
              {#each p.options ?? [] as o, k (o)}<option value={String(k)}>{o}</option>{/each}
            </select>
          </label>
        {/each}
      </div>
    {/if}

    <div class="params">
      {#each knobParams as p (p.id)}
        <div class="row" class:dim={inactive(p)}>
          <label for="fx-{slot.id}-{p.id}">{p.label}</label>
          {#if p.options}
            <select id="fx-{slot.id}-{p.id}" value={String(Math.round(slot.params[p.id] ?? p.def))}
              onchange={(e) => chain.setParam(slot.id, p.id, Number((e.target as HTMLSelectElement).value))}>
              {#each p.options as o, i (o)}<option value={String(i)}>{o}</option>{/each}
            </select>
          {:else}
            <input id="fx-{slot.id}-{p.id}" type="range" min="0" max="1" step="0.001"
              value={toPos(p, slot.params[p.id] ?? p.def)}
              oninput={(e) => chain.setParam(slot.id, p.id, fromPos(p, Number((e.target as HTMLInputElement).value)))}
              ondblclick={() => chain.setParam(slot.id, p.id, p.def)} />
            <span class="val">{fmt(p, slot.params[p.id] ?? p.def)}<small>{p.unit && p.id !== 'mix' ? p.unit : ''}</small></span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .fx {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid var(--lamp);
    border-radius: 4px;
    background: #16161a;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55);
    margin-bottom: 0.6rem;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.6rem;
    background: linear-gradient(180deg, color-mix(in srgb, var(--chassis) 100%, #fff 8%), var(--chassis));
    border-bottom: 1px solid rgba(0, 0, 0, 0.5);
  }
  .who { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; margin-right: auto; }
  .badge { font-size: 0.5rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink); opacity: 0.7; }
  h3 { margin: 0; font-size: 0.82rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink); }
  .pick { display: flex; align-items: center; gap: 0.35rem; font-size: 0.52rem; letter-spacing: 0.18em; color: var(--ink); opacity: 0.85; }
  .pick select, .tool, .close {
    background: rgba(0, 0, 0, 0.28);
    color: var(--ink);
    border: 1px solid rgba(0, 0, 0, 0.4);
    border-radius: 2px;
    font-family: inherit;
    cursor: pointer;
  }
  .pick select { padding: 0.15rem 0.3rem; font-size: 0.68rem; max-width: 12rem; }
  .mod { font-size: 0.5rem; letter-spacing: 0.12em; color: var(--lamp); text-transform: uppercase; }
  .tool { font-size: 0.56rem; letter-spacing: 0.12em; padding: 0.18rem 0.4rem; }
  .tool:disabled { opacity: 0.3; cursor: default; }
  .tool.lit { background: var(--lamp); color: #101013; border-color: var(--lamp); font-weight: 700; }
  .tool.rm:hover { border-color: #ff4444; color: #ff8a70; }
  .close { width: 1.4rem; height: 1.4rem; line-height: 1; font-size: 0.9rem; }

  .steps {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 3px;
    padding: 0.7rem 0.7rem 0;
  }
  .cell {
    position: relative;
    display: grid;
    place-items: center;
    height: 2.1rem;
    background: #101014;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #5f5f68;
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.66rem;
    cursor: pointer;
  }
  .cell.beat { border-left-color: rgba(255, 255, 255, 0.34); }
  .cell.set { background: color-mix(in srgb, var(--lamp) 24%, #101014); border-color: var(--lamp); color: #fff; }
  .cell.cur { box-shadow: 0 0 0 1px #fff; }
  .cell.cur.set { background: var(--lamp); color: #101013; }
  .cell select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }

  .params {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 2px 1rem;
    padding: 0.6rem 0.7rem 0.7rem;
  }
  .row { display: grid; grid-template-columns: 5.2rem 1fr 3.2rem; align-items: center; gap: 0.4rem; }
  .row.dim { opacity: 0.4; }
  .row label { font-size: 0.6rem; letter-spacing: 0.06em; color: #9a9aa4; white-space: nowrap; }
  .row input[type="range"] { width: 100%; min-width: 0; accent-color: var(--lamp); }
  .row select {
    grid-column: 2 / -1;
    background: #101014;
    color: #d8d8de;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 1px 3px;
    font-family: inherit;
    font-size: 0.62rem;
  }
  .val { font-family: 'Share Tech Mono', monospace; font-size: 0.62rem; color: var(--lamp); text-align: right; white-space: nowrap; }
  .val small { font-size: 0.5rem; margin-left: 1px; opacity: 0.7; }
</style>
