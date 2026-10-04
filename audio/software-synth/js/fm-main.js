// FM Synth — Main thread controller

const NUM_VOICES = 8;
const pool = new SynthShell.VoicePool(NUM_VOICES);
let audioCtx = null, workletNode = null, analyser = null, keyboard = null;

let sustainOn = false;
const sustainedNotes = new Set();

function allocateVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) if (voices[i].note === note && voices[i].active) return i;
  for (let i = 0; i < NUM_VOICES; i++) if (!voices[i].active) { voices[i].note = note; voices[i].active = true; voices[i].age = ++voiceAge; return i; }
  let oldest = 0;
  for (let i = 1; i < NUM_VOICES; i++) if (voices[i].age < voices[oldest].age) oldest = i;
  voices[oldest].note = note; voices[oldest].active = true; voices[oldest].age = ++voiceAge;
  return oldest;
}

function releaseVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) if (voices[i].note === note && voices[i].active) { voices[i].active = false; return i; }
  return -1;
}

function noteOn(note, velocity = 100) {
  if (!workletNode) return;
  const v = pool.alloc(note);
  workletNode.port.postMessage({ type: 'noteOn', voice: v, note, velocity });
  updateVoiceDisplay();
  if (keyboard) keyboard.highlightKey(note, true);
}

function noteOff(note) {
  if (!workletNode) return;
  if (sustainOn) { sustainedNotes.add(note); return; }
  const v = pool.release(note);
  if (v >= 0) { workletNode.port.postMessage({ type: 'noteOff', voice: v }); updateVoiceDisplay(); }
  if (keyboard) keyboard.highlightKey(note, false);
}

function sendParam(param, value) {
  if (workletNode) workletNode.port.postMessage({ type: 'param', param, value });
}

// ─── UI Binding ─────────────────────────────────────────────────────────────

const bind = SynthShell.createBinder(sendParam);
const bindSlider = bind.slider, bindSelect = bind.select, bindCheckbox = bind.checkbox;

// Envelope sliders: 1 ms .. 70 s, logarithmic. The times are real — attack
// to the peak, decay/release to -60 dB (see Envelope in dsp-lib.js) — and
// the slow end has to reach the ~10 s decays the converted presets use.
// (70000 is a literal because the studio's sync script extracts this
// function as standalone code.)
function sliderToTime(v) { return 0.001 * Math.pow(70000, parseFloat(v)); }
function timeFormat(v) { const t = sliderToTime(v); return t >= 1 ? t.toFixed(1)+'s' : Math.round(t*1000)+'ms'; }

// ─── Algorithm Diagrams ─────────────────────────────────────────────────────

const ALGO_DIAGRAMS = [
  '6→5→4→3→2→1        [1 carrier]',
  '(5→4→3 + 2)→1  6→5  [1 carrier]',
  '(6→5  4→3)→2→1      [1 carrier]',
  '6→5→4  3→2  1        [3 carriers]',
  '6→5  4→3  2  1       [4 carriers]',
  '6→(5,4,3,2)  1       [5 carriers]',
  '6→5  4→3  2→1        [3 pairs]',
  '6  5  4  3  2  1     [additive]',
];

// Must match ALGORITHMS[].carriers in fm-processor.js.
const ALGO_CARRIERS = [[0],[0],[0],[0,1,3],[0,1,2,4],[0,1,2,3,4],[0,2,4],[0,1,2,3,4,5]];

// ─── Init UI ────────────────────────────────────────────────────────────────

function initUI() {
  // Algorithm selector
  document.querySelectorAll('#algo-buttons button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#algo-buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const algo = parseInt(btn.dataset.algo);
      sendParam('algorithm', algo);
      document.getElementById('algo-diagram').textContent = ALGO_DIAGRAMS[algo];
      updateOpRoles(algo);
    };
  });

  bindSlider('feedback', 'feedback');

  // Operator panels
  for (let i = 0; i < 6; i++) {
    bindCheckbox(`op${i}-on`, `op.${i}.on`);
    bindSelect(`op${i}-ratio`, `op.${i}.ratio`, { map: v => parseFloat(v) });
    bindSlider(`op${i}-fine`, `op.${i}.fine`, { format: v => parseFloat(v).toFixed(2) });
    bindSlider(`op${i}-level`, `op.${i}.level`, { map: v => parseInt(v) / 99, format: v => v });
    bindSlider(`op${i}-velsens`, `op.${i}.velSens`);
    bindSlider(`op${i}-a`, `op.${i}.attack`, { map: sliderToTime, format: timeFormat });
    bindSlider(`op${i}-d`, `op.${i}.decay`, { map: sliderToTime, format: timeFormat });
    bindSlider(`op${i}-s`, `op.${i}.sustain`);
    bindSlider(`op${i}-r`, `op.${i}.release`, { map: sliderToTime, format: timeFormat });
  }

  // LFO
  bindSlider('lfo-rate', 'lfoRate', { format: v => parseFloat(v).toFixed(1)+'Hz' });
  bindSelect('lfo-wave', 'lfoWaveform');
  bindSlider('lfo-pitch', 'lfoPitchDepth', { map: v => parseFloat(v) * 12, format: v => (parseFloat(v)*12).toFixed(1)+'st' });
  bindSlider('lfo-amp', 'lfoAmpDepth');

  // Effects
  bindCheckbox('fx-chorus-on', 'fx.chorus.enabled');
  bindCheckbox('fx-delay-on', 'fx.delay.enabled');
  bindSlider('fx-delay-time', 'fx.delay.timeL', { map: v => parseFloat(v)*1.5, format: v => Math.round(parseFloat(v)*1500)+'ms' });
  bindSlider('fx-delay-fb', 'fx.delay.feedback');
  bindCheckbox('fx-reverb-on', 'fx.reverb.enabled');
  bindSlider('fx-reverb-size', 'fx.reverb.roomSize');
  bindSlider('fx-reverb-mix', 'fx.reverb.mix');
  bindSlider('master-vol', 'masterVolume');

  updateOpRoles(0);
}

function updateOpRoles(algo) {
  const carriers = ALGO_CARRIERS[algo];
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`op${i}-role`);
    if (el) el.textContent = carriers.includes(i) ? 'CARRIER' : 'MOD';
  }
}

// ─── Scope ──────────────────────────────────────────────────────────────────

function initScope() {
  SynthShell.startScope({ canvasId: 'scope', analyser, background: '#1a0d00', stroke: '#ff8800' });
}

function updateVoiceDisplay() { SynthShell.showVoiceCount('voice-display', pool); }

// ─── Presets ────────────────────────────────────────────────────────────────

function op(ratio, fine, level, a, d, s, r, vel) {
  return { on: true, ratio, fine: fine || 1.0, level: level/99, attack: a, decay: d, sustain: s, release: r, velSens: vel !== undefined ? vel : 0.7 };
}
function opOff() { return { on: false, ratio: 1, fine: 1, level: 0, attack: 0.03045, decay: 2.072, sustain: 0, release: 2.072, velSens: 0 }; }

// E.Piano 1, Wurlitzer, DX Brass, Strings and Organ are FITTED against real
// DX7 recordings (soundpacks.com sample pack) by tools/fm-fit — structure from
// the documented patches, numbers by coordinate descent on a harmonic-ladder +
// envelope distance. velSens was added after fitting (the pack is single-
// velocity), so velocity response is convention, not measurement.
const FACTORY_PRESETS = [
  { name: 'E.Piano 1', params: { algorithm: 6, feedback: 0.3, ops: [
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.003045, decay: 10.33, sustain: 0, release: 2.763, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.09134, decay: 5.284, sustain: 0.25, release: 2.072, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.001, level: 0.315, attack: 0.04262, decay: 4.145, sustain: 0, release: 2.763, velSens: 0.3 },
    { on: true, ratio: 14, fine: 1, level: 0.08379, attack: 0.003045, decay: 0.0194, sustain: 0, release: 0.6908, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.999, level: 0.21, attack: 0.03045, decay: 10.57, sustain: 0.15, release: 2.763, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.3, attack: 0.09134, decay: 3.523, sustain: 0.25, release: 2.072, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.5, mix: 0.15 } } },

  { name: 'E.Piano 2', params: { algorithm: 1, feedback: 0.2, ops: [
    op(1, 1, 90, 0.003045, 6.908, 0.2, 4.145, 0.3), op(1, 1, 50, 0.003045, 3.454, 0.0, 2.072, 0.7),
    op(1, 1, 40, 0.003045, 2.072, 0.0, 1.382, 0.8), op(14, 1, 30, 0.003045, 0.5526, 0.0, 0.6908, 0.95),
    op(1, 1, 20, 0.003045, 1.382, 0.0, 0.6908, 0.5), op(1, 1, 15, 0.003045, 5.526, 0.0, 2.072, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { chorus: { enabled: true, rate: 0.3, depth: 0.003, mix: 0.2 } } },

  { name: 'Wurlitzer', params: { algorithm: 6, feedback: 0.768, ops: [
    { on: true, ratio: 1, fine: 1, level: 0.6724, attack: 0.2506, decay: 2.387, sustain: 0, release: 2.418, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.08772, decay: 4.111, sustain: 0.06912, release: 2.072, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1, level: 0.2744, attack: 0.04263, decay: 1.592, sustain: 0, release: 2.418, velSens: 0.3 },
    { on: true, ratio: 7, fine: 1, level: 0.416, attack: 0.003045, decay: 0.2818, sustain: 0.08294, release: 0.6908, velSens: 0.7 },
    { on: true, ratio: 1, fine: 1.002, level: 0.2082, attack: 0.00571, decay: 1.857, sustain: 0, release: 2.418, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.5853, attack: 0.05967, decay: 7.792, sustain: 0.432, release: 2.072, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.4, mix: 0.12 } } },
  { name: 'FM Bass', params: { algorithm: 6, feedback: 0.15, ops: [
    op(1, 1, 90, 0.003045, 1.382, 0.6, 0.6908, 0.3), op(1, 1, 50, 0.003045, 0.8289, 0.0, 0.5526, 0.8),
    op(1, 1, 85, 0.003045, 2.072, 0.5, 1.036, 0.3), op(2, 1, 40, 0.003045, 0.5526, 0.0, 0.3454, 0.9),
    op(0.5, 1, 80, 0.003045, 1.382, 0.7, 0.6908, 0.2), op(1, 1, 30, 0.003045, 0.6908, 0.0, 0.3454, 0.7)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: {} },

  { name: 'Slap Bass', params: { algorithm: 0, feedback: 0.3, ops: [
    op(1, 1, 90, 0.003045, 0.8289, 0.0, 0.5526, 0.5), op(1, 1, 55, 0.003045, 0.4145, 0.0, 0.3454, 0.9),
    op(2, 1, 45, 0.003045, 0.2763, 0.0, 0.2072, 0.9), op(3, 1, 35, 0.003045, 0.2072, 0.0, 0.1382, 0.95),
    op(4, 1, 25, 0.003045, 0.1382, 0.0, 0.06908, 0.95), op(1, 1, 20, 0.003045, 0.3454, 0.0, 0.1382, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: {} },

  { name: 'DX Brass', params: { algorithm: 6, feedback: 0.44, ops: [
    { on: true, ratio: 1, fine: 0.998, level: 0.8075, attack: 0.2557, decay: 3.316, sustain: 0.576, release: 1.036, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.01066, decay: 2.113, sustain: 0.3168, release: 1.036, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.003, level: 0.826, attack: 0.2436, decay: 5.181, sustain: 0.8, release: 1.036, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.4956, attack: 0.6089, decay: 2.072, sustain: 0.5, release: 1.036, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.997, level: 0.425, attack: 0.1522, decay: 3.316, sustain: 0.48, release: 1.036, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.55, attack: 0.1918, decay: 2.072, sustain: 0.5, release: 1.036, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.4, mix: 0.12 } } },

  // Warm Pad is three detuned carrier/modulator pairs (odd ops at ratio 1 and
  // high level, even ops as quiet modulators). It used to name algorithm 4,
  // whose routing was broken (OP2 modulated itself, OP5/OP6 were dead), so
  // what played was a static sine + buzz; with algorithm 4 fixed to the chart
  // it would be a harsh stack. Algorithm 7 (3 pairs) is the patch as written.
  { name: 'Warm Pad', params: { algorithm: 6, feedback: 0.1, ops: [
    op(1, 1, 85, 0.9134, 3.454, 0.8, 5.526, 0.2), op(2, 1, 30, 0.6089, 4.145, 0.2, 3.454, 0.3),
    op(1, 1, 80, 1.218, 4.145, 0.7, 6.217, 0.2), op(3, 1, 25, 0.9134, 3.454, 0.15, 3.454, 0.4),
    op(1, 1.01, 75, 1.522, 3.454, 0.75, 6.908, 0.2), op(2, 1, 20, 1.218, 4.145, 0.1, 4.145, 0.3)
  ], lfoRate: 0.3, lfoPitchDepth: 0, lfoAmpDepth: 0.1 },
  fx: { chorus: { enabled: true, rate: 0.2, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.85, mix: 0.3 } } },

  { name: 'Bright Bell', params: { algorithm: 0, feedback: 0.4, ops: [
    op(1, 1, 85, 0.003045, 13.82, 0.0, 10.36, 0.3), op(1.41, 1, 50, 0.003045, 10.36, 0.0, 6.908, 0.5),
    op(2.83, 1, 40, 0.003045, 8.289, 0.0, 5.526, 0.5), op(7.07, 1, 30, 0.003045, 5.526, 0.0, 3.454, 0.6),
    op(14.1, 1, 18, 0.003045, 2.763, 0.0, 2.072, 0.7), op(1, 1, 25, 0.003045, 6.908, 0.0, 3.454, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.9, mix: 0.35 } } },

  { name: 'Marimba', params: { algorithm: 1, feedback: 0.05, ops: [
    op(1, 1, 90, 0.003045, 1.727, 0.0, 1.036, 0.4), op(4, 1, 40, 0.003045, 0.4145, 0.0, 0.3454, 0.8),
    op(1, 1, 30, 0.003045, 0.8289, 0.0, 0.6908, 0.5), opOff(), opOff(), opOff()
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.5, mix: 0.2 } } },

  { name: 'Organ', params: { algorithm: 7, feedback: 0.256, ops: [
    { on: true, ratio: 0.5, fine: 1.004, level: 1, attack: 0.01218, decay: 0.6908, sustain: 1, release: 0.3454, velSens: 0.3 },
    { on: true, ratio: 1, fine: 0.996, level: 0.2624, attack: 0.0341, decay: 0.2487, sustain: 0.2592, release: 0.3454, velSens: 0.3 },
    { on: true, ratio: 1.5, fine: 1, level: 1, attack: 0.02436, decay: 0.4145, sustain: 0.96, release: 0.3454, velSens: 0.3 },
    { on: true, ratio: 4, fine: 1, level: 0.012, attack: 0.01218, decay: 0.4312, sustain: 0.2304, release: 0.3454, velSens: 0.3 },
    { on: true, ratio: 6, fine: 0.998, level: 0.12, attack: 0.04872, decay: 0.3382, sustain: 0.2488, release: 0.3454, velSens: 0.3 },
    { on: true, ratio: 8, fine: 0.994, level: 0.1416, attack: 0.02436, decay: 0.4228, sustain: 0.553, release: 0.3454, velSens: 0.3 }
  ], lfoRate: 6.24, lfoWaveform: 0, lfoPitchDepth: 0.015, lfoAmpDepth: 0.27 }, fx: { reverb: { enabled: true, roomSize: 0.3, mix: 0.1 } } },

  { name: 'Synth Lead', params: { algorithm: 6, feedback: 0.35, ops: [
    op(1, 1, 88, 0.03045, 1.382, 0.8, 1.036, 0.4), op(1, 1, 50, 0.003045, 0.8289, 0.3, 0.6908, 0.7),
    op(2, 1, 75, 0.03045, 1.727, 0.7, 1.382, 0.4), op(3, 1, 40, 0.003045, 0.5526, 0.2, 0.6908, 0.8),
    op(1, 0.995, 85, 0.03045, 1.382, 0.8, 1.036, 0.4), op(2, 1, 35, 0.003045, 0.8289, 0.15, 0.6908, 0.7)
  ], lfoRate: 5, lfoPitchDepth: 0.3, lfoAmpDepth: 0 }, fx: { delay: { enabled: true, timeL: 0.3, feedback: 0.3, mix: 0.15 } } },

  { name: 'Strings', params: { algorithm: 6, feedback: 0.5, ops: [
    { on: true, ratio: 1, fine: 1, level: 0.5355, attack: 5.541, decay: 8.289, sustain: 0.9, release: 4.145, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.7804, attack: 0.1427, decay: 2.487, sustain: 0.3539, release: 4.145, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.004, level: 0.5898, attack: 5.115, decay: 8.289, sustain: 0.9, release: 4.145, velSens: 0.3 },
    { on: true, ratio: 3, fine: 0.996, level: 0.2752, attack: 4.871, decay: 6.217, sustain: 0.5, release: 4.145, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.996, level: 0.595, attack: 8.354, decay: 8.289, sustain: 0.9, release: 4.145, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.42, attack: 2.238, decay: 7.044, sustain: 0.432, release: 4.145, velSens: 0.6 }
  ], lfoRate: 3.52, lfoWaveform: 0, lfoPitchDepth: 0.03, lfoAmpDepth: 0.3375 }, fx: { chorus: { enabled: true, rate: 0.4, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.7, mix: 0.25 } } },

  { name: 'Tubular Bell', params: { algorithm: 6, feedback: 0.15, ops: [
    op(1, 1, 80, 0.003045, 20.72, 0.0, 13.82, 0.2), op(3.5, 1, 40, 0.003045, 5.526, 0.0, 3.454, 0.5),
    op(2.76, 1, 70, 0.003045, 17.27, 0.0, 10.36, 0.2), op(5.4, 1, 35, 0.003045, 4.145, 0.0, 2.763, 0.5),
    op(7.1, 1, 55, 0.003045, 12.43, 0.0, 6.908, 0.3), op(11, 1, 28, 0.003045, 3.454, 0.0, 2.072, 0.6)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.9, mix: 0.4 } } },
];

const presets = new SynthShell.PresetStore({
  storageKey: 'fm-synth-presets',
  factory: FACTORY_PRESETS,
  apply: (p) => applyPreset(p),
});
function populatePresetSelect() { presets.populateSelect(); }

function applyPreset(preset) {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'preset', params: preset.params, fx: preset.fx || {} });
  updateUIFromPreset(preset);
}

function updateUIFromPreset(preset) {
  const p = preset.params; if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; const v = document.getElementById(id+'-val'); if(v) v.textContent = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val).toFixed(2)) : val; } };
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  const setSelect = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  // Algorithm
  document.querySelectorAll('#algo-buttons button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.algo) === p.algorithm));
  document.getElementById('algo-diagram').textContent = ALGO_DIAGRAMS[p.algorithm || 0];
  updateOpRoles(p.algorithm || 0);
  set('feedback', p.feedback || 0);

  // Operators
  if (p.ops) p.ops.forEach((op, i) => {
    setCheck(`op${i}-on`, op.on);
    setSelect(`op${i}-ratio`, op.ratio);
    set(`op${i}-fine`, op.fine || 1.0);
    set(`op${i}-level`, Math.round((op.level || 0) * 99));
    set(`op${i}-velsens`, op.velSens || 0);
    // ADSR — convert time to slider (inverse of sliderToTime)
    const timeToSlider = t => Math.log(t / 0.001) / Math.log(70000);
    set(`op${i}-a`, timeToSlider(op.attack || 0.01));
    set(`op${i}-d`, timeToSlider(op.decay || 0.3));
    set(`op${i}-s`, op.sustain || 0);
    set(`op${i}-r`, timeToSlider(op.release || 0.3));
  });

  set('master-vol', p.masterVolume || 0.7);
}

function initPresets() { presets.init(); }

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/fm-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'fm-synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
  workletNode.connect(analyser); analyser.connect(audioCtx.destination);
  initScope();
  document.getElementById('start-btn').textContent = 'Audio On';
  document.getElementById('start-btn').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
  keyboard = new SynthKeyboard('piano-keyboard', {
    noteOn: (note, vel) => noteOn(note, vel),
    noteOff: (note) => noteOff(note),
    pitchBend: (val) => sendParam('pitchBend', val),
    sustainChange: (on) => {
      sustainOn = on;
      if (!on) { for (const n of sustainedNotes) noteOff(n); sustainedNotes.clear(); }
    }
  });
  initUI();
  initPresets();
  updateVoiceDisplay();
  document.getElementById('start-btn').onclick = startAudio;
});
