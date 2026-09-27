/**
 * AudioWorklet wrapper around the shared VA DSP.
 *
 * The DSP lives in va-dsp.js and is imported unchanged by the offline
 * renderer too - keep synthesis OUT of this file so the two cannot drift.
 *
 * Message protocol matches the other synths in this collection:
 *   {type:'patch', patch}        load a /api/tone/<i>/va document
 *   {type:'noteOn', note, velocity}
 *   {type:'noteOff', note}
 *   {type:'allNotesOff'}
 *   {type:'midi', data:[status, d1, d2]}   a controller: CC, pitch bend or
 *                                          aftertouch (CC64 is the hold pedal)
 */

import { VAVoice, applyMidi } from "./va-dsp.js";

const MAX_VOICES = 8;

class VAProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.patch = null;
    this.voices = new Map();          // note -> VAVoice
    this.releasing = [];
    this.ctl = {};                    // shared by every voice (see applyMidi)
    this.pedal = false;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    switch (msg.type) {
      case "patch":
        this.patch = msg.patch;
        this.voices.clear();
        this.releasing.length = 0;
        this.port.postMessage({ type: "loaded", name: msg.patch?.name,
                                playable: !!msg.patch?.playable });
        break;
      case "noteOn": {
        if (!this.patch || !this.patch.playable) return;
        if (this.voices.size >= MAX_VOICES) {
          const oldest = this.voices.keys().next().value;
          this.release(oldest);
        }
        // notes held only by the pedal still cost CPU: past 16, let the
        // oldest go
        if (this.releasing.length > 16) this.releasing[0].pedalUp();
        const v = new VAVoice(sampleRate, this.patch);
        v.controllers = this.ctl;
        // free-running LFOs share one clock from the first note (Zenology's
        // starts there too - renders/lfo/ktoff)
        this.lfoClock0 ??= currentTime;
        v.noteOn(msg.note, msg.velocity ?? 100, currentTime - this.lfoClock0);
        this.voices.set(msg.note, v);
        break;
      }
      case "noteOff":
        this.release(msg.note);
        break;
      case "allNotesOff":
        this.pedal = false;
        for (const n of [...this.voices.keys()]) this.release(n);
        for (const v of this.releasing) v.pedalUp();
        break;
      case "midi": {
        const [st, d1, d2] = msg.data;
        applyMidi(this.ctl, msg.data);
        if ((st & 0xf0) === 0xb0 && d1 === 64) {         // Hold 1
          this.pedal = d2 >= 64;
          if (!this.pedal) for (const v of this.releasing) v.pedalUp();
        }
        break;
      }
    }
  }

  release(note) {
    const v = this.voices.get(note);
    if (!v) return;
    v.noteOff(this.pedal);
    this.voices.delete(note);
    this.releasing.push(v);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || out[0];
    left.fill(0);
    if (right !== left) right.fill(0);
    const n = left.length;

    for (const v of this.voices.values()) v.process(left, right, n);
    for (let i = this.releasing.length - 1; i >= 0; i--) {
      const v = this.releasing[i];
      v.process(left, right, n);
      if (v.done) this.releasing.splice(i, 1);
    }
    return true;
  }
}

registerProcessor("va-processor", VAProcessor);
