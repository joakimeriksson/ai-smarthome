<script lang="ts">
  // Synthex program-selection section (row 2 center of the real panel):
  //   BANK 1-4 · PROGRAM 0-9 · MEMORY/PRESET/PANEL/WRITE · SPLIT/DOUBLE/LOWER/UPPER
  // Program buttons load factory slots directly: address = bank*10 + program,
  // from ROM PRESETS or cassette MEMORIES depending on the source group.
  import { PRESETS, MEMORIES, type Patch, type VoiceMode } from '@synthex/engine'

  interface Props {
    currentKey: string          // 'factory:46' | 'memory:23' | 'user:…' | '—'
    voiceMode: VoiceMode
    editLayer: 'upper' | 'lower'
    onload: (p: Patch, key: string) => void
    onvoicemode: (m: VoiceMode) => void
    oneditlayer: (l: 'upper' | 'lower') => void
    onwrite: () => void
  }
  let { currentKey, voiceMode, editLayer, onload, onvoicemode, oneditlayer, onwrite }: Props = $props()

  type Source = 'preset' | 'memory' | 'panel'

  const parsed = $derived.by(() => {
    const m = /^(factory|memory):(\d+)$/.exec(currentKey)
    if (!m) return null
    return { source: (m[1] === 'factory' ? 'preset' : 'memory') as Source, address: Number(m[2]) }
  })

  // Browsing bank can differ from the loaded slot's bank until a program is pressed.
  let bankSel = $state(4)   // startup patch is 46 → bank 4
  let sourceSel = $state<Source>('preset')
  let writeFlash = $state(false)

  const loadedBank = $derived(parsed ? Math.floor(parsed.address / 10) : 0)
  const loadedProg = $derived(parsed ? parsed.address % 10 : -1)

  function pressProgram(prog: number) {
    const address = bankSel * 10 + prog
    if (sourceSel === 'memory') {
      const slot = MEMORIES.find(s => s.address === address)
      if (slot?.patch) onload(slot.patch, `memory:${address}`)
    } else {
      const slot = PRESETS.find(s => s.address === address)
      if (slot) onload(slot.patch, `factory:${address}`)
    }
  }

  function pressWrite() {
    onwrite()
    writeFlash = true
    setTimeout(() => (writeFlash = false), 350)
  }
</script>

<div class="prog-panel">
  <!-- BANK -->
  <div class="group">
    <div class="caps">{#each [1, 2, 3, 4] as b (b)}<span class="cap">{b}</span>{/each}</div>
    <div class="strip">
      {#each [1, 2, 3, 4] as b (b)}
        <button class:lit={bankSel === b} onclick={() => (bankSel = b)} aria-label="Bank {b}">
          <span class="led-area"><span class="led"></span></span><span class="body"></span>
        </button>
      {/each}
    </div>
    <div class="rule-label"><span>Bank</span></div>
  </div>

  <!-- PROGRAM -->
  <div class="group">
    <div class="caps">{#each Array.from({ length: 10 }, (_, i) => i) as p (p)}<span class="cap">{p}</span>{/each}</div>
    <div class="strip">
      {#each Array.from({ length: 10 }, (_, i) => i) as p (p)}
        <button
          class:lit={sourceSel === (parsed?.source ?? '') && bankSel === loadedBank && loadedProg === p}
          onclick={() => pressProgram(p)}
          aria-label="Program {p}"
        >
          <span class="led-area"><span class="led"></span></span><span class="body"></span>
        </button>
      {/each}
    </div>
    <div class="rule-label"><span>Program</span></div>
  </div>

  <!-- MEMORY / PRESET / PANEL / WRITE -->
  <div class="group">
    <div class="caps">
      <span class="cap wide">Memory</span><span class="cap wide">Preset</span>
      <span class="cap wide">Panel</span><span class="cap wide">Write</span>
    </div>
    <div class="strip">
      <button class:lit={sourceSel === 'memory'} onclick={() => (sourceSel = 'memory')} aria-label="Memory bank">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={sourceSel === 'preset'} onclick={() => (sourceSel = 'preset')} aria-label="Preset bank">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={parsed === null} onclick={() => (sourceSel = 'panel')} aria-label="Panel mode">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={writeFlash} onclick={pressWrite} aria-label="Write patch">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
    </div>
    <div class="caps cassette">
      <span class="cap wide">Save</span><span class="cap wide">Save HG</span>
      <span class="cap wide">Verify</span><span class="cap wide">Load</span>
    </div>
    <div class="rule-label"><span>Cassette Interface</span></div>
  </div>

  <!-- SPLIT / DOUBLE / LOWER / UPPER -->
  <div class="group">
    <div class="caps">
      <span class="cap wide">Split</span><span class="cap wide">Double</span>
      <span class="cap wide">Lower</span><span class="cap wide">Upper</span>
    </div>
    <div class="strip">
      <button class:lit={voiceMode === 'split'}
        onclick={() => onvoicemode(voiceMode === 'split' ? 'single' : 'split')} aria-label="Split mode">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={voiceMode === 'double'}
        onclick={() => onvoicemode(voiceMode === 'double' ? 'single' : 'double')} aria-label="Double mode">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={editLayer === 'lower'} onclick={() => oneditlayer('lower')} aria-label="Edit lower layer">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
      <button class:lit={editLayer === 'upper'} onclick={() => oneditlayer('upper')} aria-label="Edit upper layer">
        <span class="led-area"><span class="led"></span></span><span class="body"></span>
      </button>
    </div>
    <div class="rule-label"><span>Keyboard Mode</span></div>
  </div>
</div>

<style>
  .prog-panel {
    display: flex;
    align-items: flex-start;
    justify-content: space-evenly;
    gap: 1rem;
    width: 100%;
    padding: 0.3rem 0.2rem 0.1rem;
  }
  .group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  .caps { display: flex; gap: 4px; }
  .cap {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink);
    text-align: center;
    width: 20px;
    line-height: 1;
    white-space: nowrap;
  }
  .cap.wide { width: 26px; font-size: 0.44rem; }
  .caps.cassette .cap { color: var(--ink-soft); font-size: 0.38rem; }

  .strip {
    display: flex;
    gap: 4px;
    background: #1a1816;
    padding: 4px;
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .strip button {
    width: 20px;
    display: flex;
    flex-direction: column;
    border: 0;
    padding: 0;
    cursor: pointer;
    border-radius: 1px;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 0 rgba(0, 0, 0, 0.15);
    transition: transform 60ms ease;
  }
  .group:nth-child(3) .strip button,
  .group:nth-child(4) .strip button { width: 26px; }
  .strip button:hover .body {
    background: linear-gradient(180deg, #f4f0e8 0%, #eae6de 100%);
  }
  .strip button.lit {
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
    transform: translateY(1px);
  }
  .led-area {
    display: flex; align-items: center; justify-content: center;
    padding: 3px 0;
    background: linear-gradient(180deg, #ccc8c0 0%, #d8d4cc 100%);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1);
  }
  .led {
    width: 6px; height: 6px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #6a2a10, #3a0a04 80%);
  }
  .strip button.lit .led {
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255, 40, 20, 0.6), 0 0 6px rgba(255, 40, 20, 0.3);
  }
  .body {
    padding: 5px 0;
    background: linear-gradient(180deg, #ede8e0 0%, #ddd8d0 100%);
  }

  .rule-label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
  }
  .rule-label::before, .rule-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.25);
  }
  .rule-label span {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #c8c0b4;
  }
</style>
