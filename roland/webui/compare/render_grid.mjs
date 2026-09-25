/**
 * Render one note through our VA voice at many fixed filter settings.
 *
 * The cutoff is pinned to an absolute frequency (cutOct = 0 makes
 * SCALE.cutoffHz a constant) and the feedback is pinned per run, so each output
 * is "our filter at fc Hz, feedback q" regardless of the patch's CUTOFF. That
 * gives fit_cutoff.py a library to match Zenology renders against. Anything
 * else that moves the cutoff (filter envelope, LFO, key follow, velocity) still
 * applies, so fit tones should keep those at zero.
 *
 *   node webui/compare/render_grid.mjs patch.json outdir --note 36 \
 *       --fc 60,120,240 --q 0,0.5 [--velocity 1 --lead 0.1 --hold 1.3 --dur 1.6]
 *
 * Writes outdir/q<q>_fc<fc>.f32: mono float32, little-endian, 44.1 kHz.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// cutoffHz reads these on every call, so they must exist before the import.
globalThis.__ZC_SCALE = { cutOct: 0 };
const { VAVoice, SCALE } = await import("../static/va-dsp.js");

const SR = 44100;

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
}
const list = (s) => String(s).split(",").map(Number);

const [patchPath, outdir] = process.argv.slice(2);
if (!patchPath || !outdir || !process.argv.includes("--fc")) {
  console.error("usage: render_grid.mjs <patch.json> <outdir> --note N --fc a,b,.. [--q 0,..]");
  process.exit(1);
}
const patch = JSON.parse(readFileSync(patchPath, "utf8"));
const note = Number(arg("note", 36));
const velocity = Number(arg("velocity", 1));
const lead = Number(arg("lead", 0.1));
const hold = Number(arg("hold", 1.3));
const dur = Number(arg("dur", 1.6));

const n = Math.round(dur * SR);
const on = Math.round(lead * SR);
const off = Math.min(n, Math.round((lead + hold) * SR));
mkdirSync(outdir, { recursive: true });

for (const q of list(arg("q", "0"))) {
  SCALE.resoQ = () => q;
  for (const fc of list(arg("fc"))) {
    globalThis.__ZC_SCALE.cutBase = fc;
    const L = new Float32Array(n), R = new Float32Array(n);
    const v = new VAVoice(SR, patch);
    v.noteOn(note, velocity);
    // VAVoice mixes additively, so the lead-in stays silent without processing
    v.process(L.subarray(on, off), R.subarray(on, off), off - on);
    v.noteOff();
    v.process(L.subarray(off), R.subarray(off), n - off);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) / 2;
    writeFileSync(`${outdir}/q${q}_fc${fc}.f32`, Buffer.from(mono.buffer));
  }
}
