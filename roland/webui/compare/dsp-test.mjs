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

import { VAVoice, VAOsc, Env, LFO, SCALE, Filter, VCF_MODELS, TvfFilter, TVF, HighPass, VCF_EXTRA, ENV, WAVES, SSAW } from "../static/va-dsp.js";

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

// --- saw PW morph (measured against Zenology 2.0.9) ------------------------
{
  const hs = (pw) => {
    const o = new VAOsc(SR); o.form = "SAW"; o.pw = 0.5 + (pw - 64) / 127;
    const buf = new Float32Array(SR);
    for (let i = 0; i < SR; i++) buf[i] = o.tick(220);
    return [1, 2, 3, 4, 5].map((k) => magAt(buf, 220 * k));
  };
  const tri = hs(0);
  ok("SAW at PW 0 is a triangle: no even harmonics", tri[1] / tri[0] < 0.01,
     `h2/h1 = ${(tri[1]/tri[0]).toFixed(4)}`);
  ok("SAW at PW 0 is a triangle: h3 ~ 1/9", close(tri[2] / tri[0], 1 / 9, 0.01),
     `got ${(tri[2]/tri[0]).toFixed(4)}`);
  const quarter = hs(32);
  ok("SAW at PW 32 has its null at harmonic 4", quarter[3] / quarter[0] < 0.01,
     `h4/h1 = ${(quarter[3]/quarter[0]).toFixed(4)}`);
  const mirror = hs(96);
  ok("SAW morph is symmetric about PW 64",
     [1, 2, 4].every((k) => close(mirror[k] / mirror[0], quarter[k] / quarter[0], 0.01)));
}

// --- matrix control ---------------------------------------------------------
{
  const mx = (src, dst, sens) => [
    { src: { value: 0, label: src }, dst: [
      { dst: { value: 0, label: dst }, sens },
      { dst: { value: 0, label: "OFF" }, sens: 0 },
      { dst: { value: 0, label: "OFF" }, sens: 0 },
      { dst: { value: 0, label: "OFF" }, sens: 0 }] }];
  const h2of = (p, vel) => {
    const n = Math.round(0.4 * SR), L = new Float32Array(n), R = new Float32Array(n);
    const v = new VAVoice(SR, p); v.noteOn(57, vel); v.process(L, R, n);
    const seg = L.subarray(SR * 0.1);
    return { r: magAt(seg, 440) / magAt(seg, 220), v };
  };
  const vp = patch();
  vp.partials[0].matrix = mx("VELOCITY", "PW", -31);
  ok("VELOCITY->PW: velocity 1 leaves a plain saw", close(h2of(vp, 1).r, 0.5, 0.03),
     `h2/h1 = ${h2of(vp, 1).r.toFixed(3)}`);
  ok("VELOCITY->PW: velocity 127 makes a near-triangle", h2of(vp, 127).r < 0.03,
     `h2/h1 = ${h2of(vp, 127).r.toFixed(3)}`);

  const past = patch();
  past.partials[0].matrix = mx("VELOCITY", "PW", 63);
  ok("matrix can push the saw all the way to a triangle", h2of(past, 127).r < 0.005,
     `h2/h1 = ${h2of(past, 127).r.toFixed(4)}`);

  const wheel = patch();
  wheel.partials[0].matrix = mx("SYS-CTRL1", "PW", 63);
  ok("an untouched controller source changes nothing", close(h2of(wheel, 100).r, 0.5, 0.03));

  const odd = patch();
  odd.partials[0].matrix = mx("VELOCITY", "CHO", 20);
  const { v } = h2of(odd, 100);
  ok("unsupported destinations are reported, not dropped",
     v.stacks[0].partials[0].dsp.unsupported.includes("VELOCITY->CHO"));
}

// --- VA filter (measured against Zenology 2.0.9, renders/fs + renders/fd) ---
{
  // steady-state gain of the Filter at one frequency
  const gain = (hz, fc, k, poles, amp = 0.01) => {
    const f = new Filter(SR), n = SR;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const y = f.process(amp * Math.sin(TAU * hz * i / SR), fc, k, poles);
      if (i > n / 2) peak = Math.max(peak, Math.abs(y));
    }
    return peak / amp;
  };
  const db = (g) => 20 * Math.log10(g);
  for (const [poles, want] of [[2, -12], [3, -18], [4, -24]]) {
    const oct = db(gain(3200, 100, 0, poles)) - db(gain(1600, 100, 0, poles));
    ok(`slope tap ${poles} falls ~${want} dB/oct`, close(oct, want, 2), `got ${oct.toFixed(1)}`);
  }
  // feedback is always from stage 4, so resonance costs the same passband at every tap
  const pb = [2, 3, 4].map((p) => db(gain(20, 2000, 2, p)));
  ok("resonance k=2 costs -9.5 dB passband at every slope",
     pb.every((v) => close(v, db(1 / 3), 0.3)), pb.map((v) => v.toFixed(2)).join(" "));
  ok("resonance peaks at the stage cutoff",
     gain(1000, 1000, 3.5, 4) > gain(700, 1000, 3.5, 4) && gain(1000, 1000, 3.5, 4) > gain(1400, 1000, 3.5, 4));
  const lo = gain(200, 1000, 0, 4, 0.01), hi = gain(200, 1000, 0, 4, 1);
  ok("the filter is linear at RESO 0, even at full level", close(lo, hi, 1e-3),
     `${lo.toFixed(5)} vs ${hi.toFixed(5)}`);

  const at = (m) => SCALE.cutoffHz(512, m);
  ok("VCF1 at CUTOFF 512 is ~331 Hz", close(at("VCF1"), 331, 3), `${at("VCF1").toFixed(1)}`);
  ok("models order P5 < VCF1 < JP < MG at CUTOFF 512",
     at("P5") < at("VCF1") && at("VCF1") < at("JP") && at("JP") < at("MG"));
  ok("every model has a cutoff law and a resonance curve",
     ["VCF1", "JP", "MG", "P5"].every((m) => VCF_MODELS[m]?.cut?.length && VCF_MODELS[m]?.k?.length));
  ok("cutoff keeps falling below the first table point",
     SCALE.cutoffHz(0, "VCF1") < SCALE.cutoffHz(64, "VCF1") && SCALE.cutoffHz(64, "VCF1") < SCALE.cutoffHz(128, "VCF1"));

  // filter mode: VCF ignores the TVF type (measured - byte-identical in
  // Zenology); TVF mode applies it (Parameter Guide p.28)
  const mode = (m) => ({ value: m === "VCF" ? 1 : 0, label: m });
  const typ = (t) => ({ value: ["OFF", "LPF", "BPF", "HPF"].indexOf(t), label: t });
  const fpatch = (m, t, extra = {}) => {
    const p = patch();
    p.partials[0].filter = { FILTER_MODE: mode(m), FILTER_TYPE: typ(t), CUTOFF: 400, RESO: 300, ...extra };
    return p;
  };
  const same = (x, y) => x.every((v, i) => v === y[i]);
  ok("VCF mode ignores the TVF filter type",
     same(render(fpatch("VCF", "LPF")).L, render(fpatch("VCF", "HPF")).L));
  const seg = (p) => render(p).L.subarray(SR * 0.1, SR * 0.4);
  const lowShare = (x) => magAt(x, 220) / (magAt(x, 1760) + 1e-12);
  ok("TVF mode applies the type: HPF keeps far less low end than LPF",
     lowShare(seg(fpatch("TVF", "HPF"))) < lowShare(seg(fpatch("TVF", "LPF"))) * 0.1);
  const sl = (v, l) => ({ value: v, label: l });
  ok("TVF -18 runs as -12 (Parameter Guide)",
     same(render(fpatch("TVF", "LPF", { FILTER_SLOPE: sl(1, "-18") })).L,
          render(fpatch("TVF", "LPF", { FILTER_SLOPE: sl(0, "-12") })).L));
  const lpf2 = (r) => render(fpatch("TVF", "LPF2", { FILTER_TYPE: { value: 5, label: "LPF2" }, RESO: r })).L;
  ok("TVF LPF2 ignores resonance (Parameter Guide)", same(lpf2(0), lpf2(900)));
}

// --- TVF (measured against Zenology 2.0.9, renders/tvf) ---------------------
{
  // steady-state TVF gain at one frequency, relative to the TVF path gain
  const tg = (type, hz, fc, reso, poles = 2, amp = 0.01) => {
    const f = new TvfFilter(SR); let pk = 0;
    for (let i = 0; i < SR; i++) {
      const y = f.process(amp * Math.sin(TAU * hz * i / SR), fc, reso, type, poles);
      if (i > SR / 2) pk = Math.max(pk, Math.abs(y));
    }
    return 20 * Math.log10(pk / amp);
  };
  const g0 = 20 * Math.log10(TVF.gain);
  ok("TVF path is ~+1.1 dB over the VCF path", close(g0, 1.16, 0.1), g0.toFixed(2));
  ok("TVF LPF passes lows at the path gain", close(tg("LPF", 30, 331, 0), g0, 0.3));
  ok("TVF HPF passes highs at the path gain", close(tg("HPF", 8000, 331, 0), g0, 0.5));
  ok("TVF LPF -12 falls ~12 dB/oct", close(tg("LPF", 3200, 100, 0) - tg("LPF", 1600, 100, 0), -12, 1.5));
  ok("TVF LPF -24 falls ~24 dB/oct", close(tg("LPF", 3200, 100, 0, 4) - tg("LPF", 1600, 100, 0, 4), -24, 2));
  ok("TVF resonance costs no passband level",
     close(tg("LPF", 30, 331, 896), tg("LPF", 30, 331, 0), 0.3));
  ok("TVF resonance peaks at the cutoff", tg("LPF", 331, 331, 640) > tg("LPF", 30, 331, 640) + 15);
  ok("TVF LPF is fully open at the top of the range (RESO 0)",
     [200, 2000, 12000].every((hz) => close(tg("LPF", hz, 22000, 0), g0, 0.2)));
  ok("TVF resonance survives near the top (peak at ~7.7 kHz)",
     tg("LPF", 7700, 22000, 512) > tg("LPF", 1000, 22000, 512) + 10);
  ok("TVF PKG boosts the cutoff ~4.8 dB at RESO 0",
     close(tg("PKG", 331, 331, 0) - tg("PKG", 30, 331, 0), 4.8, 1.0));
  ok("TVF LPF3 stays stable where 1/F < 2", isFinite(tg("LPF3", 1000, 6000, 0)));
  ok("TVF LPF2 ignores resonance", close(tg("LPF2", 331, 331, 900), tg("LPF2", 331, 331, 0), 1e-6));
}

// --- VCF-mode highpass and gain correction (renders/vcf-hpf, renders/vcf-gc) -
{
  const hg = (hz, fc) => {
    const h = new HighPass(SR); let pk = 0;
    for (let i = 0; i < SR; i++) {
      const y = h.process(Math.sin(TAU * hz * i / SR), fc, 0, 1);
      if (i > SR / 2) pk = Math.max(pk, Math.abs(y));
    }
    return 20 * Math.log10(pk);
  };
  ok("VCF HPF is one-pole: -6 dB/oct below its cutoff", close(hg(50, 1000) - hg(25, 1000), 6, 0.5));
  ok("VCF HPF table and gain correction are present",
     VCF_EXTRA.hpf?.length >= 8 && close(VCF_EXTRA.gc, 1.18, 0.1));
}

// --- envelopes (measured against Zenology 2.0.9, renders/aenv, adsr, penv) -
{
  const dB = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  // run an envelope; returns a sampler of its value at time t (s)
  const runEnv = (stages, opts, secs, offAt = null) => {
    const e = new Env(SR, stages, opts); e.noteOn();
    const buf = new Float64Array(Math.round(secs * SR));
    for (let i = 0; i < buf.length; i++) { if (offAt !== null && i === Math.round(offAt * SR)) e.noteOff(); buf[i] = e.tick(); }
    return { at: (t) => buf[Math.min(buf.length - 1, Math.round(t * SR))], e };
  };
  const hold = { T1: 0, T2: 0, T3: 0, T4: 0, L1: 1023, L2: 1023 };
  ok("amp, ADSR off: sustain L3 512 sits at the exponential law's -24.9 dB",
     close(dB(runEnv({ ...hold, L3: 512 }, { amp: true }, 0.5).at(0.4)), -24.9, 0.3));
  ok("amp, ADSR on: sustain L3 512 is linear, -6.0 dB",
     close(dB(runEnv({ ...hold, L3: 512 }, { amp: true, adsr: true }, 0.5).at(0.4)), -6.02, 0.1));
  const a = runEnv({ ...hold, T1: 512, L3: 1023 }, { amp: true }, 2);
  const ta = ENV.attack.find(([v]) => v === 512)[1];
  ok("amp attack 512 completes at its measured time (~1.39 s), fast start",
     a.at(ta * 0.5) > 0.6 && a.at(ta * 0.5) < 0.8 && a.at(ta * 1.02) > 0.999);
  const r = runEnv({ ...hold, T4: 512, L3: 1023 }, { amp: true }, 3, 0.2);
  const tr = ENV.time.find(([v]) => v === 512)[1];
  ok("amp release 512 (ADSR off) ramps the level over the full ~1.65 s",
     close(dB(r.at(0.2 + tr / 2)), dB((Math.pow(2, 511.5 / ENV.b) - 1) / (Math.pow(2, 1023 / ENV.b) - 1)), 0.5)
     && r.at(0.2 + tr * 1.01) === 0);
  const full = runEnv({ ...hold, T4: 256, L3: 1023 }, { amp: true, adsr: true }, 1, 0.2);
  const half = runEnv({ ...hold, T4: 256, L3: 512 }, { amp: true, adsr: true }, 1, 0.2);
  const drop = (x, s0) => dB(x.at(0.3)) - dB(x.at(s0));
  ok("amp, ADSR on: release falls at the same dB rate from half level as from full",
     close(drop(full, 0.199), drop(half, 0.199), 1.0), `${drop(full, 0.199).toFixed(2)} vs ${drop(half, 0.199).toFixed(2)}`);
  ok("pitch: level 511 at depth 100 is +60 semitones", close(SCALE.pitchSemis(511, 100), 60, 0.05));
  ok("pitch: depth 50 is ~11.75 semitones at full level", close(SCALE.pitchSemis(511, 50), 11.75, 0.05));
  ok("pitch: negative depth mirrors", close(SCALE.pitchSemis(256, -50), -SCALE.pitchSemis(256, 50), 1e-9));
  const p = runEnv({ T1: 512, T2: 0, T3: 0, T4: 0, L0: 0, L1: 511, L2: 511, L3: 511, L4: 0 }, {}, 2);
  ok("pitch envelope segments are straight lines over the shared time table",
     close(p.at(tr / 2) * 1023, 511 / 2, 4) && close(p.at(tr * 1.01) * 1023, 511, 0.5));
}

// --- oscillator levels and shapes (measured, renders/osc/octaves) -----------
{
  const fund = (form, locked = true) => {
    const o = new VAOsc(SR); o.form = form; o.pw = 0.5; o.pwLocked = locked;
    const buf = new Float32Array(SR);
    for (let i = 0; i < SR; i++) buf[i] = o.tick(130.81);
    return { h: (k) => magAt(buf.subarray(SR / 4), 130.81 * k) };
  };
  const dB = (x) => 20 * Math.log10(x);
  const saw = fund("SAW").h(1);
  ok("every VA waveform has captured tables", ["SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"]
     .every((f) => WAVES.tables?.[f]?.length === 6));
  for (const [form, want] of [["SQR", 0.14], ["TRI", -0.81], ["SIN", -0.02], ["RAMP", -5.0], ["JUNO", -9.2], ["SIN2", -0.01]]) {
    const got = dB(fund(form).h(1) / saw);
    ok(`${form} fundamental sits ${want} dB from SAW's (Zenology's levelling)`, close(got, want, 0.3), got.toFixed(2));
  }
  ok("the analytic square (PW moving) keeps the table's level",
     close(dB(fund("SQR", false).h(1) / fund("SQR").h(1)), 0, 0.3));
  ok("JUNO's energy is in the 2nd harmonic, as captured", fund("JUNO").h(2) > fund("JUNO").h(1));
}

// --- SuperSAW (measured against Zenology 2.0.9, renders/ssaw) ---------------
{
  const run = (detune, { pw = 0.5, secs = 1, hz = 261.63 } = {}) => {
    const o = new VAOsc(SR); o.form = "SSAW"; o.pw = pw; o.setDetune(detune); o.reset(0);
    const b = new Float32Array(Math.round(secs * SR));
    for (let i = 0; i < b.length; i++) b[i] = o.tick(hz);
    return b;
  };
  ok("SuperSAW has 14 voices with fixed detunes", SSAW.cents?.length === 14 && SSAW.phase?.length === 14);
  const at = (d) => SSAW.amp[SSAW.detune.indexOf(d)];
  const outer = (row) => Math.max(...row.slice(7)), inner = (row) => Math.max(...row.slice(0, 7));
  ok("detune 0 is the inner stack, the outer 15+ dB down", outer(at(0)) < inner(at(0)) * 0.18);
  ok("detune 127 has the outer stack louder than the inner", outer(at(127)) > inner(at(127)));
  const a = run(64), b = run(64);
  ok("every note restarts at the same phases (Zenology's is sample-identical)", a.every((v, i) => v === b[i]));
  const p0 = run(64, { pw: 0 }), p1 = run(64, { pw: 1 });
  ok("SuperSAW ignores PW (Zenology: byte-identical)", p0.every((v, i) => v === p1[i]));
  // the highpass: energy at each voice's exact k-th harmonic, with and without
  const hz = 1046.5, secs = 4;
  const render = (hpf) => {
    const o = new VAOsc(SR); o.form = "SSAW"; o.setDetune(127); o.reset(0);
    if (!hpf) o.ssawHpf = 0;
    const b = new Float32Array(secs * SR);
    for (let i = 0; i < b.length; i++) b[i] = o.tick(hz);
    return b.subarray(SR / 2);
  };
  const withF = render(true), without = render(false);
  const energy = (buf, k) => SSAW.cents.reduce((e, c) => e + magAt(buf, k * hz * Math.pow(2, c / 1200)) ** 2, 0);
  const d1 = 10 * Math.log10(energy(withF, 1) / energy(without, 1));
  const d3 = 10 * Math.log10(energy(withF, 3) / energy(without, 3));
  ok("the pitch-tracking highpass takes ~3.6 dB off the fundamental at detune 127",
     close(d1, -3.6, 0.6), `${d1.toFixed(2)} dB`);
  ok("... and leaves the 3rd harmonic alone", close(d3, 0, 0.3), `${d3.toFixed(2)} dB`);
}

// --- FAT, square PW, velocity and level laws (measured, renders/gap) --------
{
  const osc = (form, { fat = 64, pw = 64, hz = 220, secs = 1 } = {}) => {
    const o = new VAOsc(SR); o.form = form; o.pw = 0.5 + (pw - 64) / 127; o.setFat(fat); o.reset(0);
    const b = new Float32Array(Math.round(secs * SR));
    for (let i = 0; i < b.length; i++) b[i] = o.tick(hz);
    return b.subarray(SR / 4);
  };
  const rms = (b) => Math.sqrt(b.reduce((a, x) => a + x * x, 0) / b.length);
  const f64 = osc("SAW"), f0 = osc("SAW", { fat: 0 }), f32 = osc("SAW", { fat: 32 });
  ok("FAT 64 has no energy an octave down", magAt(f64, 110) < magAt(f64, 220) * 0.01);
  ok("FAT 0 plays a full octave down", magAt(f0, 110) > magAt(f0, 220));
  ok("FAT changes no level (Zenology: rms constant)", close(rms(f0) / rms(f64), 1, 0.03) && close(rms(f32) / rms(f64), 1, 0.03));
  ok("FAT 127 equals FAT 0 (both a full octave down)",
     close(magAt(osc("SAW", { fat: 127 }), 110), magAt(f0, 110), magAt(f0, 110) * 0.05));
  const q32 = osc("SQR", { pw: 32 });
  ok("SQR PW 32 is a 25% pulse: harmonic 4 vanishes", magAt(q32, 880) < magAt(q32, 220) * 0.02);
  const q0 = osc("SQR", { pw: 0 }), q1 = osc("SQR", { pw: 1 });
  ok("SQR PW 0 and 1 are the same clamped pulse", q0.every((v, i) => Math.abs(v - q1[i]) < 1e-9));
  ok("SQR narrows DC-free: PW 0 is ~15 dB below PW 64",
     close(20 * Math.log10(rms(q0) / rms(osc("SQR"))), -15.3, 1.5));

  const tone = (over) => { const p = patch(); Object.assign(p.partials[0].amp, over); return p; };
  const lvl = (p, vel, common = 127) => {
    p.common.LEVEL = common;
    const n = Math.round(0.4 * SR), L = new Float32Array(n), R = new Float32Array(n);
    const v = new VAVoice(SR, p); v.noteOn(57, vel); v.process(L, R, n);
    return rms(L.subarray(SR * 0.1));
  };
  const dB = (a, b) => 20 * Math.log10(a / b);
  ok("LEVEL_VSENS 50: velocity 64 is (64/127)^2 of velocity 127",
     close(dB(lvl(tone({ LEVEL_VSENS: 50 }), 64), lvl(tone({ LEVEL_VSENS: 50 }), 127)), 40 * Math.log10(64 / 127), 0.2));
  ok("LEVEL_VSENS -50 mutes velocity 127", lvl(tone({ LEVEL_VSENS: -50 }), 127) < 1e-6);
  ok("LEVEL_VSENS 0 is flat", close(dB(lvl(tone({ LEVEL_VSENS: 0 }), 20), lvl(tone({ LEVEL_VSENS: 0 }), 127)), 0, 0.05));
  ok("partial LEVEL 64 is (64/127)^2 of 127 (-11.9 dB)",
     close(dB(lvl(tone({ LEVEL: 64, LEVEL_VSENS: 0 }), 100), lvl(tone({ LEVEL: 127, LEVEL_VSENS: 0 }), 100)), -11.95, 0.1));
  ok("tone LEVEL 59 is (59/127)^2 of 127 (-13.3 dB)",
     close(dB(lvl(tone({ LEVEL_VSENS: 0 }), 100, 59), lvl(tone({ LEVEL_VSENS: 0 }), 100, 127)), -13.32, 0.1));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
