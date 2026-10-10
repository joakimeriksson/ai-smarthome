// The page: the front panel (drawn by the same Rust code as the native window, in its own wasm
// instance), the pointer and keyboard input, the firmware and clock pickers, and the audio graph
// that runs the emulator.
import { appFromPackage, fetchPackage } from "./fwsc.js";

const ENTRY = 0x02000120;                  // every firmware's app links here (behind 0x120 padding)
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

const wasm = await (await fetch("fm1_web.wasm")).arrayBuffer();   // the worklet gets its own copy
const ui = (await WebAssembly.instantiate(wasm, {})).instance.exports;
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

// the image of catalog entry f: its package, fetched from its author's site and unpacked here
// (nothing is hosted with this page), the app behind 0x120 bytes of padding; kept per session
const images = new Map();
async function imageOf(f) {
  if (!images.has(f.id)) {
    const { bytes, url } = await fetchPackage(f);
    const app = appFromPackage(bytes);
    const image = new Uint8Array(0x120 + app.length);
    image.set(app, 0x120);
    images.set(f.id, { image, url });
  }
  return images.get(f.id);
}

let loadedUrl = null;                      // the package the running machine came from

function showFirmware() {
  title.textContent = `M-VAVE FM-1 · ${fw.name} (emulated)`;
  const a = document.createElement("a");
  a.href = fw.repo;
  a.textContent = "source";
  const b = document.createElement("b");
  b.textContent = `${fw.name} ${fw.version}`;
  const parts = [b, ` by ${fw.author} · ${fw.license} · `, a, ` · ${fw.about}`];
  if (loadedUrl) {
    const p = document.createElement("a");
    p.href = loadedUrl;
    p.textContent = loadedUrl.split("/").pop();
    parts.push(" Running ", p, ".");
  }
  about.replaceChildren(...parts);
  const q = new URLSearchParams(location.search);
  q.set("fw", fw.id);
  q.set("mhz", mhz);
  history.replaceState(null, "", `?${q}`);
}
showFirmware();

fwSel.addEventListener("change", () => {
  fw = byId.get(fwSel.value);
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
// up / down or scrolled, MASTER as a pot
const at = (e) => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
};
let grab = -1, lastY = 0, acc = 0, mouseHeld = -1;
canvas.addEventListener("pointerdown", (e) => {
  const [x, y] = at(e);
  grab = ui.panel_hit(x, y);
  lastY = y;
  acc = 0;
  canvas.setPointerCapture(e.pointerId);
  if (grab >= 100) {
    mouseHeld = grab - 100;
    setKey(mouseHeld, true);
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (grab < 0) return;
  const [x, y] = at(e);
  if (grab >= 100 && mouseHeld >= 14) {
    const h = ui.panel_hit(x, y);              // glissando over the note keys
    if (h >= 114 && h - 100 !== mouseHeld) {
      setKey(mouseHeld, false);
      mouseHeld = h - 100;
      setKey(mouseHeld, true);
    }
  } else if (grab >= 0 && grab < 7) {
    acc += lastY - y;
    while (acc >= 12) { acc -= 12; turn(grab, 1); }
    while (acc <= -12) { acc += 12; turn(grab, -1); }
  } else if (grab === 7) {
    setPot(pot + (lastY - y) * 4);
  }
  lastY = y;
});
const release = () => {
  if (mouseHeld >= 0) setKey(mouseHeld, false);
  mouseHeld = -1;
  grab = -1;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
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
let ac = null, last = null, bootSeq = 0;

// (re)boot the machine in the audio thread with the selected firmware and clock
async function boot() {
  const seq = ++bootSeq;
  const f = fw;
  status.textContent = `downloading ${f.name} from ${new URL(f.package).host}…`;
  let got;
  try {
    got = await imageOf(f);
  } catch (err) {
    if (seq === bootSeq) status.textContent = `${f.name}: could not load it (${err.message})`;
    return;
  }
  if (seq !== bootSeq) return;                     // another choice came in meanwhile
  const firmware = got.image.slice().buffer;
  loadedUrl = got.url;
  showFirmware();
  down.fill(0);                                    // nothing held across a reboot
  frame = null;
  last = null;
  node.port.postMessage({ type: "boot", wasm: wasm.slice(0), firmware, entry: ENTRY, mhz });
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
    if (m.type !== "frame") return;
    frame = m;
    const now = performance.now();
    if (!last || now - last.t > 1000) {
      const mips = last ? (m.minsns - last.minsns) / ((now - last.t) / 1000) : 0;
      status.textContent = m.halted ? `${fw.name}: the emulated CPU halted` :
        `${fw.name} · ${mhz} MHz · ${mips.toFixed(0)} M instructions/s · ${(m.ms / 1000).toFixed(1)} s · ` +
        `${m.short} short audio quanta`;
      last = { t: now, minsns: m.minsns };
    }
  };
  await boot();
  await ac.resume();
  startBtn.hidden = true;
});
