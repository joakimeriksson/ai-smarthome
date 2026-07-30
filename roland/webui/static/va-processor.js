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
 */

import { VAVoice } from "./va-dsp.js";

const MAX_VOICES = 8;

class VAProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.patch = null;
    this.voices = new Map();          // note -> VAVoice
    this.releasing = [];
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
        const v = new VAVoice(sampleRate, this.patch);
        v.noteOn(msg.note);
        this.voices.set(msg.note, v);
        break;
      }
      case "noteOff":
        this.release(msg.note);
        break;
      case "allNotesOff":
        for (const n of [...this.voices.keys()]) this.release(n);
        break;
    }
  }

  release(note) {
    const v = this.voices.get(note);
    if (!v) return;
    v.noteOff();
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
