// Drum Machine AudioWorklet Processor
// 10 voice types modelled on the Roland TR-808, 16-step sequencer.
//
// The 808 does not shape oscillators with envelopes. Almost every voice is a
// *bridged-T network that rings*: a trigger pulse strikes the circuit, and the
// decay, the attack shape and the harmonic content all fall out of the
// network's resonance. Modelling that directly — a two-pole resonator excited
// by an impulse — is what makes these sound like drums rather than like beeps
// with a volume curve on them.
//
// The metallic voices (both hats, cymbal, cowbell) share one bank of six
// square-wave oscillators, exactly as the hardware does. That shared source is
// why they sound like they belong to the same machine, and why noise-based
// hi-hats never sound like an 808.

import { fastTanh } from './dsp-lib.js';

const TWO_PI = 2 * Math.PI;
const NUM_CHANNELS = 8;
const NUM_STEPS = 16;

/**
 * The six oscillator frequencies of the 808's metal tone source. These are the
 * machine's fingerprint — inharmonic on purpose, so the sum never settles into
 * a pitch. Every metallic voice is a filtered slice of this bank.
 */
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

/**
 * Duty cycle of each metal oscillator.
 *
 * A perfect 50% square has only ODD harmonics, and six of them give a comb
 * sparse enough to leave 17 dB notches where the real cymbal measures smooth.
 * The 808's oscillators are Schmitt-trigger relaxation circuits whose charge
 * and discharge legs are not symmetric, so none of them sits at exactly 50% —
 * which puts the even harmonics back and doubles the density of the comb.
 */
const METAL_DUTY = [0.478, 0.512, 0.463, 0.529, 0.494, 0.451];

// ─── Building blocks ────────────────────────────────────────────────────────

/**
 * Two-pole resonator: strike it with an impulse and it rings at `freq`,
 * decaying to 1/e after `decay` seconds. This stands in for the bridged-T
 * networks behind the kick, snare, toms and rimshot.
 */
class Resonator {
  constructor(sr) {
    this.sr = sr;
    this.y1 = 0;
    this.y2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.gain = 1;
  }

  set(freq, decay) {
    const w = TWO_PI * Math.min(freq, this.sr * 0.49) / this.sr;
    const r = Math.exp(-1 / (Math.max(0.001, decay) * this.sr));
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    // An impulse into a two-pole rings at about 1/sin(w) times its amplitude —
    // ~128x at 55 Hz. Without this the kick just pins the output stage.
    this.gain = Math.sin(w);
  }

  reset() { this.y1 = 0; this.y2 = 0; }

  process(x) {
    const y = x * this.gain + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * Topology-preserving state-variable filter (Zavalishin). Used for every noise
 * and metal path.
 *
 * Two reasons for this form rather than the cheaper Chamberlin one: it stays
 * stable all the way to Nyquist — the hi-hats filter at 6–9 kHz, where the
 * Chamberlin version blows up to NaN — and its cutoff stays accurate up there
 * instead of warping downward.
 */
class SVF {
  constructor() {
    this.ic1 = 0;
    this.ic2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.a3 = 0;
    this.k = 1;
    this.hp = 0;
    this.bp = 0;
  }

  set(sr, freq, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(freq, 10), sr * 0.49) / sr);
    this.k = 1 / Math.max(0.35, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  reset() { this.ic1 = 0; this.ic2 = 0; this.hp = 0; this.bp = 0; }

  /** Returns the highpass; `band()` gives the bandpass from the same pass. */
  process(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
    return this.hp;
  }

  band() { return this.bp; }
}

/**
 * Asymmetric soft saturation with a DC blocker.
 *
 * A resonator on its own rings as a near-pure sine — for the kick that means
 * 55 Hz and essentially nothing else. But a pure 55 Hz sine has no punch on any
 * speaker that cannot reproduce 55 Hz, which is most of them; what you hear as
 * the weight of an 808 kick is largely its HARMONICS, from which the ear
 * reconstructs a fundamental it never actually receives.
 *
 * On the hardware those harmonics come from the transistor stages after the
 * bridged-T network, which clip one half of the wave harder than the other.
 * The squared term below is that asymmetry. It also generates DC, hence the
 * blocker — the even harmonics are wanted, the offset is not.
 */
class Saturator {
  constructor() { this.x1 = 0; this.y1 = 0; }

  reset() { this.x1 = 0; this.y1 = 0; }

  process(x, drive) {
    const s = fastTanh(x * drive + x * x * drive * 0.6);
    const y = s - this.x1 + 0.9985 * this.y1;
    this.x1 = s;
    this.y1 = y;
    return y;
  }
}

// ─── Drum voice ─────────────────────────────────────────────────────────────

class DrumVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.time = 0;
    this.velocity = 0;
    this.noiseState = 0x12345;

    this.res1 = new Resonator(sr);
    this.res2 = new Resonator(sr);
    this.svf1 = new SVF();
    this.svf2 = new SVF();
    this.svf3 = new SVF();
    this.sat = new Saturator();

    // Phases for the shared metal oscillator bank.
    this.metal = new Float64Array(METAL_FREQS.length);

    this.lpState = 0;

    // Choke envelope: an open hat cut short by a closed one must fade over a
    // few milliseconds, not stop dead, or it clicks.
    this.chokeGain = 1;
    this.choking = false;
    this.env = 0;
  }

  trigger(velocity) {
    this.active = true;
    this.time = 0;
    this.velocity = velocity;
    this.chokeGain = 1;
    this.choking = false;
    this.env = 1;
    this.res1.reset();
    this.res2.reset();
    this.svf1.reset();
    this.svf2.reset();
    this.svf3.reset();
    this.sat.reset();
    // Free-running metal phases on the real machine, so each hit lands on a
    // different part of the beat pattern between the six oscillators. That
    // variation is most of why two consecutive 808 hats never sound identical.
    for (let i = 0; i < this.metal.length; i++) this.metal[i] = Math.random();
    this.noiseState = (Math.random() * 0xFFFFFF) | 1;
  }

  /** Cut this voice short over ~4 ms (closed hat muting an open one). */
  choke() { if (this.active) this.choking = true; }

  _noise() {
    this.noiseState ^= this.noiseState << 13;
    this.noiseState ^= this.noiseState >> 17;
    this.noiseState ^= this.noiseState << 5;
    return ((this.noiseState & 0xFFFF) / 32768 - 1);
  }

  /** Sum of the six square oscillators, advanced one sample. `ratio` tunes. */
  _metalTone(ratio) {
    let sum = 0;
    for (let i = 0; i < METAL_FREQS.length; i++) {
      this.metal[i] += METAL_FREQS[i] * ratio / this.sr;
      if (this.metal[i] >= 1) this.metal[i] -= Math.floor(this.metal[i]);
      sum += this.metal[i] < METAL_DUTY[i] ? 1 : -1;
    }
    return sum * (1 / METAL_FREQS.length);
  }

  process(type, params) {
    if (!this.active) return 0;

    const t = this.time / this.sr;
    const first = this.time === 0;
    // A one-sample impulse is the trigger pulse that strikes the network.
    const strike = first ? 1 : 0;
    this.time++;

    // ACCENT. On the 808 an accented step does not merely get louder — the
    // accent bus opens the voices up, so hits get brighter and snappier too.
    const accent = 0.55 + this.velocity * 0.45;

    const dcy = params.decay;
    const tone = params.tone;
    const color = params.color;
    let out = 0;

    switch (type) {
      case 0: { // BASS DRUM
        // The 808's kick rings at ~55 Hz for a long time. Its pitch drop is
        // slight — a few percent over the first cycles — unlike the octave-wide
        // sweep of a 909 or an electro kick, which is what makes it sit under
        // a mix instead of announcing itself.
        const decay = 0.015 + dcy * 0.42;   // -60 dB at 0.10 s .. 3.0 s, per the kit
        // Retune only while the sweep is moving; after that the coefficients
        // are constant and the resonator just rings.
        if (first) {
          this.res1.set(tone * 1.32, decay);
          this.res2.set(tone * 5.5, 0.006);
        } else if (t < 0.06 && (this.time & 15) === 1) {
          const sweep = 1 + 0.32 * Math.exp(-t / 0.012);
          this.res1.set(tone * sweep, decay);
        }
        const body = this.sat.process(this.res1.process(strike * 0.9), 2.0);

        // The attack is the trigger pulse itself passing through the network —
        // a pitched knock with body, not a thin tick. This is the part you hear
        // on a small speaker, so it carries most of the perceived impact.
        const knock = this.res2.process(strike) * Math.exp(-t / 0.006) * (0.35 + color * 0.9);
        const click = this._noise() * Math.exp(-t / 0.0014) * color * 0.35;

        out = body * 1.35 + (knock + click) * accent;
        break;
      }

      case 1: { // SNARE DRUM
        // Structure per the service-manual analyses (Werner's circuit model):
        // two bridged-T oscillators an octave apart; the TONE knob is a
        // voltage divider CROSSFADING between them (pitch never moves); the
        // SNAPPY knob only scales the noise, which passes a fixed highpass
        // and a gentle output lowpass. Oscillator tuning varies per unit —
        // ours follows the sampled machine (172/345 Hz), not the schematic's
        // nominal 238/476.
        // Two bridged-T oscillators (the 808 uses roughly 180 Hz and 330 Hz)
        // give the drum its hollow "donk"; a separate noise path is the
        // snare wires. COLOR is the panel's SNAPPY: the balance between them.
        // TONE crossfade: 0 = all fundamental, 1 = all second oscillator.
        const blend = params.blend !== undefined ? params.blend : 0.5;
        if (first) {
          const bodyDecay = 0.008 + dcy * 0.028;
          this.res1.set(tone, bodyDecay);
          // The 808 "tak": the second oscillator starts loud and dies much
          // faster than the fundamental (kit: -4 dB in the first 30 ms,
          // -22 dB after). Quiet-and-lingering here is what makes a
          // synthesised snare read as a tom with noise on it.
          this.res2.set(tone * 2.0, bodyDecay * 0.35);
          // Fixed noise highpass — SNAPPY does not move it, only the level.
          this.svf1.set(this.sr, 1600, 0.8);
          this.lpState = 0;
        }
        // Shaped like the kick's: the real shell carries real harmonic content
        // (-15 dB at 600 Hz, where an unshaped pair of resonators gives -26).
        const body = this.sat.process(
          this.res1.process(strike) * (1 - blend) * 1.2 +
          this.res2.process(strike) * blend * 2.5, 1.9);

        // The wires have their own, longer envelope — they ring on after the
        // shell has stopped, which is the part that reads as "snare".
        const rattleEnv = Math.exp(-t / (0.010 + dcy * 0.045));
        // Fixed highpass, then a one-pole lowpass standing in for the output
        // buffer — band-limited noise, tilted up, exactly not a narrow band.
        const hp = this.svf1.process(this._noise());
        this.lpState += 0.55 * (hp - this.lpState);
        const rattle = this.lpState * rattleEnv;

        out = body * 1.1 + rattle * (0.12 + color * 3.6) * accent;
        break;
      }

      case 2: { // CLOSED HI-HAT
        // Six squares through a steep highpass — the 808's hat is metal, not
        // noise. TONE tunes the bank, COLOR opens the highpass.
        if (first) {
          const hp = 5200 + color * 2600 * accent;
          this.svf1.set(this.sr, hp, 0.7);
          this.svf2.set(this.sr, hp * 1.35, 0.7);
        }
        const env = Math.exp(-t / (0.003 + dcy * 0.032));
        const metal = this._metalTone(tone / 300);
        out = this.svf2.process(this.svf1.process(metal)) * env * 5.5;
        break;
      }

      case 3: { // OPEN HI-HAT
        // Same source and filter as the closed hat — on the hardware they are
        // literally the same circuit with a longer envelope, which is why the
        // pair sounds coherent. Two-stage decay: a bright ping, then the tail.
        if (first) {
          const hp = 4600 + color * 2400 * accent;
          this.svf1.set(this.sr, hp, 0.7);
          this.svf2.set(this.sr, hp * 1.35, 0.7);
        }
        const env = 0.45 * Math.exp(-t / 0.012) + Math.exp(-t / (0.013 + dcy * 0.073));
        const metal = this._metalTone(tone / 300);
        out = this.svf2.process(this.svf1.process(metal)) * env * 4.2;
        break;
      }

      case 4: { // HAND CLAP
        // Three fast noise bursts about 10 ms apart, then a decaying tail —
        // through a resonant band near 1 kHz. That resonance is the clap; a
        // flat filter here is what makes most software claps sound like hiss.
        if (first) this.svf1.set(this.sr, 1100 + tone * 2.4, 2.2 + color * 2.4);
        let env;
        if (t < 0.026) {
          const inBurst = t < 0.0028 || (t > 0.009 && t < 0.0118) || (t > 0.018 && t < 0.0208);
          env = inBurst ? 1 : 0.02;
        } else {
          env = Math.exp(-(t - 0.026) / (0.02 + dcy * 0.2));
        }
        this.svf1.process(this._noise() * env);
        out = this.svf1.band() * 2.2 * accent;
        break;
      }

      case 5: { // TOM
        // Bridged-T body with a short pitch drop, plus a little noise for the
        // head. COLOR is how much skin you hear against the shell.
        // The kit's toms ring longer the lower they are tuned — 0.58 s at the
        // low tom's 90 Hz against 0.30 s at the high tom's 190 Hz. That is what
        // a fixed-Q resonator does, so the decay scales as 1/f rather than
        // being one number for all three.
        const decay = (0.02 + dcy * 0.10) * (110 / Math.max(40, tone));
        // The real pitch drop is slight. A half-octave sweep put the low tom's
        // energy at 130 Hz when the reference peaks at 90.
        if (first) {
          // Must run on the first sample: the retune branch below also matches
          // time===1 (time increments before the check), so an else-if here is
          // dead code — that latent bug left the skin filter uninitialised.
          this.res1.set(tone * 1.12, decay);
          this.svf1.set(this.sr, tone * 4, 1.2);
        } else if (t < 0.04 && (this.time & 15) === 1) {
          this.res1.set(tone * (1 + 0.12 * Math.exp(-t / 0.02)), decay);
        }
        const body = this.sat.process(this.res1.process(strike), 6.0) * 1.2;
        // Barely any skin — and now that the filter above is actually
        // initialised (see the branch-order note), it is banded at tone*4.
        const skin = this.svf1.process(this._noise()) * Math.exp(-t / 0.006) * color * 0.05;
        out = body + skin * accent;
        break;
      }

      case 6: { // RIM SHOT
        // Very short, very dry: a pulse through two closely-tuned resonators.
        // Under ~40 ms on the real machine — it is a click with a pitch.
        // Measured against the kit: the real rimshot has two resonances, near
        // 440 Hz and 1.9 kHz, plus broadband content well above 4 kHz — and it
        // is gone in under 20 ms. It is a click with two pitches in it, not a
        // low tone; tuning it low is what made this the worst-fitting voice.
        // The real rimshot is BROAD, not two tones: a hump spanning 300 Hz to
        // 4 kHz peaking near 1.9 kHz, with a 450 Hz body that lingers a few
        // milliseconds longer. High-Q resonators gave two spikes with 20 dB
        // holes between them, which is why this was the worst-fitting voice.
        if (first) {
          this.res1.set(tone, 0.005 + dcy * 0.006);        // the body that lingers
          this.svf1.set(this.sr, 1750, 1.4);               // the broad click band
          this.svf2.set(this.sr, 3400, 0.6);               // upper shoulder
        }
        const excite = strike * 5 + this._noise() * Math.exp(-t / 0.0016) * 2.2;
        this.svf1.process(excite);
        this.svf2.process(excite);
        const bodyR = this.res1.process(strike) * 1.0;
        // Fitted against the kit (npm run drum-fit RS). The body is far quieter
        // than it looks like it should be: the rimshot reads as a click with a
        // pitch in it, not as a low tone, and over-weighting the 440 Hz
        // resonance was most of what made this the worst-fitting voice.
        out = (bodyR * 0.35 + this.svf1.band() * 2.8 + this.svf2.band() * 1.0) * 2.0 * accent;
        break;
      }

      case 7: { // COWBELL
        // Two oscillators from the same metal bank the hats use — 540 Hz and
        // 800 Hz — through a band. Sharing the source is what keeps it in the
        // same family as the hats instead of sounding bolted on.
        // The reference is focused on its two oscillators — 600 Hz at -12 dB and
        // 900 Hz at the peak — and is 26 dB down by 3.2 kHz. Passing the raw
        // squares through carried all their harmonics and made mine peak up at
        // 3.2 kHz instead, so the band sits between the two fundamentals and a
        // lowpass takes the harmonics off the direct path.
        if (first) {
          this.svf1.set(this.sr, 1180, 2.8);      // fitted; npm run drum-fit CB
          this.svf2.set(this.sr, 1250, 0.7);
        }
        const ratio = tone / 540;
        let sq = 0;
        for (const i of [4, 5]) {
          this.metal[i] += METAL_FREQS[i] * ratio / this.sr;
          if (this.metal[i] >= 1) this.metal[i] -= Math.floor(this.metal[i]);
          sq += this.metal[i] < METAL_DUTY[i] ? 1 : -1;
        }
        // The 808 cowbell's attack is percussive, the body sustains briefly.
        const env = 0.6 * Math.exp(-t / 0.004) + Math.exp(-t / (0.018 + dcy * 0.17));
        const shaped = sq * 0.5 * env;
        this.svf1.process(shaped);
        this.svf2.process(shaped);
        const lp = shaped - this.svf2.process(shaped);   // drop the top harmonics
        out = (this.svf1.band() * 1.6 + lp * 0.10) * 1.5 * accent;
        break;
      }

      case 8: { // CYMBAL
        // The whole metal bank, band-limited and left to ring. The 808 cymbal
        // is the same six oscillators as the hats with a much longer, softer
        // decay and a second band that keeps the shimmer alive underneath.
        // Measured from the kit, and the opposite of the obvious guess: the
        // real cymbal's TOP dies fast while its MID rings on. At 8.3 kHz it is
        // 20 dB down after 0.07 s; at 1.4 kHz that takes 1.37 s. So this is a
        // bright strike over a long mid wash, not a shimmer that outlasts the
        // body — which is what an earlier version had, and why it sounded like
        // hiss that would not stop.
        if (first) {
          this.svf1.set(this.sr, 1500, 0.6);                    // drop the body
          this.svf2.set(this.sr, 3000, 0.7);                    // the wash
          this.svf3.set(this.sr, 9800 + color * 2400, 1.2);     // the strike
        }
        // Six PERFECT squares give a sparse comb — odd harmonics only — which
        // left notches 25 dB deep where the real cymbal is smooth. The hardware
        // is not that clean: its oscillators drive transistor stages that
        // intermodulate and fill the gaps in. Saturating the bank does the same.
        const metal = this.sat.process(this._metalTone(tone / 300), 2.4);
        // The two envelopes differ only moderately. Over 1.4 s the top loses
        // about 14 dB RELATIVE to the mid, which works out at tau ~0.35 s
        // against ~0.6 s — not the near-instant top an absolute decay
        // measurement first suggested. Killing the top outright made the
        // one-second average far too dark.
        const strikeEnv = Math.exp(-t / (0.05 + dcy * 0.9));
        const washEnv = Math.exp(-t / (0.12 + dcy * 0.95));
        const hp = this.svf1.process(metal);
        this.svf2.process(hp);
        this.svf3.process(hp);
        // The top band needs a lot of gain, and that is not a fudge: six square
        // waves have roughly 45 dB less energy at 8 kHz than at 2.7 kHz, while
        // the real cymbal measures nearly flat between them. The hardware's
        // filter network supplies that lift; these numbers were fitted against
        // the kit rather than guessed (npm run drum-fit CY).
        out = (this.svf3.band() * (strikeEnv * 180 + washEnv * 12)
             + this.svf2.band() * washEnv * 3.2) * accent;
        break;
      }

      case 10: { // CONGA
        // On the hardware this IS the tom circuit — the panel switches each
        // tom channel between LOW TOM and LOW CONGA. Same bridged-T body, but
        // tuned higher, with a faster strike and essentially no pitch sweep,
        // which is what turns the tom's "doom" into the conga's "tock".
        const decay = (0.008 + dcy * 0.05) * (281 / Math.max(80, tone));
        if (first) this.res1.set(tone * 1.03, decay);
        out = this.sat.process(this.res1.process(strike), 3.0) * 1.5;
        break;
      }

      case 11: { // CLAVES
        // Shares the rimshot circuit on the real machine: one high bridged-T
        // ping near 2.4 kHz with a faint upper partial, gone in ~35 ms. The
        // reference is very clean away from the ping (-49 dB three octaves
        // down); a lone two-pole's skirts are too shallow for that, so the
        // ping also passes through a bandpass at the same frequency, doubling
        // the rolloff.
        if (first) {
          this.res1.set(tone, 0.004 + dcy * 0.004);
          this.res2.set(tone * 1.32, 0.002 + dcy * 0.002);
          this.svf1.set(this.sr, tone, 1.2);
        }
        const ping = this.res1.process(strike) + this.res2.process(strike) * 0.15;
        this.svf1.process(ping);
        out = this.svf1.band() * 5.5 * accent;
        break;
      }

      case 9: { // MARACA
        // Noise through a high band, very short. The 808's shaker, useful for
        // the off-beats a hat would crowd.
        // The reference maraca's spectrum rises all the way to 12 kHz, so this
        // sits high and gentle rather than being a band in the middle.
        if (first) this.svf1.set(this.sr, 13000 + tone * 5, 0.35);
        const env = Math.exp(-t / (0.0015 + dcy * 0.0115));
        out = this.svf1.process(this._noise()) * env * 1.3 * accent;
        break;
      }
    }

    // Choke fade — ~4 ms, so a muted open hat stops without a click.
    if (this.choking) {
      this.chokeGain -= 1 / (0.004 * this.sr);
      if (this.chokeGain <= 0) { this.chokeGain = 0; this.active = false; return 0; }
      out *= this.chokeGain;
    }

    // Retire the voice on its ENVELOPE, not on the current sample. Reading the
    // instantaneous value switched off anything that oscillates — a 50 Hz kick
    // and every metal voice cross zero constantly — so hits were cut off within
    // a few tens of milliseconds no matter what the decay knob said.
    const a = Math.abs(out);
    this.env = a > this.env ? a : this.env + (a - this.env) * 0.0008;
    if (t > 6 || (t > 0.05 && this.env < 0.00002)) this.active = false;

    return out * this.velocity;
  }
}

// ─── Main Processor ─────────────────────────────────────────────────────────

class DrumMachineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;

    // Drum voices
    this.drumVoices = [];
    for (let i = 0; i < NUM_CHANNELS; i++) this.drumVoices.push(new DrumVoice(this.sr));

    // Channel params
    this.channels = [
      // Tuned near the 808's own voices: 55 Hz kick, 180 Hz snare shell, the
      // metal bank at its native pitch (tone 300 = ratio 1.0).
      { type: 0, tone: 55,  decay: 0.55, color: 0.35, level: 0.9,  pan: 0 },    // Kick
      { type: 1, tone: 172, decay: 0.45, color: 0.55, blend: 0.5, level: 0.75, pan: 0 },  // Snare
      { type: 2, tone: 300, decay: 0.3,  color: 0.5,  level: 0.55, pan: 0.15 }, // Closed HH
      { type: 3, tone: 300, decay: 0.5,  color: 0.5,  level: 0.5,  pan: 0.15 }, // Open HH
      { type: 4, tone: 200, decay: 0.5,  color: 0.4,  level: 0.7,  pan: -0.15 },// Clap
      { type: 5, tone: 110, decay: 0.5,  color: 0.4,  level: 0.7,  pan: -0.25 },// Tom
      { type: 6, tone: 436, decay: 0.35, color: 0.5,  level: 0.6,  pan: 0.2 },  // Rim
      { type: 7, tone: 540, decay: 0.45, color: 0.5,  level: 0.5,  pan: 0.3 },  // Cowbell
    ];

    // Sequencer
    this.pattern = new Array(NUM_CHANNELS).fill(null).map(() => new Uint8Array(NUM_STEPS));
    this.playing = false;
    this.bpm = 120;
    this.swing = 0;
    this.currentStep = 0;
    this.sampleCounter = 0;
    this.samplesPerStep = 0;
    this._calcTiming();

    this.masterVolume = 0.8;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _calcTiming() {
    // 16th notes: 4 steps per beat
    this.samplesPerStep = Math.round(this.sr * 60 / (this.bpm * 4));
  }

  /**
   * Hi-hat choke. On the 808 the closed and open hats are one circuit, so a
   * closed hit mutes a ringing open one. Matched by voice *type* rather than
   * by channel index, so it still works if the channels are reassigned.
   */
  _choke(ch) {
    if (this.channels[ch].type !== 2) return;
    for (let i = 0; i < NUM_CHANNELS; i++) {
      if (i !== ch && this.channels[i].type === 3) this.drumVoices[i].choke();
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'trigger': {
        const ch = msg.channel;
        if (ch >= 0 && ch < NUM_CHANNELS) {
          this.drumVoices[ch].trigger(msg.velocity || 1.0);
          this._choke(ch);
        }
        break;
      }
      case 'setPattern': {
        // Set full pattern: msg.pattern = array of 8 arrays of 16 values
        if (msg.pattern) {
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            for (let s = 0; s < NUM_STEPS; s++) {
              this.pattern[ch][s] = msg.pattern[ch] ? (msg.pattern[ch][s] || 0) : 0;
            }
          }
        }
        break;
      }
      case 'setStep': {
        // Toggle single step
        const { channel, step, value } = msg;
        if (channel >= 0 && channel < NUM_CHANNELS && step >= 0 && step < NUM_STEPS) {
          this.pattern[channel][step] = value;
        }
        break;
      }
      case 'play': { this.playing = true; this.currentStep = 0; this.sampleCounter = 0; break; }
      case 'stop': { this.playing = false; break; }
      case 'param': {
        const { param, value } = msg;
        if (param === 'bpm') { this.bpm = value; this._calcTiming(); }
        else if (param === 'swing') { this.swing = value; }
        else if (param === 'masterVolume') { this.masterVolume = value; }
        else if (param.startsWith('ch.')) {
          const parts = param.split('.');
          const ch = parseInt(parts[1]);
          const field = parts[2];
          if (this.channels[ch]) this.channels[ch][field] = value;
        }
        break;
      }
      case 'preset': {
        if (msg.channels) this.channels = msg.channels.map(c => ({...c}));
        if (msg.pattern) {
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            for (let s = 0; s < NUM_STEPS; s++) {
              this.pattern[ch][s] = msg.pattern[ch] ? (msg.pattern[ch][s] || 0) : 0;
            }
          }
        }
        if (msg.bpm) { this.bpm = msg.bpm; this._calcTiming(); }
        break;
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;
    outL.fill(0); outR.fill(0);

    for (let s = 0; s < blockSize; s++) {
      // Sequencer tick
      if (this.playing) {
        if (this.sampleCounter <= 0) {
          // Trigger step
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            if (this.pattern[ch][this.currentStep]) {
              this.drumVoices[ch].trigger(this.pattern[ch][this.currentStep] / 127);
              this._choke(ch);
            }
          }
          this.port.postMessage({ type: 'step', step: this.currentStep });

          // Advance step with swing
          const isOdd = this.currentStep % 2 === 1;
          const swingOffset = isOdd ? Math.round(this.samplesPerStep * this.swing * 0.5) : 0;
          this.sampleCounter = this.samplesPerStep + swingOffset;
          this.currentStep = (this.currentStep + 1) % NUM_STEPS;
        }
        this.sampleCounter--;
      }

      // Mix all drum voices
      let L = 0, R = 0;
      for (let ch = 0; ch < NUM_CHANNELS; ch++) {
        const sample = this.drumVoices[ch].process(this.channels[ch].type, this.channels[ch]);
        const level = this.channels[ch].level;
        const pan = this.channels[ch].pan;
        L += sample * level * (0.5 - pan * 0.5);
        R += sample * level * (0.5 + pan * 0.5);
      }

      // The 808's output stage rounds peaks rather than squaring them off, and
      // that gentle saturation is part of why a loud pattern glues together
      // instead of splintering. Hard clipping here sounded brittle.
      outL[s] = fastTanh(L * this.masterVolume * 0.62);
      outR[s] = fastTanh(R * this.masterVolume * 0.62);
    }

    return true;
  }
}

registerProcessor('drum-machine-processor', DrumMachineProcessor);
