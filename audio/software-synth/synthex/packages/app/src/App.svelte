<script lang="ts">
  import { onMount } from 'svelte'
  import { Synth, factoryDefault, type Patch, type ModSlot } from '@synthex/engine'

  import Knob from './components/Knob.svelte'
  import Selector from './components/Selector.svelte'
  import Switch from './components/Switch.svelte'
  import Panel from './components/Panel.svelte'
  import Keyboard from './components/Keyboard.svelte'
  import PatchBrowser from './components/PatchBrowser.svelte'
  import Sequencer from './components/Sequencer.svelte'

  import { PatchStore } from './lib/patch-store.svelte'
  import { ComputerKeyboard } from './lib/keyboard-input'
  import { initMidi, type MidiAccess } from './lib/midi-input'
  import { StepSequencer, type Step, type Track } from './lib/sequencer'
  import { Arpeggiator } from './lib/arpeggio'
  import { ChordMemory } from './lib/chord-memory'

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let synth: Synth | null = null
  let store = $state(new PatchStore(factoryDefault()))
  let started = $state(false)
  let starting = $state(false)
  let startError = $state<string | null>(null)
  let scopeCanvas: HTMLCanvasElement | undefined = $state()
  let currentSlotKey = $state<string>('—')

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
  let seqPlaying = $state(false)
  let seqStep = $state(0)
  let stepRaf = 0
  let sequencer: StepSequencer | null = null
  let arp = new Arpeggiator({ noteOn: () => {}, noteOff: () => {}, getTime: () => 0 })
  let chord = new ChordMemory()
  let learningChord = $state(false)

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
    held.delete(note); held = held
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

  async function start() {
    if (synth || starting) return
    starting = true
    startError = null
    try {
      synth = new Synth({ polyphony: 8 })
      // Resume IMMEDIATELY while the click's user-activation is still valid.
      // Chrome treats the activation as expired after the first await, which
      // would prevent later resume() calls from succeeding.
      await synth.resume()
      await synth.init()
      store.attach(synth)
      started = true
      drawScope()
      startStepIndicator()

      compKbd
        .on(press)
        .off(release)
        .onOctave(o => baseOctave = o)
      compKbd.attach(window)
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

      midi = await initMidi({
        onNoteOn: press,
        onNoteOff: release,
        onPitchBend: semis => synth?.pitchBend(semis),
        onCC: (cc, v) => {
          if (cc === 1) synth?.setJoy(0, v * 2 - 1) // mod wheel → joystick Y
        },
      })
    } catch (err) {
      startError = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      synth = null
    } finally {
      starting = false
    }
  }

  function loadPatch(p: Patch, key: string) {
    store.load(p)
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
  function playSeq() { ensureSequencer().setTracks(seqTracks); ensureSequencer().setBpm(bpm); ensureSequencer().start(); seqPlaying = true }
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

  function drawScope() {
    if (!synth || !scopeCanvas) return
    const analyser = synth.getAnalyser()
    if (!analyser) return
    const ctx = scopeCanvas.getContext('2d')
    if (!ctx) return
    const buf = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (!scopeCanvas) return
      const w = scopeCanvas.width, h = scopeCanvas.height
      // Dark CRT-style background with subtle phosphor grid
      ctx.fillStyle = '#0a0301'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255, 60, 24, 0.08)'
      ctx.lineWidth = 1
      for (let x = 0; x <= w; x += w / 8) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      }
      for (let y = 0; y <= h; y += h / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      }
      analyser.getFloatTimeDomainData(buf)
      ctx.shadowColor = 'rgba(255, 60, 24, 0.7)'
      ctx.shadowBlur = 4
      ctx.strokeStyle = '#ff3818'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = (i / buf.length) * w
        const y = (1 - (buf[i]! * 0.5 + 0.5)) * h
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
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

  const WAVE_OPTS = [
    { value: 'sawtooth' as const, label: 'Saw' },
    { value: 'square' as const,   label: 'Sqr' },
    { value: 'triangle' as const, label: 'Tri' },
    { value: 'sine' as const,     label: 'Sin' },
    { value: 'noise' as const,    label: 'Nse' },
  ]
  const OCT_OPTS = [
    { value: -2, label: '-2' }, { value: -1, label: '-1' },
    { value: 0,  label: '0'  }, { value: 1,  label: '+1' }, { value: 2, label: '+2' },
  ]
  const FILT_OPTS = [
    { value: 'lp24' as const, label: 'LP24' },
    { value: 'lp12' as const, label: 'LP12' },
    { value: 'bp12' as const, label: 'BP12' },
    { value: 'bp6'  as const, label: 'BP6'  },
    { value: 'hp12' as const, label: 'HP12' },
  ]
  const LFO_SHAPE_OPTS = [
    { value: 'tri' as const,         label: 'Tri' },
    { value: 'square' as const,      label: 'Sqr' },
    { value: 'sample-hold' as const, label: 'S&H' },
    { value: 'random' as const,      label: 'Rnd' },
  ]

  // Mod matrix slots displayed (matches PLAN §3.3)
  const MOD_SLOTS: { slot: ModSlot; label: string }[] = [
    { slot: 'lfo1ToCutoff',     label: 'LFO1→Cutoff' },
    { slot: 'lfo1ToOsc1Pitch',  label: 'LFO1→Pitch' },
    { slot: 'lfo2ToOsc2Pwm',    label: 'LFO2→PWM2' },
    { slot: 'lfo2ToAmp',        label: 'LFO2→Amp' },
    { slot: 'env1ToOsc2Pitch',  label: 'Env1→Pitch2' },
    { slot: 'velToCutoff',      label: 'Vel→Cutoff' },
  ]

  onMount(() => {
    return () => { cancelAnimationFrame(stepRaf); sequencer?.stop() }
  })
</script>

<svelte:window onpointerdown={() => started || start()} />

<div class="chassis">
  <!-- Hinge strip — suggests the slanted panel of the real Synthex -->
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
          <div class="name-display">{store.patch.name}</div>
        </div>
        <canvas bind:this={scopeCanvas} width="320" height="60" class="scope"></canvas>
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
        {:else if started}
          <span class="no-midi">NO WEBMIDI</span>
        {/if}
      </div>
    </header>

    {#if !started}
      <div class="overlay">
        <div class="overlay-inner">
          <div class="overlay-brand">SYNTHEX</div>
          <div class="overlay-tagline">A faithful web tribute to the Elka Synthex</div>
          <button onclick={start} disabled={starting}>
            {starting ? '◌ INITIALISING…' : '▶ POWER ON'}
          </button>
          {#if startError}
            <pre class="err">Error: {startError}</pre>
            <p class="hint-err">Check the browser DevTools console for the full stack.</p>
          {/if}
        </div>
      </div>
    {/if}

  <div class="layout">
    <aside class="left">
      <PatchBrowser currentName={store.patch.name} onload={loadPatch} />
    </aside>

    <div class="panels">
      <!-- DCO 1 -->
      <Panel title="DCO 1">
        <Selector value={store.patch.upper.osc1.wave} options={WAVE_OPTS} label="Wave"
          onchange={(v) => set('upper.osc1.wave', v)} />
        <Selector value={store.patch.upper.osc1.octave} options={OCT_OPTS} label="Oct"
          onchange={(v) => set('upper.osc1.octave', v)} />
        <Knob label="PWM" value={store.patch.upper.osc1.pwm} min={0.05} max={0.95} default={0.5}
          onchange={(v) => set('upper.osc1.pwm', v)} />
        <Knob label="Glide" value={store.patch.upper.osc1.glide.amount} min={-32} max={31} default={0} unit="st"
          onchange={(v) => set('upper.osc1.glide.amount', v)} />
        <Knob label="Speed" value={store.patch.upper.osc1.glide.speed} min={0.001} max={2} default={0.05} unit="s"
          onchange={(v) => set('upper.osc1.glide.speed', v)} />
      </Panel>

      <!-- DCO 2 -->
      <Panel title="DCO 2">
        <Selector value={store.patch.upper.osc2.wave} options={WAVE_OPTS} label="Wave"
          onchange={(v) => set('upper.osc2.wave', v)} />
        <Selector value={store.patch.upper.osc2.octave} options={OCT_OPTS} label="Oct"
          onchange={(v) => set('upper.osc2.octave', v)} />
        <Knob label="Detune" value={store.patch.upper.osc2.detune} min={-50} max={50} default={0} unit="ct"
          onchange={(v) => set('upper.osc2.detune', v)} />
        <Knob label="PWM" value={store.patch.upper.osc2.pwm} min={0.05} max={0.95} default={0.5}
          onchange={(v) => set('upper.osc2.pwm', v)} />
        <Switch label="Sync" value={store.patch.upper.osc2.sync}
          onchange={(v) => set('upper.osc2.sync', v)} />
        <Knob label="Glide" value={store.patch.upper.osc2.glide.amount} min={-32} max={31} default={0} unit="st"
          onchange={(v) => set('upper.osc2.glide.amount', v)} />
        <Knob label="Speed" value={store.patch.upper.osc2.glide.speed} min={0.001} max={2} default={0.05} unit="s"
          onchange={(v) => set('upper.osc2.glide.speed', v)} />
      </Panel>

      <!-- Mixer -->
      <Panel title="Mix">
        <Knob label="OSC1" value={store.patch.upper.mix.osc1} min={0} max={1} default={0.5}
          onchange={(v) => set('upper.mix.osc1', v)} />
        <Knob label="OSC2" value={store.patch.upper.mix.osc2} min={0} max={1} default={0.5}
          onchange={(v) => set('upper.mix.osc2', v)} />
        <Knob label="Noise" value={store.patch.upper.mix.noise} min={0} max={1} default={0}
          onchange={(v) => set('upper.mix.noise', v)} />
        <Selector value={store.patch.upper.mix.noiseColor} label="Color"
          options={[{value:'white' as const, label:'Wht'},{value:'pink' as const, label:'Pnk'}]}
          onchange={(v) => set('upper.mix.noiseColor', v)} />
        <Knob label="1→2 PWM" value={store.patch.upper.mix.crossMod} min={0} max={1} default={0}
          onchange={(v) => set('upper.mix.crossMod', v)} />
        <Knob label="2→1 PWM" value={store.patch.upper.mix.crossMod2} min={0} max={1} default={0}
          onchange={(v) => set('upper.mix.crossMod2', v)} />
        <Switch label="Ring" value={store.patch.upper.mix.ringMod}
          onchange={(v) => set('upper.mix.ringMod', v)} />
      </Panel>

      <!-- Filter -->
      <Panel title="Filter">
        <Selector value={store.patch.upper.filter.mode} options={FILT_OPTS} label="Mode"
          onchange={(v) => set('upper.filter.mode', v)} />
        <Knob label="Cutoff" value={store.patch.upper.filter.cutoff} min={0} max={1} default={0.6}
          onchange={(v) => set('upper.filter.cutoff', v)} />
        <Knob label="Reso" value={store.patch.upper.filter.resonance} min={0} max={1} default={0.2}
          onchange={(v) => set('upper.filter.resonance', v)} />
        <Knob label="Env" value={store.patch.upper.filter.envAmount} min={-1} max={1} default={0.4}
          onchange={(v) => set('upper.filter.envAmount', v)} />
        <Knob label="Track" value={store.patch.upper.filter.keyTrack} min={0} max={1} default={0.5}
          onchange={(v) => set('upper.filter.keyTrack', v)} />
      </Panel>

      <!-- Envelopes -->
      <Panel title="Filter Env">
        <Knob label="A" value={store.patch.upper.envFilter.a} min={0.001} max={5} default={0.005} unit="s"
          onchange={(v) => set('upper.envFilter.a', v)} />
        <Knob label="D" value={store.patch.upper.envFilter.d} min={0.001} max={5} default={0.4} unit="s"
          onchange={(v) => set('upper.envFilter.d', v)} />
        <Knob label="S" value={store.patch.upper.envFilter.s} min={0} max={1} default={0.5}
          onchange={(v) => set('upper.envFilter.s', v)} />
        <Knob label="R" value={store.patch.upper.envFilter.r} min={0.001} max={5} default={0.3} unit="s"
          onchange={(v) => set('upper.envFilter.r', v)} />
      </Panel>
      <Panel title="Amp Env">
        <Knob label="A" value={store.patch.upper.envAmp.a} min={0.001} max={5} default={0.005} unit="s"
          onchange={(v) => set('upper.envAmp.a', v)} />
        <Knob label="D" value={store.patch.upper.envAmp.d} min={0.001} max={5} default={0.2} unit="s"
          onchange={(v) => set('upper.envAmp.d', v)} />
        <Knob label="S" value={store.patch.upper.envAmp.s} min={0} max={1} default={0.85}
          onchange={(v) => set('upper.envAmp.s', v)} />
        <Knob label="R" value={store.patch.upper.envAmp.r} min={0.001} max={5} default={0.3} unit="s"
          onchange={(v) => set('upper.envAmp.r', v)} />
      </Panel>

      <!-- LFOs (with Synthex Depth A / Depth B routing knobs) -->
      <Panel title="LFO 1">
        <Selector value={store.patch.upper.lfo1.shape} options={LFO_SHAPE_OPTS} label="Shape"
          onchange={(v) => set('upper.lfo1.shape', v)} />
        <Knob label="Rate" value={store.patch.upper.lfo1.rate} min={0.05} max={20} default={5} unit="Hz"
          onchange={(v) => set('upper.lfo1.rate', v)} />
        <Knob label="Delay" value={store.patch.upper.lfo1.delay} min={0} max={5} default={0} unit="s"
          onchange={(v) => set('upper.lfo1.delay', v)} />
        <Knob label="Depth A" value={store.patch.upper.lfo1.depthA} min={0} max={1} default={1}
          onchange={(v) => set('upper.lfo1.depthA', v)} />
        <Knob label="Depth B" value={store.patch.upper.lfo1.depthB} min={0} max={1} default={1}
          onchange={(v) => set('upper.lfo1.depthB', v)} />
        <Switch label="Sync" value={store.patch.upper.lfo1.sync}
          onchange={(v) => set('upper.lfo1.sync', v)} />
      </Panel>
      <Panel title="LFO 2">
        <Selector value={store.patch.upper.lfo2.shape} options={LFO_SHAPE_OPTS} label="Shape"
          onchange={(v) => set('upper.lfo2.shape', v)} />
        <Knob label="Rate" value={store.patch.upper.lfo2.rate} min={0.05} max={20} default={0.4} unit="Hz"
          onchange={(v) => set('upper.lfo2.rate', v)} />
        <Knob label="Delay" value={store.patch.upper.lfo2.delay} min={0} max={5} default={0} unit="s"
          onchange={(v) => set('upper.lfo2.delay', v)} />
        <Knob label="Depth A" value={store.patch.upper.lfo2.depthA} min={0} max={1} default={1}
          onchange={(v) => set('upper.lfo2.depthA', v)} />
        <Knob label="Depth B" value={store.patch.upper.lfo2.depthB} min={0} max={1} default={1}
          onchange={(v) => set('upper.lfo2.depthB', v)} />
        <Switch label="Sync" value={store.patch.upper.lfo2.sync}
          onchange={(v) => set('upper.lfo2.sync', v)} />
      </Panel>

      <!-- Mod matrix -->
      <Panel title="Mod Matrix">
        {#each MOD_SLOTS as ms (ms.slot)}
          <Knob label={ms.label} value={store.patch.upper.modMatrix[ms.slot]} min={-1} max={1} default={0}
            onchange={(v) => set(`upper.modMatrix.${ms.slot}`, v)} />
        {/each}
      </Panel>

      <!-- FX -->
      <Panel title="Chorus">
        <Switch label="On" value={store.patch.fx.chorus.enabled}
          onchange={(v) => set('fx.chorus.enabled', v)} />
        <Selector value={store.patch.fx.chorus.mode} options={[
          {value: 1 as const, label: 'I'}, {value: 2 as const, label: 'II'}, {value: 3 as const, label: 'III'}
        ]} label="Mode" onchange={(v) => set('fx.chorus.mode', v)} />
        <Knob label="Mix" value={store.patch.fx.chorus.mix} min={0} max={1} default={0.4}
          onchange={(v) => set('fx.chorus.mix', v)} />
        <Knob label="Rate" value={store.patch.fx.chorus.rate} min={0} max={1} default={0.5}
          onchange={(v) => set('fx.chorus.rate', v)} />
        <Knob label="Depth" value={store.patch.fx.chorus.depth} min={0} max={1} default={0.5}
          onchange={(v) => set('fx.chorus.depth', v)} />
      </Panel>
      <Panel title="Echo">
        <Switch label="On" value={store.patch.fx.delay.enabled}
          onchange={(v) => set('fx.delay.enabled', v)} />
        <Selector value={store.patch.fx.delay.mode} label="Mode"
          options={[{value:'standard' as const,label:'Std'},{value:'tape' as const,label:'Tape'},{value:'pingpong' as const,label:'P-P'}]}
          onchange={(v) => set('fx.delay.mode', v)} />
        <Knob label="Time" value={store.patch.fx.delay.time} min={0.01} max={2} default={0.25} unit="s"
          onchange={(v) => set('fx.delay.time', v)} />
        <Knob label="Fbk" value={store.patch.fx.delay.feedback} min={0} max={0.95} default={0.3}
          onchange={(v) => set('fx.delay.feedback', v)} />
        <Knob label="Tone" value={store.patch.fx.delay.tone} min={0} max={1} default={0.5}
          onchange={(v) => set('fx.delay.tone', v)} />
        <Knob label="Spread" value={store.patch.fx.delay.spread} min={0} max={1} default={0.3}
          onchange={(v) => set('fx.delay.spread', v)} />
        <Knob label="Mix" value={store.patch.fx.delay.mix} min={0} max={1} default={0.2}
          onchange={(v) => set('fx.delay.mix', v)} />
      </Panel>
      <Panel title="Reverb">
        <Switch label="On" value={store.patch.fx.reverb.enabled}
          onchange={(v) => set('fx.reverb.enabled', v)} />
        <Selector value={store.patch.fx.reverb.algorithm} label="Algo"
          options={[{value:'plate' as const,label:'Plate'},{value:'room' as const,label:'Room'},{value:'hall' as const,label:'Hall'},{value:'galactic' as const,label:'Gal'}]}
          onchange={(v) => set('fx.reverb.algorithm', v)} />
        <Knob label="Size" value={store.patch.fx.reverb.size} min={0} max={1} default={0.4}
          onchange={(v) => set('fx.reverb.size', v)} />
        <Knob label="Damp" value={store.patch.fx.reverb.damping} min={0} max={1} default={0.5}
          onchange={(v) => set('fx.reverb.damping', v)} />
        <Knob label="Mix" value={store.patch.fx.reverb.mix} min={0} max={1} default={0.15}
          onchange={(v) => set('fx.reverb.mix', v)} />
      </Panel>

      <!-- Master + Performance -->
      <Panel title="Master">
        <Knob label="Volume" value={store.patch.master.volume} min={0} max={1} default={0.8}
          onchange={(v) => set('master.volume', v)} />
        <Knob label="Tune" value={store.patch.master.tune} min={-12} max={12} default={0} unit="st"
          onchange={(v) => set('master.tune', v)} />
        <Knob label="Fine" value={store.patch.master.fineTune} min={-50} max={50} default={0} unit="ct"
          onchange={(v) => set('master.fineTune', v)} />
        <Knob label="Poly" value={store.patch.master.polyphony} min={1} max={16} default={8} step={1}
          onchange={(v) => set('master.polyphony', v)} />
        <Knob label="Uni Det" value={store.patch.master.unisonDetune} min={0} max={1} default={0.15}
          onchange={(v) => set('master.unisonDetune', v)} />
        <Switch label="Limit" value={store.patch.master.limiter}
          onchange={(v) => set('master.limiter', v)} />
      </Panel>

      <Panel title="Voice">
        <Selector value={store.patch.voiceMode} label="Layer"
          options={[{value:'single' as const,label:'Sgl'},{value:'split' as const,label:'Spl'},{value:'double' as const,label:'Dbl'}]}
          onchange={(v) => set('voiceMode', v)} />
        <Selector value={store.patch.upper.keyAssign} label="Assign"
          options={[{value:'poly' as const,label:'Poly'},{value:'mono' as const,label:'Mono'},{value:'unison' as const,label:'Uni'}]}
          onchange={(v) => set('upper.keyAssign', v)} />
        <Switch label="Multi-Trig" value={store.patch.upper.multiTrigger}
          onchange={(v) => set('upper.multiTrigger', v)} />
        <Knob label="Pan" value={store.patch.upper.pan} min={-1} max={1} default={0}
          onchange={(v) => set('upper.pan', v)} />
        <Knob label="Glide" value={store.patch.upper.glide.time} min={0} max={2} default={0} unit="s"
          onchange={(v) => set('upper.glide.time', v)} />
        <Knob label="Split" value={store.patch.splitPoint} min={24} max={96} default={60} step={1}
          onchange={(v) => set('splitPoint', v)} />
      </Panel>

      <Panel title="Arpeggiator">
        <Switch label="On" value={store.patch.arp?.enabled ?? false}
          onchange={(v) => { set('arp.enabled', v); arp.setEnabled(v) }} />
        <Selector value={store.patch.arp?.pattern ?? 'up'} label="Pattern"
          options={[{value:'up' as const,label:'Up'},{value:'down' as const,label:'Dn'},{value:'updown' as const,label:'U/D'},{value:'random' as const,label:'Rnd'}]}
          onchange={(v) => { set('arp.pattern', v); arp.pattern = v }} />
        <Knob label="Range" value={store.patch.arp?.range ?? 1} min={1} max={4} default={1} step={1}
          onchange={(v) => { set('arp.range', v); arp.range = v }} />
        <Knob label="Rate" value={store.patch.arp?.rate ?? 8} min={0.5} max={32} default={8} unit="Hz"
          onchange={(v) => { set('arp.rate', v); arp.rate = v }} />
        <Knob label="Gate" value={store.patch.arp?.gateLength ?? 0.5} min={0.05} max={1} default={0.5}
          onchange={(v) => { set('arp.gateLength', v); arp.gateLength = v }} />
        <Switch label="Hold" value={store.patch.arp?.hold ?? false}
          onchange={(v) => { set('arp.hold', v); arp.setHold(v) }} />
      </Panel>

      <Panel title="Chord Mem">
        <Switch label="On" value={store.patch.chordMemory?.enabled ?? false}
          onchange={(v) => { set('chordMemory.enabled', v); chord.enabled = v }} />
        <button class="learn" class:active={learningChord}
          onclick={() => {
            if (learningChord) {
              chord.finishLearn(); learningChord = false
              // Mutate the patch directly — array values bypass the scalar setParam path.
              if (store.patch.chordMemory) store.patch.chordMemory.notes = chord.notes
            } else {
              chord.startLearn(); learningChord = true
            }
          }}>{learningChord ? '◉ Learning…' : 'Learn'}</button>
        <div class="cm-info">{(store.patch.chordMemory?.notes.length ?? 0)} notes</div>
      </Panel>
    </div>
  </div>

  <section class="bottom">
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
    <div class="keyboard-rig">
      <div class="cheek left" aria-hidden="true"></div>
      <div class="kbd-row">
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
      <div class="cheek right" aria-hidden="true"></div>
    </div>
    <p class="hint">
      Computer keyboard: <kbd>Z</kbd>/<kbd>Q</kbd> rows · <kbd>−</kbd>/<kbd>=</kbd> octave shift · drag knobs · Shift = fine · Cmd = coarse · double-click = default
    </p>
  </section>
  </main>
</div>

<style>
  /* ─────────────────────────────────────────────────────────────────────
     Synthex theme — Italian industrial 80s. Cream-painted aluminum panel,
     screen-printed orange section bands, recessed knobs with white pointers,
     red 7-segment LED display, walnut end-cheeks on the keyboard.
     ───────────────────────────────────────────────────────────────────── */
  :global(:root) {
    --cream:        #e3dac0;
    --cream-light:  #ede5cd;
    --cream-deep:   #c8be9f;
    --paper-warm:   #d8cdac;
    --ink:          #1a1410;
    --ink-soft:     #5a5044;
    --orange:       #d65a1c;
    --orange-bright:#ee6e2a;
    --orange-dark:  #a04014;
    --led:          #ff3018;
    --led-glow:     rgba(255, 48, 24, 0.55);
    --wood-1:       #c08858;
    --wood-2:       #8b5a30;
    --wood-3:       #5a3a1c;
    --metal:        #cfc6b0;
  }

  :global(html, body) {
    margin: 0;
    background: #2a2520;
    color: var(--ink);
    font-family: 'Saira Condensed', 'Helvetica Neue', sans-serif;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  :global(*, *::before, *::after) { box-sizing: border-box; }

  /* The chassis: outer matte black bezel housing the cream panel. */
  .chassis {
    max-width: 1480px;
    margin: 1rem auto 2rem;
    background:
      linear-gradient(180deg, #15110d 0%, #1f1a14 100%);
    padding: 14px 14px 16px;
    border-radius: 6px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.06) inset,
      0 -1px 0 rgba(0, 0, 0, 0.55) inset,
      0 12px 30px rgba(0, 0, 0, 0.55),
      0 2px 4px rgba(0, 0, 0, 0.4);
  }

  /* Hinge strip — chrome highlight at the top edge suggesting the slanted
     panel of the real instrument. */
  .hinge {
    height: 8px;
    margin-bottom: 6px;
    border-radius: 2px;
    background:
      linear-gradient(180deg, #5a5346 0%, #2a241c 50%, #80766a 75%, #d8cfb9 100%);
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.3);
  }

  main {
    background:
      /* paper-grain texture */
      repeating-linear-gradient(
        45deg,
        transparent 0,
        transparent 2px,
        rgba(0, 0, 0, 0.012) 2px,
        rgba(0, 0, 0, 0.012) 3px
      ),
      repeating-linear-gradient(
        -45deg,
        transparent 0,
        transparent 4px,
        rgba(255, 255, 255, 0.025) 4px,
        rgba(255, 255, 255, 0.025) 5px
      ),
      linear-gradient(180deg, var(--cream-light) 0%, var(--cream) 30%, var(--paper-warm) 100%);
    padding: 1rem 1.2rem 1.5rem;
    border-radius: 4px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18),
      inset 0 0 30px rgba(0, 0, 0, 0.05);
  }

  /* ─── Top brand bar ─── */
  .top {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 1.25rem;
    align-items: end;
    margin-bottom: 1rem;
    padding-bottom: 0.85rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.18);
  }
  .brand { display: flex; flex-direction: column; gap: 0.15rem; }
  .logo {
    font-family: 'Audiowide', 'Saira Condensed', sans-serif;
    font-size: 2.4rem;
    line-height: 0.9;
    color: var(--ink);
    letter-spacing: 0.04em;
    transform: skewX(-6deg);
    text-shadow:
      0 1px 0 rgba(255, 255, 255, 0.5),
      1px 2px 0 rgba(0, 0, 0, 0.12);
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
    color: var(--cream-light);
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
    font-size: 1.6rem;
    color: var(--led);
    text-shadow: 0 0 6px var(--led-glow), 0 0 14px var(--led-glow);
    letter-spacing: 0.05em;
    line-height: 1;
  }
  .name-display {
    background: #1a0606;
    border: 1px solid #000;
    border-radius: 2px;
    padding: 0.4rem 0.7rem;
    color: var(--led);
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.95rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-shadow: 0 0 4px var(--led-glow);
    box-shadow:
      inset 0 0 10px rgba(0, 0, 0, 0.7),
      inset 0 0 14px rgba(255, 48, 24, 0.12);
    min-width: 12rem;
    line-height: 1;
  }
  .scope {
    background: #0a0301;
    border: 2px solid #000;
    border-radius: 3px;
    box-shadow:
      inset 0 0 12px rgba(0, 0, 0, 0.85),
      0 1px 0 rgba(255, 255, 255, 0.4);
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
    background: var(--cream-light);
    color: var(--ink);
    border: 1px solid rgba(0, 0, 0, 0.3);
    padding: 0.18rem 0.35rem;
    border-radius: 2px;
    font: inherit;
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.78rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }
  .no-midi {
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: var(--ink-soft);
  }

  /* ─── Power-on overlay ─── */
  .overlay {
    position: fixed;
    inset: 0;
    background:
      radial-gradient(circle at center, rgba(214, 90, 28, 0.15) 0%, rgba(20, 12, 8, 0.95) 60%);
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
    background:
      linear-gradient(180deg, var(--cream-light) 0%, var(--cream) 60%, var(--paper-warm) 100%);
    border: 1px solid rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      0 12px 40px rgba(0, 0, 0, 0.5);
  }
  .overlay-brand {
    font-family: 'Audiowide', sans-serif;
    font-size: 3rem;
    color: var(--ink);
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
    margin-bottom: 0.4rem;
  }
  .overlay button {
    background: linear-gradient(180deg, var(--orange-bright) 0%, var(--orange) 60%, var(--orange-dark) 100%);
    color: var(--cream-light);
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

  /* ─── Main panel grid ─── */
  .layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 0.85rem;
  }
  .panels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.75rem;
    align-content: start;
  }

  /* ─── Bottom: sequencer + keyboard rig ─── */
  .bottom {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Walnut wood end-cheeks flank the keyboard. */
  .keyboard-rig {
    display: grid;
    grid-template-columns: 28px 1fr 28px;
    gap: 0;
    align-items: stretch;
    background: #15110d;
    border-radius: 4px;
    padding: 5px;
    box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.55);
  }
  .cheek {
    background:
      linear-gradient(180deg, var(--wood-1) 0%, var(--wood-2) 50%, var(--wood-3) 100%),
      repeating-linear-gradient(
        90deg, transparent 0, transparent 1px,
        rgba(0, 0, 0, 0.07) 1px, rgba(0, 0, 0, 0.07) 2px
      );
    background-blend-mode: multiply;
    border: 1px solid rgba(0, 0, 0, 0.4);
    border-radius: 3px;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -2px 4px rgba(0, 0, 0, 0.3);
    position: relative;
  }
  /* Wood grain stripes */
  .cheek::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(
        180deg,
        transparent 0,
        transparent 5px,
        rgba(0, 0, 0, 0.08) 5px,
        rgba(0, 0, 0, 0.08) 6px
      );
    border-radius: 3px;
    pointer-events: none;
    mix-blend-mode: multiply;
  }

  .kbd-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.5rem;
    align-items: stretch;
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
    background: linear-gradient(180deg, var(--cream) 0%, var(--cream-deep) 100%);
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 3px;
    align-self: stretch;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1);
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
    background: linear-gradient(180deg, #5e5645, #2a241c);
    padding: 2px;
    border-radius: 3px;
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.5);
  }
  .oct-group button {
    width: 22px;
    height: 22px;
    background: linear-gradient(180deg, #f5efdc 0%, #d8ceb2 60%, #b3a786 100%);
    border: 0;
    color: var(--ink);
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
  .learn {
    background: linear-gradient(180deg, var(--cream-light), var(--cream-deep));
    color: var(--orange);
    border: 1px solid rgba(0, 0, 0, 0.25);
    padding: 0.4rem 0.7rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 700;
    font-size: 0.75rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    border-radius: 2px;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18);
  }
  .learn.active {
    background: linear-gradient(180deg, var(--orange-bright), var(--orange-dark));
    color: var(--cream-light);
    text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.3);
  }
  .cm-info {
    font-family: 'Saira Condensed', sans-serif;
    font-size: 0.7rem;
    color: var(--ink-soft);
    align-self: center;
  }
  kbd {
    background: linear-gradient(180deg, var(--cream-light), var(--cream-deep));
    color: var(--ink);
    border: 1px solid rgba(0, 0, 0, 0.25);
    border-radius: 2px;
    padding: 0 0.32rem;
    font-family: 'Saira Condensed', sans-serif;
    font-weight: 600;
    font-size: 0.72rem;
    box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.2);
  }
</style>
