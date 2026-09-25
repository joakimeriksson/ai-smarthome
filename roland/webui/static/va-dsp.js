/**
 * ZEN-Core virtual-analog voice - pure DSP, no Web Audio, no DOM.
 *
 * Imported unchanged by BOTH the AudioWorklet (webui/static/va-processor.js)
 * and the offline renderer (webui/compare/render.mjs). Do not fork it: the
 * Synthex project duplicated its DSP between worklet and renderer and the two
 * drifted, which is exactly the bug this arrangement avoids.
 *
 * Input is the JSON from GET /api/tone/<i>/va - see zencore/va.py.
 *
 * ---------------------------------------------------------------------------
 * CALIBRATION: everything in SCALE below is a GUESS about how Roland's integer
 * parameter ranges map to real units. Nothing here has been measured against
 * Zenology yet. These are the knobs the compare harness exists to fit; treat
 * any value marked UNFITTED as unproven, in the same spirit as the rest of the
 * project. Do not "tidy" them into looking authoritative.
 * ---------------------------------------------------------------------------
 */

/** Fit parameters. The sweep sets globalThis.__ZC_SCALE to try alternatives
 *  without editing this file; the defaults below are what ships. */
const K = (globalThis.__ZC_SCALE ??= {});

export const SCALE = {
  // cutoff 0..1023 -> Hz, exponential: base * 2^(v/1023 * octaves).  FITTED
  // 2026-09-23 against Zenology 2.0.9 "MEAS SAW" (user slot 5: one VA saw,
  // LPF -24, reso 0, KF 0, velocity 1). Reproduce with
  //   webui/compare/zen_bank.py --slot 5 --param PCMT_PTL_1.CUTOFF \
  //     --values 192,256,...,896 --out renders/cutoff
  //   webui/compare/fit_cutoff.py renders/cutoff
  // Measured on CUTOFF 320..640 (6 points, notes 36/48/60, within 29 cents);
  // the endpoints 0 -> 5.5 Hz and 1023 -> 19.2 kHz are extrapolated. Below 320
  // the corner is under the test notes' fundamentals and cannot be located;
  // above ~640 our filter's SHAPE stops matching Zenology's (residual 0.7 dB at
  // 640, 4.2 dB at 896) - a filter-model problem, not a constant.
  cutoffHz: (v) => (K.cutBase ?? 5.505) * Math.pow(2, (v / 1023) * (K.cutOct ?? 11.767)),
  // envelope time 0..1023 -> seconds, exponential, scaled by envMul. UNFITTED
  envTime: (v) => (K.envMul ?? 1) * 0.001 * Math.pow(2, (v / 1023) * 13),
  // envelope level 0..1023 -> linear 0..1.                        UNFITTED
  envLevel: (v) => v / 1023,
  // pitch-env level -511..511 with depth -100..100 -> semitones.  UNFITTED
  pitchSemis: (level, depth) => (level / 511) * (depth / 100) * 48,
  // LFO rate 0..1023 -> Hz, assumed exponential 0.05..~30 Hz.     UNFITTED
  lfoHz: (v) => 0.05 * Math.pow(2, (v / 1023) * 9),
  // resonance 0..1023 -> filter feedback. Feedback at RESO 0 MEASURED 2026-09-22:
  // Zenology's reso-0 lowpass matches a plain cascade (feedback 0) best on all
  // three notes of the MEAS SAW fit; 0.707 roughly doubled the residual. The
  // slope above 0 is still UNFITTED.
  resoQ: (v) => (K.resoBase ?? 0) + (v / 1023) * 12,
};

const TAU = Math.PI * 2;

/** Unwrap {value,label} from the API, or pass a plain number through. */
const raw = (f, dflt = 0) =>
  f == null ? dflt : (typeof f === "object" ? f.value : f);
const label = (f) => (f && typeof f === "object" ? f.label : null);

/* -------------------------------------------------------------------------
 * Oscillator
 * ---------------------------------------------------------------------- */

/** polyBLEP - removes most of the aliasing from the discontinuous shapes. */
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** polyBLAMP - the same correction for a kink (a jump in slope) rather than a
 *  jump in value. Scale by the slope change per sample. */
function blamp(t, dt) {
  if (t < dt) { t = t / dt - 1; return -t * t * t / 3; }
  if (t > 1 - dt) { t = (t - 1) / dt + 1; return t * t * t / 3; }
  return 0;
}

export class VAOsc {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.phase = 0;
    this.form = "SAW";
    this.pw = 0.5;
    this.syncedThisSample = false;
  }

  reset(phase = 0) { this.phase = phase; }

  /** Advance one sample at `hz`; returns [-1,1]. Sets syncedThisSample when
   *  the phase wrapped, which is what a sync slave listens for. */
  tick(hz) {
    const dt = hz / this.sr;
    this.phase += dt;
    this.syncedThisSample = this.phase >= 1;
    if (this.syncedThisSample) this.phase -= Math.floor(this.phase);
    return this.shape(this.phase, dt);
  }

  /** Roland applies PULSE WIDTH to VA waveforms other than SQR - the manual
   *  says so explicitly, and factory preset "Kaihou Keys" runs PW=127 on SAW
   *  partials. SAW has its own measured morph (sawMorph); for the other forms
   *  this is a duty-cycle phase warp, identity at PW=64.
   *  UNFITTED for everything but SAW: the warp shape is a guess. */
  warp(p) {
    const w = this.pw;
    if (w <= 0.001 || w >= 0.999 || Math.abs(w - 0.5) < 1e-4) return p;
    return p < w ? 0.5 * (p / w) : 0.5 + 0.5 * ((p - w) / (1 - w));
  }

  /** SAW under PW, MEASURED 2026-09-24 against Zenology 2.0.9 ("MEAS SAW",
   *  PW 0..127, renders/mx-pw): PW 64 is a plain saw, and moving PW either way
   *  turns it into a variable-slope triangle whose short edge takes
   *  |PW-64|/127 of the cycle, capped at a pure triangle (1/2). So PW 0 is a
   *  pure triangle while a stored PW 127 stops just short of one (harmonic 2
   *  at -45 dB) - but a matrix route pushing PW past 127 does reach it, so the
   *  cap is on the shape, not on PW. The harmonic nulls land where that shape
   *  puts them (PW 32: k = 4, 8, 12 at -41..-62 dB) and the level stays
   *  constant, as it does for a fixed-peak triangle.
   *  Aliasing: polyBLAMP on both kinks; it helps little once the short edge is
   *  under ~2 samples (very high notes near PW 64). */
  sawMorph(p, dt) {
    const r = Math.min(0.5, Math.abs(this.pw * 127 - 64) / 127);
    if (r < dt) return 2 * p - 1 - blep(p, dt);          // edge shorter than a sample
    const q = 1 - r;                                      // where the peak sits
    const v = p < q ? -1 + (2 * p) / q : 1 - (2 * (p - q)) / r;
    const k = (2 / r + 2 / q) * dt;                       // slope change per sample
    return v + k * blamp(p, dt) - k * blamp((p - q + 1) % 1, dt);
  }

  shape(p, dt) {
    if (this.form === "SAW") return this.sawMorph(p, dt);
    // SQR carries its own duty cycle; everything else is warped by PW.
    if (this.form !== "SQR" && this.form !== "JUNO") p = this.warp(p);
    switch (this.form) {
      case "RAMP":
        return -(2 * p - 1 - blep(p, dt));
      case "SQR": {
        let v = p < this.pw ? 1 : -1;
        v += blep(p, dt);
        v -= blep((p - this.pw + 1) % 1, dt);
        return v;
      }
      case "TRI": {
        // integrate a square for a naturally band-limited triangle
        let s = p < 0.5 ? 1 : -1;
        s += blep(p, dt) - blep((p + 0.5) % 1, dt);
        this._triState = (this._triState || 0) * 0.999 + s * dt * 4;
        return this._triState;
      }
      case "TRI2": return 2 * Math.abs(2 * p - 1) - 1;
      case "TRI3": {
        const t = 2 * Math.abs(2 * p - 1) - 1;
        return Math.sign(t) * Math.pow(Math.abs(t), 0.6);
      }
      case "SIN": return Math.sin(TAU * p);
      case "SIN2": {
        const s = Math.sin(TAU * p);
        return Math.sign(s) * Math.pow(Math.abs(s), 0.7);
      }
      case "JUNO": {
        // modulated sawtooth: saw plus a pulse, the classic Juno stack
        const saw = 2 * p - 1 - blep(p, dt);
        const sq = (p < this.pw ? 1 : -1) + blep(p, dt)
                 - blep((p - this.pw + 1) % 1, dt);
        return 0.6 * saw + 0.4 * sq;
      }
      default: return 2 * p - 1 - blep(p, dt);
    }
  }
}

/* -------------------------------------------------------------------------
 * Envelope - Roland's 4-time / 5-level shape
 * ---------------------------------------------------------------------- */

export class Env {
  /** stages: {T1..T4, L0..L4}. Amp envelopes have no L0/L4 (silence at both). */
  constructor(sampleRate, stages, { amp = false } = {}) {
    this.sr = sampleRate;
    const t = (k) => Math.max(1e-4, SCALE.envTime(raw(stages[k], 0)));
    const l = (k, d) => (stages[k] == null ? d : SCALE.envLevel(raw(stages[k])));
    this.t = [t("T1"), t("T2"), t("T3"), t("T4")];
    this.l = amp
      ? [0, l("L1", 1), l("L2", 1), l("L3", 1), 0]
      : [l("L0", 0), l("L1", 0), l("L2", 0), l("L3", 0), l("L4", 0)];
    this.stage = 0;
    this.value = this.l[0];
    this.time = 0;
    this.released = false;
  }

  noteOn() { this.stage = 0; this.time = 0; this.value = this.l[0]; this.released = false; }
  noteOff() { this.stage = 3; this.time = 0; this.released = true; this.from = this.value; }

  get done() { return this.released && this.stage > 3; }

  tick() {
    if (this.stage > 3) return this.value;
    const dur = this.t[this.stage];
    const from = this.stage === 3 ? (this.from ?? this.value) : this.l[this.stage];
    const to = this.l[this.stage + 1];
    this.time += 1 / this.sr;
    const k = Math.min(1, this.time / dur);
    this.value = from + (to - from) * k;
    if (k >= 1) {
      if (this.stage === 2 && !this.released) return this.value;  // sustain
      this.stage += 1;
      this.time = 0;
    }
    return this.value;
  }
}

/* -------------------------------------------------------------------------
 * Filter - cascaded one-poles, 12/18/24 dB per octave
 * ---------------------------------------------------------------------- */

export class Filter {
  constructor(sampleRate) { this.sr = sampleRate; this.z = [0, 0, 0, 0]; }

  /** type: LPF|BPF|HPF|OFF, poles: 2|3|4 */
  process(x, hz, q, type, poles) {
    if (type === "OFF" || type == null) return x;
    const f = Math.min(0.45, Math.max(1e-5, hz / this.sr));
    const g = 1 - Math.exp(-TAU * f);
    const fb = q * (1 - 0.15 * g * g);
    let v = x - fb * this.z[poles - 1];
    v = Math.tanh(v * 0.7) / 0.7;                    // soft clip, keeps it stable
    for (let i = 0; i < poles; i++) {
      this.z[i] += g * (v - this.z[i]);
      v = this.z[i];
    }
    if (type === "LPF") return v;
    if (type === "HPF") return x - v;
    if (type === "BPF") return this.z[0] - v;
    return v;
  }
}

/* -------------------------------------------------------------------------
 * Partial + Voice
 * ---------------------------------------------------------------------- */

/** One LFO: waveform, rate, delay before it starts, fade-in, and depths. */
export class LFO {
  constructor(sr, cfg) {
    this.sr = sr;
    this.form = label(cfg.form) || "TRI";
    this.rate = raw(cfg.rate, 650);
    this.hz = SCALE.lfoHz(this.rate);
    this.rateMod = 0;                 // matrix LFOn-RATE offset, RATE units
    this.delay = SCALE.envTime(raw(cfg.delay, 0));
    this.fade = SCALE.envTime(raw(cfg.fade, 0));
    this.keyTrig = !!raw(cfg.key_trig, 0);
    this.offset = raw(cfg.ofst, 0) / 100;
    this.pitch = raw(cfg.pit_depth, 0) / 100;
    this.tvf = raw(cfg.tvf_depth, 0) / 100;
    this.tva = raw(cfg.tva_depth, 0) / 100;
    this.pan = raw(cfg.pan_depth, 0) / 63;
    this.phase = 0;
    this.t = 0;
    this.sh = 0;
    this.lastCycle = 0;
  }

  reset() { if (this.keyTrig) this.phase = 0; this.t = 0; }

  tick() {
    this.t += 1 / this.sr;
    const prev = this.phase;
    const hz = this.rateMod
      ? SCALE.lfoHz(Math.max(0, Math.min(1023, this.rate + this.rateMod)))
      : this.hz;
    this.phase = (this.phase + hz / this.sr) % 1;
    const p = this.phase;
    let v;
    switch (this.form) {
      case "SIN": v = Math.sin(TAU * p); break;
      case "TRI": v = 2 * Math.abs(2 * p - 1) - 1; break;
      case "SAW-UP": v = 2 * p - 1; break;
      case "SAW-DW": v = 1 - 2 * p; break;
      case "SQR": v = p < 0.5 ? 1 : -1; break;
      case "RND":
      case "S&H":
        if (p < prev) this.sh = Math.random() * 2 - 1;   // new value each cycle
        v = this.sh; break;
      case "TRP": v = Math.max(-1, Math.min(1, (2 * Math.abs(2 * p - 1) - 1) * 2)); break;
      case "VSIN": { const s = Math.sin(TAU * p); v = Math.sign(s) * Math.pow(Math.abs(s), 0.6); break; }
      default: v = 2 * Math.abs(2 * p - 1) - 1;
    }
    v += this.offset;
    // delay then fade-in, as the schema's DELAY/FADE describe
    if (this.t < this.delay) return 0;
    const f = this.fade > 0 ? Math.min(1, (this.t - this.delay) / this.fade) : 1;
    return v * f;
  }
}

/* -------------------------------------------------------------------------
 * Matrix control - 4 per partial, each one source to up to 4 destinations
 * ---------------------------------------------------------------------- */

/** How far sens 63 at full source moves each destination, in that
 *  destination's own parameter units (and what those units mean here).
 *
 *  MEASURED 2026-09-24 for PW only (Zenology 2.0.9, MEAS SAW, renders/mx-vel and
 *  renders/mx-sens): the offset is sens/63 * source * 127, i.e. sens 63 at full
 *  source spans the whole 0..127 range. It was linear in sens (+-8, 16, 24, 31
 *  -> 15, 32, 48, 63 PW units) and in velocity (1..127). Beyond that the SAW
 *  shape saturates at a pure triangle rather than PW clamping at 0/127.
 *
 *  UNFITTED for every other row: each assumes the same rule - full scale is the
 *  destination parameter's whole schema range. PCH in particular (96 semitones
 *  at sens 63, from PIT_CRS -48..48) is a guess worth measuring first. */
export const MATRIX_FULL = {
  PW: 127,                 // PW units 0..127                          MEASURED
  PWM: 126,                // PWM_DEPTH units -63..63                  UNFITTED
  PCH: 96,                 // semitones                                UNFITTED
  CUT: 1023,               // CUTOFF units                             UNFITTED
  RES: 1023,               // RESO units                               UNFITTED
  LEV: 127,                // LEVEL units                              UNFITTED
  PAN: 127,                // PAN units -64..63                        UNFITTED
  ATT: 255,                // OSC_ATT units                            UNFITTED
  "PIT-LFO1": 200, "PIT-LFO2": 200,   // LFO depth units -100..100     UNFITTED
  "TVF-LFO1": 200, "TVF-LFO2": 200,
  "TVA-LFO1": 200, "TVA-LFO2": 200,
  "LFO1-RATE": 1023, "LFO2-RATE": 1023,  // LFO RATE units             UNFITTED
};

/** Source values, 0..1 or -1..1. VELOCITY is MEASURED: unipolar and linear,
 *  velocity/127 (the PW offset grew in proportion from 1 to 127, with no
 *  centre at 64). The rest are UNFITTED assumptions:
 *  LFOs and envelopes pass their own output through, KEYFOLLOW is bipolar
 *  around C4 reaching +-1 five octaves away. Controllers (CCxx, BEND, AFT,
 *  SYS-CTRLn) read Voice.controllers, which nothing sets yet - so they are 0,
 *  which is what an untouched mod wheel sends. */
function matrixSource(name, st) {
  switch (name) {
    case "VELOCITY": return st.vel;
    case "KEYFOLLOW": return st.key;
    case "LFO1": return st.l1;
    case "LFO2": return st.l2;
    case "PIT-ENV": return st.pe;
    case "TVF-ENV": return st.fe;
    case "TVA-ENV": return st.ae;
    default: return st.ctl?.[name] ?? 0;
  }
}

class Partial {
  constructor(sr, cfg) {
    this.sr = sr;
    this.cfg = cfg;
    this.osc = new VAOsc(sr);
    this.osc.form = label(cfg.osc.VA_FORM) || "SAW";
    this.osc.pw = raw(cfg.osc.PW, 64) / 127;
    this.filter = new Filter(sr);
    this.aenv = new Env(sr, cfg.aenv, { amp: true });
    this.fenv = new Env(sr, cfg.fenv);
    this.penv = new Env(sr, cfg.penv);
    this.lfo1 = new LFO(sr, cfg.lfo1 || {});
    this.lfo2 = new LFO(sr, cfg.lfo2 || {});

    this.coarse = raw(cfg.pitch.PIT_CRS, 0);
    this.fine = raw(cfg.pitch.PIT_FINE, 0) / 100;
    this.keyfollow = raw(cfg.pitch.PIT_KF, 100) / 100;
    this.level = raw(cfg.amp.LEVEL, 127) / 127;
    this.pan = raw(cfg.amp.PAN, 0) / 64;
    this.levelVSens = raw(cfg.amp.LEVEL_VSENS, 0) / 100;
    this.cutoff = raw(cfg.filter.CUTOFF, 1023);
    this.reso = raw(cfg.filter.RESO, 0);
    this.cutoffVSens = raw(cfg.filter.CUTOFF_VSENS, 0) / 100;
    this.cutoffKF = raw(cfg.filter.CUTOFF_KF, 0) / 100;
    this.ftype = label(cfg.filter.FILTER_TYPE) || "LPF";
    this.poles = { "-12": 2, "-18": 3, "-24 [dB/Oct]": 4 }[label(cfg.filter.FILTER_SLOPE)] || 4;
    this.vcf = label(cfg.filter.VCF_TYPE) || "VCF1";
    this.penvDepth = raw(cfg.penv.DEPTH, 0);
    this.fenvDepth = raw(cfg.fenv.DEPTH, 0);
    this.pwmDepth = raw(cfg.osc.PWM_DEPTH, 0) / 63;
    this.basePw = this.osc.pw;
    this.att = raw(cfg.osc.OSC_ATT, 255) / 255;
    this.basePan = this.pan;
    this.vel = 1;

    // Active matrix routes. Anything this synth has no place for is listed in
    // `unsupported` rather than silently dropped, so the UI can say so.
    this.routes = [];
    this.unsupported = [];
    for (const c of cfg.matrix || []) {
      const src = label(c.src);
      if (!src || src === "OFF") continue;
      for (const d of c.dst) {
        const dst = label(d.dst);
        if (!dst || dst === "OFF" || !d.sens) continue;
        if (dst in MATRIX_FULL) {
          this.routes.push({ src, dst, amt: (d.sens / 63) * MATRIX_FULL[dst] });
        } else {
          this.unsupported.push(`${src}->${dst}`);
        }
      }
    }
    this.mod = Object.fromEntries(Object.keys(MATRIX_FULL).map((k) => [k, 0]));
    this.state = { vel: 0, key: 0, l1: 0, l2: 0, pe: 0, fe: 0, ae: 0, ctl: null };
  }

  /** Sum every route into this.mod. Envelope and LFO sources use the previous
   *  sample's values, so a route may feed its own source (LFO1 -> LFO1-RATE). */
  evalMatrix() {
    const m = this.mod;
    for (const k in m) m[k] = 0;
    for (const r of this.routes) m[r.dst] += r.amt * matrixSource(r.src, this.state);
  }

  noteOn(velocity = 100) {
    this.vel = velocity / 127;
    this.state.vel = velocity / 127;
    this.aenv.noteOn(); this.fenv.noteOn(); this.penv.noteOn();
    this.lfo1.reset(); this.lfo2.reset();
    this.osc.reset(0);
  }
  noteOff() { this.aenv.noteOff(); this.fenv.noteOff(); this.penv.noteOff(); }
  get done() { return this.aenv.done; }

  /** One sample. `hz` is the note frequency before this partial's own tuning.
   *  `detune` is the unison voice's offset in cents. */
  tick(hz, detune = 0, controllers = null) {
    const st = this.state;
    st.key = Math.log2(Math.max(hz, 1) / 261.6) / 5;
    st.ctl = controllers;
    const m = this.mod;
    if (this.routes.length) this.evalMatrix();

    this.lfo1.rateMod = m["LFO1-RATE"];
    this.lfo2.rateMod = m["LFO2-RATE"];
    const l1 = (st.l1 = this.lfo1.tick());
    const l2 = (st.l2 = this.lfo2.tick());
    const pe = (st.pe = this.penv.tick());
    const fe = (st.fe = this.fenv.tick());
    const ae = (st.ae = this.aenv.tick());

    const pitchMod = SCALE.pitchSemis(pe * 511, this.penvDepth)
                   + ((this.lfo1.pitch + m["PIT-LFO1"] / 100) * l1
                    + (this.lfo2.pitch + m["PIT-LFO2"] / 100) * l2) * 12
                   + m.PCH;
    const f = hz * Math.pow(2,
      (this.coarse + this.fine + pitchMod + detune / 100) / 12);

    // PWM is driven by LFO2 - the manual is explicit about that. The matrix
    // adds to both the static PW and the PWM depth.
    const pwmDepth = this.pwmDepth + m.PWM / 63;
    if (pwmDepth || m.PW) {
      const pw = this.basePw + m.PW / 127 + l2 * pwmDepth * 0.45;
      // SAW saturates by itself (see sawMorph) - clamping PW here would stop
      // it short of the pure triangle Zenology reaches. The pulse shapes keep
      // their old guard against a zero-width (silent) pulse.
      this.osc.pw = this.osc.form === "SAW"
        ? pw
        : Math.min(0.95, Math.max(0.05, pw));
    }

    let s = this.osc.tick(f) * Math.max(0, this.att + m.ATT / 255);

    // cutoff: patch value + filter envelope + LFOs + velocity + key follow + matrix
    let cut = this.cutoff
      + fe * 1023 * (this.fenvDepth / 63)
      + ((this.lfo1.tvf + m["TVF-LFO1"] / 100) * l1
       + (this.lfo2.tvf + m["TVF-LFO2"] / 100) * l2) * 512
      + this.cutoffVSens * (this.vel - 0.5) * 1023
      + this.cutoffKF * Math.log2(Math.max(hz, 1) / 261.6) * 170
      + m.CUT;
    cut = Math.max(0, Math.min(1023, cut));
    const reso = Math.max(0, Math.min(1023, this.reso + m.RES));
    s = this.filter.process(s, SCALE.cutoffHz(cut), SCALE.resoQ(reso),
                            this.ftype, this.poles);

    this.pan = Math.max(-1, Math.min(1, this.basePan + m.PAN / 64));

    // amp: envelope, patch level, velocity sensitivity, LFO tremolo
    const trem = 1 + ((this.lfo1.tva + m["TVA-LFO1"] / 100) * l1
                    + (this.lfo2.tva + m["TVA-LFO2"] / 100) * l2);
    const velGain = 1 + this.levelVSens * (this.vel - 0.5) * 2;
    const level = Math.max(0, this.level + m.LEV / 127);
    return s * ae * level * Math.max(0, velGain) * Math.max(0, trem);
  }

  /** Pan including any LFO movement, as -1..+1. */
  panNow() {
    return Math.max(-1, Math.min(1,
      this.pan + this.lfo1.pan * this.lfo1.sh * 0));   // LFO pan applied in tick order
  }
}

export class VAVoice {
  /** patch: the JSON from /api/tone/<i>/va */
  constructor(sampleRate, patch) {
    this.sr = sampleRate;
    this.patch = patch;

    // Unison stacks detuned copies of the whole partial set. Size 2..8, detune
    // 0..100 - spread symmetrically about the note.
    const uni = patch.voice || {};
    this.unison = !!raw(uni.UNISON_SW, 0);
    this.uniSize = this.unison ? Math.max(2, raw(uni.UNISON_SIZE, 4)) : 1;
    this.uniDetune = raw(uni.UNISON_DETN, 20);

    this.stacks = [];
    for (let u = 0; u < this.uniSize; u++) {
      const spread = this.uniSize > 1 ? (u / (this.uniSize - 1)) * 2 - 1 : 0;
      this.stacks.push({
        detune: spread * this.uniDetune,          // cents
        // unison voices sit across the stereo field
        spread: this.uniSize > 1 ? spread : 0,
        partials: patch.partials
          .filter((p) => p.on && p.synthesised)
          .map((p) => ({ n: p.index, dsp: new Partial(sampleRate, p) })),
      });
    }

    this.struct12 = label(patch.structure.pair12) || "OFF";
    this.struct34 = label(patch.structure.pair34) || "OFF";
    this.ringLevel = raw(patch.structure.RING12_LEVEL, 127) / 127;
    this.xmodDepth = raw(patch.structure.XMOD12_DEPTH, 1200) / 1200;
    this.toneLevel = raw(patch.common.LEVEL, 127) / 127;
    this.octave = raw(patch.common.OCTAVE, 0);
    this.coarse = raw(patch.common.PIT_CRS, 0);
    this.fine = raw(patch.common.PIT_FINE, 0) / 100;
    this.note = 69;
    this.velocity = 100;
    /** Matrix controller sources by schema label ("SYS-CTRL1", "CC74", "BEND"
     *  ...), 0..1 or -1..1. Nothing sets these yet, so they read as 0. */
    this.controllers = {};
  }

  noteOn(note, velocity = 100) {
    this.note = note;
    this.velocity = velocity;
    for (const s of this.stacks) for (const p of s.partials) p.dsp.noteOn(velocity);
  }
  noteOff() {
    for (const s of this.stacks) for (const p of s.partials) p.dsp.noteOff();
  }
  get done() {
    return this.stacks.every((s) => s.partials.every((p) => p.dsp.done));
  }

  /** Render additively into stereo buffers. */
  process(left, right, n) {
    const hz = 440 * Math.pow(2,
      (this.note - 69 + this.octave * 12 + this.coarse + this.fine) / 12);
    // keep the level sane as unison and partials stack up
    const g = this.toneLevel * 0.25 / Math.sqrt(this.uniSize);

    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (const stack of this.stacks) {
        const find = (k) => stack.partials.find((p) => p.n === k);
        for (const { n: idx, dsp } of stack.partials) {
          const pair = idx === 1 ? this.struct12
                     : idx === 3 ? this.struct34 : "OFF";
          const other = (pair !== "OFF") ? find(idx + 1) : null;

          // XMOD: the modulator's output offsets the carrier's frequency
          let fmod = 0;
          if (pair === "XMOD" || pair === "XMOD2") {
            if (other) fmod = other.dsp.osc.shape(other.dsp.osc.phase, 0)
                              * this.xmodDepth * 1200;   // cents
          }
          let s = dsp.tick(hz, stack.detune + fmod, this.controllers);

          if (pair === "SYNC" && other && other.dsp.osc.syncedThisSample) {
            dsp.osc.reset(0);                       // slave reset by the master
          } else if (pair === "RING" && other) {
            s = s * other.dsp.osc.shape(other.dsp.osc.phase, 0) * this.ringLevel;
          }

          const pan = Math.max(-1, Math.min(1, dsp.pan + stack.spread * 0.5));
          l += s * (1 - pan) * 0.5;
          r += s * (1 + pan) * 0.5;
        }
      }
      left[i] += l * g;
      right[i] += r * g;
    }
  }
}

export const VA_FORMS = ["SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"];
