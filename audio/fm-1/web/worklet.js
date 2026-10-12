// The emulator in the audio thread: each 128-frame quantum runs the machine until its I2S
// DMA has produced 128 frames, so the audio device paces the emulation. The page gets the
// LCD and the LEDs about 30 times a second; keys, knobs and the pot come back as messages.
// The WebAssembly JIT's host side, as web/jit.js (a copy: an AudioWorklet does not import
// modules everywhere): compile a hot block's module, install its `run` in the function table.
function jitImports(exports, stats) {
  return {
    fm1_jit_compile(ptr, len) {
      try {
        const x = exports();
        const bytes = new Uint8Array(x.memory.buffer, ptr, len).slice();
        const table = x.__indirect_function_table;
        const run = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory: x.memory, table } }).exports.run;
        const slot = table.grow(1);
        table.set(slot, run);
        stats.regions++;
        return slot;
      } catch (e) {
        stats.failed++;
        stats.error = String(e);
        return 0;
      }
    },
  };
}

class Fm1 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
    this.calls = 0;
    this.port.onmessageerror = () => this.port.postMessage({ type: "error", message: "a message could not be read" });
    this.port.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "boot") {
        this.x = null;                    // the old machine stops now, not when the new one is up
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
        else if (m.type === "midi") for (const b of m.bytes) this.x.fm1_midi(b);
      }
    };
  }

  async boot(m) {
    // the module arrives as bytes: a compiled WebAssembly.Module does not cross into the
    // AudioWorklet's scope (Chrome delivers it as a messageerror). Compiled once, here: on a
    // phone compiling it again on every firmware change takes a noticeable while
    if (!this.module) this.module = await WebAssembly.compile(m.wasm);
    let x;
    this.jit = { regions: 0, failed: 0, error: "" };
    x = (await WebAssembly.instantiate(this.module, { env: jitImports(() => x, this.jit) })).exports;
    // hot code compiled to WebAssembly, a few blocks per quantum at most (?jit=0: interpreter only)
    x.fm1_jit(m.jit === false ? 0 : 1, 16);
    // the whole update package (.fwsc): the machine unpacks it, gets the flash chip and the
    // boot parameters from it (what M-VAVE's own firmware needs; the others boot the same)
    const copy = (buf) => {
      const p = x.fm1_alloc(buf.byteLength);
      new Uint8Array(x.memory.buffer, p, buf.byteLength).set(new Uint8Array(buf));
      return p;
    };
    const pkg = copy(m.package);
    const bank = m.syx ? copy(m.syx) : 0;
    if (x.fm1_boot_fwsc(pkg, m.package.byteLength, bank, m.syx ? m.syx.byteLength : 0, m.mhz) !== 0) {
      throw new Error("not an FM-1 update package (or a DX7 bank it cannot use)");
    }
    this.x = x;                         // (a reboot replaces the whole instance)
    this.budget = m.mhz * 1e6 * 0.02;   // at most 20 ms of emulated time per quantum
    this.short = 0;
    this.calls = 0;
    this.port.postMessage({ type: "booted", seq: m.seq });
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
        short: this.short, halted: x.fm1_halted(), jit: this.jit }, [lcd.buffer, leds.buffer]);
    }
    return true;
  }
}
registerProcessor("fm1", Fm1);
