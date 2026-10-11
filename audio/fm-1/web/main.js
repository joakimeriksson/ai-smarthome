// The page: the front panel (drawn by the same Rust code as the native window, in its own wasm
// instance), the pointer and keyboard input, the firmware and clock pickers, and the audio graph
// that runs the emulator. Every firmware boots from its whole update package (.fwsc), unpacked
// in the wasm: a catalog entry's fetched from its author's site, or one opened from this
// computer (M-VAVE's own: their server does not let other pages fetch it).
import { fetchPackage } from "./fwsc.js";

const CLOCKS = [60, 80, 100, 120, 160, 200, 240];
const params = new URLSearchParams(location.search);
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const catalog = await (await fetch("firmwares.json")).json();
const byId = new Map(catalog.firmwares.map((f) => [f.id, f]));
let fw = byId.get(params.get("fw")) || byId.get(stored("fm1.fw")) || byId.get(catalog.default) || catalog.firmwares[0];
let mhz = Number(params.get("mhz") || stored("fm1.mhz") || 100);

const canvas = document.getElementById("panel");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
const startBtn = document.getElementById("start");
const fwSel = document.getElementById("fw");
const mhzSel = document.getElementById("mhz");
const about = document.getElementById("about");
const title = document.getElementById("title");
const openInput = document.getElementById("open");
const bankInput = document.getElementById("bank");
const bankName = document.getElementById("bankname");

const wasm = await (await fetch("fm1_web.wasm")).arrayBuffer();   // the worklet gets its own copy
// (the panel's instance runs no machine: its JIT import is never called)
const ui = (await WebAssembly.instantiate(wasm, { env: { fm1_jit_compile: () => 0 } })).instance.exports;
const W = ui.panel_width(), H = ui.panel_height();
canvas.width = W;
canvas.height = H;

let node = null;
let frame = null;            // the latest LCD + LEDs from the audio thread
const down = new Uint8Array(41);
const encClicks = new Int32Array(7);
const turning = new Uint32Array(8);
let pot = 900;

// ---------------------------------------------------------------- firmware and clock
for (const f of catalog.firmwares) fwSel.add(new Option(`${f.name} ${f.version}`, f.id));
for (const c of new Set([...CLOCKS, mhz].sort((a, b) => a - b))) mhzSel.add(new Option(`${c} MHz`, c));
fwSel.value = fw.id;
mhzSel.value = mhz;

// the package of catalog entry f, fetched from its author's site (nothing is hosted with this
// page); kept per session. A package opened from this computer is the entry `local`. A `byo`
// entry (M-VAVE's own: their server does not let pages fetch it) is the copy the visitor opened,
// kept in this browser (IndexedDB) for the next visit.
const packages = new Map();
class NeedFile extends Error {}
async function packageOf(f) {
  if (f.id === "local") return { bytes: f.bytes, url: null };
  if (f.byo) {
    if (!packages.has(f.id)) {
      const kept = await idb("get", f.id);
      if (!kept) throw new NeedFile();
      packages.set(f.id, { bytes: kept, url: null });
    }
    return packages.get(f.id);
  }
  if (!packages.has(f.id)) packages.set(f.id, await fetchPackage(f));
  return packages.get(f.id);
}
// a tiny key-value store in IndexedDB; any failure (private mode, blocked storage) is "nothing kept"
function idb(op, key, value) {
  return new Promise((done) => {
    try {
      const open = indexedDB.open("fm1-emulator", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("packages");
      open.onerror = () => done(null);
      open.onsuccess = () => {
        try {
          const tx = open.result.transaction("packages", op === "get" ? "readonly" : "readwrite");
          const st = tx.objectStore("packages");
          const r = op === "get" ? st.get(key) : op === "put" ? st.put(value, key) : st.delete(key);
          r.onsuccess = () => done(op === "get" ? r.result || null : true);
          r.onerror = () => done(null);
        } catch { done(null); }
      };
    } catch { done(null); }
  });
}
// a kept copy of a byo entry: known at once, so the page can say so before Start
for (const f of catalog.firmwares.filter((f) => f.byo)) {
  const kept = await idb("get", f.id);
  if (kept) packages.set(f.id, { bytes: kept, url: null });
}
let bank = null;                           // a DX7 32-voice bank for the stock firmware, or null

let loadedUrl = null;                      // the package the running machine came from

function showFirmware() {
  title.textContent = `M-VAVE FM-1 · ${fw.name} (emulated)`;
  const b = document.createElement("b");
  b.textContent = `${fw.name} ${fw.version}`.trim();
  let parts;
  if (fw.id === "local") {
    parts = [b, " · opened from this computer; it stays in this page."];
  } else if (fw.byo) {
    const dl = document.createElement("a");
    dl.href = fw.download;
    dl.textContent = "download FM-1.fwsc from M-VAVE";
    const doc = document.createElement("a");
    doc.href = fw.repo;
    doc.textContent = "how it runs";
    const have = packages.has(fw.id) ? " Your copy is kept in this browser; open another .fwsc to replace it." :
      " Then click \u201cOpen .fwsc\u2026\u201d (or drop the file on the synth); this browser keeps it for next time.";
    parts = [b, " · M-VAVE's own firmware. This page does not host it and cannot fetch it: ", dl, "." + have +
      " It starts with a small patch bank of the emulator's own; \u201cDX7 bank\u2026\u201d loads a 32-voice .syx · ", doc];
  } else {
    const a = document.createElement("a");
    a.href = fw.repo;
    a.textContent = "source";
    parts = [b, ` by ${fw.author} · ${fw.license} · `, a, ` · ${fw.about}`];
  }
  if (loadedUrl) {
    const p = document.createElement("a");
    p.href = loadedUrl;
    p.textContent = loadedUrl.split("/").pop();
    parts.push(" Running ", p, ".");
  }
  about.replaceChildren(...parts);
  if (fw.id === "local") return;           // (not something a link can bring back)
  const q = new URLSearchParams(location.search);
  q.set("fw", fw.id);
  q.set("mhz", mhz);
  history.replaceState(null, "", `?${q}`);
}
showFirmware();

fwSel.addEventListener("change", () => {
  fw = byId.get(fwSel.value) || localFw;
  loadedUrl = null;
  store("fm1.fw", fw.id);
  showFirmware();
  fwSel.blur();                 // back to playing from the keyboard
  if (node) boot();
});
mhzSel.addEventListener("change", () => {
  mhz = Number(mhzSel.value);
  store("fm1.mhz", mhz);
  showFirmware();
  mhzSel.blur();
  if (node) boot();
});

// a package from this computer: the file picker or a drop on the panel. With M-VAVE's entry
// chosen, or a file named like theirs, it is that entry's copy and is kept for next time.
let localFw = null;
async function openLocal(file) {
  if (!file) return;
  const mv = catalog.firmwares.find((f) => f.byo);
  if (mv && (fw.byo || /^FM-1( \(\d+\))?\.fwsc$/i.test(file.name))) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    packages.set(mv.id, { bytes, url: null });
    idb("put", mv.id, bytes);
    fw = mv;
    fwSel.value = mv.id;
    store("fm1.fw", mv.id);
    loadedUrl = null;
    showFirmware();
    if (node) boot();
    else status.textContent = `${file.name} ready: click Start`;
    return;
  }
  localFw = { id: "local", name: file.name.replace(/\.fwsc$/i, ""), version: "", bytes: new Uint8Array(await file.arrayBuffer()) };
  let opt = [...fwSel.options].find((o) => o.value === "local");
  if (!opt) fwSel.add(opt = new Option("", "local"), 0);
  opt.text = `${localFw.name} (your file)`;
  fwSel.value = "local";
  fw = localFw;
  loadedUrl = null;
  showFirmware();
  if (node) boot();
  else status.textContent = `${file.name} ready: click Start`;
}
openInput.addEventListener("change", () => { openLocal(openInput.files[0]); openInput.value = ""; });
bankInput.addEventListener("change", async () => {
  const file = bankInput.files[0];
  bankInput.value = "";
  if (!file) return;
  bank = new Uint8Array(await file.arrayBuffer());
  bankName.textContent = file.name;
  if (node) boot();
});
const stage = document.querySelector(".stage");
stage.addEventListener("dragover", (e) => { e.preventDefault(); });
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = [...e.dataTransfer.files].find((f) => /\.(fwsc|syx)$/i.test(f.name));
  if (!file) return;
  if (/\.syx$/i.test(file.name)) {
    file.arrayBuffer().then((b) => { bank = new Uint8Array(b); bankName.textContent = file.name; if (node) boot(); });
  } else {
    openLocal(file);
  }
});

// ---------------------------------------------------------------- drawing
function draw() {
  const mem = () => ui.memory.buffer;
  if (frame) {
    new Uint16Array(mem(), ui.panel_lcd(), 240 * 240).set(frame.lcd);
    new Float32Array(mem(), ui.panel_leds(), 41).set(frame.leds);
  }
  for (let i = 0; i < 41; i++) ui.panel_set(0, i, down[i]);
  for (let i = 0; i < 7; i++) ui.panel_set(1, i, encClicks[i]);
  ui.panel_set(2, 0, pot);
  for (let i = 0; i < 8; i++) {
    ui.panel_set(3, i, turning[i]);
    if (turning[i]) turning[i]--;
  }
  const p = ui.panel_draw();
  const img = new ImageData(new Uint8ClampedArray(mem(), p, W * H * 4), W, H);
  ctx.putImageData(img, 0, 0);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------------------------------------------------------------- input to the machine
const send = (m) => node && node.port.postMessage(m);
function setKey(id, on) {
  if (down[id] === (on ? 1 : 0)) return;
  down[id] = on ? 1 : 0;
  send({ type: "key", id, down: on });
}
function turn(i, clicks) {
  encClicks[i] += clicks;
  turning[i] = 10;
  send({ type: "enc", enc: ui.panel_enc_id(i), clicks });
}
function setPot(v) {
  pot = Math.max(0, Math.min(1023, Math.round(v)));
  turning[7] = 10;
  send({ type: "pot", value: pot });
}

// pointer: keys and buttons held while pressed (drag across keys: glissando), knobs dragged
// up / down or scrolled, MASTER as a pot. Every pointer on its own, so on a touch screen
// several fingers play a chord, or hold a key while one turns a knob.
const at = (e) => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
};
const holds = new Uint8Array(41);          // pointers holding each key / button
function press(id) { if (holds[id]++ === 0) setKey(id, true); }
function unpress(id) { if (holds[id] && --holds[id] === 0) setKey(id, false); }
const pointers = new Map();                // pointerId -> { grab, lastY, acc, held }
canvas.addEventListener("pointerdown", (e) => {
  const [x, y] = at(e);
  const p = { grab: ui.panel_hit(x, y), lastY: y, acc: 0, held: -1 };
  pointers.set(e.pointerId, p);
  canvas.setPointerCapture(e.pointerId);
  if (p.grab >= 100) {
    p.held = p.grab - 100;
    press(p.held);
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || p.grab < 0) return;
  const [x, y] = at(e);
  if (p.grab >= 100 && p.held >= 14) {
    const h = ui.panel_hit(x, y);              // glissando over the note keys
    if (h >= 114 && h - 100 !== p.held) {
      unpress(p.held);
      p.held = h - 100;
      press(p.held);
    }
  } else if (p.grab >= 0 && p.grab < 7) {
    p.acc += p.lastY - y;
    while (p.acc >= 12) { p.acc -= 12; turn(p.grab, 1); }
    while (p.acc <= -12) { p.acc += 12; turn(p.grab, -1); }
  } else if (p.grab === 7) {
    setPot(pot + (p.lastY - y) * 4);
  }
  p.lastY = y;
});
const release = (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (p.held >= 0) unpress(p.held);
  pointers.delete(e.pointerId);
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("lostpointercapture", release);
let wheelAcc = 0;
canvas.addEventListener("wheel", (e) => {
  const [x, y] = at(e);
  const h = ui.panel_hit(x, y);
  if (h < 0 || h > 7) return;
  e.preventDefault();
  if (h === 7) { setPot(pot - e.deltaY * 0.5); return; }
  wheelAcc -= e.deltaY;
  while (wheelAcc >= 40) { wheelAcc -= 40; turn(h, 1); }
  while (wheelAcc <= -40) { wheelAcc += 40; turn(h, -1); }
}, { passive: false });

// computer keyboard: A W S E D F T G Y H U J K O L P ; ' = C4..F5, Z X OCT- OCT+, Space PLAY,
// R REC, 1..0 FX SCL ENV LFO EDIT GLO HOME SAVE ARP SEQ, arrows / , . encoders
const PIANO = "awsedftgyhujkolp;'";
const BUTTONS = { z: 0, x: 1, " ": 12, r: 13, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 0: 11 };
const ENC_KEYS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowDown: [1, -1], ArrowUp: [1, 1], ",": [2, -1], ".": [2, 1] };
function keyId(k) {
  const i = PIANO.indexOf(k.toLowerCase());
  if (i >= 0) return 21 + i;
  const b = BUTTONS[k.toLowerCase()];
  return b === undefined ? -1 : b;
}
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.target instanceof HTMLSelectElement) return;
  if (ENC_KEYS[e.key]) { e.preventDefault(); turn(...ENC_KEYS[e.key]); return; }
  const id = keyId(e.key);
  if (id < 0 || e.repeat) return;
  e.preventDefault();
  setKey(id, true);
});
addEventListener("keyup", (e) => {
  const id = keyId(e.key);
  if (id >= 0) setKey(id, false);
});

// ---------------------------------------------------------------- audio: start on a click
let ac = null, last = null, bootSeq = 0, booting = 0;

// (re)boot the machine in the audio thread with the selected firmware and clock
async function boot() {
  const seq = ++bootSeq;
  const f = fw;
  if (f.id !== "local" && !f.byo) status.textContent = `downloading ${f.name} from ${new URL(f.package).host}…`;
  let got;
  try {
    got = await packageOf(f);
  } catch (err) {
    if (seq !== bootSeq) return;
    status.textContent = err instanceof NeedFile ? `${f.name}: open your FM-1.fwsc to boot it` :
      `${f.name}: could not load it (${err.message})`;
    return;
  }
  showFirmware();                                  // (says whether a kept copy is in use)
  if (seq !== bootSeq) return;                     // another choice came in meanwhile
  loadedUrl = got.url;
  showFirmware();
  down.fill(0);                                    // nothing held or turned across a reboot
  holds.fill(0);
  pointers.clear();
  encClicks.fill(0);
  frame = null;
  last = null;
  booting = seq;                                   // (frames of the old machine still on their way)
  node.port.postMessage({ type: "boot", seq, wasm: wasm.slice(0), package: got.bytes.slice().buffer,
    syx: bank ? bank.slice().buffer : null, mhz, jit: params.get("jit") !== "0" });
  status.textContent = `booting ${f.name}…`;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  status.textContent = "starting audio…";
  ac = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
  await ac.audioWorklet.addModule("worklet.js");
  node = new AudioWorkletNode(ac, "fm1", { numberOfInputs: 0, outputChannelCount: [2] });
  node.connect(ac.destination);
  node.port.onmessage = (e) => {
    const m = e.data;
    if (m.type === "error") {
      status.textContent = `${fw.name}: ${m.message}`;
      return;
    }
    if (m.type === "booted") {
      if (m.seq === bootSeq) booting = 0;
      return;
    }
    if (m.type !== "frame" || booting) return;
    frame = m;
    const now = performance.now();
    if (!last || now - last.t > 1000) {
      const mips = last ? (m.minsns - last.minsns) / ((now - last.t) / 1000) : 0;
      status.textContent = m.halted ? `${fw.name}: the emulated CPU halted` :
        `${fw.name} · ${mhz} MHz · ${mips.toFixed(0)} M instructions/s · ${(m.ms / 1000).toFixed(1)} s · ` +
        `${m.short} short audio quanta`;
      // (hover: the JIT's work in the audio thread)
      status.title = m.jit ? `JIT: ${m.jit.regions} regions compiled, ${m.jit.failed} failed${m.jit.error ? ` (${m.jit.error})` : ""}` : "";
      last = { t: now, minsns: m.minsns };
    }
  };
  await boot();
  await ac.resume();
  startBtn.hidden = true;
  // a phone on its side: the synth fills the screen, so bring all of it into view
  if (matchMedia("(orientation: landscape) and (max-height: 560px)").matches) canvas.scrollIntoView({ block: "center" });
});
