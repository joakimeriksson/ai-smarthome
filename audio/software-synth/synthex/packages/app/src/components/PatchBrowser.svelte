<script lang="ts">
  import { PRESETS, MEMORIES, type FactorySlot, type MemorySlot, type Patch } from '@synthex/engine'
  import { listPatches, savePatch, deletePatch, type SavedPatch } from '../lib/persistence'

  interface Props {
    currentName: string
    onload: (p: Patch, key: string) => void
  }
  let { currentName, onload }: Props = $props()

  let userPatches = $state<SavedPatch[]>([])
  let saveName = $state('')
  $effect(() => { if (!saveName) saveName = currentName })
  let mode = $state<'presets' | 'memories' | 'user'>('presets')
  let getPatch: (() => Patch) | null = null

  const playableMemories = MEMORIES.filter((m): m is MemorySlot & { patch: Patch } => !!m.patch)

  export function bindPatchSource(fn: () => Patch): void {
    getPatch = fn
  }

  async function refreshUser() { userPatches = await listPatches() }
  refreshUser()

  function loadFactory(slot: FactorySlot) { onload(slot.patch, `factory:${slot.address}`) }
  function loadMemory(slot: MemorySlot & { patch: Patch }) { onload(slot.patch, `memory:${slot.address}`) }
  function loadUser(p: SavedPatch) { onload(p.patch, `user:${p.name}`) }

  async function save() {
    if (!getPatch || !saveName.trim()) return
    await savePatch(saveName.trim(), getPatch())
    await refreshUser()
  }
  async function del(name: string) { await deletePatch(name); await refreshUser() }

  // Format the 2-digit address as "B-P" (bank-program) like the manual.
  function fmtAddr(addr: number): string {
    return `${Math.floor(addr / 10)}–${addr % 10}`
  }
</script>

<div class="browser">
  <div class="head">
    <div class="hdr-strip">
      <span class="rule"></span>
      <span class="hdr-title">Patches</span>
      <span class="rule"></span>
    </div>
    <div class="now-playing">
      <div class="np-row">
        <span class="np-marker"></span>
        <span class="np-name">{currentName}</span>
      </div>
    </div>
    <div class="tabs">
      <button class:active={mode === 'presets'} onclick={() => mode = 'presets'}>ROM</button>
      <button class:active={mode === 'memories'} onclick={() => mode = 'memories'}>Cassette</button>
      <button class:active={mode === 'user'} onclick={() => mode = 'user'}>User</button>
    </div>
  </div>

  {#if mode === 'presets'}
    <ul class="list">
      {#each PRESETS as slot (slot.address)}
        <li>
          <button onclick={() => loadFactory(slot)}>
            <span class="addr">{fmtAddr(slot.address)}</span>
            <span class="name">{slot.patch.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if mode === 'memories'}
    <ul class="list">
      {#each playableMemories as slot (slot.address)}
        <li>
          <button onclick={() => loadMemory(slot)}>
            <span class="addr">{fmtAddr(slot.address)}</span>
            <span class="name">{slot.name}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="save">
      <input type="text" bind:value={saveName} placeholder="Patch name" />
      <button class="save-btn" onclick={save}>Save</button>
    </div>
    <ul class="list">
      {#each userPatches as p (p.name)}
        <li>
          <button onclick={() => loadUser(p)}>
            <span class="addr">●</span>
            <span class="name">{p.name}</span>
          </button>
          <button class="del" onclick={() => del(p.name)} aria-label="Delete">×</button>
        </li>
      {/each}
      {#if userPatches.length === 0}
        <li class="empty">No saved patches yet.</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .browser {
    background:
      linear-gradient(180deg, var(--cream-light) 0%, var(--cream) 30%, var(--cream-deep) 100%);
    border: 1px solid rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    width: 240px;
    display: flex;
    flex-direction: column;
    max-height: 100%;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.08),
      0 1px 1px rgba(0, 0, 0, 0.18);
  }
  .head {
    padding: 0 0 0.5rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.15);
  }
  .hdr-strip {
    background: var(--orange);
    color: var(--cream-light);
    padding: 0.18rem 0.55rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.25);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18);
  }
  .hdr-strip .rule { flex: 1; height: 1px; background: rgba(255, 255, 255, 0.4); }
  .hdr-title {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 800;
    font-size: 0.7rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.25);
  }
  .now-playing {
    margin: 0.55rem 0.6rem 0.4rem;
    background: #1a0606;
    border: 1px solid #3a0a05;
    border-radius: 2px;
    padding: 0.35rem 0.5rem;
    box-shadow:
      inset 0 0 8px rgba(0, 0, 0, 0.7),
      inset 0 0 14px rgba(255, 40, 24, 0.1);
  }
  .np-row { display: flex; align-items: center; gap: 0.4rem; }
  .np-marker {
    width: 6px; height: 6px; border-radius: 50%;
    background: radial-gradient(circle at 30% 25%, #ffe9b0 0%, var(--led) 35%, #b01608 100%);
    box-shadow: 0 0 5px var(--led-glow);
    flex: 0 0 auto;
  }
  .np-name {
    font-family: 'DSEG7 Classic', 'Share Tech Mono', monospace;
    color: var(--led);
    font-size: 0.85rem;
    text-shadow: 0 0 4px var(--led-glow);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tabs {
    display: flex;
    gap: 0;
    margin: 0 0.5rem;
    background: linear-gradient(180deg, #5e5645, #2a241c);
    padding: 3px;
    border-radius: 3px;
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.55),
      0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .tabs button {
    flex: 1;
    background: linear-gradient(180deg, #f5efdc 0%, #d8ceb2 60%, #b3a786 100%);
    color: var(--ink);
    border: 0;
    padding: 0.3rem 0;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.65rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
    border-radius: 2px;
    margin-right: 2px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  }
  .tabs button:last-child { margin-right: 0; }
  .tabs button.active {
    background: linear-gradient(180deg, #c95820 0%, #ee6e2a 60%, #c7501a 100%);
    color: #fff5e0;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.35);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    transform: translateY(1px);
  }

  .save {
    padding: 0.5rem;
    display: flex;
    gap: 0.35rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  }
  .save input {
    flex: 1;
    background: #fbf6e7;
    border: 1px solid rgba(0, 0, 0, 0.25);
    color: var(--ink);
    padding: 0.28rem 0.45rem;
    border-radius: 2px;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.78rem;
  }
  .save-btn {
    background: linear-gradient(180deg, #c95820 0%, #ee6e2a 60%, #c7501a 100%);
    color: #fff5e0;
    border: 0;
    padding: 0 0.7rem;
    border-radius: 2px;
    cursor: pointer;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0.3rem 0.4rem;
    overflow-y: auto;
    max-height: 360px;
    /* "tractor-feed" stripes echo a pre-printed preset card */
    background:
      repeating-linear-gradient(
        180deg,
        transparent 0,
        transparent 22px,
        rgba(0, 0, 0, 0.025) 22px,
        rgba(0, 0, 0, 0.025) 44px
      );
  }
  .list::-webkit-scrollbar { width: 8px; }
  .list::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.25);
    border-radius: 4px;
  }
  .list li {
    display: flex;
    align-items: stretch;
  }
  .list li.empty {
    color: var(--ink-soft);
    padding: 0.5rem;
    font-size: 0.78rem;
    font-family: 'Saira Condensed', sans-serif;
    font-style: italic;
  }
  .list button {
    flex: 1;
    background: transparent;
    color: var(--ink);
    border: 0;
    padding: 0.32rem 0.5rem;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.82rem;
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    border-radius: 2px;
  }
  .list button:hover {
    background: rgba(214, 90, 28, 0.12);
    color: var(--orange-dark);
  }
  .list .addr {
    color: var(--orange);
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.78rem;
    min-width: 1.8rem;
    letter-spacing: 0.04em;
  }
  .list .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .list .del {
    flex: 0 0 auto;
    color: var(--ink-soft);
    padding: 0 0.5rem;
    font-size: 1.1rem;
    line-height: 1;
  }
  .list .del:hover { color: #d32; background: transparent; }
</style>
