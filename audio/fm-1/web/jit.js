// The host side of the WebAssembly JIT (crates/fm1-core/src/jit_wasm.rs): a hot block arrives
// as a small module, which is compiled here synchronously and whose `run` goes into the
// emulator's exported function table; Rust then calls it by that index, with no JavaScript in
// between. Returns the index, or 0 when it cannot (the block stays interpreted).
// (worklet.js carries its own copy: an AudioWorklet does not import modules everywhere)
export function jitImports(exports) {
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
