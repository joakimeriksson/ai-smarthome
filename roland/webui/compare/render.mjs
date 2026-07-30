/**
 * Offline render of a ZEN-Core VA patch to WAV, for spectral comparison
 * against Zenology captures.
 *
 * Imports the SAME DSP the worklet uses - see webui/static/va-dsp.js.
 *
 *   python3 webui/compare/dump_va.py User2.svz 2 > /tmp/patch.json
 *   node webui/compare/render.mjs /tmp/patch.json /tmp/out.wav --note 62 --hold 2 --dur 3.5
 *
 * Note/hold/dur default to the conventions in the Synthex compare harness
 * (tools/compare/capture_ref.py), so renders line up with captures.
 */

import { readFileSync, writeFileSync } from "node:fs";

// Fit parameters must be in place BEFORE va-dsp.js is evaluated, so they are
// read from the environment here rather than passed as arguments.
if (process.env.ZC_SCALE) globalThis.__ZC_SCALE = JSON.parse(process.env.ZC_SCALE);
const { VAVoice } = await import("../static/va-dsp.js");

const SR = 44100;

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}

const [patchPath, outPath] = process.argv.slice(2);
if (!patchPath || !outPath) {
  console.error("usage: render.mjs <patch.json> <out.wav> [--note 62] [--hold 2] [--dur 3.5]");
  process.exit(1);
}

const note = arg("note", 62);
const hold = arg("hold", 2.0);
const dur = arg("dur", 3.5);

const patch = JSON.parse(readFileSync(patchPath, "utf8"));
if (!patch.playable) {
  console.error(`patch "${patch.name}" has no synthesised partials - ` +
                `a VA-only synth cannot play it`);
  process.exit(2);
}

/** --seq "62,65,69,74" plays a phrase; --gap sets note spacing in seconds.
 *  Without it, one held note - the shape the capture scenarios use. */
function strArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}
const seq = strArg("seq");
const gap = arg("gap", 0.45);

// --lead matches capture.py's silence before the first note, so a render and a
// capture line up sample-for-sample without hunting for onsets.
const lead = arg("lead", 0);
const events = seq
  ? seq.split(",").map((s, i) => ({
      note: Number(s.trim()),
      at: lead + i * gap,
      off: lead + i * gap + gap * 0.85,
    }))
  : [{ note, at: lead, off: lead + hold }];
const total = seq
  ? Math.max(dur, events.at(-1).off + 1.5)
  : dur;

const n = Math.round(total * SR);
const left = new Float32Array(n);
const right = new Float32Array(n);

// One voice per note, mixed - the worklet is polyphonic the same way.
const marks = [];
for (const e of events) {
  marks.push({ at: Math.round(e.at * SR), kind: "on", ev: e });
  marks.push({ at: Math.round(e.off * SR), kind: "off", ev: e });
}
marks.sort((a, b) => a.at - b.at);

const live = new Map();
let cursor = 0;
const render = (until) => {
  const len = Math.min(n, until) - cursor;
  if (len <= 0) return;
  for (const v of live.values()) {
    v.process(left.subarray(cursor, cursor + len), right.subarray(cursor, cursor + len), len);
  }
  cursor += len;
};
for (const m of marks) {
  render(m.at);
  if (m.kind === "on") {
    const v = new VAVoice(SR, patch);
    v.noteOn(m.ev.note);
    live.set(m.ev, v);
  } else {
    live.get(m.ev)?.noteOff();
  }
}
render(n);

// -- stats, so a silent render is obvious immediately ----------------------
const rms = (b) => Math.sqrt(b.reduce((a, v) => a + v * v, 0) / b.length);
const peak = (b) => b.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
console.log(`${patch.name}: ${patch.partials.filter(p => p.on && p.synthesised).length} VA partials`);
console.log(`  rms  L ${rms(left).toFixed(4)}  R ${rms(right).toFixed(4)}`);
console.log(`  peak L ${peak(left).toFixed(4)}  R ${peak(right).toFixed(4)}`);
if (peak(left) < 1e-4 && peak(right) < 1e-4) console.log("  WARNING: silent render");

// -- 16-bit stereo WAV ------------------------------------------------------
const buf = Buffer.alloc(44 + n * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
const clip = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(clip(left[i]), 44 + i * 4);
  buf.writeInt16LE(clip(right[i]), 46 + i * 4);
}
writeFileSync(outPath, buf);
console.log(`  wrote ${outPath} (${(buf.length / 1024).toFixed(0)} kB, ` +
            `${total.toFixed(2)}s @ ${SR})`);
