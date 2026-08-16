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
  import { SCALE_LABELS, NOTE_NAMES, type ScaleName } from './lib/generate.ts'
  import MixerStrip from './components/MixerStrip.svelte'
  import StepGrid from './components/StepGrid.svelte'
import InstrumentEditor from './components/InstrumentEditor.svelte'

  const studio = new Studio()

  // Sibling apps under a shared static root in a deploy; dev ports otherwise.
  const synthexUrl = import.meta.env['VITE_SYNTHEX_URL']
    ?? (import.meta.env.DEV ? 'http://localhost:5173/' : '../synthex/')
  const pagesUrl = import.meta.env['VITE_PAGES_URL']
    ?? (import.meta.env.DEV ? 'http://localhost:8123/' : '../')
  let meters = $state<Record<number, number>>({})
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
  })

  onMount(() => {
    void boot()
    detachKeys = keys.attach(window)
    const tick = () => {
      const next: Record<number, number> = {}
      for (const t of studio.tracks) next[t.id] = t.meter()
      meters = next
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
    await restore(studio, demoProject())
    projectName = 'Demo — Six Worlds'
    savedProjects = await listProjects()
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
    const p = await loadProject(name)
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
            class:on={studio.playing && i === studio.step}></span>
        {/each}
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
        {#each savedProjects as name (name)}<option value={name}>{name}</option>{/each}
      </select>
      {#if savedProjects.includes(projectName)}
        <button class="del" onclick={() => doDelete(projectName)}>DEL</button>
      {/if}
    </div>
  </header>

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
      </div>

      <!-- Blank rack panel: honest furniture for the unused bay space. -->
      <div class="blank" aria-hidden="true"></div>

      <div class="strip master">
        <span class="name">MASTER</span>
        <div class="meter-row">
          <div class="meter"><div class="fill" style="height:{Math.round(masterMeter * 100)}%"></div></div>
          <input class="fader" type="range" min="0" max="1" step="0.01" value={studio.masterLevel}
            oninput={(e) => { studio.masterLevel = Number((e.target as HTMLInputElement).value); studio.applyMix() }} />
        </div>
      </div>

    </div>
  </section>

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
  .steps { display: flex; gap: 3px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #26262e; }
  .dot.beat { background: #34343f; }
  .dot.on { background: var(--lamp); box-shadow: 0 0 7px var(--lamp); }

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

  .strip.master {
    display: flex; flex-direction: column; gap: 0.4rem; padding: 0.5rem;
    background: #131318; border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; min-width: 82px;
  }
  .strip.master .name { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.1em; color: var(--ink); }
  .meter-row { display: flex; gap: 0.4rem; height: 88px; }
  .meter { width: 8px; background: #0a0a0c; border-radius: 2px; display: flex; flex-direction: column-reverse; overflow: hidden; }
  .fill { background: linear-gradient(180deg, #ff5a3c 0%, #ffcc33 22%, #cfe8d4 45%); transition: height 60ms linear; }
  .fader { writing-mode: vertical-lr; direction: rtl; width: 20px; accent-color: var(--lamp); }

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
