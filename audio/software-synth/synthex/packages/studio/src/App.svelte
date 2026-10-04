<script lang="ts">
  import { onMount } from 'svelte'
  import { Studio } from './lib/studio.svelte.ts'
  import { INSTRUMENTS, type InstrumentKind } from './lib/instruments.ts'
  import { ComputerKeys } from './lib/keys.ts'
  import {
    snapshot, restore, saveProject, listProjects, loadProject, deleteProject, exportJson,
    type Project,
  } from './lib/project.ts'
  import { demoProject } from './lib/demo.ts'
  import { DEMOS } from './lib/demos.ts'
  import { SCALE_LABELS, NOTE_NAMES, type ScaleName } from './lib/generate.ts'
  import MixerStrip from './components/MixerStrip.svelte'
  import BusStrip from './components/BusStrip.svelte'
  import FxEditor from './components/FxEditor.svelte'
  import StepGrid from './components/StepGrid.svelte'
  import InstrumentEditor from './components/InstrumentEditor.svelte'
  import type { FxChain } from './lib/mixer.svelte.ts'
  import { FX_DEFS, FX_FAMILIES, SCATTER_PADS, type FxKind } from './lib/fx.ts'

  const studio = new Studio()

  // Sibling apps under a shared static root in a deploy; dev ports otherwise.
  const synthexUrl = import.meta.env['VITE_SYNTHEX_URL']
    ?? (import.meta.env.DEV ? 'http://localhost:5173/' : '../synthex/')
  const pagesUrl = import.meta.env['VITE_PAGES_URL']
    ?? (import.meta.env.DEV ? 'http://localhost:8123/' : '../')
  let meters = $state<Record<number, number>>({})
  let busMeters = $state<Record<string, number>>({})
  let masterMeter = $state(0)
  let octave = $state(4)
  let projectName = $state('Untitled')
  let savedProjects = $state<string[]>([])
  let statusMsg = $state('')
  let raf = 0
  let detachKeys: (() => void) | null = null

  const keys = new ComputerKeys({
    noteOn: (n, v) => studio.noteOn(n, v),
    noteOff: (n) => studio.noteOff(n),
    onOctave: (o) => octave = o,
    onTransport: () => studio.toggle(),
    onPad: (pad, down) => padKey(pad, down),
  })

  // Scatter pads: hold one and its pattern takes over the whole mix; with
  // LATCH a press toggles instead. Shift+1-8 plays them from the keyboard.
  let latch = $state(false)
  function padDown(name: string) {
    if (latch && studio.scatterHeld === name) studio.scatterOff()
    else studio.scatterOn(name)
  }
  function padUp() { if (!latch) studio.scatterOff() }
  function padKey(pad: number, down: boolean) {
    const name = SCATTER_PADS[pad]
    if (!name) return
    if (down) padDown(name); else if (studio.scatterHeld === name) padUp()
  }
  /** Open the pads' Scatter (on the master bus) in the effect editor. */
  function editScatter() {
    const slot = studio.masterScatter()
    if (slot && studio.master) openFx(studio.master.chain, slot.id, 'Master')
  }

  onMount(() => {
    void boot()
    detachKeys = keys.attach(window)
    const tick = () => {
      const next: Record<number, number> = {}
      for (const t of studio.tracks) next[t.id] = t.meter()
      meters = next
      const buses: Record<string, number> = {}
      for (const b of studio.buses) buses[b.id] = b.meter()
      busMeters = buses
      masterMeter = studio.masterMeter()
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(raf); detachKeys?.() }
  })

  async function boot() {
    await studio.init()
    // Load the demo song so the studio makes music immediately — an empty
    // grid asks the player for work before it has earned any interest.
    const demo = demoProject()
    await restore(studio, demo)
    projectName = demo.name
    savedProjects = await listProjects()
  }

  // The effect open in the effect editor: its chain, slot, and a label for
  // where it sits.
  let fxSel = $state<{ chain: FxChain; slotId: string; where: string } | null>(null)
  // Close it when its chain goes away (track removed, project loaded).
  const fxOpen = $derived(fxSel && fxSel.chain.slots.some(s => s.id === fxSel!.slotId) ? fxSel : null)
  const selectedIn = (chain: FxChain) => (fxOpen?.chain === chain ? fxOpen.slotId : null)
  function openFx(chain: FxChain, slotId: string, owner: string) {
    const n = chain.slots.findIndex(s => s.id === slotId) + 1
    fxSel = { chain, slotId, where: `${owner} · slot ${n}` }
  }

  function addReturn(e: Event) {
    const el = e.target as HTMLSelectElement
    const kind = el.value as FxKind
    el.value = ''
    if (!kind) return
    const bus = studio.addReturn(kind)
    if (bus?.chain.slots[0]) openFx(bus.chain, bus.chain.slots[0].id, `Return ${bus.id}`)
  }

  // Which track's sound editor is open, if any.
  let editingId = $state<number | null>(null)
  const editingTrack = $derived(studio.tracks.find(t => t.id === editingId) ?? null)

  function toggleEdit(id: number) {
    editingId = editingId === id ? null : id
    // Editing a sound means listening to it, so bring the keyboard along.
    if (editingId !== null) studio.focused = id
  }

  /** A drum bank entry is a rhythm — load it into the focused track's grid. */
  function loadPattern(pattern: number[][]) {
    const t = editingTrack
    if (!t) return
    t.drumGrid = t.drumGrid.map((row, ch) =>
      row.map((v, i) => pattern[ch]?.[i] ?? v))
    touchPatterns()
  }

  let rollingAll = $state(false)
  function rollAll() {
    studio.rollAll()
    rollingAll = true
    setTimeout(() => (rollingAll = false), 300)
  }

  function flash(msg: string) {
    statusMsg = msg
    setTimeout(() => { if (statusMsg === msg) statusMsg = '' }, 2000)
  }

  async function doSave() {
    const p = snapshot(studio, projectName.trim() || 'Untitled')
    await saveProject(p)
    savedProjects = await listProjects()
    flash(`Saved "${p.name}"`)
  }

  async function doLoad(name: string) {
    const demo = name.startsWith('demo:') ? DEMOS.find(d => 'demo:' + d.id === name) : null
    const p = demo ? demo.build() : await loadProject(name)
    if (!p) return
    await restore(studio, p as Project)
    projectName = p.name
    flash(`Loaded "${p.name}"`)
  }

  async function doDelete(name: string) {
    await deleteProject(name)
    savedProjects = await listProjects()
    flash(`Deleted "${name}"`)
  }

  function touchPatterns() { studio.tracks = [...studio.tracks] }
</script>

<svelte:window onpointerdown={() => studio.resume()} />

<div class="app">
  <header>
    <div class="brand">
      <h1>STUDIO</h1>
      <span class="tag">Software Synth Workstation</span>
    </div>

    <div class="transport">
      <button class="play" class:on={studio.playing} onclick={() => studio.toggle()}>
        {studio.playing ? '■ STOP' : '▶ PLAY'}
      </button>
      <label class="num">
        BPM
        <input type="number" min="40" max="240" value={studio.bpm}
          oninput={(e) => studio.setBpm(Number((e.target as HTMLInputElement).value))} />
      </label>
      <label class="num">
        SWING
        <input type="range" min="0" max="0.7" step="0.01" value={studio.swing}
          oninput={(e) => studio.setSwing(Number((e.target as HTMLInputElement).value))} />
      </label>
      <div class="steps">
        {#each Array(16) as _, i (i)}
          <span class="dot" class:beat={i % 4 === 0}
            class:on={studio.playing && i === studio.step % 16}></span>
        {/each}
        {#if studio.songLength() > 16}
          <span class="bar-count">{Math.floor(studio.step / 16) + 1}/{studio.songLength() / 16}</span>
        {/if}
      </div>

      <button class="roll" class:rolling={rollingAll} onclick={rollAll}
        title="Roll new patterns for every track">⚄ ROLL ALL</button>

      <label class="num">
        KEY
        <select value={studio.rootPc}
          onchange={(e) => studio.rootPc = Number((e.target as HTMLSelectElement).value)}>
          {#each NOTE_NAMES as n, i (n)}<option value={i}>{n}</option>{/each}
        </select>
      </label>
      <label class="num">
        SCALE
        <select value={studio.scaleName}
          onchange={(e) => studio.scaleName = (e.target as HTMLSelectElement).value as ScaleName}>
          {#each Object.entries(SCALE_LABELS) as [k, label] (k)}<option value={k}>{label}</option>{/each}
        </select>
      </label>
    </div>

    <div class="project">
      <input class="pname" type="text" bind:value={projectName} aria-label="Project name" />
      <button onclick={doSave}>SAVE</button>
      <button onclick={() => exportJson(snapshot(studio, projectName))}>EXPORT</button>
      <select onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) void doLoad(v) }}>
        <option value="">— open —</option>
        <optgroup label="Demos">
          {#each DEMOS as d (d.id)}<option value={'demo:' + d.id}>{d.build().name.replace(/^Demo — /, '')}</option>{/each}
        </optgroup>
        {#if savedProjects.length}
          <optgroup label="Saved">
            {#each savedProjects as name (name)}<option value={name}>{name}</option>{/each}
          </optgroup>
        {/if}
      </select>
      {#if savedProjects.includes(projectName)}
        <button class="del" onclick={() => doDelete(projectName)}>DEL</button>
      {/if}
    </div>
  </header>

  <section class="scatter" aria-label="Scatter pads">
    <span class="sc-title">SCATTER</span>
    {#each SCATTER_PADS as name, i (name)}
      <button class="pad" class:on={studio.scatterHeld === name}
        title="Hold to scatter the mix: {name} (Shift+{i + 1})"
        onpointerdown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); padDown(name) }}
        onpointerup={padUp} onpointercancel={padUp}>
        <small>{i + 1}</small>{name}
      </button>
    {/each}
    <button class="sc-tool" class:on={latch} onclick={() => { latch = !latch; if (!latch) studio.scatterOff() }}
      title="Latch: a press switches a pad on until it is pressed again">LATCH</button>
    <button class="sc-tool" onclick={editScatter} title="Edit the pads' Scatter (on the master bus)">EDIT</button>
  </section>

  {#if studio.error}
    <p class="error">{studio.error}</p>
  {/if}
  {#if statusMsg}
    <p class="status">{statusMsg}</p>
  {/if}

  <section class="desk">
    <div class="mixer">
      {#each studio.tracks as track (track.id)}
        <MixerStrip
          track={track}
          focused={studio.focused === track.id}
          meter={meters[track.id] ?? 0}
          onfocus={() => studio.focused = track.id}
          onchange={() => studio.applyMix()}
          onremove={() => studio.removeTrack(track.id)}
          onroll={() => studio.rollTrack(track.id)}
          onswap={(kind: InstrumentKind) => studio.swapInstrument(track.id, kind)}
          onedit={() => toggleEdit(track.id)}
          editing={editingId === track.id}
          buses={studio.buses}
          selectedFx={selectedIn(track.chain)}
          onfx={(slotId: string) => openFx(track.chain, slotId, track.name)}
        />
      {/each}

      <div class="add">
        <span class="add-title">ADD</span>
        {#each INSTRUMENTS as inst (inst.kind)}
          <button style="--chassis:{inst.chassis}; --ink:{inst.ink}; --accent:{inst.accent}"
            title="Add a {inst.subtitle} track"
            onclick={() => studio.addTrack(inst.kind as InstrumentKind)}>
            {inst.name}<small>{inst.subtitle}</small>
          </button>
        {/each}
        <span class="add-title return-title">RETURN</span>
        <select class="add-return" value="" aria-label="Add a return bus" onchange={addReturn}>
          <option value="">+ return bus…</option>
          {#each FX_FAMILIES as f (f.family)}
            <optgroup label={f.label}>
              {#each FX_DEFS.filter(d => d.family === f.family) as d (d.kind)}<option value={d.kind}>{d.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </div>

      <!-- Blank rack panel: honest furniture for the unused bay space. -->
      <div class="blank" aria-hidden="true"></div>

      <!-- Returns: one reverb or echo shared by every track that sends to it. -->
      {#each studio.buses as bus (bus.id)}
        <BusStrip
          bus={bus}
          meter={busMeters[bus.id] ?? 0}
          selectedFx={selectedIn(bus.chain)}
          onfx={(slotId: string) => openFx(bus.chain, slotId, `Return ${bus.id}`)}
          onchange={() => studio.applyMix()}
          onremove={() => studio.removeReturn(bus.id)}
        />
      {/each}

      {#if studio.master}
        <BusStrip
          bus={studio.master}
          meter={masterMeter}
          selectedFx={selectedIn(studio.master.chain)}
          onfx={(slotId: string) => openFx(studio.master!.chain, slotId, 'Master')}
          onchange={() => studio.applyMix()}
        />
      {/if}

    </div>
  </section>

  {#if fxOpen}
    <section class="editor-bay">
      <FxEditor chain={fxOpen.chain} slotId={fxOpen.slotId} where={fxOpen.where} onclose={() => (fxSel = null)}
        step={studio.stepIndex} playing={studio.playing} />
    </section>
  {/if}

  {#if editingTrack}
    <section class="editor-bay">
      <InstrumentEditor
        track={editingTrack}
        onclose={() => (editingId = null)}
        onpattern={loadPattern}
      />
    </section>
  {/if}

  <section class="pattern">
    <div class="pattern-head">
      <h2>PATTERN — {studio.focusedTrack()?.name ?? 'no track'}</h2>
      {#if studio.focusedTrack() && !studio.focusedTrack()!.isPercussion}
        <label class="inline">
          GATE
          <input type="range" min="0.1" max="1" step="0.05"
            value={studio.focusedTrack()!.gate}
            oninput={(e) => { studio.focusedTrack()!.gate = Number((e.target as HTMLInputElement).value); touchPatterns() }} />
        </label>
        <label class="inline">
          TRANSPOSE
          <input type="number" min="-24" max="24" step="1"
            value={studio.focusedTrack()!.transpose}
            oninput={(e) => { studio.focusedTrack()!.transpose = Number((e.target as HTMLInputElement).value); touchPatterns() }} />
        </label>
      {/if}
      <button class="clear" onclick={() => studio.clearPatterns()}>CLEAR ALL</button>
    </div>

    <StepGrid
      track={studio.focusedTrack()}
      currentStep={studio.step}
      playing={studio.playing}
      onchange={touchPatterns}
    />
  </section>

  <footer>
    <span>Keys <kbd>Z</kbd>/<kbd>Q</kbd> rows play the focused track · <kbd>−</kbd>/<kbd>=</kbd> octave ({octave}) · <kbd>Space</kbd> transport</span>
    <span class="links">
      Standalone: <a href={synthexUrl} target="_blank" rel="noreferrer">Synthex</a>
      · <a href={pagesUrl} target="_blank" rel="noreferrer">synth pages</a>
    </span>
  </footer>
</div>

<style>
  :global(:root) {
    /* The rack is furniture: warm dark steel, deliberately without a hue of
       its own. Every colour on this page belongs to one of the machines
       mounted in it — that is what makes six instruments legible at a glance
       instead of six tinted copies of one. */
    --bg: #17171a;
    --rail: #101013;
    --panel: #1d1d22;
    --ink: #e9e7e2;
    --dim: #8a8a93;
    --lamp: #fff4e0;          /* the rack's own indicator: warm white */
  }
  :global(html, body) {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: 'Saira Condensed', system-ui, sans-serif;
  }
  /* Brushed-steel grain, and the rack rails the modules bolt into. */
  :global(body) {
    background-image:
      repeating-linear-gradient(90deg,
        rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 3px),
      linear-gradient(180deg, #1b1b1f, #131316);
    background-attachment: fixed;
  }
  :global(*, *::before, *::after) { box-sizing: border-box; }

  .app { padding: 0.9rem 1.1rem 1.4rem; display: flex; flex-direction: column; gap: 0.8rem; }

  header {
    display: flex;
    align-items: center;
    gap: 1.4rem;
    flex-wrap: wrap;
    padding-bottom: 0.7rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .brand { display: flex; flex-direction: column; }
  h1 { margin: 0; font-size: 1.3rem; letter-spacing: 0.3em; }
  .tag { font-size: 0.6rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); }

  .transport { display: flex; align-items: center; gap: 0.9rem; }
  .play {
    background: #1c1c22; color: var(--ink); border: 1px solid rgba(255,255,255,0.15);
    padding: 0.4rem 1rem; border-radius: 3px; cursor: pointer;
    font-family: inherit; font-weight: 700; letter-spacing: 0.14em;
  }
  .play.on { background: var(--lamp); color: #101013; border-color: var(--lamp); box-shadow: 0 0 12px -2px var(--lamp); }
  .num { display: flex; align-items: center; gap: 0.35rem; font-size: 0.62rem; letter-spacing: 0.14em; color: var(--dim); }
  .num input[type="number"] {
    width: 3.6rem; background: #0a0a0c; border: 1px solid rgba(255,255,255,0.12);
    color: var(--ink); padding: 0.2rem 0.35rem; border-radius: 2px;
    font-family: 'Share Tech Mono', monospace;
  }
  .steps { display: flex; gap: 3px; align-items: center; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #26262e; }
  .dot.beat { background: #34343f; }
  .dot.on { background: var(--lamp); box-shadow: 0 0 7px var(--lamp); }
  .bar-count {
    margin-left: 6px; font-family: 'Share Tech Mono', monospace; font-size: 0.7rem;
    color: var(--ink); opacity: 0.7; min-width: 2.2em;
  }

  .roll {
    background: #1c1c22;
    color: var(--ink);
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 0.3rem 0.6rem;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 700;
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    white-space: nowrap;
  }
  .roll:hover { border-color: var(--lamp); color: var(--lamp); }
  .roll.rolling {
    background: var(--lamp);
    color: #101013;
    border-color: var(--lamp);
    animation: roll-all 300ms ease-out;
  }
  @keyframes roll-all {
    from { transform: rotate(-180deg) scale(0.85); }
    to   { transform: rotate(0) scale(1); }
  }
  .num select {
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--ink);
    padding: 0.18rem 0.3rem;
    border-radius: 2px;
    font-family: inherit;
    font-size: 0.68rem;
    cursor: pointer;
  }

  .project { display: flex; align-items: center; gap: 0.35rem; margin-left: auto; }
  .pname {
    width: 9rem; background: #0a0a0c; border: 1px solid rgba(255,255,255,0.12);
    color: var(--ink); padding: 0.25rem 0.4rem; border-radius: 2px; font-family: inherit;
  }
  .project button, .project select {
    background: #1c1c22; color: var(--ink); border: 1px solid rgba(255,255,255,0.12);
    padding: 0.25rem 0.5rem; border-radius: 2px; cursor: pointer;
    font-family: inherit; font-size: 0.62rem; letter-spacing: 0.12em;
  }
  .project button:hover { background: #26262e; }
  .project .del:hover { background: #ff4444; color: #fff; }

  .error { color: #ff8a70; background: #2a1410; border: 1px solid #5a2820; padding: 0.5rem 0.7rem; border-radius: 3px; margin: 0; font-size: 0.8rem; }
  .status { color: var(--lamp); margin: 0; font-size: 0.75rem; letter-spacing: 0.1em; }

  /* A rack bay: modules bolted to rails at both ends. */
  .mixer {
    display: flex;
    gap: 0.4rem;
    align-items: stretch;
    overflow-x: auto;
    padding: 0.5rem 0.65rem;
    background: linear-gradient(180deg, #131316, #0f0f12);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.6);
  }
  .desk { position: relative; }
  .desk::before,
  .desk::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 9px;
    background:
      repeating-linear-gradient(180deg,
        transparent 0 8px,
        rgba(0, 0, 0, 0.55) 8px 12px,
        transparent 12px 26px),
      linear-gradient(90deg, #2a2a30, #1b1b20);
    border-radius: 3px;
    pointer-events: none;
  }
  .desk::before { left: 0; }
  .desk::after { right: 0; }
  .mixer { margin-inline: 11px; }

  /* Master is the end of the signal path, so it sits at the end of the rack,
     with a blanking panel spanning whatever bay space is left over. */
  .blank {
    flex: 1;
    min-width: 0;
    border-radius: 3px;
    background:
      repeating-linear-gradient(180deg,
        rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 4px),
      linear-gradient(180deg, #1c1c21, #16161b);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  /* The scatter pads: a groovebox's row of rubber pads, lit while held. */
  .scatter {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin: 0.55rem 11px 0;
  }
  .sc-title { font-size: 0.56rem; letter-spacing: 0.24em; color: var(--dim); margin-right: 0.3rem; }
  .pad {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    padding: 0.36rem 0.6rem 0.34rem;
    background: linear-gradient(180deg, #2a282d, #1d1b1f);
    border: 1px solid rgba(0, 0, 0, 0.6);
    border-bottom-width: 3px;
    border-radius: 3px;
    color: #cfc8cb;
    font-family: inherit;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .pad small { font-family: 'Share Tech Mono', monospace; font-size: 0.56rem; color: #ff4d5e; }
  .pad:hover { color: #fff; border-color: rgba(255, 77, 94, 0.5); }
  .pad.on {
    background: #ff4d5e;
    border-color: #ff4d5e;
    border-bottom-width: 1px;
    margin-top: 2px;
    color: #14090b;
    box-shadow: 0 0 14px -2px #ff4d5e;
  }
  .pad.on small { color: #14090b; }
  .sc-tool {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 2px;
    color: var(--dim);
    font-family: inherit;
    font-size: 0.54rem;
    letter-spacing: 0.16em;
    padding: 0.25rem 0.45rem;
    cursor: pointer;
  }
  .sc-tool:hover { color: var(--ink); }
  .sc-tool.on { background: #ff4d5e; border-color: #ff4d5e; color: #14090b; }

  .return-title { margin-top: 0.4rem; }
  .add-return {
    background: rgba(0, 0, 0, 0.3);
    border: 1px dashed rgba(255, 255, 255, 0.16);
    border-radius: 2px;
    color: #8b8b96;
    font-family: inherit;
    font-size: 0.56rem;
    padding: 0.2rem;
    cursor: pointer;
  }
  .add-return:hover { color: var(--ink); border-color: rgba(255, 255, 255, 0.32); }

  /* Adding a track is choosing a machine, so the buttons are miniature
     faceplates in each instrument's own material — the same swatch you will
     see on the strip once it is racked. */
  .add {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 118px;
    padding: 0.4rem;
    background: rgba(0, 0, 0, 0.25);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 3px;
  }
  .add-title { font-size: 0.52rem; letter-spacing: 0.22em; color: var(--dim); margin-bottom: 0.1rem; }
  .add button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: linear-gradient(180deg,
      color-mix(in srgb, var(--chassis) 100%, #fff 8%), var(--chassis));
    border: 1px solid rgba(0, 0, 0, 0.5);
    color: var(--ink);
    padding: 0.2rem 0.4rem;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.12);
  }
  .add button:hover { box-shadow: 0 0 0 1px var(--accent); }
  .add button small {
    color: color-mix(in srgb, var(--ink) 62%, transparent);
    font-size: 0.48rem;
    font-weight: 400;
    letter-spacing: 0.05em;
    text-shadow: none;
  }

  .editor-bay { margin-inline: 11px; }

  .pattern { background: var(--panel); border: 1px solid rgba(255,255,255,0.07); border-radius: 4px; padding: 0.7rem 0.9rem 0.9rem; }
  .pattern-head { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 0.72rem; letter-spacing: 0.2em; color: var(--ink); }
  .inline { display: flex; align-items: center; gap: 0.3rem; font-size: 0.58rem; letter-spacing: 0.12em; color: var(--dim); }
  .inline input[type="number"] { width: 3rem; background: #0a0a0c; border: 1px solid rgba(255,255,255,0.12); color: var(--ink); border-radius: 2px; padding: 0.15rem 0.3rem; font-family: 'Share Tech Mono', monospace; }
  .clear { margin-left: auto; background: #1c1c22; border: 1px solid rgba(255,255,255,0.12); color: var(--dim); padding: 0.22rem 0.5rem; border-radius: 2px; cursor: pointer; font-family: inherit; font-size: 0.6rem; letter-spacing: 0.12em; }
  .clear:hover { color: #ff8a70; border-color: #ff4444; }

  footer { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; color: var(--dim); font-size: 0.68rem; }
  footer a { color: var(--dim); }
  kbd { background: #1c1c22; border: 1px solid rgba(255,255,255,0.12); border-radius: 2px; padding: 0 0.25rem; font-family: 'Share Tech Mono', monospace; }
</style>
