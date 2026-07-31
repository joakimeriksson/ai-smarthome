/**
 * Tests for the VA DSP that need no plugin and no audio device.
 *
 * These check the synth against things that are true by construction - a saw's
 * harmonics fall as 1/n, an envelope reaches its stages on time, an LFO runs at
 * the rate asked for, unison spreads detune symmetrically. They cannot tell us
 * whether we match Zenology; that is what the compare harness is for. They CAN
 * tell us whether the engine does what it claims, which is what stopped being
 * obvious once LFOs, unison and cross-mod went in.
 *
 *   node webui/compare/dsp-test.mjs
 */

import { VAVoice, VAOsc, Env, LFO, SCALE } from "../static/va-dsp.js";

const SR = 44100;
let pass = 0, fail = 0;

function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${detail}`); }
}
function close(a, b, tol) { return Math.abs(a - b) <= tol; }

/** Naive DFT magnitude at one frequency - enough for harmonic checks. */
function magAt(buf, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = (TAU * hz * i) / SR;
    re += buf[i] * Math.cos(t); im -= buf[i] * Math.sin(t);
  }
  return Math.hypot(re, im) / buf.length;
}
const TAU = Math.PI * 2;

// --- oscillator ------------------------------------------------------------
{
  const osc = new VAOsc(SR);
  osc.form = "SAW";
  const n = SR;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = osc.tick(220);
  const h = [1, 2, 3, 4, 5].map((k) => magAt(buf, 220 * k));
  // a sawtooth's harmonic amplitudes fall as 1/n
  ok("saw h2 is ~1/2 of h1", close(h[1] / h[0], 0.5, 0.08), `got ${(h[1]/h[0]).toFixed(3)}`);
  ok("saw h3 is ~1/3 of h1", close(h[2] / h[0], 1 / 3, 0.08), `got ${(h[2]/h[0]).toFixed(3)}`);
  ok("saw h4 is ~1/4 of h1", close(h[3] / h[0], 0.25, 0.08), `got ${(h[3]/h[0]).toFixed(3)}`);

  const sq = new VAOsc(SR); sq.form = "SQR"; sq.pw = 0.5;
  const b2 = new Float32Array(n);
  for (let i = 0; i < n; i++) b2[i] = sq.tick(220);
  const e = [1, 2, 3].map((k) => magAt(b2, 220 * k));
  ok("square has no even harmonic at 50% duty", e[1] / e[0] < 0.05,
     `h2/h1 = ${(e[1]/e[0]).toFixed(3)}`);
  ok("square h3 is ~1/3", close(e[2] / e[0], 1 / 3, 0.1), `got ${(e[2]/e[0]).toFixed(3)}`);

  const sin = new VAOsc(SR); sin.form = "SIN";
  const b3 = new Float32Array(n);
  for (let i = 0; i < n; i++) b3[i] = sin.tick(220);
  ok("sine is pure", magAt(b3, 440) / magAt(b3, 220) < 0.02);

  // PW must deform non-square waveforms too - Roland's manual says so
  const a = new VAOsc(SR), b = new VAOsc(SR);
  a.form = b.form = "SAW"; a.pw = 0.5; b.pw = 0.9;
  let diff = 0;
  for (let i = 0; i < 2000; i++) diff += Math.abs(a.tick(220) - b.tick(220));
  ok("pulse width deforms a SAW", diff > 1, `total diff ${diff.toFixed(2)}`);
}

// --- envelope --------------------------------------------------------------
{
  // amp envelope: T1 is the attack; with L1 at full it should reach ~1
  const env = new Env(SR, { T1: 0, T2: 0, T3: 0, T4: 300, L1: 1023, L2: 1023, L3: 1023 },
                      { amp: true });
  env.noteOn();
  for (let i = 0; i < SR * 0.05; i++) env.tick();
  ok("instant attack reaches full", env.value > 0.95, `value ${env.value.toFixed(3)}`);
  env.noteOff();
  let n = 0;
  while (!env.done && n < SR * 10) { env.tick(); n++; }
  ok("release completes", env.done, `after ${(n / SR).toFixed(2)}s`);

  const slow = new Env(SR, { T1: 800, T2: 0, T3: 0, T4: 0, L1: 1023, L2: 1023, L3: 1023 },
                       { amp: true });
  slow.noteOn();
  for (let i = 0; i < SR * 0.01; i++) slow.tick();
  ok("slow attack is still low after 10 ms", slow.value < 0.5, `value ${slow.value.toFixed(3)}`);
}

// --- LFO -------------------------------------------------------------------
{
  const lfo = new LFO(SR, { form: { value: 1, label: "TRI" }, rate: 650 });
  const want = SCALE.lfoHz(650);
  let crossings = 0, prev = lfo.tick();
  const secs = 4;
  for (let i = 1; i < SR * secs; i++) {
    const v = lfo.tick();
    if (prev < 0 && v >= 0) crossings++;
    prev = v;
  }
  ok("LFO runs at the requested rate",
     close(crossings / secs, want, want * 0.1),
     `measured ${(crossings / secs).toFixed(2)} Hz, wanted ${want.toFixed(2)}`);

  const delayed = new LFO(SR, { form: { value: 1, label: "TRI" }, rate: 650, delay: 500 });
  ok("LFO delay holds output at zero", Math.abs(delayed.tick()) < 1e-9);
}

// --- voice / unison --------------------------------------------------------
function patch(over = {}) {
  const p = {
    name: "test", playable: true,
    common: { LEVEL: 127, OCTAVE: 0, PIT_CRS: 0, PIT_FINE: 0 },
    voice: { UNISON_SW: 0, UNISON_SIZE: 4, UNISON_DETN: 20 },
    structure: { pair12: { value: 0, label: "OFF" }, pair34: { value: 0, label: "OFF" },
                 RING12_LEVEL: 127, XMOD12_DEPTH: 1200 },
    partials: [{
      index: 1, on: true, synthesised: true,
      osc: { OSC_TYPE: { value: 1, label: "VA" }, VA_FORM: { value: 0, label: "SAW" },
             PW: 64, PWM_DEPTH: 0, OSC_ATT: 255 },
      pitch: { PIT_CRS: 0, PIT_FINE: 0, PIT_KF: 100 },
      amp: { LEVEL: 127, PAN: 0, LEVEL_VSENS: 0 },
      filter: { FILTER_TYPE: { value: 0, label: "OFF" }, CUTOFF: 1023, RESO: 0 },
      penv: { DEPTH: 0 }, fenv: { DEPTH: 0 },
      aenv: { T1: 0, T2: 0, T3: 0, T4: 300, L1: 1023, L2: 1023, L3: 1023 },
      lfo1: {}, lfo2: {},
    }],
  };
  return { ...p, ...over };
}

function render(p, note = 57, secs = 0.5) {
  const n = Math.round(secs * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const v = new VAVoice(SR, p);
  v.noteOn(note, 100);
  v.process(L, R, n);
  return { L, R, v };
}

{
  const { L } = render(patch());
  const peak = L.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
  ok("voice produces sound", peak > 0.01, `peak ${peak.toFixed(4)}`);

  // A3 = 220 Hz: the fundamental should dominate
  const seg = L.subarray(SR * 0.1, SR * 0.4);
  ok("voice plays the right pitch",
     magAt(seg, 220) > magAt(seg, 330) && magAt(seg, 220) > magAt(seg, 110));

  const uni = patch();
  uni.voice = { UNISON_SW: 1, UNISON_SIZE: 8, UNISON_DETN: 50 };
  const u = render(uni);
  ok("unison builds the requested stack", u.v.stacks.length === 8,
     `got ${u.v.stacks.length}`);
  const det = u.v.stacks.map((s) => s.detune);
  ok("unison detune is symmetric",
     close(det[0], -det[det.length - 1], 1e-6), `${det[0]} vs ${det[det.length-1]}`);
  ok("unison stays in range", Math.max(...det.map(Math.abs)) <= 50 + 1e-9);

  // panning must actually differ between channels
  const pan = patch();
  pan.partials[0].amp.PAN = -60;
  const pr = render(pan);
  const rms = (b) => Math.sqrt(b.reduce((a, x) => a + x * x, 0) / b.length);
  ok("pan moves the image", rms(pr.L) > rms(pr.R) * 1.5,
     `L ${rms(pr.L).toFixed(4)} R ${rms(pr.R).toFixed(4)}`);

  // velocity sensitivity
  const vs = patch();
  vs.partials[0].amp.LEVEL_VSENS = 100;
  const nq = Math.round(0.3 * SR);
  const soft = new Float32Array(nq), softR = new Float32Array(nq);
  const loud = new Float32Array(nq), loudR = new Float32Array(nq);
  const v1 = new VAVoice(SR, vs); v1.noteOn(57, 20); v1.process(soft, softR, nq);
  const v2 = new VAVoice(SR, vs); v2.noteOn(57, 127); v2.process(loud, loudR, nq);
  ok("velocity changes level", rms(loud) > rms(soft) * 1.3,
     `soft ${rms(soft).toFixed(4)} loud ${rms(loud).toFixed(4)}`);

  // a PCM patch must not be playable by a VA-only synth
  const pcm = patch();
  pcm.partials[0].synthesised = false;
  const q = render(pcm);
  ok("PCM partials are silent here",
     q.L.reduce((a, x) => Math.max(a, Math.abs(x)), 0) < 1e-9);
}

// --- filter ----------------------------------------------------------------
{
  const open = patch(), shut = patch();
  open.partials[0].filter = { FILTER_TYPE: { value: 1, label: "LPF" }, CUTOFF: 1023, RESO: 0 };
  shut.partials[0].filter = { FILTER_TYPE: { value: 1, label: "LPF" }, CUTOFF: 200, RESO: 0 };
  const a = render(open).L.subarray(SR * 0.1, SR * 0.4);
  const b = render(shut).L.subarray(SR * 0.1, SR * 0.4);
  const bright = (s) => magAt(s, 1760) / (magAt(s, 220) + 1e-12);
  ok("closing the filter removes highs", bright(b) < bright(a) * 0.5,
     `open ${bright(a).toFixed(4)} shut ${bright(b).toFixed(4)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
