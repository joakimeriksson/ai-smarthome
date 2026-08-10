// Physical Modeling Synth — Main thread controller

const NUM_VOICES = 8;
let audioCtx = null, workletNode = null, analyser = null, keyboard = null;
const pool = new SynthShell.VoicePool(NUM_VOICES);
let sustainOn = false;
const sustainedNotes = new Set();

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
function sendParam(param, value) { if (workletNode) workletNode.port.postMessage({ type: 'param', param, value }); }

// ─── UI Binding ─────────────────────────────────────────────────────────────

const bind = SynthShell.createBinder(sendParam);
const bindSlider = bind.slider, bindSelect = bind.select, bindCheckbox = bind.checkbox;

function initUI() {
  bindSelect('exciter', 'exciter');
  bindSlider('color', 'color');
  bindSlider('brightness', 'brightness');
  bindSlider('decay', 'decay');
  bindSlider('damping', 'damping');
  bindSlider('pickup', 'pickup');
  bindSlider('inharm', 'inharm');
  bindSlider('body-amount', 'bodyAmount');
  bindSlider('body-size', 'bodySize');
  bindSlider('stereo-width', 'stereoWidth');
  bindSlider('master-vol', 'masterVolume');

  bindCheckbox('fx-chorus-on', 'fx.chorus.enabled');
  bindSlider('fx-chorus-rate', 'fx.chorus.rate', { map: v => parseFloat(v)*3, format: v => (parseFloat(v)*3).toFixed(1)+'Hz' });
  bindSlider('fx-chorus-depth', 'fx.chorus.depth', { map: v => parseFloat(v)*0.01 });
  bindSlider('fx-chorus-mix', 'fx.chorus.mix');
  bindCheckbox('fx-delay-on', 'fx.delay.enabled');
  bindSlider('fx-delay-time', 'fx.delay.timeL', { map: v => parseFloat(v)*1.5, format: v => Math.round(parseFloat(v)*1500)+'ms' });
  bindSlider('fx-delay-fb', 'fx.delay.feedback');
  bindSlider('fx-delay-mix', 'fx.delay.mix');
  bindCheckbox('fx-reverb-on', 'fx.reverb.enabled');
  bindSlider('fx-reverb-size', 'fx.reverb.roomSize');
  bindSlider('fx-reverb-damp', 'fx.reverb.damping');
  bindSlider('fx-reverb-mix', 'fx.reverb.mix');
}

// ─── Scope ──────────────────────────────────────────────────────────────────

function initScope() {
  SynthShell.startScope({ canvasId: 'scope', analyser, background: '#0a1a0a', stroke: '#44cc44' });
}

function updateVoiceDisplay() { SynthShell.showVoiceCount('voice-display', pool); }

// ─── Presets ────────────────────────────────────────────────────────────────

const FACTORY_PRESETS = [
  { name: 'Acoustic Guitar', params: { exciter: 0, color: 0.5, brightness: 0.45, decay: 0.5, damping: 0.1, pickup: 0.13, inharm: 0, bodyAmount: 0.3, bodySize: 0.5, stereoWidth: 0.2, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.5, damping: 0.5, mix: 0.15 } } },
  { name: 'Electric Guitar', params: { exciter: 0, color: 0.65, brightness: 0.6, decay: 0.6, damping: 0.05, pickup: 0.17, inharm: 0.03, bodyAmount: 0.0, bodySize: 0.5, stereoWidth: 0.15, masterVolume: 0.8 },
    fx: { chorus: { enabled: true, rate: 0.2, depth: 0.003, mix: 0.2 } } },
  { name: 'Nylon Guitar', params: { exciter: 0, color: 0.3, brightness: 0.3, decay: 0.4, damping: 0.15, pickup: 0.2, inharm: 0, bodyAmount: 0.4, bodySize: 0.6, stereoWidth: 0.25, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.6, mix: 0.2 } } },
  { name: 'Harp', params: { exciter: 0, color: 0.55, brightness: 0.5, decay: 0.85, damping: 0.15, pickup: 0.1, inharm: 0, bodyAmount: 0.2, bodySize: 0.4, stereoWidth: 0.4, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.8, damping: 0.4, mix: 0.3 } } },
  { name: 'Kalimba', params: { exciter: 1, color: 0.7, brightness: 0.6, decay: 0.7, damping: 0.25, pickup: 0.05, inharm: 0.15, bodyAmount: 0.5, bodySize: 0.3, stereoWidth: 0.3, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.7, damping: 0.5, mix: 0.25 } } },
  { name: 'Marimba', params: { exciter: 3, color: 0.35, brightness: 0.35, decay: 0.5, damping: 0.5, pickup: 0.25, inharm: 0.1, bodyAmount: 0.6, bodySize: 0.7, stereoWidth: 0.35, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.5, damping: 0.6, mix: 0.2 } } },
  { name: 'Koto', params: { exciter: 0, color: 0.7, brightness: 0.65, decay: 0.6, damping: 0.3, pickup: 0.08, inharm: 0, bodyAmount: 0.15, bodySize: 0.4, stereoWidth: 0.2, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.4, mix: 0.2 } } },
  { name: 'Clavinet', params: { exciter: 1, color: 0.8, brightness: 0.75, decay: 0.55, damping: 0.15, pickup: 0.05, inharm: 0.08, bodyAmount: 0.0, bodySize: 0.5, stereoWidth: 0.1, masterVolume: 0.8 },
    fx: { chorus: { enabled: true, rate: 0.8, depth: 0.002, mix: 0.15 } } },
  { name: 'Bowed String', params: { exciter: 2, color: 0.4, brightness: 0.5, decay: 0.8, damping: 0.05, pickup: 0.15, inharm: 0, bodyAmount: 0.2, bodySize: 0.5, stereoWidth: 0.2, masterVolume: 0.7 },
    fx: { reverb: { enabled: true, roomSize: 0.7, damping: 0.5, mix: 0.25 } } },
  { name: 'Steel Drum', params: { exciter: 3, color: 0.6, brightness: 0.55, decay: 0.65, damping: 0.3, pickup: 0.3, inharm: 0.25, bodyAmount: 0.4, bodySize: 0.35, stereoWidth: 0.35, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.4, mix: 0.25 } } },
  { name: 'Bell Chime', params: { exciter: 1, color: 0.75, brightness: 0.7, decay: 0.9, damping: 0.1, pickup: 0.12, inharm: 0.3, bodyAmount: 0.2, bodySize: 0.3, stereoWidth: 0.4, masterVolume: 0.7 },
    fx: { reverb: { enabled: true, roomSize: 0.9, damping: 0.3, mix: 0.4 } } },
  { name: 'Sitar', params: { exciter: 0, color: 0.5, brightness: 0.5, decay: 0.75, damping: 0.25, pickup: 0.04, inharm: 0.2, bodyAmount: 0.5, bodySize: 0.6, stereoWidth: 0.15, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.5, mix: 0.2 } } },
];

const presets = new SynthShell.PresetStore({
  storageKey: 'pm-synth-presets',
  factory: FACTORY_PRESETS,
  apply: applyPreset,
  capture: capturePreset,
});

function applyPreset(preset) {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'preset', params: preset.params, fx: preset.fx || {} });
  const p = preset.params;
  const { setControl: set, setSelectValue: setSelect, setChecked: setCheck } = SynthShell;
  setSelect('exciter', p.exciter || 0);
  set('color', p.color); set('brightness', p.brightness);
  set('decay', p.decay); set('damping', p.damping);
  set('pickup', p.pickup); set('inharm', p.inharm);
  set('body-amount', p.bodyAmount); set('body-size', p.bodySize);
  set('stereo-width', p.stereoWidth); set('master-vol', p.masterVolume);
  const fx = preset.fx || {};
  if (fx.chorus) setCheck('fx-chorus-on', fx.chorus.enabled);
  if (fx.delay) setCheck('fx-delay-on', fx.delay.enabled);
  if (fx.reverb) setCheck('fx-reverb-on', fx.reverb.enabled);
}

function capturePreset() {
  const rv = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) : 0; };
  return { params: {
    exciter: parseInt(document.getElementById('exciter').value, 10),
    color: rv('color'), brightness: rv('brightness'), decay: rv('decay'), damping: rv('damping'),
    pickup: rv('pickup'), inharm: rv('inharm'), bodyAmount: rv('body-amount'), bodySize: rv('body-size'),
    stereoWidth: rv('stereo-width'), masterVolume: rv('master-vol'),
  } };
}

function initPresets() { presets.init(); }

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/pm-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'pm-synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
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
    sustainChange: (on) => { sustainOn = on; if (!on) { for (const n of sustainedNotes) noteOff(n); sustainedNotes.clear(); } }
  });
  initUI(); initPresets(); updateVoiceDisplay();
  document.getElementById('start-btn').onclick = startAudio;
});
