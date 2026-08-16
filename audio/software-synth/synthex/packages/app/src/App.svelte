<script lang="ts">
  import { onMount } from 'svelte'
  import { Synth, factoryDefault, PRESETS, type Patch } from '@synthex/engine'

  import Knob from './components/Knob.svelte'
  import Selector from './components/Selector.svelte'
  import Switch from './components/Switch.svelte'
  import Panel from './components/Panel.svelte'
  import Keyboard from './components/Keyboard.svelte'
  import PatchBrowser from './components/PatchBrowser.svelte'
  import Sequencer from './components/Sequencer.svelte'
  import Slider from './components/Slider.svelte'

  import ProgramPanel from './components/ProgramPanel.svelte'
  import Joystick from './components/Joystick.svelte'
  import SlideSwitch from './components/SlideSwitch.svelte'
  import Rocker from './components/Rocker.svelte'

  import { PatchStore } from './lib/patch-store.svelte'
  import { savePatch } from './lib/persistence'
  import { ComputerKeyboard } from './lib/keyboard-input'
  import { initMidi, type MidiAccess } from './lib/midi-input'
  import { StepSequencer, type Step, type Track } from './lib/sequencer'
  import { Arpeggiator } from './lib/arpeggio'
  import { ChordMemory } from './lib/chord-memory'

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // $state: the template reads this (MIDI indicator), so assignment in
  // boot() must trigger a re-render.
  let synth = $state<Synth | null>(null)
  // Default to the iconic Laser Harp patch (PRESET 46 — "Ring mod.")
  const laserHarp = PRESETS.find(s => s.address === 46)?.patch ?? factoryDefault()
  let store = $state(new PatchStore(laserHarp))
  // True once the AudioContext is actually running (first user gesture).
  let audioOn = $state(false)
  let startError = $state<string | null>(null)
  let scopeCanvas: HTMLCanvasElement | undefined = $state()
  let spectrumCanvas: HTMLCanvasElement | undefined = $state()
  let currentSlotKey = $state<string>('46')
  let currentKey = $state<string>('factory:46')

  // Which layer the panel edits (real Synthex LOWER/UPPER buttons).
  // All layer-scoped controls read `layer.…` and write through `setL()`.
  let editLayer = $state<'upper' | 'lower'>('upper')
  let layer = $derived(editLayer === 'lower' ? store.patch.lower : store.patch.upper)
  function setL(path: string, value: number | string | boolean) {
    store.set(`${editLayer}.${path}`, value)
  }

  // ENVELOPE CONTROLS — real Synthex behavior:
  //   HOLD: note-offs are deferred while lit (notes sustain until HOLD off).
  //   RELEASE: when off, the amp envelope release stage is bypassed
  //   (notes cut at note-off); when on, the patch release time applies.
  let holdOn = $state(false)
  const heldByHold = new Set<number>()
  function setHold(v: boolean) {
    holdOn = v
    if (!v) {
      for (const n of heldByHold) { releaseNow(n); held.delete(n) }
      heldByHold.clear()
      held = held
    }
  }

  let releaseOn = $state(true)
  let stashedRelease: { upper: number; lower: number } | null = null
  function setReleaseEnabled(v: boolean) {
    releaseOn = v
    if (!v) {
      stashedRelease = { upper: store.patch.upper.envAmp.r, lower: store.patch.lower.envAmp.r }
      store.set('upper.envAmp.r', 0.01)
      store.set('lower.envAmp.r', 0.01)
    } else if (stashedRelease) {
      store.set('upper.envAmp.r', stashedRelease.upper)
      store.set('lower.envAmp.r', stashedRelease.lower)
      stashedRelease = null
    }
  }

  // Joystick performance section (manual: NOT stored in programs).
  //   Vertical stick = bend: osc pitch (±bendOsc×7 st) + cutoff (bendFilt).
  //   Horizontal stick = LFO2 fade-in: left → osc pitch, right → cutoff.
  //   The four depth sliders + LFO2 rate sliders live here, panel-global.
  let joyTarget = $state<'upper' | 'both' | 'lower'>('both')
  const perfSliders = $state({
    bendOsc: 0.3, bendFilt: 0.3, lfo2Osc: 0.5, lfo2Filt: 0.5,
    lfo2Init: 5.5, lfo2Delta: 0,
  })
  function joyChange(jx: number, jy: number) {
    synth?.setJoy(jx, jy, joyTarget)
  }
  function setPerfDepth(key: 'bendOsc' | 'bendFilt' | 'lfo2Osc' | 'lfo2Filt', v: number) {
    perfSliders[key] = v
    synth?.setPerformance({ [key]: v })
  }
  // LFO2 rate = coarse INIT FREQ + fine DELTA FREQ (manual §2). Performance
  // control: written straight to the voices, re-applied after patch loads.
  function applyLfo2Rate() {
    const rate = perfSliders.lfo2Init + perfSliders.lfo2Delta
    synth?.setParam('upper.lfo2.rate', rate)
    synth?.setParam('lower.lfo2.rate', rate)
  }
  function setPerfLfo2(key: 'lfo2Init' | 'lfo2Delta', v: number) {
    perfSliders[key] = v
    applyLfo2Rate()
  }
  function applyPerformance() {
    synth?.setPerformance({
      bendOsc: perfSliders.bendOsc, bendFilt: perfSliders.bendFilt,
      lfo2Osc: perfSliders.lfo2Osc, lfo2Filt: perfSliders.lfo2Filt,
    })
    applyLfo2Rate()
  }

  // VOLUME panel STEREO/MONO rocker.
  let stereo = $state(true)
  function setStereo(v: boolean) { stereo = v; synth?.setMono(!v) }

  // PROGRAM section WRITE button — snapshot current patch to user storage.
  async function writeCurrent() {
    const snap = $state.snapshot(store.patch) as Patch
    await savePatch(snap.name, snap)
  }

  let held = $state(new Set<number>())
  const compKbd = new ComputerKeyboard()
  let baseOctave = $state(4)
  let kbdStartOctave = $state(3) // base of the on-screen keyboard, in octaves

  function shiftOctave(delta: number) {
    compKbd.setOctave(baseOctave + delta)
  }
  function shiftKbd(delta: number) {
    kbdStartOctave = Math.max(0, Math.min(7, kbdStartOctave + delta))
  }

  let midi = $state<MidiAccess | null>(null)
  let midiInputId = $state<string | null>(null)
  let midiChannel = $state<number | null>(null)

  function emptySteps(n: number): Step[] {
    const out: Step[] = []; for (let i = 0; i < n; i++) out.push({ kind: 'rest' }); return out
  }
  let seqTracks = $state<Track[]>([
    { steps: emptySteps(16), enabled: true,  target: 'upper' },
    { steps: emptySteps(16), enabled: false, target: 'upper' },
    { steps: emptySteps(16), enabled: false, target: 'upper' },
    { steps: emptySteps(16), enabled: false, target: 'upper' },
  ])
  let activeTrack = $state(0)
  let bpm = $state(120)
  let seqGate = $state(1)
  let seqEditorOpen = $state(false)   // WRITE button opens the step editor
  // Modern (non-1981) controls live in a collapsible shelf, closed by default.
  let modernOpen = $state(false)
  let modernActive = $derived(
    (store.patch.arp?.enabled ?? false) ||
    store.patch.fx.delay.enabled ||
    store.patch.fx.reverb.enabled ||
    (store.patch.chordMemory?.enabled ?? false),
  )
  let seqPlaying = $state(false)
  let seqStep = $state(0)
  let stepRaf = 0
  let sequencer: StepSequencer | null = null
  let arp = new Arpeggiator({ noteOn: () => {}, noteOff: () => {}, getTime: () => 0 })
  let chord = new ChordMemory()
  let detachKbd: (() => void) | null = null

  // ---------------------------------------------------------------------------
  // Note routing helpers
  // ---------------------------------------------------------------------------

  // Press goes through chord-memory and arp before reaching the synth.
  function press(note: number, vel: number) {
    if (!synth) return
    held.add(note); held = held
    if (arp.enabled) {
      arp.noteOn(note)
      return
    }
    const chordNotes = chord.noteOn(note)
    if (chordNotes) for (const n of chordNotes) synth.noteOn(n, vel)
    else synth.noteOn(note, vel)
  }
  function release(note: number) {
    if (!synth) return
    // HOLD engaged: defer the note-off; key stays sounding (and lit).
    if (holdOn) { heldByHold.add(note); return }
    held.delete(note); held = held
    releaseNow(note)
  }
  function releaseNow(note: number) {
    if (!synth) return
    if (arp.enabled) {
      arp.noteOff(note)
      return
    }
    const chordNotes = chord.noteOff(note)
    if (chordNotes) for (const n of chordNotes) synth.noteOff(n)
    else synth.noteOff(note)
  }
  function rawNoteOn(n: number) { synth?.noteOn(n, 1) }
  function rawNoteOff(n: number) { synth?.noteOff(n) }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  // Boot everything at page load — worklet, voices, MIDI. The AudioContext
  // starts 'suspended' (browsers require a user gesture for sound), so the
  // first click or keypress anywhere calls ensureAudio() to resume it.
  // No blocking power-on screen; the overlay only appears if boot fails.
  async function boot() {
    if (synth) return
    startError = null
    try {
      // Relative to the page, and resolved through Vite's BASE_URL so the
      // app also works when deployed under a sub-path (project Pages sites).
      // The worklet is a prebuilt .js — see engine/scripts/build-worklet.mjs
      // for why it cannot be loaded from the .ts source in a production build.
      synth = new Synth({
        polyphony: 8,
        workletUrl: `${import.meta.env.BASE_URL}synthex-voice-processor.js`,
      })
      await synth.init()
      store.attach(synth)
      startStepIndicator()

      compKbd
        .on(press)
        .off(release)
        .onOctave(o => baseOctave = o)
      detachKbd = compKbd.attach(window)
      compKbd.setOctave(baseOctave)

      arp = new Arpeggiator({
        noteOn: rawNoteOn,
        noteOff: rawNoteOff,
        getTime: () => synth?.context.currentTime ?? 0,
      })
      // Pull initial arp/chord state from patch
      const ap = store.patch.arp
      if (ap) {
        arp.enabled = ap.enabled; arp.pattern = ap.pattern; arp.range = ap.range
        arp.hold = ap.hold; arp.rate = ap.rate; arp.gateLength = ap.gateLength
      }
      const cm = store.patch.chordMemory
      if (cm) { chord.enabled = cm.enabled; chord.notes = cm.notes }

      // Reflect suspend/resume in the header indicator.
      synth.context.onstatechange = () => { audioOn = synth?.context.state === 'running' }
      audioOn = synth.context.state === 'running'

      applyPerformance()

      midi = await initMidi({
        onNoteOn: press,
        onNoteOff: release,
        onPitchBend: semis => synth?.pitchBend(semis),
        onCC: (cc, v) => {
          // Mod wheel = vibrato = joystick pushed left (LFO2 → osc pitch).
          if (cc === 1) synth?.setJoy(-v, 0, joyTarget)
        },
      })
    } catch (err) {
      startError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      synth = null
    }
  }

  // Called from any pointer/key gesture; resumes the suspended context.
  function ensureAudio() {
    if (synth && synth.context.state !== 'running') void synth.resume()
  }

  function loadPatch(p: Patch, key: string) {
    store.load(p)
    currentKey = key
    // A fresh patch always has its release stage active again.
    releaseOn = true
    stashedRelease = null
    // Performance sliders are panel controls (manual): survive program loads.
    applyPerformance()
    // Extract bank-program for the LED display: factory:46 → "46", user:Bass → "U-"
    const m = /^(factory|memory):(\d+)$/.exec(key)
    if (m) currentSlotKey = m[2]!
    else currentSlotKey = 'U-'
  }

  // ---------------------------------------------------------------------------
  // Sequencer
  // ---------------------------------------------------------------------------

  function ensureSequencer(): StepSequencer {
    if (sequencer) return sequencer
    sequencer = new StepSequencer({
      tracks: seqTracks,
      bpm,
      stepsPerBeat: 4,
      // Sequencer routes per-track to its assigned layer; bypass arp/chord.
      onNoteOn: (n, _t) => synth?.noteOn(n, 1),
      onNoteOff: (n, _t) => synth?.noteOff(n),
      getTime: () => synth?.context.currentTime ?? 0,
    })
    return sequencer
  }
  function playSeq() { const s = ensureSequencer(); s.setTracks(seqTracks); s.setBpm(bpm); s.setGate(seqGate); s.start(); seqPlaying = true }
  function setSeqGate(g: number) { seqGate = g; sequencer?.setGate(g) }
  function stopSeq() { sequencer?.stop(); seqPlaying = false }
  function setBpm(b: number) { bpm = b; sequencer?.setBpm(b) }
  function changeStep(track: number, i: number, s: Step) {
    const t = seqTracks[track]; if (!t) return
    t.steps[i] = s; seqTracks = seqTracks; sequencer?.setTracks(seqTracks)
  }
  function changeTrack(i: number, patch: Partial<Track>) {
    const t = seqTracks[i]; if (!t) return
    Object.assign(t, patch); seqTracks = seqTracks; sequencer?.setTracks(seqTracks)
  }
  function startStepIndicator() {
    const tick = () => {
      if (sequencer) seqStep = sequencer.currentStep(activeTrack)
      stepRaf = requestAnimationFrame(tick)
    }
    tick()
  }

  // ---------------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------------

  // Runs with or without a live analyser: draws the CRT grid immediately on
  // mount so the displays never sit as dead black boxes before power-on.
  let scopeRunning = false
  function drawScope() {
    if (!scopeCanvas || scopeRunning) return
    scopeRunning = true
    const ctx = scopeCanvas.getContext('2d')
    if (!ctx) return
    const sCtx = spectrumCanvas?.getContext('2d')
    // Engine analyser is fixed at fftSize 2048; safe to preallocate.
    const buf = new Float32Array(2048)
    const freqBuf = new Uint8Array(1024)
    const tick = () => {
      if (!scopeCanvas) return
      const analyser = synth?.getAnalyser() ?? null
      const w = scopeCanvas.width, h = scopeCanvas.height

      // ─── Waveform scope ───
      ctx.fillStyle = '#080402'
      ctx.fillRect(0, 0, w, h)
      // Phosphor grid
      ctx.strokeStyle = 'rgba(255, 60, 24, 0.06)'
      ctx.lineWidth = 0.5
      for (let x = 0; x <= w; x += w / 8) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = 0; y <= h; y += h / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }
      // Center line
      ctx.strokeStyle = 'rgba(255, 60, 24, 0.12)'
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke()

      if (analyser) analyser.getFloatTimeDomainData(buf)
      // Soft glow layer
      ctx.shadowColor = 'rgba(255, 50, 18, 0.6)'
      ctx.shadowBlur = 6
      ctx.strokeStyle = 'rgba(255, 56, 24, 0.4)'
      ctx.lineWidth = 3
      ctx.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * w
        const y = (1 - (buf[i]! * 0.5 + 0.5)) * h
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      // Crisp trace
      ctx.shadowBlur = 2
      ctx.strokeStyle = '#ff4020'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * w
        const y = (1 - (buf[i]! * 0.5 + 0.5)) * h
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0

      // ─── Spectrum analyzer ───
      if (sCtx && spectrumCanvas) {
        const sw = spectrumCanvas.width, sh = spectrumCanvas.height
        sCtx.fillStyle = '#080402'
        sCtx.fillRect(0, 0, sw, sh)
        // Grid
        sCtx.strokeStyle = 'rgba(255, 60, 24, 0.08)'
        sCtx.lineWidth = 0.5
        for (let y = 0; y <= sh; y += sh / 4) {
          sCtx.beginPath(); sCtx.moveTo(0, y); sCtx.lineTo(sw, y); sCtx.stroke()
        }
        for (let x = 0; x <= sw; x += sw / 8) {
          sCtx.beginPath(); sCtx.moveTo(x, 0); sCtx.lineTo(x, sh); sCtx.stroke()
        }
        sCtx.strokeStyle = 'rgba(255, 60, 24, 0.15)'
        sCtx.beginPath(); sCtx.moveTo(0, sh - 1); sCtx.lineTo(sw, sh - 1); sCtx.stroke()
        if (analyser) analyser.getByteFrequencyData(freqBuf)
        const barCount = Math.min(freqBuf.length, 128)
        const barW = sw / barCount
        for (let i = 0; i < barCount; i++) {
          const val = freqBuf[i]! / 255
          const barH = val * sh * 0.9
          const x = i * barW
          // Gradient from orange to red based on height
          const r = 255
          const g = Math.round(60 + (1 - val) * 40)
          const b = Math.round(20 + (1 - val) * 10)
          sCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.5 + val * 0.5})`
          sCtx.fillRect(x, sh - barH, barW - 0.5, barH)
        }
        // Glow overlay
        sCtx.shadowColor = 'rgba(255, 50, 18, 0.3)'
        sCtx.shadowBlur = 4
        sCtx.strokeStyle = 'rgba(255, 60, 24, 0.6)'
        sCtx.lineWidth = 1
        sCtx.beginPath()
        for (let i = 0; i < barCount; i++) {
          const val = freqBuf[i]! / 255
          const x = i * barW + barW / 2
          const y = sh - val * sh * 0.9
          if (i === 0) sCtx.moveTo(x, y); else sCtx.lineTo(x, y)
        }
        sCtx.stroke()
        sCtx.shadowBlur = 0
      }

      requestAnimationFrame(tick)
    }
    tick()
  }

  // ---------------------------------------------------------------------------
  // Patch shortcuts
  // ---------------------------------------------------------------------------

  function set(path: string, value: number | string | boolean) {
    store.set(path, value)
  }

  // SVG waveform icons — thin, single-cycle, matching real Synthex screen-print
  const wSvg = (d: string) => `<svg viewBox="0 0 16 10" width="16" height="10" style="display:block"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="miter" stroke-linecap="butt"/></svg>`
  const WAVE_LABEL: Record<string, string> = {
    sawtooth: 'Sawtooth', triangle: 'Triangle', square: 'Square', sine: 'Sine',
  }

  const WAVE_OPTS = [
    { value: 'sawtooth' as const, label: wSvg('M2,8 L2,2 L14,8') },                    // saw: vertical up, ramp down
    { value: 'triangle' as const, label: wSvg('M2,8 L8,2 L14,8') },                    // triangle: single peak
    { value: 'square' as const,   label: wSvg('M2,8 L2,2 L8,2 L8,8 L14,8') },          // square: single pulse
    { value: 'sine' as const,     label: wSvg('M1,5 C3,1 5,1 8,5 C11,9 13,9 15,5') },  // sine: single S-curve
  ]
  // Synthex footage: 8' = concert pitch = octave -1 (one octave below MIDI standard)
  // This matches Cherry Audio Elka-X tuning where MIDI 50 plays D2 not D3.
  const OCT_OPTS = [
    { value: -2, label: "16'" }, { value: -1, label: "8'" },
    { value: 0,  label: "4'"  }, { value: 1,  label: "2'" }, { value: 2, label: "1'" },
  ]
  const FILT_OPTS = [
    { value: 'lp24' as const, label: 'LP' },
    { value: 'bp12' as const, label: 'BP1' },
    { value: 'bp6'  as const, label: 'BP2' },
    { value: 'hp12' as const, label: 'HP' },
    { value: 'lp12' as const, label: 'ENV +/-' },
  ]
  // Real Synthex LFO: triangle, saw down, saw up, square
  const LFO_SHAPE_OPTS = [
    { value: 'tri' as const,         label: wSvg('M2,8 L8,2 L14,8') },                  // △ triangle
    { value: 'ramp' as const,        label: wSvg('M2,8 L14,2 L14,8') },                 // ∧ saw down (ramp up, drop)
    { value: 'square' as const,      label: wSvg('M2,2 L2,8 L14,2') },                  // ∧ saw up (drop, ramp up)
    { value: 'sample-hold' as const, label: wSvg('M2,8 L2,2 L8,2 L8,8 L14,8') },        // ⊓ square pulse
  ]

  onMount(() => {
    drawScope()
    void boot()
    return () => { cancelAnimationFrame(stepRaf); sequencer?.stop(); detachKbd?.() }
  })
</script>

<svelte:window onpointerdown={ensureAudio} onkeydown={ensureAudio} />

<div class="chassis">
  <div class="side-cheek left" aria-hidden="true"></div>
  <div class="center-body">
  <div class="hinge"></div>

  <main>
    <header class="top">
      <div class="brand">
        <div class="logo">SYNTHEX</div>
        <div class="tagline">
          <span class="elka">ELKA</span> · POLY DCO · MARIO MAGGI · 1981
        </div>
      </div>

      <div class="display-rack">
        <div class="prog-block">
          <div class="prog-label">PROGRAM</div>
          <div class="prog-display">
            <span class="dseg">{currentSlotKey}</span>
          </div>
        </div>
        <div class="name-block">
          <div class="name-label">NAME</div>
          <PatchBrowser currentName={store.patch.name} onload={loadPatch} />
        </div>
        <canvas bind:this={scopeCanvas} width="240" height="46" class="scope"></canvas>
        <canvas bind:this={spectrumCanvas} width="140" height="46" class="scope spectrum"></canvas>
      </div>

      <div class="midi">
        {#if midi}
          <label class="midi-label">
            <span>MIDI IN</span>
            <select onchange={(e) => { midiInputId = (e.target as HTMLSelectElement).value || null; midi?.selectInput(midiInputId) }}>
              <option value="">— none —</option>
              {#each midi.inputs as inp (inp.id)}
                <option value={inp.id} selected={midiInputId === inp.id}>{inp.name}</option>
              {/each}
            </select>
          </label>
          <label class="midi-label">
            <span>CH</span>
            <select onchange={(e) => { const v = (e.target as HTMLSelectElement).value; midiChannel = v ? Number(v) : null; midi?.setChannelFilter(midiChannel) }}>
              <option value="">All</option>
              {#each Array.from({length: 16}, (_, i) => i + 1) as ch (ch)}
                <option value={ch} selected={midiChannel === ch}>{ch}</option>
              {/each}
            </select>
          </label>
        {:else if synth}
          <span class="no-midi">NO WEBMIDI</span>
        {/if}
        {#if !audioOn && !startError}
          <span class="audio-hint">♪ CLICK OR PLAY A KEY FOR SOUND</span>
        {/if}
      </div>
    </header>

    {#if startError}
      <div class="overlay">
        <div class="overlay-inner">
          <div class="overlay-brand">SYNTHEX</div>
          <div class="overlay-tagline">Audio engine failed to start</div>
          <button onclick={boot}>↻ RETRY</button>
          <pre class="err">Error: {startError}</pre>
          <p class="hint-err">Check the browser DevTools console for the full stack.</p>
        </div>
      </div>
    {/if}

  <div class="layout">
    <!-- ═══ ROW 1: LFO1 | Tuning | OSC1 | Multimode Filter | Filter Envelope ═══ -->
    <div class="row row-top">

      <div class="col">
        <Panel title="Low Frequency Oscillator">
          <div class="lfo-row">
            <Knob label="Frequency" size={52} value={layer.lfo1.rate} min={0.05} max={20} default={5} unit="Hz"
              onchange={(v) => setL('lfo1.rate', v)} />
            <Knob label="Delay" size={52} value={layer.lfo1.delay} min={0} max={5} default={0} unit="s"
              onchange={(v) => setL('lfo1.delay', v)} />
          </div>
          <div class="lfo-row">
            <Knob label="Depth A" size={52} value={layer.lfo1.depthA} min={0} max={1} default={1}
              onchange={(v) => setL('lfo1.depthA', v)} />
            <Knob label="Depth B" size={52} value={layer.lfo1.depthB} min={0} max={1} default={1}
              onchange={(v) => setL('lfo1.depthB', v)} />
          </div>
          <div class="lfo-full">
            <Selector value={layer.lfo1.shape} options={LFO_SHAPE_OPTS} label=""
              onchange={(v) => setL('lfo1.shape', v)} />
          </div>
          <div class="lfo-section-label"><span>Waveform</span></div>
          <div class="lfo-routing">
            <div class="lfo-route-group">
              <Switch label="OSC 1" value={layer.modMatrix.lfo1ToOsc1Pitch !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToOsc1Pitch', v ? 0.5 : 0)} />
              <Switch label="OSC 2" value={layer.modMatrix.lfo1ToOsc2Pitch !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToOsc2Pitch', v ? 0.5 : 0)} />
              <Switch label="PW 1" value={layer.modMatrix.lfo1ToOsc1Pwm !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToOsc1Pwm', v ? 0.5 : 0)} />
              <Switch label="PW 2" value={layer.modMatrix.lfo1ToOsc2Pwm !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToOsc2Pwm', v ? 0.5 : 0)} />
            </div>
            <div class="lfo-route-group">
              <Switch label="Filt" value={layer.modMatrix.lfo1ToCutoff !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToCutoff', v ? 0.5 : 0)} />
              <Switch label="Amp" value={layer.modMatrix.lfo1ToAmp !== 0}
                onchange={(v) => setL('modMatrix.lfo1ToAmp', v ? 0.5 : 0)} />
            </div>
          </div>
          <div class="lfo-group-labels">
            <span class="lfo-group-rule" style="flex:4">A</span>
            <span class="lfo-group-rule" style="flex:2">B</span>
          </div>
          <div class="lfo-section-label"><span>Routing</span></div>
        </Panel>
      </div>

      <div class="col col-narrow">
        <Panel title="Tuning">
          <div class="tuning-col">
            <Knob label="Master Tune" light value={store.patch.master.tune} min={-12} max={12} default={0} step={1} unit="st"
              onchange={(v) => set('master.tune', v)} />
            <Knob label="Detune" value={store.patch.master.unisonDetune} min={0} max={1} default={0.15}
              onchange={(v) => set('master.unisonDetune', v)} />
            <div style="flex:1"></div>
            <Switch label="Sync" value={layer.osc2.sync}
              onchange={(v) => setL('osc2.sync', v)} />
          </div>
        </Panel>
      </div>

      <div class="col col-osc">
        <div class="stack">
        <Panel title="Oscillator 1" inline>
            <Selector value={layer.osc1.octave} options={OCT_OPTS} label="Octave"
              onchange={(v) => setL('osc1.octave', v)} />
            <Knob label="Transpose" size={44} value={layer.osc1.glide.amount} min={0} max={12} default={0} step={1} unit="st"
              onchange={(v) => setL('osc1.glide.amount', v)} />
            <div class="osc-waveform-strip">
              <div class="osc-waveform-caps">
                {#each WAVE_OPTS as w}<span class="osc-wf-cap">{@html w.label}</span>{/each}
                <span class="osc-wf-cap">OSC2 PWM</span>
                <span class="osc-wf-cap">Ring Mod</span>
              </div>
              <div class="osc-waveform-btns">
                {#each WAVE_OPTS as w (w.value)}
                  <button class:active={layer.osc1.wave === w.value}
                    aria-label="OSC1 waveform: {WAVE_LABEL[w.value] ?? w.value}"
                    onclick={() => setL('osc1.wave', w.value)}>
                    <span class="led-area"><span class="led"></span></span><span class="body"></span>
                  </button>
                {/each}
                <button class:active={layer.mix.crossMod > 0}
                  aria-label="OSC2 cross-modulates OSC1 pulse width"
                  onclick={() => setL('mix.crossMod', layer.mix.crossMod > 0 ? 0 : 0.5)}>
                  <span class="led-area"><span class="led"></span></span><span class="body"></span>
                </button>
                <button class:active={layer.mix.ringMod}
                  aria-label="Ring modulation"
                  onclick={() => setL('mix.ringMod', !layer.mix.ringMod)}>
                  <span class="led-area"><span class="led"></span></span><span class="body"></span>
                </button>
              </div>
              <div class="lfo-section-label"><span>Waveform</span></div>
            </div>
            <Knob label="Pulse Width" size={44} value={layer.osc1.pwm} min={0.05} max={0.95} default={0.5}
              onchange={(v) => setL('osc1.pwm', v)} />
            <Knob label="Volume" size={44} value={layer.mix.osc1} min={0} max={1} default={0.5}
              onchange={(v) => setL('mix.osc1', v)} />
        </Panel>
        <!-- OSC2 directly below OSC1 in same column -->
        <Panel title="Oscillator 2" inline>
            <Selector value={layer.osc2.octave} options={OCT_OPTS} label="Octave"
              onchange={(v) => setL('osc2.octave', v)} />
            <Knob label="Transpose" size={44} value={layer.osc2.glide.amount} min={0} max={12} default={0} step={1} unit="st"
              onchange={(v) => setL('osc2.glide.amount', v)} />
            <div class="osc-waveform-strip">
              <div class="osc-waveform-caps">
                {#each WAVE_OPTS as w}<span class="osc-wf-cap">{@html w.label}</span>{/each}
                <span class="osc-wf-cap">OSC1 PWM</span>
                <span class="osc-wf-cap">Ring Mod</span>
              </div>
              <div class="osc-waveform-btns">
                {#each WAVE_OPTS as w (w.value)}
                  <button class:active={layer.osc2.wave === w.value}
                    aria-label="OSC2 waveform: {WAVE_LABEL[w.value] ?? w.value}"
                    onclick={() => setL('osc2.wave', w.value)}>
                    <span class="led-area"><span class="led"></span></span><span class="body"></span>
                  </button>
                {/each}
                <button class:active={layer.mix.crossMod2 > 0}
                  aria-label="OSC1 cross-modulates OSC2 pulse width"
                  onclick={() => setL('mix.crossMod2', layer.mix.crossMod2 > 0 ? 0 : 0.5)}>
                  <span class="led-area"><span class="led"></span></span><span class="body"></span>
                </button>
                <button class:active={layer.mix.ringMod}
                  aria-label="Ring modulation"
                  onclick={() => setL('mix.ringMod', !layer.mix.ringMod)}>
                  <span class="led-area"><span class="led"></span></span><span class="body"></span>
                </button>
              </div>
              <div class="lfo-section-label"><span>Waveform</span></div>
            </div>
            <Knob label="Pulse Width" size={44} value={layer.osc2.pwm} min={0.05} max={0.95} default={0.5}
              onchange={(v) => setL('osc2.pwm', v)} />
            <Knob label="Volume" size={44} value={layer.mix.osc2} min={0} max={1} default={0.5}
              onchange={(v) => setL('mix.osc2', v)} />
        </Panel>
        <!-- Glide + Noise side by side below OSC2 -->
        <div class="row row-sub">
          <Panel title="Glide / Portamento" inline>
            <Selector value={'none' as string} label=""
              options={[
                {value: 'osc1' as string, label: 'OSC 1'},
                {value: 'osc2' as string, label: 'OSC 2'},
                {value: 'glide' as string, label: 'Glide'},
                {value: 'portam' as string, label: 'Portam.'},
              ]}
              onchange={(v) => {
                if (v === 'osc1') setL('glide.osc1', !layer.glide.osc1)
                else if (v === 'osc2') setL('glide.osc2', !layer.glide.osc2)
                else if (v === 'glide') setL('glide.mode', layer.glide.mode === 'glide' ? 'off' : 'glide')
                else if (v === 'portam') setL('glide.mode', layer.glide.mode === 'portamento' ? 'off' : 'portamento')
              }} />
            <Knob label="Speed" size={40} value={layer.glide.time} min={0.01} max={10} default={0.2}
              onchange={(v) => setL('glide.time', v)} />
            <Knob label="Glide Amount" size={40} value={layer.glide.amount} min={-24} max={24} default={0} step={1} unit="st"
              onchange={(v) => setL('glide.amount', v)} />
          </Panel>
          <Panel title="Noise Generator" inline>
            <Selector value={layer.mix.noiseColor} label=""
              options={[{value:'white' as const, label:'White'},{value:'pink' as const, label:'Pink'}]}
              onchange={(v) => setL('mix.noiseColor', v)} />
            <Knob label="Volume" size={40} value={layer.mix.noise} min={0} max={1} default={0}
              onchange={(v) => setL('mix.noise', v)} />
          </Panel>
        </div>
        </div>
      </div>

      <div class="col col-filter">
        <Panel title="Multimode Filter">
          <div class="filter-grid">
            <Knob label="Frequency" value={layer.filter.cutoff} min={0} max={1} default={0.6}
              onchange={(v) => setL('filter.cutoff', v)} />
            <Knob label="Envelope" value={layer.filter.envAmount} min={-1} max={1} default={0.4}
              onchange={(v) => setL('filter.envAmount', v)} />
            <Knob label="Resonance" value={layer.filter.resonance} min={0} max={1} default={0.2}
              onchange={(v) => setL('filter.resonance', v)} />
            <Knob label="Keyboard" value={layer.filter.keyTrack} min={0} max={1} default={0.5}
              onchange={(v) => setL('filter.keyTrack', v)} />
          </div>
          <div style="flex:1"></div>
          <Selector value={layer.filter.mode} options={FILT_OPTS} label="Filter Modes"
            onchange={(v) => setL('filter.mode', v)} />
        </Panel>
      </div>

      <div class="col col-env">
        <div class="stack">
          <Panel title="Filter Envelope" inline>
            <Knob label="Attack" value={layer.envFilter.a} min={0.001} max={5} default={0.005} unit="s"
              onchange={(v) => setL('envFilter.a', v)} />
            <Knob label="Decay" value={layer.envFilter.d} min={0.001} max={5} default={0.4} unit="s"
              onchange={(v) => setL('envFilter.d', v)} />
            <Knob label="Sustain" value={layer.envFilter.s} min={0} max={1} default={0.5}
              onchange={(v) => setL('envFilter.s', v)} />
            <Knob label="Release" value={layer.envFilter.r} min={0.001} max={5} default={0.3} unit="s"
              onchange={(v) => setL('envFilter.r', v)} />
          </Panel>
          <Panel title="Amplifier Envelope" inline>
            <Knob label="Attack" value={layer.envAmp.a} min={0.001} max={5} default={0.005} unit="s"
              onchange={(v) => setL('envAmp.a', v)} />
            <Knob label="Decay" value={layer.envAmp.d} min={0.001} max={5} default={0.2} unit="s"
              onchange={(v) => setL('envAmp.d', v)} />
            <Knob label="Sustain" value={layer.envAmp.s} min={0} max={1} default={0.85}
              onchange={(v) => setL('envAmp.s', v)} />
            <Knob label="Release" value={layer.envAmp.r} min={0.001} max={5} default={0.3} unit="s"
              onchange={(v) => setL('envAmp.r', v)} />
          </Panel>
          <div class="row row-sub">
            <Panel title="Chorus Effects">
              <Selector value={store.patch.fx.chorus.mode} options={[
                {value: 0 as const, label: 'Off'}, {value: 1 as const, label: '1'}, {value: 2 as const, label: '2'}, {value: 3 as const, label: '3'}
              ]} label="" onchange={(v) => { set('fx.chorus.mode', v); set('fx.chorus.enabled', v !== 0) }} />
            </Panel>
            <Panel title="Envelope Controls">
              <Switch label="Hold" value={holdOn} onchange={setHold} />
              <Switch label="Release" value={releaseOn} onchange={setReleaseEnabled} />
            </Panel>
          </div>
        </div>
      </div>

    </div>

    <!-- ═══ ROW 2: LFO2 (sliders) | Program | Voice Mode | Volume ═══ -->
    <div class="row row-bottom">

      <div class="col col-wide">
        <Panel title="" inline>
          <!-- Joystick — on the real panel it lives here, left of the
               LFO2 sliders. Up/down = bend, left/right = osc/filter mod. -->
          <Joystick onchange={joyChange}
            topLabel="Bend +" bottomLabel="Bend −"
            leftLabel="To Osc." rightLabel="To Filter" />
          <!-- LFO 2 sliders -->
          <div class="lfo2-sliders">
            <div class="lfo2-group-label">LFO 2</div>
            <div class="lfo2-slider-row">
              <Slider label="Init Freq" value={perfSliders.lfo2Init} min={0.5} max={15} default={5.5}
                onchange={(v) => setPerfLfo2('lfo2Init', v)} />
              <div class="fader-scale" aria-hidden="true"></div>
              <Slider label="Delta Freq" value={perfSliders.lfo2Delta} min={0} max={1.5} default={0}
                onchange={(v) => setPerfLfo2('lfo2Delta', v)} />
            </div>
          </div>
          <div class="lfo2-sliders">
            <div class="lfo2-group-label">To Osc.</div>
            <div class="lfo2-slider-row">
              <Slider label="LFO 2" value={perfSliders.lfo2Osc} min={0} max={1} default={0.5}
                onchange={(v) => setPerfDepth('lfo2Osc', v)} />
              <div class="fader-scale" aria-hidden="true"></div>
              <Slider label="Bend" value={perfSliders.bendOsc} min={0} max={1} default={0.3}
                onchange={(v) => setPerfDepth('bendOsc', v)} />
            </div>
          </div>
          <div class="lfo2-sliders">
            <div class="lfo2-group-label">To Filter</div>
            <div class="lfo2-slider-row">
              <Slider label="LFO 2" value={perfSliders.lfo2Filt} min={0} max={1} default={0.5}
                onchange={(v) => setPerfDepth('lfo2Filt', v)} />
              <div class="fader-scale" aria-hidden="true"></div>
              <Slider label="Bend" value={perfSliders.bendFilt} min={0} max={1} default={0.3}
                onchange={(v) => setPerfDepth('bendFilt', v)} />
            </div>
          </div>
          <SlideSwitch value={joyTarget}
            options={[
              { value: 'upper' as const, label: 'Upper' },
              { value: 'both' as const, label: 'Both' },
              { value: 'lower' as const, label: 'Lower' },
            ]}
            onchange={(v) => joyTarget = v} />
        </Panel>
      </div>

      <!-- Program section — BANK / PROGRAM / MEMORY / KEYBOARD MODE, as on
           the real panel. Program buttons load factory slots directly. -->
      <div class="col col-program">
        <Panel title="">
          <ProgramPanel
            currentKey={currentKey}
            voiceMode={store.patch.voiceMode}
            editLayer={editLayer}
            onload={loadPatch}
            onvoicemode={(m) => set('voiceMode', m)}
            oneditlayer={(l) => editLayer = l}
            onwrite={writeCurrent}
          />
        </Panel>
      </div>

      <div class="col col-narrow">
        <Panel title="Volume">
          <div class="volume-row">
            <Rocker topLabel="Stereo" bottomLabel="Mono" value={stereo} onchange={setStereo} />
            <Knob label="Balance" size={56} light value={layer.pan} min={-1} max={1} default={0}
              onchange={(v) => setL('pan', v)} />
            <Knob label="Master" size={56} light value={store.patch.master.volume} min={0} max={1} default={0.8}
              onchange={(v) => set('master.volume', v)} />
          </div>
        </Panel>
      </div>

    </div>

    <!-- Modern additions — deliberately styled apart from the 1981 panel:
         key assign, arpeggiator, delay, reverb are not on the real Synthex. -->
    <div class="modern-strip" class:openx={modernOpen}>
      <button class="modern-tag" aria-expanded={modernOpen}
        onclick={() => modernOpen = !modernOpen}>
        <span class="modern-arrow">{modernOpen ? '▾' : '▸'}</span>
        Modern
        {#if modernActive}<span class="modern-dot" title="A modern feature is active"></span>{/if}
      </button>
      {#if modernOpen}
      <Selector value={layer.keyAssign} label="Key Assign"
        options={[{value:'poly' as const,label:'Poly'},{value:'mono' as const,label:'Mono'},{value:'unison' as const,label:'Uni'}]}
        onchange={(v) => setL('keyAssign', v)} />
      <Switch label="Multi Trig" value={layer.multiTrigger}
        onchange={(v) => setL('multiTrigger', v)} />
      <Switch label="Chord Mem" value={store.patch.chordMemory?.enabled ?? false}
        onchange={(v) => { set('chordMemory.enabled', v); chord.enabled = v }} />
      <span class="modern-sep"></span>
      <Switch label="Arp" value={store.patch.arp?.enabled ?? false}
        onchange={(v) => { set('arp.enabled', v); arp.enabled = v }} />
      <Selector value={store.patch.arp?.pattern ?? 'up'} label="Pattern"
        options={[
          {value: 'up' as const, label: 'Up'},
          {value: 'down' as const, label: 'Dn'},
          {value: 'updown' as const, label: 'U/D'},
          {value: 'random' as const, label: 'Rnd'},
        ]}
        onchange={(v) => { set('arp.pattern', v); arp.pattern = v }} />
      <Knob label="Rate" size={34} value={store.patch.arp?.rate ?? 8} min={1} max={30} default={8} unit="Hz"
        onchange={(v) => { set('arp.rate', v); arp.rate = v }} />
      <Knob label="Range" size={34} value={store.patch.arp?.range ?? 1} min={1} max={4} default={1} step={1} unit="oct"
        onchange={(v) => { set('arp.range', v); arp.range = v }} />
      <Switch label="Arp Hold" value={store.patch.arp?.hold ?? false}
        onchange={(v) => { set('arp.hold', v); arp.setHold(v) }} />
      <span class="modern-sep"></span>
      <Switch label="Delay" value={store.patch.fx.delay.enabled}
        onchange={(v) => set('fx.delay.enabled', v)} />
      <Knob label="Time" size={34} value={store.patch.fx.delay.time} min={0.01} max={1.5} default={0.25} unit="s"
        onchange={(v) => set('fx.delay.time', v)} />
      <Knob label="Fdbk" size={34} value={store.patch.fx.delay.feedback} min={0} max={0.95} default={0.3}
        onchange={(v) => set('fx.delay.feedback', v)} />
      <Knob label="Mix" size={34} value={store.patch.fx.delay.mix} min={0} max={1} default={0.2}
        onchange={(v) => set('fx.delay.mix', v)} />
      <span class="modern-sep"></span>
      <Switch label="Reverb" value={store.patch.fx.reverb.enabled}
        onchange={(v) => set('fx.reverb.enabled', v)} />
      <Knob label="Size" size={34} value={store.patch.fx.reverb.size} min={0} max={1} default={0.5}
        onchange={(v) => set('fx.reverb.size', v)} />
      <Knob label="Mix" size={34} value={store.patch.fx.reverb.mix} min={0} max={1} default={0.2}
        onchange={(v) => set('fx.reverb.mix', v)} />
      {/if}
    </div>

    <!-- Black strip with the chrome SYNTHEX badge, as on the real unit -->
    <div class="brand-strip">
      <span class="brand-left">Synthex Web</span>
      <span class="brand-right">SYNTHEX</span>
    </div>

  </div>

  <section class="bottom">
    {#if seqEditorOpen}
      <Sequencer
        tracks={seqTracks}
        activeTrack={activeTrack}
        bpm={bpm}
        playing={seqPlaying}
        currentStep={seqStep}
        onstepchange={changeStep}
        ontrackchange={changeTrack}
        onactivetrack={(i) => activeTrack = i}
        onbpm={setBpm}
        onplay={playSeq}
        onstop={stopSeq}
      />
    {/if}
    <div class="keyboard-rig">
      <div class="kbd-row">
        <!-- Compact SEQUENCER panel, left of the keys as on the real unit.
             WRITE opens the modern step-grid editor above. -->
        <div class="seqp">
          <div class="seqp-title"><span>Sequencer</span></div>
          <div class="seqp-knobs">
            <Knob label="Frequency" size={42} value={bpm} min={40} max={240} default={120} step={1}
              onchange={(v) => setBpm(v)} />
            <Knob label="Gate" size={42} value={seqGate} min={0.1} max={1} default={1}
              onchange={setSeqGate} />
          </div>
          <div class="seqp-lower">
            <div class="seqp-transport">
              <Switch label="Write" value={seqEditorOpen} onchange={(v) => seqEditorOpen = v} />
              <Switch label="Loop" value={seqPlaying} onchange={(v) => v ? playSeq() : stopSeq()} />
              <Switch label="Stop Ready" value={!seqPlaying} onchange={() => stopSeq()} />
            </div>
            <div class="seqp-seqs">
              <span class="seqp-seq-label">Sequence</span>
              {#each seqTracks as t, i (i)}
                <button
                  class="seqp-seq-btn"
                  class:sel={i === activeTrack}
                  class:on={t.enabled}
                  aria-label="Sequence {i + 1}"
                  onclick={() => { activeTrack = i; changeTrack(i, { enabled: !t.enabled }) }}
                ><span class="led"></span><span class="num">{i + 1}</span></button>
              {/each}
            </div>
          </div>
        </div>
        <div class="oct-ctrl">
          <div class="oct-group">
            <span class="oct-label">Type Oct</span>
            <div class="oct-buttons">
              <button onclick={() => shiftOctave(-1)} aria-label="Octave down">−</button>
              <span class="oct-val">{baseOctave}</span>
              <button onclick={() => shiftOctave(1)} aria-label="Octave up">+</button>
            </div>
          </div>
          <div class="oct-group">
            <span class="oct-label">View Oct</span>
            <div class="oct-buttons">
              <button onclick={() => shiftKbd(-1)} aria-label="Keyboard down">◀</button>
              <span class="oct-val">{kbdStartOctave}</span>
              <button onclick={() => shiftKbd(1)} aria-label="Keyboard up">▶</button>
            </div>
          </div>
        </div>
        <div class="kbd-frame">
          <Keyboard
            held={held}
            octaves={5}
            startNote={kbdStartOctave * 12 + 12}
            onnoteon={press}
            onnoteoff={release}
          />
        </div>
      </div>
    </div>
    <p class="hint">
      Computer keyboard: <kbd>Z</kbd>/<kbd>Q</kbd> rows · <kbd>−</kbd>/<kbd>=</kbd> octave shift · drag knobs · Shift = fine · Cmd = coarse · double-click = default
    </p>
  </section>
  </main>
  </div>
  <div class="side-cheek right" aria-hidden="true"></div>
</div>

<style>
  /* ─────────────────────────────────────────────────────────────────────
     Synthex theme — Matched from the real Elka Synthex (1981).
     Dark gray painted metal panel, white screen-printed labels and
     section borders, silver metallic knobs, red LEDs, walnut cheeks.
     ───────────────────────────────────────────────────────────────────── */
  :global(:root) {
    --panel:        #3a3838;
    --panel-light:  #444242;
    --panel-deep:   #303030;
    --surface:      #2a2828;
    --ink:          #e8e4dc;
    --ink-soft:     #908880;
    --orange:       #d65a1c;
    --orange-bright:#ee6e2a;
    --orange-dark:  #a04014;
    --led:          #ff3018;
    --led-glow:     rgba(255, 48, 24, 0.55);
    --wood-1:       #c08858;
    --wood-2:       #8b5a30;
    --wood-3:       #5a3a1c;
    --metal:        #9a9088;
    --btn-face:     #dcd4c6;
    --btn-hi:       #eee8da;
    --btn-lo:       #b8b09a;
    --rule:         rgba(255, 255, 255, 0.25);
  }

  :global(html, body) {
    margin: 0;
    background: #1a1a18;
    color: var(--ink);
    font-family: 'Saira Condensed', 'Helvetica Neue', sans-serif;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body.knob-dragging) { user-select: none; cursor: ns-resize; }
  :global(body.knob-dragging *) { user-select: none; }

  /* The chassis: outer frame with walnut side cheeks. */
  .chassis {
    max-width: 1680px;
    margin: 1rem auto 2rem;
    display: grid;
    grid-template-columns: 32px 1fr 32px;
    gap: 0;
    border-radius: 6px;
    box-shadow:
      0 12px 30px rgba(0, 0, 0, 0.55),
      0 2px 4px rgba(0, 0, 0, 0.4);
  }

  /* Walnut side cheeks flanking the entire instrument */
  .side-cheek {
    background:
      linear-gradient(180deg, var(--wood-1) 0%, var(--wood-2) 50%, var(--wood-3) 100%),
      repeating-linear-gradient(
        90deg, transparent 0, transparent 1px,
        rgba(0, 0, 0, 0.07) 1px, rgba(0, 0, 0, 0.07) 2px
      );
    background-blend-mode: multiply;
    border: 1px solid rgba(0, 0, 0, 0.5);
    position: relative;
    overflow: hidden;
  }
  .side-cheek::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(
        180deg,
        transparent 0, transparent 5px,
        rgba(0, 0, 0, 0.08) 5px, rgba(0, 0, 0, 0.08) 6px
      );
    pointer-events: none;
    mix-blend-mode: multiply;
  }
  .side-cheek.left {
    border-radius: 6px 0 0 6px;
    box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.08);
  }
  .side-cheek.right {
    border-radius: 0 6px 6px 0;
    box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.08);
  }

  .center-body {
    display: flex;
    flex-direction: column;
  }

  /* Hinge strip — chrome highlight matching the real Synthex panel hinge */
  .hinge {
    height: 5px;
    background:
      linear-gradient(180deg,
        #585450 0%, #3a3836 30%,
        #6a6660 50%, #a09890 70%,
        #686460 85%, #3a3836 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 -1px 0 rgba(0, 0, 0, 0.4);
  }

  main {
    background: var(--panel);
    padding: 1rem 1.2rem 1.5rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      inset 0 -1px 0 rgba(0, 0, 0, 0.3);
  }

  /* ─── Top brand bar ─── */
  .top {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1.25rem;
    align-items: end;
    margin-bottom: 0.6rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .brand { display: flex; flex-direction: column; gap: 0.15rem; }
  .logo {
    font-family: 'Audiowide', 'Saira Condensed', sans-serif;
    font-size: 1.5rem;
    line-height: 0.9;
    color: #e8e0d0;
    letter-spacing: 0.04em;
    transform: skewX(-6deg);
    text-shadow:
      0 1px 0 rgba(0, 0, 0, 0.5),
      1px 2px 0 rgba(0, 0, 0, 0.3);
  }
  .tagline {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.6rem;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .tagline .elka {
    background: var(--orange);
    color: #ede4d2;
    padding: 1px 5px;
    border-radius: 1px;
  }

  /* Display rack — program LED + scope side by side */
  .display-rack {
    display: flex;
    align-items: end;
    gap: 0.75rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .prog-block, .name-block {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .prog-label, .name-label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .prog-display {
    background: #1a0606;
    border: 1px solid #000;
    border-radius: 2px;
    padding: 0.25rem 0.55rem;
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.7),
      inset 0 0 18px rgba(255, 48, 24, 0.18);
    min-width: 4.4rem;
    text-align: center;
  }
  .dseg {
    font-family: 'DSEG7 Classic', 'Share Tech Mono', monospace;
    font-size: 1.15rem;
    color: var(--led);
    text-shadow: 0 0 6px var(--led-glow), 0 0 14px var(--led-glow);
    letter-spacing: 0.05em;
    line-height: 1;
  }
  .scope {
    background: #080402;
    border: 2px solid #000;
    border-radius: 3px;
    box-shadow:
      inset 0 0 12px rgba(0, 0, 0, 0.85),
      inset 0 0 24px rgba(0, 0, 0, 0.4),
      0 1px 0 rgba(255, 255, 255, 0.04);
    position: relative;
  }
  /* CRT scan line overlay */
  .scope::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(
        180deg,
        transparent 0px,
        transparent 1px,
        rgba(0, 0, 0, 0.15) 1px,
        rgba(0, 0, 0, 0.15) 2px
      );
    pointer-events: none;
    border-radius: 2px;
  }
  .scope.spectrum {
    border-left: 1px solid #222;
  }

  /* MIDI control block at far right */
  .midi {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    align-items: flex-end;
  }
  .midi-label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    align-items: flex-end;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .midi select {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 0.18rem 0.35rem;
    border-radius: 2px;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.78rem;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
  }
  .no-midi {
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: var(--ink-soft);
  }
  .audio-hint {
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    color: var(--led);
    text-shadow: 0 0 5px var(--led-glow);
    animation: audio-hint-pulse 1.6s ease-in-out infinite;
    white-space: nowrap;
  }
  @keyframes audio-hint-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  /* ─── Power-on overlay ─── */
  .overlay {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(circle at center, rgba(214, 90, 28, 0.1) 0%, rgba(10, 8, 6, 0.95) 60%);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    backdrop-filter: blur(2px);
  }
  .overlay-inner {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    align-items: center;
    max-width: 36rem;
    text-align: center;
    padding: 2rem 3rem 2.4rem;
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 12px 40px rgba(0, 0, 0, 0.7);
  }
  .overlay-brand {
    font-family: 'Audiowide', sans-serif;
    font-size: 3rem;
    color: #e8e0d0;
    letter-spacing: 0.05em;
    transform: skewX(-6deg);
  }
  .overlay-tagline {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 500;
    font-size: 0.78rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 0.1rem;
  }
  .overlay button {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: #ede4d2;
    border: 1px solid rgba(0, 0, 0, 0.4);
    padding: 0.85rem 2.4rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    border-radius: 3px;
    cursor: pointer;
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.4);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      inset 0 -1px 0 rgba(0, 0, 0, 0.3),
      0 4px 10px rgba(0, 0, 0, 0.35);
  }
  .overlay button:hover { filter: brightness(1.06); }
  .overlay button:disabled { opacity: 0.6; cursor: wait; }
  .err {
    background: #2a1410;
    color: #ff8a70;
    border: 1px solid #5a2820;
    padding: 0.6rem 0.8rem;
    border-radius: 3px;
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.78rem;
    text-align: left;
    max-width: 100%;
    overflow-x: auto;
    white-space: pre-wrap;
  }
  .hint-err { font-size: 0.78rem; color: var(--ink-soft); margin: 0; }

  /* ─── Elka-X structured panel layout ─── */
  .layout {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .col-wide {
    flex: 2.2;
  }
  .col-narrow {
    flex: 0.55;
    min-width: 90px;
  }
  .col-program {
    flex: 2.6;
  }
  .volume-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.7rem;
    width: 100%;
    height: 100%;
  }

  /* Modern-additions strip: visually secondary to the 1981 panel */
  /* Recessed shelf for non-Synthex additions — reads as a separate, darker
     sub-area below the painted panels, no dashed outline. */
  .modern-strip {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.6rem 1.3rem;
    padding: 0.5rem 0.9rem 0.55rem;
    margin-top: 0.15rem;
    background: var(--panel-deep);
    border-radius: 3px;
    box-shadow:
      inset 0 2px 5px rgba(0, 0, 0, 0.45),
      inset 0 -1px 0 rgba(255, 255, 255, 0.03);
  }
  .modern-strip:not(.openx) {
    padding: 0.18rem 0.9rem;
  }
  .modern-tag {
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: transparent;
    cursor: pointer;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.52rem;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--ink-soft);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    padding: 0.14rem 0.4rem;
  }
  .modern-tag:hover { color: var(--ink); border-color: rgba(255, 255, 255, 0.3); }
  .modern-arrow { font-size: 0.5rem; line-height: 1; }
  .modern-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255, 40, 20, 0.6);
  }
  .modern-sep {
    width: 1px;
    align-self: stretch;
    background: rgba(255, 255, 255, 0.12);
  }
  .col-filter {
    flex: 0.8;
    min-width: 140px;
  }
  .filter-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    width: 100%;
    justify-items: center;
  }
  .tuning-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    height: 100%;
  }
  .col-osc {
    flex: 3.5;
  }
  .col-env {
    flex: 2.5;
  }
  .col > :global(.panel) {
    flex: 1;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }
  /* Stack rows share the column height equally so the OSC column matches
     the LFO / filter / envelope columns instead of ending short. */
  .stack > :global(.panel),
  .stack > .row-sub {
    flex: 1;
  }
  .row-sub {
    display: flex;
    gap: 0.5rem;
    align-items: stretch;
  }
  .row-sub > :global(.panel) {
    flex: 1;
  }

  /* ─── OSC waveform strip — all 6 buttons in one dark strip ─── */
  .osc-waveform-strip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    flex-shrink: 0;
  }
  .osc-waveform-caps {
    display: flex;
    gap: 4px;
  }
  .osc-wf-cap {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.42rem;
    text-transform: uppercase;
    color: var(--ink);
    text-align: center;
    width: 20px;
    line-height: 1.1;
    overflow: visible;
  }
  .osc-waveform-btns {
    display: flex;
    gap: 4px;
    background: #1a1816;
    padding: 4px;
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .osc-waveform-btns button {
    width: 20px;
    display: flex;
    flex-direction: column;
    border: 0;
    padding: 0;
    cursor: pointer;
    border-radius: 1px;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 0 rgba(0,0,0,0.15);
    transition: transform 60ms ease;
  }
  .osc-waveform-btns button:hover .body {
    background: linear-gradient(180deg, #f4f0e8 0%, #eae6de 100%);
  }
  .osc-waveform-btns button.active {
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.2);
    transform: translateY(1px);
  }
  .osc-waveform-btns .led-area {
    display: flex; align-items: center; justify-content: center;
    padding: 3px 0;
    background: linear-gradient(180deg, #ccc8c0 0%, #d8d4cc 100%);
    box-shadow: inset 0 1px 1px rgba(0,0,0,0.1);
  }
  .osc-waveform-btns .led {
    width: 6px; height: 6px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #6a2a10, #3a0a04 80%);
  }
  .osc-waveform-btns button.active .led {
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255,40,20,0.6), 0 0 6px rgba(255,40,20,0.3);
  }
  .osc-waveform-btns .body {
    padding: 5px 0;
    background: linear-gradient(180deg, #ede8e0 0%, #ddd8d0 100%);
  }

  /* ─── LFO grid layout (matches hardware 2-column with center switch) ─── */
  .lfo-row {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
  }  .lfo-full {
    display: flex;
    justify-content: center;
    width: 100%;
  }
  /* ── SECTION LABEL ── decorative horizontal rules */
  .lfo-section-label {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
    margin: 0;
  }
  .lfo-section-label::before,
  .lfo-section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.25);
  }
  .lfo-section-label span {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #c8c0b4;
    flex-shrink: 0;
  }
  .lfo-routing {
    display: flex;
    gap: 0.15rem;
    justify-content: center;
    width: 100%;
  }
  .lfo-route-group {
    display: flex;
    gap: 4px;
    background: #1a1816;
    padding: 4px;
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
  }
  .lfo-group-labels {
    display: flex;
    width: 100%;
    gap: 0.15rem;
    margin: 0;
  }
  .lfo-group-rule {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.5rem;
    letter-spacing: 0.12em;
    color: #c8c0b4;
    justify-content: center;
  }
  .lfo-group-rule::before,
  .lfo-group-rule::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.25);
  }

  /* ─── LFO 2 slider section ─── */
  .lfo2-sliders {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }
  .lfo2-group-label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.45rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #c8c0b4;
  }
  .lfo2-slider-row {
    display: flex;
    gap: 0.15rem;              /* tight — the two faders of a pair sit close */
    align-items: flex-start;
  }
  /* Shared graduated scale printed between a fader pair (not inside the
     tracks). Fine horizontal lines the height of the track. */
  .fader-scale {
    width: 9px;
    height: 64px;             /* matches Slider default track height */
    align-self: flex-start;
    background: repeating-linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.32) 0, rgba(255, 255, 255, 0.32) 1px,
      transparent 1px, transparent 5px
    );
  }

  /* Brand strip — chrome hinge between upper panel and keyboard,
     matching the real Synthex dividing strip */
  .brand-strip {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.3rem 1rem;
    background: linear-gradient(180deg, #121110 0%, #0a0908 100%);
    border-radius: 0;
    margin-top: 0.5rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.07),
      inset 0 -1px 0 rgba(0, 0, 0, 0.5);
  }
  .brand-left {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(160, 152, 140, 0.4);
  }
  /* Chrome badge look for the logotype */
  .brand-right {
    font-family: 'Audiowide', sans-serif;
    font-size: 1.35rem;
    letter-spacing: 0.05em;
    transform: skewX(-6deg);
    background: linear-gradient(180deg, #f2f0ec 0%, #b8b4ac 45%, #7a766e 55%, #d8d4cc 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.4);
  }

  /* ─── Bottom: sequencer + keyboard rig ─── */
  .bottom {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Keyboard rig — no separate cheeks since we have side cheeks on chassis */
  .keyboard-rig {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
    align-items: stretch;
    background: #0e0c0a;
    border-radius: 4px;
    padding: 5px;
    box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.55);
  }

  .kbd-row {
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 0.5rem;
    align-items: stretch;
  }

  /* Compact hardware-style sequencer panel */
  .seqp {
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: var(--panel);
    padding: 0.55rem 0.6rem 0.45rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 168px;
  }
  .seqp-title {
    display: flex;
    justify-content: center;
    margin-top: -1rem;
  }
  .seqp-title span {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    background: var(--panel);
    padding: 0 0.45rem;
    line-height: 1;
  }
  .seqp-knobs {
    display: flex;
    justify-content: space-evenly;
    gap: 0.4rem;
  }
  .seqp-lower {
    display: flex;
    gap: 0.6rem;
    align-items: flex-end;
    justify-content: space-between;
  }
  .seqp-transport {
    display: flex;
    gap: 0.55rem;
    align-items: flex-end;
  }
  .seqp-seqs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .seqp-seq-label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.44rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .seqp-seq-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: linear-gradient(180deg, #ede8e0 0%, #ddd8d0 100%);
    border: 0;
    border-radius: 1px;
    padding: 1px 4px 1px 3px;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 0 rgba(0, 0, 0, 0.15);
  }
  .seqp-seq-btn.sel { outline: 1px solid var(--orange); }
  .seqp-seq-btn .led {
    width: 5px; height: 5px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #6a2a10, #3a0a04 80%);
  }
  .seqp-seq-btn.on .led {
    background: radial-gradient(circle at 35% 30%, #ff6050 0%, #ff2010 50%, #c01008 100%);
    box-shadow: 0 0 3px rgba(255, 40, 20, 0.6);
  }
  .seqp-seq-btn .num {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.55rem;
    color: #1a1410;
    line-height: 1;
  }
  .kbd-frame {
    background: #14110d;
    padding: 4px;
    border-radius: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
  }

  .oct-ctrl {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.45rem 0.5rem;
    background: var(--panel);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    align-self: stretch;
  }
  .oct-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .oct-buttons {
    display: flex;
    gap: 2px;
    align-items: center;
    background: linear-gradient(180deg, #1a1816, #0e0c0a);
    padding: 2px;
    border-radius: 3px;
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.5);
  }
  .oct-group button {
    width: 22px;
    height: 22px;
    background: linear-gradient(180deg, var(--btn-face) 0%, var(--btn-lo) 100%);
    border: 0;
    color: #1a1410;
    border-radius: 2px;
    cursor: pointer;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.78rem;
    line-height: 1;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25);
  }
  .oct-group button:hover { filter: brightness(1.05); }
  .oct-group button:active { transform: translateY(1px); }
  .oct-label {
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .oct-val {
    background: #1a0606;
    color: var(--led);
    font-family: 'DSEG7 Classic', 'Share Tech Mono', monospace;
    font-size: 0.8rem;
    min-width: 1.4rem;
    padding: 1px 4px;
    text-align: center;
    border-radius: 2px;
    text-shadow: 0 0 3px var(--led-glow);
    box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.7);
  }

  .hint {
    margin: 0;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    text-align: center;
  }
  kbd {
    background: linear-gradient(180deg, var(--panel-light), var(--panel-deep));
    color: var(--ink);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    padding: 0 0.32rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.72rem;
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  }
</style>
