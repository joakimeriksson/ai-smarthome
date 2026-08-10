<script lang="ts">
  import { PRESETS, MEMORIES, type FactorySlot, type MemorySlot, type Patch } from '@synthex/engine'
  import { listPatches, savePatch, deletePatch, type SavedPatch } from '../lib/persistence'

  interface Props {
    currentName: string
    onload: (p: Patch, key: string) => void
  }
  let { currentName, onload }: Props = $props()

  let open = $state(false)
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

  function loadFactory(slot: FactorySlot) { onload(slot.patch, `factory:${slot.address}`); open = false }
  function loadMemory(slot: MemorySlot & { patch: Patch }) { onload(slot.patch, `memory:${slot.address}`); open = false }
  function loadUser(p: SavedPatch) { onload(p.patch, `user:${p.name}`); open = false }

  async function save() {
    if (!getPatch || !saveName.trim()) return
    await savePatch(saveName.trim(), getPatch())
    await refreshUser()
  }
  async function del(name: string) { await deletePatch(name); await refreshUser() }

  function fmtAddr(addr: number): string {
    return `${Math.floor(addr / 10)}–${addr % 10}`
  }

  function toggle() { open = !open; if (open) refreshUser() }
</script>

<div class="patch-picker">
  <button class="name-btn" onclick={toggle}>
    <span class="np-marker"></span>
    <span class="np-name">{currentName}</span>
    <span class="np-arrow">{open ? '▴' : '▾'}</span>
  </button>

  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => open = false}></div>
    <div class="dropdown">
      <div class="tabs">
        <button class:active={mode === 'presets'} onclick={() => mode = 'presets'}>ROM</button>
        <button class:active={mode === 'memories'} onclick={() => mode = 'memories'}>Cassette</button>
        <button class:active={mode === 'user'} onclick={() => mode = 'user'}>User</button>
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
  {/if}
</div>

<style>
  .patch-picker {
    position: relative;
  }

  .name-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #1a0606;
    border: 1px solid #3a0a05;
    border-radius: 2px;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    box-shadow:
      inset 0 0 8px rgba(0, 0, 0, 0.7),
      inset 0 0 14px rgba(255, 40, 24, 0.1);
    min-width: 12rem;
  }
  .name-btn:hover {
    border-color: #5a1a10;
  }
  .np-marker {
    width: 6px; height: 6px; border-radius: 50%;
    background: radial-gradient(circle at 30% 25%, #ffe9b0 0%, var(--led) 35%, #b01608 100%);
    box-shadow: 0 0 5px var(--led-glow);
    flex: 0 0 auto;
  }
  .np-name {
    font-family: 'Share Tech Mono', monospace;
    color: var(--led);
    font-size: 0.85rem;
    text-shadow: 0 0 4px var(--led-glow);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    text-align: left;
  }
  .np-arrow {
    color: var(--ink-soft);
    font-size: 0.7rem;
    flex: 0 0 auto;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    width: 280px;
    background: #282524;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 3px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    z-index: 100;
    display: flex;
    flex-direction: column;
  }

  .tabs {
    display: flex;
    gap: 0;
    padding: 4px;
    background: linear-gradient(180deg, #1a1816, #0e0c0a);
    border-radius: 3px 3px 0 0;
  }
  .tabs button {
    flex: 1;
    background: linear-gradient(180deg, var(--btn-hi) 0%, var(--btn-face) 40%, var(--btn-lo) 100%);
    color: #1a1410;
    border: 0;
    padding: 0.28rem 0;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
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
    background: linear-gradient(180deg, #8a8274 0%, #6a645a 40%, #504c44 100%);
    color: #ede4d2;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
  }

  .save {
    padding: 0.4rem;
    display: flex;
    gap: 0.3rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .save input {
    flex: 1;
    background: #1a1816;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--ink);
    padding: 0.24rem 0.4rem;
    border-radius: 2px;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.75rem;
  }
  .save-btn {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: #ede4d2;
    border: 0;
    padding: 0 0.6rem;
    border-radius: 2px;
    cursor: pointer;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0.2rem;
    overflow-y: auto;
    max-height: 320px;
  }
  .list::-webkit-scrollbar { width: 6px; }
  .list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }
  .list li {
    display: flex;
    align-items: stretch;
  }
  .list li.empty {
    color: var(--ink-soft);
    padding: 0.4rem;
    font-size: 0.75rem;
    font-family: 'Saira Condensed', sans-serif;
    font-style: italic;
  }
  .list button {
    flex: 1;
    background: transparent;
    color: var(--ink);
    border: 0;
    padding: 0.25rem 0.4rem;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.78rem;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    border-radius: 2px;
  }
  .list button:hover {
    background: rgba(214, 90, 28, 0.15);
    color: var(--orange-bright);
  }
  .list .addr {
    color: var(--orange);
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.72rem;
    min-width: 1.6rem;
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
    padding: 0 0.4rem;
    font-size: 1rem;
    line-height: 1;
  }
  .list .del:hover { color: #d32; background: transparent; }
</style>
