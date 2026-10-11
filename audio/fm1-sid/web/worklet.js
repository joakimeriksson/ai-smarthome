// The FM-1 in the audio thread (after ../fm-1/web/worklet.js): each 128-frame quantum runs the
// emulated machine until its I2S DMA has produced 128 frames, so the audio device paces the
// emulation. This one boots a raw app image (the SID player firmware + its tune pack) at XIP
// 0x02000120. The page gets the LCD, the LEDs and the timing about 30 times a second.
// SPDX-License-Identifier: GPL-3.0-only

// The emulator's WebAssembly JIT, host side (as ../fm-1/web/jit.js): compile a hot region's
// module and install its `run` in the emulator's function table; 0 = stay interpreted.
function jitImports(exports) {
  return {
    fm1_jit_compile(ptr, len) {
      try {
        const x = exports();
        const bytes = new Uint8Array(x.memory.buffer, ptr, len).slice();
        const table = x.__indirect_function_table;
        const run = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory: x.memory, table } }).exports.run;
        const slot = table.grow(1);
        table.set(slot, run);
        return slot;
      } catch (e) {
        return 0;
      }
    },
  };
}

class Fm1 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
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
      }
    };
  }

  async boot(m) {
    // the module comes as bytes: a compiled WebAssembly.Module does not cross into the
    // AudioWorklet's scope everywhere
    if (!this.module) this.module = await WebAssembly.compile(m.wasm);
    let x;
    x = (await WebAssembly.instantiate(this.module, { env: jitImports(() => x) })).exports;
    x.fm1_jit(1, 16);   // hot code compiled to WebAssembly, at most 16 regions per quantum
    const p = x.fm1_alloc(m.image.byteLength);
    new Uint8Array(x.memory.buffer, p, m.image.byteLength).set(new Uint8Array(m.image));
    x.fm1_boot(p, m.image.byteLength, 0x02000120, m.mhz);
    this.x = x;
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
    let have;
    try {
      have = x.fm1_render(n, this.budget);
    } catch (err) {
      this.x = null;
      this.port.postMessage({ type: "error", message: `render: ${err}` });
      return true;
    }
    out[0].set(new Float32Array(x.memory.buffer, x.fm1_out_l(), n));
    if (out[1]) out[1].set(new Float32Array(x.memory.buffer, x.fm1_out_r(), n));
    if (have < n) this.short++;
    if (++this.calls % 11 === 0) {
      const lcd = new Uint16Array(x.memory.buffer, x.fm1_lcd(), 240 * 240).slice();
      const leds = new Float32Array(x.memory.buffer, x.fm1_leds(), 41).slice();
      this.port.postMessage({ type: "frame", lcd, leds, ms: x.fm1_ms(), minsns: x.fm1_minsns(),
        short: this.short, halted: x.fm1_halted() }, [lcd.buffer, leds.buffer]);
    }
    return true;
  }
}
registerProcessor("fm1", Fm1);
