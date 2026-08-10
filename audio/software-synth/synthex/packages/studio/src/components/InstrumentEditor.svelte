<script lang="ts">
  // The sound editor for one track: pick a preset, tweak the same controls the
  // standalone synth offers, or open that synth's full page.
  //
  // Controls are not hand-listed here — they are extracted from the standalone
  // page at build time (scripts/sync-synth-data.mjs), so this editor follows
  // whatever the real synth exposes.
  import { instrumentDef } from '../lib/instruments.ts'
  import {
    loadSynthData, engineValue, sliderPosition, formatValue,
    type ParamSpec, type SynthData,
  } from '../lib/synth-data.ts'
  import { DRUM_CHANNELS, drumChannelName } from '../lib/instruments.ts'
  import type { Track } from '../lib/track.svelte.ts'

  interface Props {
    track: Track
    onclose: () => void
    onpattern: (pattern: number[][]) => void
  }
  let { track, onclose, onpattern }: Props = $props()

  const def = $derived(instrumentDef(track.kind))

  /** The page each instrument came from, for the "open full editor" link. */
  const STANDALONE: Record<string, string> = {
    va: 'va-synth.html',
    ws: 'ws-synth.html',
    sid: 'sid-synth.html',
    fm: 'fm-synth.html',
    pm: 'pm-synth.html',
    drum: 'drum-machine.html',
  }
  const standaloneUrl = $derived(
    track.kind === 'synthex'
      ? 'http://localhost:5173/'
      : `http://localhost:8123/${STANDALONE[track.kind] ?? ''}`,
  )

  let data = $state<SynthData | null>(null)
  let loading = $state(true)
  let channel = $state(0)

  /**
   * Live slider positions, by parameter name.
   *
   * The handle cannot be driven from the engine value alone: SID quantises
   * with `Math.round(v * 255)`, so 1001 positions collapse onto 256 values and
   * deriving the position back would snap the handle to the start of each
   * plateau mid-drag. The position is the user's input, the engine value is
   * what we compute from it. Cleared whenever the sound is replaced.
   */
  let positions = $state<Record<string, number>>({})

  // Re-fetch whenever the track's engine changes (instrument swap).
  $effect(() => {
    const kind = track.kind
    loading = true
    void loadSynthData(kind).then(d => {
      // Ignore a response that arrived after another swap.
      if (track.kind === kind) { data = d; loading = false; positions = {} }
    })
  })

  /** Controls in the order the standalone page lays them out, by panel. */
  const groups = $derived.by(() => {
    const out: { title: string; params: ParamSpec[] }[] = []
    for (const p of data?.params ?? []) {
      const last = out[out.length - 1]
      if (last && last.title === p.group) last.params.push(p)
      else out.push({ title: p.group, params: [p] })
    }
    return out
  })

  /** Drum voices are addressed per channel; everything else is global. */
  const nameOf = (p: ParamSpec) => (p.perChannel ? `ch.${channel}.${p.param}` : p.param)

  /** The value the engine holds (or would hold at this control's default). */
  function engineOf(p: ParamSpec): number | string | boolean {
    const stored = track.params[nameOf(p)]
    if (stored !== undefined) return stored
    if (p.type === 'toggle') return false
    if (p.type === 'select') return p.options?.[0]?.value ?? '0'
    return engineValue(p, p.default ?? p.min ?? 0)
  }

  /** Where the slider handle sits: the live position, else derived once. */
  const posOf = (p: ParamSpec) =>
    positions[nameOf(p)] ?? sliderPosition(p, Number(engineOf(p)))

  function applyPreset(name: string) {
    const preset = data?.presets.find(p => p.name === name)
    if (!preset) return
    // A drum "preset" is a rhythm plus its kit: the pattern goes to the step
    // grid, and the kit lands as ordinary per-channel edits so it persists in
    // the project file like any other tweak.
    if (preset.pattern) {
      onpattern(preset.pattern)
      if (preset.kit) {
        for (let ch = 0; ch < preset.kit.length; ch++) {
          for (const [field, value] of Object.entries(preset.kit[ch] ?? {})) {
            track.setParam(`ch.${ch}.${field}`, value)
          }
        }
        positions = {}
      }
      track.presetName = preset.name
      return
    }
    if (preset.params) {
      track.loadPreset(preset.name, preset.params, preset.fx ?? {})
      // SID: the GT2 tables are the animated half of the sound (PWM sweeps,
      // arps, filter runs) — send them after the params, or clear stale ones.
      const inst = track.instrument as { post?: (m: Record<string, unknown>) => void }
      if (inst.post) {
        const t = preset.tables
        if (t) {
          const empty = () => new Array<number>(255).fill(0)
          const tbls = [t.wtbl, t.ptbl, t.ftbl]
          tbls.forEach((tbl, i) => inst.post!({
            type: 'tableData', tableType: i,
            ltable: tbl ? tbl.lt : empty(), rtable: tbl ? tbl.rt : empty(),
          }))
          inst.post({ type: 'tableStartPtrs', ptrs: {
            wave: t.wavePtr ?? 0, pulse: t.pulsePtr ?? 0, filter: t.filterPtr ?? 0 } })
          inst.post({ type: 'tableEnabled', value: true })
        } else if (track.kind === 'sid') {
          inst.post({ type: 'tableEnabled', value: false })
        }
      }
      positions = {}     // handles follow the new sound
    }
  }
</script>

<div class="editor" style="--accent:{def.accent}; --chassis:{def.chassis}; --ink:{def.ink}">
  <header>
    <div class="who">
      <span class="badge">{def.name}</span>
      <h3>{track.name}</h3>
      {#if track.presetName}<span class="preset-name">{track.presetName}</span>{/if}
    </div>

    <label class="pick">
      PRESET
      <select
        value={track.presetName ?? ''}
        onchange={(e) => applyPreset((e.target as HTMLSelectElement).value)}
      >
        <option value="">— {track.kind === 'drum' ? 'pattern' : 'preset'} —</option>
        {#each data?.presets ?? [] as p (p.name)}
          <option value={p.name}>{p.name}</option>
        {/each}
      </select>
    </label>

    <a class="out" href={standaloneUrl} target="_blank" rel="noreferrer"
      title="Opens the standalone {def.name} in a new tab — a separate instance, so save a preset there to bring a sound back here">
      Full editor ↗
    </a>
    <button class="close" onclick={onclose} aria-label="Close editor">×</button>
  </header>

  {#if loading}
    <p class="note">Loading {def.name} controls…</p>
  {:else if !groups.length}
    <p class="note">
      {#if track.kind === 'synthex'}
        Synthex patches are edited on its own panel — pick a preset here, or
        <a href={standaloneUrl} target="_blank" rel="noreferrer">open the Synthex</a>.
      {:else}
        No controls found for {def.name}. Run <code>npm run sync-synth-data</code>.
      {/if}
    </p>
  {:else}
    {#if data?.params.some(p => p.perChannel)}
      <div class="channels">
        {#each DRUM_CHANNELS as name, i (name)}
          <button class:on={channel === i} onclick={() => (channel = i)}>
            {drumChannelName(i, track.params)}
          </button>
        {/each}
      </div>
    {/if}

    <div class="groups">
      {#each groups as g (g.title)}
        <section class="group">
          <h4>{g.title}</h4>
          {#each g.params as p (p.param)}
            <div class="row">
              <label for="p-{track.id}-{p.param}">{p.label}</label>

              {#if p.type === 'range'}
                <input
                  id="p-{track.id}-{p.param}"
                  type="range"
                  min={p.min} max={p.max} step={p.step}
                  value={posOf(p)}
                  oninput={(e) => {
                    const pos = Number((e.target as HTMLInputElement).value)
                    positions[nameOf(p)] = pos
                    track.setParam(nameOf(p), engineValue(p, pos))
                  }}
                />
                <span class="val">{formatValue(p, Number(engineOf(p)))}</span>
              {:else if p.type === 'select'}
                <select
                  id="p-{track.id}-{p.param}"
                  value={String(engineOf(p))}
                  onchange={(e) => track.setParam(nameOf(p), Number((e.target as HTMLSelectElement).value))}
                >
                  {#each p.options ?? [] as o (o.value)}
                    <option value={o.value}>{o.label}</option>
                  {/each}
                </select>
              {:else}
                <input
                  id="p-{track.id}-{p.param}"
                  type="checkbox"
                  checked={engineOf(p) === true}
                  onchange={(e) => track.setParam(nameOf(p), (e.target as HTMLInputElement).checked)}
                />
              {/if}
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The editor is the machine pulled forward out of the rack, so it wears the
     instrument's own faceplate rather than the rack's neutral grey. */
  .editor {
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 3px solid var(--accent);
    border-radius: 4px;
    background: #16161a;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.55);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.6rem;
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--chassis) 100%, #fff 8%), var(--chassis));
    border-bottom: 1px solid rgba(0, 0, 0, 0.5);
  }
  .who { display: flex; align-items: baseline; gap: 0.5rem; min-width: 0; }
  .badge {
    font-size: 0.5rem;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink);
    opacity: 0.7;
  }
  h3 {
    margin: 0;
    font-size: 0.82rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
  }
  .preset-name {
    font-size: 0.62rem;
    color: var(--ink);
    opacity: 0.75;
    font-family: 'Share Tech Mono', monospace;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
    font-size: 0.52rem;
    letter-spacing: 0.18em;
    color: var(--ink);
    opacity: 0.85;
  }
  .pick select {
    background: rgba(0, 0, 0, 0.28);
    color: var(--ink);
    border: 1px solid rgba(0, 0, 0, 0.4);
    border-radius: 2px;
    padding: 0.15rem 0.3rem;
    font-family: inherit;
    font-size: 0.68rem;
    max-width: 13rem;
    cursor: pointer;
  }

  .out {
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    color: var(--ink);
    text-decoration: none;
    border: 1px solid rgba(0, 0, 0, 0.4);
    background: rgba(0, 0, 0, 0.18);
    border-radius: 2px;
    padding: 0.18rem 0.4rem;
    white-space: nowrap;
  }
  .out:hover { border-color: var(--accent); }
  .close {
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid rgba(0, 0, 0, 0.4);
    color: var(--ink);
    border-radius: 2px;
    width: 1.4rem;
    height: 1.4rem;
    line-height: 1;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .note { color: #8a8a93; font-size: 0.72rem; padding: 0.9rem; margin: 0; }
  .note a, code { color: var(--accent); }

  /* Drum voices: pick which one the controls below are editing. */
  .channels {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
    padding: 0.5rem 0.6rem 0;
  }
  .channels button {
    background: #1e1e24;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #8a8a93;
    border-radius: 2px;
    padding: 0.2rem 0.5rem;
    font-family: inherit;
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .channels button.on { background: var(--accent); border-color: var(--accent); color: #101013; font-weight: 700; }

  /* Panels in the same order as the standalone page, flowing into columns. */
  .groups {
    columns: 4 15rem;
    column-gap: 0.9rem;
    padding: 0.6rem;
  }
  .group {
    break-inside: avoid;
    margin-bottom: 0.7rem;
    background: #1b1b20;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 3px;
    padding: 0.4rem 0.5rem 0.5rem;
  }
  h4 {
    margin: 0 0 0.35rem;
    font-size: 0.56rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 0.2rem;
  }
  .row {
    display: grid;
    grid-template-columns: 4.6rem 1fr 2.4rem;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 2px;
  }
  .row label {
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    color: #9a9aa4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Ranges are replaced elements with an intrinsic width; without this the
     grid column refuses to shrink and the value read-out is pushed out. */
  .row input[type="range"] { width: 100%; min-width: 0; accent-color: var(--accent); }
  .row select {
    grid-column: 2 / -1;
    min-width: 0;
    background: #101014;
    color: #d8d8de;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 1px 3px;
    font-family: inherit;
    font-size: 0.6rem;
    cursor: pointer;
  }
  .row input[type="checkbox"] { justify-self: start; accent-color: var(--accent); }
  .val {
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.58rem;
    color: var(--accent);
    text-align: right;
  }
</style>
