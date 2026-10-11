// The emulator in the audio thread: each 128-frame quantum runs the machine until its I2S
// DMA has produced 128 frames, so the audio device paces the emulation. The page gets the
// LCD and the LEDs about 30 times a second; keys, knobs and the pot come back as messages.
class Fm1 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
    this.calls = 0;
    this.port.onmessageerror = () => this.port.postMessage({ type: "error", message: "a message could not be read" });
    this.port.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "boot") {
        try {
          await this.boot(m);
        } catch (err) {
          this.x = null;
          this.port.postMessage({ type: "error", message: `boot: ${err}` });
        }
      } else if (this.x) {
        if (m.type === "key") this.x.fm1_key(m.id, m.down ? 1 : 0);
        else if (m.type === "enc") this.x.fm1_enc(m.enc, m.clicks);
        else if (m.type === "pot") this.x.fm1_pot(m.value);
      }
    };
  }

  async boot(m) {
    // the module arrives as bytes: a compiled WebAssembly.Module does not cross into the
    // AudioWorklet's scope (Chrome delivers it as a messageerror)
    const { instance } = await WebAssembly.instantiate(m.wasm, {});
    const x = instance.exports;
    const p = x.fm1_alloc(m.firmware.byteLength);
    new Uint8Array(x.memory.buffer, p, m.firmware.byteLength).set(new Uint8Array(m.firmware));
    x.fm1_boot(p, m.firmware.byteLength, m.entry, m.mhz);
    this.x = x;                         // (a reboot replaces the whole instance)
    this.budget = m.mhz * 1e6 * 0.02;   // at most 20 ms of emulated time per quantum
    this.short = 0;
    this.calls = 0;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const x = this.x;
    if (!x) return true;
    const n = out[0].length;
    const t0 = currentTime;
    let have;
    try {
      have = x.fm1_render(n, this.budget);
    } catch (err) {                       // a trap in the emulator: stop and say so
      this.x = null;
      this.port.postMessage({ type: "error", message: `render: ${err}` });
      return true;
    }
    const l = new Float32Array(x.memory.buffer, x.fm1_out_l(), n);
    const r = new Float32Array(x.memory.buffer, x.fm1_out_r(), n);
    out[0].set(l);
    if (out[1]) out[1].set(r);
    this.short = (this.short || 0) + (have < n ? 1 : 0);
    if (++this.calls % 11 === 0) {
      // the screen and the LEDs, copied out of wasm memory (the page has its own instance)
      const lcd = new Uint16Array(x.memory.buffer, x.fm1_lcd(), 240 * 240).slice();
      const leds = new Float32Array(x.memory.buffer, x.fm1_leds(), 41).slice();
      this.port.postMessage({ type: "frame", lcd, leds, ms: x.fm1_ms(), minsns: x.fm1_minsns(),
        short: this.short, halted: x.fm1_halted() }, [lcd.buffer, leds.buffer]);
    }
    return true;
  }
}
registerProcessor("fm1", Fm1);
