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
  // cutoff 0..1023 -> Hz, exponential: base * 2^(v/1023 * octaves).  UNFITTED
  cutoffHz: (v) => (K.cutBase ?? 20) * Math.pow(2, (v / 1023) * (K.cutOct ?? 10)),
  // envelope time 0..1023 -> seconds, exponential, scaled by envMul. UNFITTED
  envTime: (v) => (K.envMul ?? 1) * 0.001 * Math.pow(2, (v / 1023) * 13),
  // envelope level 0..1023 -> linear 0..1.                        UNFITTED
  envLevel: (v) => v / 1023,
  // pitch-env level -511..511 with depth -100..100 -> semitones.  UNFITTED
  pitchSemis: (level, depth) => (level / 511) * (depth / 100) * 48,
  // LFO rate 0..1023 -> Hz, assumed exponential 0.05..~30 Hz.     UNFITTED
  lfoHz: (v) => 0.05 * Math.pow(2, (v / 1023) * 9),
  // resonance 0..1023 -> filter Q.                                UNFITTED
  resoQ: (v) => 0.707 + (v / 1023) * 12,
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
   *  partials. Model it as a duty-cycle phase warp, identity at PW=64.
   *  UNFITTED: the warp shape is a guess; only its presence is verified. */
  warp(p) {
    const w = this.pw;
    if (w <= 0.001 || w >= 0.999 || Math.abs(w - 0.5) < 1e-4) return p;
    return p < w ? 0.5 * (p / w) : 0.5 + 0.5 * ((p - w) / (1 - w));
  }

  shape(p, dt) {
    // SQR carries its own duty cycle; everything else is warped by PW.
    if (this.form !== "SQR" && this.form !== "JUNO") p = this.warp(p);
    switch (this.form) {
      case "SAW":
        return 2 * p - 1 - blep(p, dt);
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
    this.lfo2Phase = 0;

    this.coarse = raw(cfg.pitch.PIT_CRS, 0);
    this.fine = raw(cfg.pitch.PIT_FINE, 0) / 100;
    this.level = raw(cfg.amp.LEVEL, 127) / 127;
    this.pan = raw(cfg.amp.PAN, 0) / 64;
    this.cutoff = raw(cfg.filter.CUTOFF, 1023);
    this.reso = raw(cfg.filter.RESO, 0);
    this.ftype = label(cfg.filter.FILTER_TYPE) || "LPF";
    this.poles = { "-12": 2, "-18": 3, "-24 [dB/Oct]": 4 }[label(cfg.filter.FILTER_SLOPE)] || 4;
    this.penvDepth = raw(cfg.penv.DEPTH, 0);
    this.fenvDepth = raw(cfg.fenv.DEPTH, 0);
    this.pwmDepth = raw(cfg.osc.PWM_DEPTH, 0) / 63;
    this.lfo2Hz = SCALE.lfoHz(raw(cfg.lfo2.rate, 650));
    this.basePw = this.osc.pw;
  }

  noteOn() {
    this.aenv.noteOn(); this.fenv.noteOn(); this.penv.noteOn();
    this.osc.reset(0);
  }
  noteOff() { this.aenv.noteOff(); this.fenv.noteOff(); this.penv.noteOff(); }
  get done() { return this.aenv.done; }

  /** One sample. `hz` is the note frequency before this partial's own tuning. */
  tick(hz) {
    const pitchMod = SCALE.pitchSemis(this.penv.tick() * 511, this.penvDepth);
    const f = hz * Math.pow(2, (this.coarse + this.fine + pitchMod) / 12);

    if (this.pwmDepth) {
      this.lfo2Phase = (this.lfo2Phase + this.lfo2Hz / this.sr) % 1;
      const tri = 2 * Math.abs(2 * this.lfo2Phase - 1) - 1;
      this.osc.pw = Math.min(0.95, Math.max(0.05, this.basePw + tri * this.pwmDepth * 0.45));
    }

    let s = this.osc.tick(f);
    const cut = SCALE.cutoffHz(
      Math.min(1023, this.cutoff + this.fenv.tick() * 1023 * (this.fenvDepth / 63)));
    s = this.filter.process(s, cut, SCALE.resoQ(this.reso), this.ftype, this.poles);
    return s * this.aenv.tick() * this.level;
  }
}

export class VAVoice {
  /** patch: the JSON from /api/tone/<i>/va */
  constructor(sampleRate, patch) {
    this.sr = sampleRate;
    this.patch = patch;
    this.partials = patch.partials
      .filter((p) => p.on && p.synthesised)
      .map((p) => ({ n: p.index, dsp: new Partial(sampleRate, p) }));
    this.struct12 = label(patch.structure.pair12) || "OFF";
    this.struct34 = label(patch.structure.pair34) || "OFF";
    this.ringLevel = raw(patch.structure.RING12_LEVEL, 127) / 127;
    this.toneLevel = raw(patch.common.LEVEL, 127) / 127;
    this.octave = raw(patch.common.OCTAVE, 0);
    this.note = 69;
  }

  noteOn(note) {
    this.note = note;
    for (const p of this.partials) p.dsp.noteOn();
  }
  noteOff() { for (const p of this.partials) p.dsp.noteOff(); }
  get done() { return this.partials.every((p) => p.dsp.done); }

  /** Render into interleaved-free stereo buffers. */
  process(left, right, n) {
    const hz = 440 * Math.pow(2, (this.note - 69 + this.octave * 12) / 12);
    const find = (i) => this.partials.find((p) => p.n === i);
    for (let i = 0; i < n; i++) {
      let l = 0, r = 0;
      for (const { n: idx, dsp } of this.partials) {
        let s = dsp.tick(hz);
        // pair structure: partial 1 is the slave of 2, and 3 of 4.
        const pair = idx === 1 ? this.struct12 : idx === 3 ? this.struct34 : "OFF";
        if (pair === "SYNC") {
          const master = find(idx + 1);
          if (master && master.dsp.osc.syncedThisSample) dsp.osc.reset(0);
        } else if (pair === "RING") {
          const other = find(idx + 1);
          if (other) s = s * other.dsp.osc.shape(other.dsp.osc.phase, 0) * this.ringLevel;
        }
        const pan = dsp.pan;
        l += s * Math.min(1, 1 - pan);
        r += s * Math.min(1, 1 + pan);
      }
      const g = this.toneLevel * 0.25;
      left[i] += l * g;
      right[i] += r * g;
    }
  }
}

export const VA_FORMS = ["SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"];
