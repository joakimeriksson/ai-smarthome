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
  // cutoff 0..1023 -> Hz for the partial's VCF model. MEASURED - see VCF_MODELS.
  // __ZC_SCALE.cutBase/cutOct override it with a plain exponential, which
  // render_grid.mjs uses to pin the filter at a chosen frequency.
  cutoffHz: (v, model = "VCF1") => K.cutBase != null
    ? K.cutBase * Math.pow(2, (v / 1023) * (K.cutOct ?? 0))
    : vcfModel(model).hz(v),
  // envelope time 0..1023 -> seconds, exponential, scaled by envMul. UNFITTED
  envTime: (v) => (K.envMul ?? 1) * 0.001 * Math.pow(2, (v / 1023) * 13),
  // envelope level 0..1023 -> linear 0..1.                        UNFITTED
  envLevel: (v) => v / 1023,
  // pitch-env level -511..511 with depth -100..100 -> semitones.  UNFITTED
  pitchSemis: (level, depth) => (level / 511) * (depth / 100) * 48,
  // LFO rate 0..1023 -> Hz, assumed exponential 0.05..~30 Hz.     UNFITTED
  lfoHz: (v) => 0.05 * Math.pow(2, (v / 1023) * 9),
  // resonance 0..1023 -> ladder feedback k (self-oscillation at 4) for the
  // partial's VCF model. MEASURED - see VCF_MODELS.
  resoK: (v, model = "VCF1") => vcfModel(model).k(v),
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
      // ZEN-Core's Noise oscillator; Zenology's is white to 0.3 dB (renders/noise-open)
      case "NOISE": return Math.random() * 2 - 1;
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
 * Filter - the ZEN-Core VA lowpass
 * ---------------------------------------------------------------------- */

/** Zenology's VA filter, MEASURED 2026-09-25 (Zenology 2.0.9) with a white-noise
 *  probe - the Noise oscillator is white to 0.3 dB - through every VCF_TYPE x
 *  FILTER_SLOPE x RESO x CUTOFF (renders/fs, renders/fd):
 *
 *  This is the VCF, used when the partial's filter mode (PCMS FILTER_TYPE) is
 *  VCF. The TVF - the other mode - is TvfFilter below.
 *  - In VCF mode it is always a lowpass: the TVF type (PCMT FILTER_TYPE, OFF/
 *    LPF/BPF/HPF/PKG/LPF2/LPF3) gave byte-identical audio on VCF1 and JP, as
 *    the Parameter Guide says ("If Filter Type is set to VCF, this will be LPF").
 *  - Every model is the same structure: four identical one-pole stages with
 *    resonance fed back from stage 4, and FILTER_SLOPE choosing which stage is
 *    heard (-12/-18/-24 = after stage 2/3/4). Evidence: the passband drop with
 *    resonance is identical at every slope, and the peak sits at the stage
 *    cutoff for all of them.
 *  - It is a bilinear (zero-delay-feedback) ladder: that digital response fits
 *    Zenology to 0.01-0.05 dB up to 22 kHz; an analog one misses by 4+ dB above
 *    CUTOFF 768.
 *  - No passband compensation: RESO costs level (-13.5 dB at RESO 900), as in
 *    an analog ladder, i.e. 1 / (1 + k).
 *
 *  The models differ only in their cutoff law and resonance curve, tabulated
 *  in VCF_MODELS from webui/compare/fit_vcf.py. Near self-oscillation the
 *  ladder saturates: in the feedback (sat) and at its input (insat, per model),
 *  with MG's top k refitted through that nonlinearity (VCF_EXTRA.knl).
 *
 *  Validation vs Zenology, 2026-09-26 (webui/compare/validate_filters.py):
 *  noise, 108 settings: 0.55-0.60 dB mean (run-to-run spread ~0.05), worst
 *  ~3 dB on P5 at RESO 900; saw, filter only: RESO 0 0.32 dB, RESO 800 1.24 dB.
 *  RESO 1023 on a saw is 1-5 dB louder than Zenology's; a ring far below the
 *  note (CUTOFF 256, strong resonance) is 7-11 dB off - set by the note-on
 *  transient. */
export class Filter {
  constructor(sampleRate) { this.sr = sampleRate; this.s = [0, 0, 0, 0]; }

  /** hz: stage cutoff; k: feedback (4 = self-oscillation); poles: 2|3|4;
   *  sat: the feedback's saturation level; insat: the ladder input's (0 = none).
   *  Both per model, VCF_EXTRA. */
  process(x, hz, k, poles = 4, sat = 1, insat = 0) {
    const s = this.s;
    const g = Math.tan(Math.PI * Math.min(hz, this.sr * 0.49) / this.sr);
    const G = g / (1 + g);
    const b = 1 / (1 + g);
    // Solve the feedback loop for this sample (no unit delay):
    // y4 = G^4 u + b (G^3 s0 + G^2 s1 + G s2 + s3), u = x - k y4
    const sigma = b * (G * (G * (G * s[0] + s[1]) + s[2]) + s[3]);
    const G4 = G * G * G * G;
    // Saturate only what is fed back: at RESO 0 the filter is then exactly
    // linear, as Zenology's is (its reso-0 harmonics fit a linear ladder to
    // 0.1 dB at full level), while self-oscillation stays bounded.
    const y4 = (G4 * x + sigma) / (1 + k * G4);
    let u = x - k * sat * Math.tanh(y4 / sat);
    // Input saturation: fitted per model on Zenology's saw at RESO 0/800/1023
    // (renders/ab, renders/selfosc); it tames strong resonance without
    // touching RESO 0, which stays within 0.1-0.2 dB. MG fits best without it.
    const L = K.vcfInSat ?? insat;
    if (L) u = L * Math.tanh(u / L);
    let out = u;
    for (let i = 0; i < 4; i++) {                    // all four run: stage 4 feeds back
      const w = (u - s[i]) * G;
      const y = w + s[i];
      s[i] = y + w;
      u = y;
      if (i === poles - 1) out = y;
    }
    return out;
  }
}

/** Per-model tables: cutoff law [[CUTOFF, Hz], ...] and resonance [[RESO, k], ...],
 *  each point a fit of the bilinear ladder to a Zenology noise render. Values
 *  between points are interpolated (log-frequency for the cutoff). */
export const VCF_MODELS = /*VCF_TABLES*/{
  VCF1: {
    cut: [[128, 14.3], [256, 40.51], [384, 115.61], [512, 330.89], [640, 948.45], [768, 2713.74], [896, 7754.23], [1023, 22045.55]],
    k: [[0, 0.0], [128, 0.522], [256, 1.045], [384, 1.566], [512, 2.086], [640, 2.604], [768, 3.102], [896, 3.546], [1023, 4.262]],
  },
  JP: {
    cut: [[128, 43.18], [256, 108.63], [384, 273.86], [512, 691.35], [640, 1745.41], [768, 4391.84], [896, 11014.81], [1023, 22045.59]],
    k: [[0, 0.0], [128, 0.196], [256, 0.522], [384, 0.98], [512, 1.566], [640, 2.215], [768, 2.851], [896, 3.439], [1023, 4.331]],
  },
  MG: {
    cut: [[128, 54.72], [256, 137.79], [384, 347.57], [512, 880.06], [640, 2214.17], [768, 5561.9], [896, 13950.78], [1023, 22045.59]],
    k: [[0, 0.0], [128, 0.114], [256, 0.457], [384, 1.029], [512, 1.826], [640, 2.833], [768, 3.75], [896, 3.76], [1023, 4.35]],
  },
  P5: {
    cut: [[128, 15.77], [256, 39.45], [384, 99.2], [512, 250.09], [640, 631.27], [768, 1593.98], [896, 4010.32], [1023, 10000.35]],
    k: [[0, 0.0], [128, 0.375], [256, 0.979], [384, 1.81], [512, 2.853], [640, 3.721], [768, 3.752], [896, 3.799], [1023, 4.223]],
  },
}/*END_VCF_TABLES*/;

/** VCF-mode extras, MEASURED 2026-09-26 (renders/vcf-hpf, renders/vcf-gc; hpf and
 *  gc written by fit_vcf.py, knl and insat by fit_vcf_nl.py). hpf: [HPF_CUTOFF, Hz, leak dB, gain dB] - a one-pole bilinear
 *  highpass plus a small dry leak; it does nothing in TVF mode (measured, as
 *  the Parameter Guide says). gc: VCF_GC is a flat make-up gain for the level
 *  resonance costs, 1 + gc * (VCF_GC/127) * k; no effect at RESO 0 (measured).
 *  The HPF's position relative to the ladder is not known - it sits before it. */
export const VCF_EXTRA = /*VCF_EXTRA*/{"hpf": [[128, 14.34, -25.8, -0.43], [256, 40.78, -25.8, -0.43], [384, 116.18, -25.8, -0.43], [512, 332.73, -24.2, -0.52], [640, 945.52, -24.9, -0.49], [768, 2619.41, -26.0, -0.5], [896, 6133.88, -28.8, -1.02], [1023, 9628.07, -35.8, -4.31]], "gc": 1.177, "knl": {"MG": [[768, 4.1], [896, 4.1], [1023, 4.2]]}, "insat": {"VCF1": 4, "JP": 2.5, "P5": 2.5}}/*END_VCF_EXTRA*/;

/** One-pole zero-delay-feedback highpass with the measured leak. */
export class HighPass {
  constructor(sampleRate) { this.sr = sampleRate; this.s = 0; }
  process(x, hz, leak, gain) {
    const g = Math.tan(Math.PI * Math.min(hz, this.sr * 0.49) / this.sr);
    const v = (x - this.s) * (g / (1 + g));
    const lp = v + this.s;
    this.s = lp + v;
    return (x - lp + leak * x) * gain;
  }
}

function interp(table, v, log) {
  if (v <= table[0][0]) {
    // below the first point, continue the first segment (the laws are exponential)
    const [[x0, y0], [x1, y1]] = table;
    const t = (v - x0) / (x1 - x0);
    return log ? y0 * Math.pow(y1 / y0, t) : y0 + (y1 - y0) * t;
  }
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (v <= x1) {
      const [x0, y0] = table[i - 1];
      const t = (v - x0) / (x1 - x0);
      return log ? y0 * Math.pow(y1 / y0, t) : y0 + (y1 - y0) * t;
    }
  }
  return table[table.length - 1][1];
}

const vcfCache = {};
function vcfModel(name) {
  if (vcfCache[name]) return vcfCache[name];
  const m = VCF_MODELS[name] || VCF_MODELS.VCF1;
  // Where the ladder saturates, a linear fit reads k too low (P5 plateaued at
  // 3.7-3.8 from RESO 640). VCF_EXTRA.knl holds k refitted by simulating this
  // nonlinear filter against Zenology's noise and saw renders; it replaces the
  // linear points it covers.
  const nl = VCF_EXTRA.knl?.[name] || [];
  const ktab = m.k.filter(([r]) => !nl.some(([n]) => n === r)).concat(nl)
    .sort((a, b) => a[0] - b[0]);
  return (vcfCache[name] = {
    hz: (v) => interp(m.cut, v, true),
    k: (v) => Math.max(0, interp(ktab, v, false)),     // feedback is never negative
  });
}

/** The TVF: the partial filter in TVF mode (Zenology's INIT tone uses it).
 *  MEASURED 2026-09-26 against Zenology 2.0.9 with the white-noise probe
 *  (renders/tvf; tables from webui/compare/fit_tvf.py):
 *
 *  - A Chamberlin state-variable filter (low += F band; high = x - low - q band;
 *    band += F high) - its slope flattens toward Nyquist exactly as Zenology's
 *    does; a bilinear filter misses by up to 11 dB. F = 2 sin(pi fc / fs) on
 *    VCF1's cutoff law, to 0.2%.
 *  - LPF, BPF and HPF are its low, band and high outputs, +1.2 dB hotter than
 *    the VCF path; PKG is low + high + w band at its own gain (+0.7 dB). All
 *    fit to ~0.01 dB.
 *  - Resonance sets q (TVF.q), and costs no passband level. At RESO 0 the
 *    damping eases toward the top of the range (TVF.m); with resonance up it
 *    holds within 1-4%, so the easing is weighted by q / q(RESO 0).
 *  - -24 is a fixed stage at the RESO-0 damping followed by the resonant one
 *    (two identical resonant stages miss by up to 6.5 dB). -18 runs as -12.
 *  - LPF2 is LPF with resonance ignored - statically identical at every cutoff;
 *    it differs under the filter envelope (see Partial.tick). LPF3 ignores
 *    resonance too and is critically damped, q = min(2, 1/F).
 *  - Top of the range: with resonance, F follows the law up to CUTOFF 896's
 *    value (TVF.fclamp); at low resonance Zenology sits at F = 1, q = 1, which
 *    leaves the lowpass fully open. 896 and 1023 render identically.
 *  - RESO 1023 is q = 0: a lossless resonator, rung by the note-on and held at
 *    a steady, near-pure sine (harmonics 28-100 dB down) for the whole note.
 *
 *  Validation vs Zenology, 2026-09-26 (webui/compare/validate_filters.py):
 *  noise, 206 settings below RESO 1023: 0.38 dB mean, 0.21 median; saw, filter
 *  only, 72 settings: 0.45 dB (RESO 0) / 0.55 dB (RESO 800). Weakest: PKG at
 *  CUTOFF 640-896 (1.5-3 dB), and PKG -24 at strong resonance on a saw, where
 *  the ring beats against the note and per-harmonic levels are not stable. */
/** TVF LPF2's envelope sweep: Hz added at full depth (2.66 Hz x 63^2). */
export const LPF2_HZ = 10557;

export const TVF = /*TVF_TABLES*/{"q": [[0, 1.15474], [128, 0.59968], [256, 0.35884], [384, 0.21697], [512, 0.1341], [640, 0.08654], [768, 0.06021], [896, 0.04246], [1023, 0.0]], "m": [[0.0, 1.0], [0.1351, 0.9869], [0.3845, 0.9324], [1.0, 0.8735]], "lpf3q": 2.0066, "pkg": 2.071, "pkggain": 1.0849, "gain": 1.1424, "fclamp": 1.0494}/*END_TVF_TABLES*/;

export class TvfFilter {
  constructor(sampleRate) { this.sr = sampleRate; this.low = [0, 0]; this.band = [0, 0]; }

  /** One Chamberlin stage; returns the requested output. */
  stage(i, x, F, q, type) {
    const low = this.low[i] + F * this.band[i];
    const high = x - low - q * this.band[i];
    const band = F * high + this.band[i];
    // At RESO 1023 q = 0: a lossless resonator the note-on rings, holding a
    // steady near-pure sine (measured, renders/selfosc/tvf) - so no amplitude
    // limiting in the audible range. Past |64| a soft ceiling guards against
    // an input that sits exactly on the cutoff and would pump it forever.
    this.low[i] = low;
    const a = band < 0 ? -band : band;
    this.band[i] = a <= 64 ? band : Math.sign(band) * (64 + 64 * Math.tanh((a - 64) / 64));
    if (type === "HPF") return high;
    if (type === "BPF") return band;
    if (type === "PKG") return low + high + TVF.pkg * band;
    return low;
  }

  process(x, hz, reso, type, poles) {
    if (type === "OFF") return x * TVF.gain;
    const flat = type === "LPF2" || type === "LPF3";
    const q0 = TVF.q[0][1];
    let F = 2 * Math.sin(Math.PI * Math.min(hz, this.sr / 2) / this.sr);
    let q = type === "LPF3" ? TVF.lpf3q : interp(TVF.q, flat ? 0 : reso, false);
    // RESO-0 damping of the fixed first stage of -24
    let qf = type === "LPF3" ? TVF.lpf3q : q0;
    if (type === "LPF3") {
      // LPF3: critically damped (q = 2) until F q reaches 1, then q = 1/F -
      // measured F q = 0.997 / 1.001 / 1.000 at CUTOFF 800 / 832 / 864
      q = qf = Math.min(q, 1 / F);
    } else {
      const ease = interp(TVF.m, Math.min(F, 1), false);
      q *= 1 - (1 - ease) * Math.min(1, q / q0);
      qf *= 1 - (1 - ease) * Math.min(1, qf / q0);
    }
    if (F >= 1) {
      // top of the range: resonant settings follow the law to the clamp; low
      // resonance settles at F = 1, q = 1 (the open lowpass)
      if (q >= 0.95) { F = 1; q = 1; } else F = Math.min(F, TVF.fclamp);
      qf = 1;
    }
    let y = x;
    if (poles === 4) {
      // the fixed stage runs at the clamped F too
      y = this.stage(1, y, Math.min(F, 1), qf, type);
    }
    return this.stage(0, y, F, q, type) * (type === "PKG" ? TVF.pkggain : TVF.gain);
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
    this.osc.form = label(cfg.osc.OSC_TYPE) === "Noise" ? "NOISE"
                  : label(cfg.osc.VA_FORM) || "SAW";
    this.osc.pw = raw(cfg.osc.PW, 64) / 127;
    // PCMS FILTER_TYPE, surfaced as FILTER_MODE by va.py. Absent means TVF,
    // which is what Zenology's INIT tone uses.
    this.fmode = label(cfg.filter.FILTER_MODE) || "TVF";
    this.filter = this.fmode === "VCF" ? new Filter(sr) : new TvfFilter(sr);
    this.tvfType = label(cfg.filter.FILTER_TYPE) || "LPF";
    // VCF-mode highpass and gain correction (see VCF_EXTRA)
    const hpfCut = raw(cfg.filter.HPF_CUTOFF, 0);
    this.hpf = null;
    if (this.fmode === "VCF" && hpfCut > 0 && VCF_EXTRA.hpf) {
      const col = (i) => VCF_EXTRA.hpf.map((r) => [r[0], r[i]]);
      this.hpf = new HighPass(sr);
      this.hpfHz = interp(col(1), hpfCut, true);
      this.hpfLeak = Math.pow(10, interp(col(2), hpfCut, false) / 20);
      this.hpfGain = Math.pow(10, interp(col(3), hpfCut, false) / 20);
    }
    this.vcfGc = raw(cfg.filter.VCF_GC, 0) / 127;
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
    // key follow pivots on the Cutoff Keyfollow Base Point key (60 = C4)
    this.kfBaseHz = 440 * Math.pow(2, (raw(cfg.filter.CUTOFF_KF_BP, 60) - 69) / 12);
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
    // Filter envelope, MEASURED 2026-09-26 (renders/env, envelope held at full
    // level): the cutoff moves by 1023 * sign(d) * (d/63)^2 CUTOFF units - a
    // quadratic depth law, to within 1 unit for VCF1 and TVF LPF alike. TVF LPF2
    // is the exception for positive depth: it adds frequency instead, LPF2_HZ *
    // (d/63)^2 Hz (2.66 Hz x d^2, same from base CUTOFF 256 and 384) - the
    // "sensitivity" difference the Parameter Guide mentions. Negative depth on
    // LPF2 behaves like LPF.
    const dq = (this.fenvDepth / 63) * Math.abs(this.fenvDepth / 63);
    const lpf2Hz = this.fmode === "TVF" && this.tvfType === "LPF2" && dq > 0;
    let cut = this.cutoff
      + (lpf2Hz ? 0 : fe * 1023 * dq)
      + ((this.lfo1.tvf + m["TVF-LFO1"] / 100) * l1
       + (this.lfo2.tvf + m["TVF-LFO2"] / 100) * l2) * 512
      + this.cutoffVSens * (this.vel - 0.5) * 1023
      + this.cutoffKF * Math.log2(Math.max(hz, 1) / this.kfBaseHz) * 170
      + m.CUT;
    cut = Math.max(0, Math.min(1023, cut));
    const reso = Math.max(0, Math.min(1023, this.reso + m.RES));
    if (this.fmode === "VCF") {
      if (this.hpf) s = this.hpf.process(s, this.hpfHz, this.hpfLeak, this.hpfGain);
      const k = K.vcfK ?? SCALE.resoK(reso, this.vcf);     // K.vcfK: fitting override
      s = this.filter.process(s, SCALE.cutoffHz(cut, this.vcf), k, this.poles,
                              K.vcfSat ?? VCF_EXTRA.sat?.[this.vcf] ?? 1,
                              VCF_EXTRA.insat?.[this.vcf] ?? 0)
        * (1 + (VCF_EXTRA.gc ?? 0) * this.vcfGc * k);
    } else {
      const fcHz = SCALE.cutoffHz(cut, "VCF1") + (lpf2Hz ? LPF2_HZ * dq * fe : 0);
      s = this.filter.process(s, fcHz, reso, this.tvfType, this.poles);
    }

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
