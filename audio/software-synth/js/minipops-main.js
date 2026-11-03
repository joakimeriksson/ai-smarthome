// Mini Pops 7 — main thread controller.
//
// The front panel of the Korg (Keio) Mini Pops 7, 1973: ten rhythm keys that
// can be pressed together, an A/B lever that picks which of each key's two
// rhythms plays, a tempo knob with the two pilot/tempo lamps, and five
// sliders — three "additional rhythm" sounds blended on top (quijada, guiro,
// tambourine), volume and tone balance. The rhythms themselves live in
// js/minipops-processor.js, transcribed from the service manual.

let audioCtx = null, workletNode = null, analyser = null;

// Names only — the hits are the processor's business.
const KEYS_A = ['Waltz', 'Samba', 'Mambo', 'Rumba', 'Tango', 'Bossanova', 'Rock 1', 'Rock 3', 'March 2/4', 'Swing'];
const KEYS_B = ['Jazz Waltz', 'Meringue', 'Cha-cha', 'Beguine', 'Habanera', 'Slow Rock', 'Rock 2', 'Rock 4', 'March 6/8', 'Latin Swing'];
const VOICE_NAMES = ['BD', 'SD1', 'SD2', 'HH', 'CY1', 'CY2', 'CB', 'CO', 'LB', 'SB', 'CL', 'QU', 'GU', 'TA'];
const VOICE_LABELS = ['Bass drum', 'Snare 1', 'Snare 2', 'Hi-hat', 'Cymbal 1', 'Cymbal 2',
  'Cow bell', 'Conga', 'L. bongo', 'S. bongo', 'Claves', 'Quijada', 'Guiro', 'Tambourine'];
const NUM_KEYS = 10;

const keys = new Uint8Array(NUM_KEYS);
let section = 0;           // 0 = A (upper row), 1 = B (lower row)
let playing = false;

function sendParam(param, value) {
  if (workletNode) workletNode.port.postMessage({ type: 'param', param, value });
}
function post(msg) { if (workletNode) workletNode.port.postMessage(msg); }

const bind = SynthShell.createBinder(sendParam);
const bindSlider = bind.slider;

// ─── Rhythm keys and lever ──────────────────────────────────────────────────

function setKey(k, down) {
  keys[k] = down ? 1 : 0;
  sendParam(`key.${k}`, !!down);
  renderKeys();
}

function setSection(s) {
  section = s ? 1 : 0;
  sendParam('section', section);
  renderKeys();
}

function renderKeys() {
  document.querySelectorAll('.mp-key').forEach((el, k) => el.classList.toggle('on', !!keys[k]));
  const bed = document.getElementById('keybed');
  if (bed) { bed.classList.toggle('section-a', section === 0); bed.classList.toggle('section-b', section === 1); }
  const lever = document.getElementById('lever');
  if (lever) {
    lever.classList.toggle('b', section === 1);
    lever.setAttribute('aria-checked', section === 1 ? 'true' : 'false');
  }
  document.getElementById('lamp-a')?.classList.toggle('lit', section === 0);
  document.getElementById('lamp-b')?.classList.toggle('lit', section === 1);
  const names = [];
  for (let k = 0; k < NUM_KEYS; k++) if (keys[k]) names.push((section ? KEYS_B : KEYS_A)[k]);
  const now = document.getElementById('now-playing');
  if (now) now.textContent = names.length ? names.join(' + ') : 'no key down';
}

function buildKeybed() {
  const bed = document.getElementById('keybed');
  if (!bed) return;
  bed.innerHTML = '';
  const rowA = document.createElement('div'); rowA.className = 'mp-legends a';
  const rowK = document.createElement('div'); rowK.className = 'mp-keys';
  const rowB = document.createElement('div'); rowB.className = 'mp-legends b';
  for (let k = 0; k < NUM_KEYS; k++) {
    const a = document.createElement('span'); a.textContent = KEYS_A[k]; rowA.appendChild(a);
    const b = document.createElement('span'); b.textContent = KEYS_B[k]; rowB.appendChild(b);
    const key = document.createElement('button');
    key.className = 'mp-key';
    key.type = 'button';
    key.title = `${KEYS_A[k]} / ${KEYS_B[k]}  (key ${(k + 1) % 10})`;
    key.setAttribute('aria-label', `${KEYS_A[k]} / ${KEYS_B[k]}`);
    key.setAttribute('aria-pressed', 'false');
    key.onclick = () => { setKey(k, !keys[k]); key.setAttribute('aria-pressed', keys[k] ? 'true' : 'false'); };
    rowK.appendChild(key);
  }
  bed.append(rowA, rowK, rowB);
}

// ─── Tone generator pads, lamps, step dots ──────────────────────────────────

function buildVoices() {
  const box = document.getElementById('voices');
  if (!box) return;
  box.innerHTML = '';
  VOICE_NAMES.forEach((name, i) => {
    const pad = document.createElement('button');
    pad.className = 'mp-pad';
    pad.type = 'button';
    pad.innerHTML = `<span class="mp-pad-led"></span><span class="mp-pad-name">${VOICE_LABELS[i]}</span>`;
    pad.title = `${VOICE_LABELS[i]} — click to audition`;
    pad.onclick = () => post({ type: 'trigger', voice: i, velocity: 1 });
    box.appendChild(pad);
  });
}

const flashTimers = new Array(VOICE_NAMES.length).fill(0);
function flashVoices(mask) {
  const pads = document.querySelectorAll('.mp-pad');
  for (let i = 0; i < pads.length; i++) {
    if (!(mask & (1 << i))) continue;
    pads[i].classList.add('hit');
    clearTimeout(flashTimers[i]);
    flashTimers[i] = setTimeout(() => pads[i].classList.remove('hit'), 90);
  }
}

let lastLen = 0;
function showStep(step, len, div) {
  const dots = document.getElementById('steps');
  if (dots) {
    if (len !== lastLen) {
      dots.innerHTML = '';
      for (let i = 0; i < len; i++) {
        const d = document.createElement('span');
        d.className = 'mp-dot' + (i % div === 0 ? ' beat' : '');
        dots.appendChild(d);
      }
      lastLen = len;
    }
    dots.querySelectorAll('.mp-dot').forEach((d, i) => d.classList.toggle('cur', i === step));
  }
  // The lamp of the selected section flashes on the first beat of every bar.
  const bar = len === 12 && div === 3 ? 12 : len / 2;
  if (step % bar === 0) {
    const lamp = document.getElementById(section ? 'lamp-b' : 'lamp-a');
    if (lamp) { lamp.classList.add('flash'); setTimeout(() => lamp.classList.remove('flash'), 120); }
  }
}

function clearStep() {
  document.querySelectorAll('.mp-dot.cur').forEach(d => d.classList.remove('cur'));
}

// ─── Transport ──────────────────────────────────────────────────────────────

function setPlaying(on) {
  playing = on;
  post({ type: on ? 'play' : 'stop' });
  const btn = document.getElementById('play-btn');
  if (btn) { btn.textContent = on ? 'STOP' : 'START'; btn.classList.toggle('active', on); }
  if (!on) clearStep();
}

// ─── Presets ────────────────────────────────────────────────────────────────

/**
 * A rhythm selection as a preset: the lever, which keys are down, and the
 * three additional-rhythm sliders. One entry per key and section gives the
 * twenty rhythms of the manual; `extra` blends in the slider sounds.
 */
function rhythm(name, sec, down, extra = {}) {
  const params = { section: sec };
  const list = Array.isArray(down) ? down : [down];
  for (let k = 0; k < 10; k++) params[`key.${k}`] = list.includes(k);
  params.quijada = extra.quijada ?? 0;
  params.guiro = extra.guiro ?? 0;
  params.tambourine = extra.tambourine ?? 0;
  return { name, params };
}

const FACTORY_PRESETS = [
  rhythm('Waltz', 0, 0),
  rhythm('Samba', 0, 1),
  rhythm('Mambo', 0, 2),
  rhythm('Rumba', 0, 3),
  rhythm('Tango', 0, 4),
  rhythm('Bossanova', 0, 5),
  rhythm('Rock 1', 0, 6),
  rhythm('Rock 3', 0, 7),
  rhythm('March 2/4', 0, 8),
  rhythm('Swing', 0, 9),
  rhythm('Jazz Waltz', 1, 0),
  rhythm('Meringue', 1, 1),
  rhythm('Cha-cha', 1, 2),
  rhythm('Beguine', 1, 3),
  rhythm('Habanera', 1, 4),
  rhythm('Slow Rock', 1, 5),
  rhythm('Rock 2', 1, 6),
  rhythm('Rock 4', 1, 7),
  rhythm('March 6/8', 1, 8),
  rhythm('Latin Swing', 1, 9),
  // The manual's "special tonal effects": the slider sounds blended in.
  rhythm('Cha-cha + Guiro', 1, 2, { guiro: 0.6 }),
  rhythm('Samba + Tambourine', 0, 1, { tambourine: 0.5 }),
  rhythm('Beguine + Quijada', 1, 3, { quijada: 0.55 }),
  // Two keys at once, the trick the machine is remembered for.
  rhythm('Rock 1 + Bossanova', 0, [5, 6]),
  rhythm('Rumba + Swing', 0, [3, 9]),
];

function applyPreset(preset) {
  const p = preset.params || {};
  if ('section' in p) section = p.section ? 1 : 0;
  for (let k = 0; k < NUM_KEYS; k++) keys[k] = p[`key.${k}`] ? 1 : 0;
  for (const id of ['quijada', 'guiro', 'tambourine', 'volume', 'balance', 'tempo']) {
    if (p[id] !== undefined) SynthShell.setControl(id, p[id]);
  }
  post({ type: 'preset', params: p });
  renderKeys();
  document.querySelectorAll('.mp-key').forEach((el, k) => el.setAttribute('aria-pressed', keys[k] ? 'true' : 'false'));
}

function capturePreset() {
  const params = { section };
  for (let k = 0; k < NUM_KEYS; k++) params[`key.${k}`] = !!keys[k];
  for (const id of ['quijada', 'guiro', 'tambourine', 'balance']) {
    const el = document.getElementById(id);
    if (el) params[id] = parseFloat(el.value);
  }
  return { params };
}

// ─── Audio ──────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/minipops-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'minipops-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
  workletNode.connect(analyser); analyser.connect(audioCtx.destination);
  workletNode.port.onmessage = (e) => {
    if (e.data.type === 'step') showStep(e.data.step, e.data.len, e.data.div);
    else if (e.data.type === 'hits') flashVoices(e.data.mask);
  };
  // Push the panel's state into the fresh processor.
  for (let k = 0; k < NUM_KEYS; k++) sendParam(`key.${k}`, !!keys[k]);
  sendParam('section', section);
  for (const id of ['tempo', 'volume', 'balance', 'quijada', 'guiro', 'tambourine']) {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(new Event('input'));
  }
  document.querySelectorAll('#trims input[type="range"]').forEach(el => el.dispatchEvent(new Event('input')));
  SynthShell.startScope({ analyser, background: '#0b0b0d', stroke: '#ffb26b' });
  const btn = document.getElementById('start-btn');
  btn.textContent = 'Audio On'; btn.disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
  buildKeybed();
  buildVoices();
  renderKeys();

  bindSlider('tempo', 'tempo', { decimals: 0 });
  bindSlider('volume', 'volume');
  bindSlider('balance', 'balance');
  bindSlider('quijada', 'quijada');
  bindSlider('guiro', 'guiro');
  bindSlider('tambourine', 'tambourine');
  bindSlider('trim-sd1', 'trim.SD1');
  bindSlider('trim-sd2', 'trim.SD2');
  bindSlider('trim-hh', 'trim.HH');
  bindSlider('trim-cy1', 'trim.CY1');
  bindSlider('trim-cy2', 'trim.CY2');
  bindSlider('trim-ta', 'trim.TA');
  bindSlider('quijada-pitch', 'quijadaPitch');
  bindSlider('guiro-pitch', 'guiroPitch');

  document.getElementById('start-btn').onclick = startAudio;
  document.getElementById('play-btn').onclick = () => setPlaying(!playing);
  document.getElementById('lever').onclick = () => setSection(section ? 0 : 1);

  const presets = new SynthShell.PresetStore({
    storageKey: 'minipops-presets',
    factory: FACTORY_PRESETS,
    apply: applyPreset,
    capture: capturePreset,
  });
  presets.init();
  const sel = document.getElementById('preset-select');
  if (sel && sel.options[0]) sel.options[0].textContent = '-- Rhythm --';

  // Keys 1-9, 0 press the rhythm keys; A / B move the lever; space starts.
  const isTextEntry = (el) => el.isContentEditable || el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type));
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target) || e.repeat) return;
    if (/^[0-9]$/.test(e.key)) {
      const k = (parseInt(e.key, 10) + 9) % 10;
      e.preventDefault();
      setKey(k, !keys[k]);
    } else if (e.key === 'a' || e.key === 'A') setSection(0);
    else if (e.key === 'b' || e.key === 'B') setSection(1);
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && !isTextEntry(e.target)) e.preventDefault();
  });
});
