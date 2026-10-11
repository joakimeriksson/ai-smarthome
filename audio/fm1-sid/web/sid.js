// FM-1 SID: the page. The M-VAVE FM-1's front panel (drawn by the emulator's own Rust code in
// a wasm instance of its own, as on ../fm-1/web), the emulated machine in an AudioWorklet
// running the SID player firmware (../firmware), and around it a player: the picks, all of
// HVSC to search (its index and the tunes are fetched from hvsc.c64.org when asked for; none
// are hosted here), your own .sid files, and the firmware's state mirrored from the keys the
// page sends it.
// SPDX-License-Identifier: GPL-3.0-only
import { buildPack, bootImage, sidInfo } from "./pack.js";

const HVSC = "https://www.hvsc.c64.org/download/C64Music/";
const MHZ = 240;                       // the FM-1's clock; idle time is skipped, not emulated
const KEY = { OCTDN: 0, OCTUP: 1, FX: 2, EDIT: 6, PLAY: 12 };
const ENC_TUNE = 6;                    // PRESETS (SELECT, 0, steps tunes too)
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (s) => s == null || !isFinite(s) ? "–:––" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const stored = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const [catalog, wasm, base] = await Promise.all([
  fetch("tunes.json").then((r) => r.json()),
  fetch("fm1_web.wasm").then((r) => r.arrayBuffer()),
  fetch("sidplayer.bin").then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
]);

// ------------------------------------------------------------------------------ state
// the playlist is the firmware's tune pack: every entry is in the image the machine runs
const list = catalog.picks.map((p) => ({ ...p, src: p.file ? p.file : HVSC + p.path, group: "picks" }));
const bytesOf = new Map();             // url -> Uint8Array (one copy per file)
const st = {
  idx: 0,                              // the entry the firmware plays
  engine: Number(stored("fm1sid.engine") || 0),   // 0 reSID 0.16, 1 fm1-sid's model
  chip: Number(stored("fm1sid.chip") || 0),       // 0 the tune's, 1 6581, 2 8580
  model: "6581",                       // what the firmware runs now
  paused: false,
  elapsed: 0,                          // emulated seconds into the tune, without pauses
  lastMs: null,                        // the machine's clock at the last frame
  booted: false,
};
let node = null, ac = null, gain = null, analyser = null, frame = null, bootSeq = 0;
let packed = [];                       // the entries in the running image, in pack order

// ------------------------------------------------------------------------------ panel
const canvas = $("panel");
const ctx = canvas.getContext("2d");
const ui = (await WebAssembly.instantiate(wasm, {})).instance.exports;
const W = ui.panel_width(), H = ui.panel_height();
canvas.width = W;
canvas.height = H;
const down = new Uint8Array(41);
const encClicks = new Int32Array(7);
const turning = new Uint32Array(8);

function drawPanel() {
  const mem = () => ui.memory.buffer;
  if (frame) {
    new Uint16Array(mem(), ui.panel_lcd(), 240 * 240).set(frame.lcd);
    new Float32Array(mem(), ui.panel_leds(), 41).set(frame.leds);
  }
  for (let i = 0; i < 41; i++) ui.panel_set(0, i, down[i]);
  for (let i = 0; i < 7; i++) ui.panel_set(1, i, encClicks[i]);
  ui.panel_set(2, 0, 900);
  for (let i = 0; i < 8; i++) {
    ui.panel_set(3, i, turning[i]);
    if (turning[i]) turning[i]--;
  }
  const p = ui.panel_draw();
  ctx.putImageData(new ImageData(new Uint8ClampedArray(mem(), p, W * H * 4), W, H), 0, 0);
  drawScope();
  requestAnimationFrame(drawPanel);
}
requestAnimationFrame(drawPanel);

// ------------------------------------------------------------------------------ input
// everything the machine is sent goes through here, so the page knows what the firmware does
const send = (m) => node && st.booted && node.port.postMessage(m);
function setKey(id, on) {
  if (down[id] === (on ? 1 : 0)) return;
  down[id] = on ? 1 : 0;
  send({ type: "key", id, down: on });
  if (!on || !st.booted) return;
  if (id === KEY.PLAY) st.paused = !st.paused;
  else if (id === KEY.EDIT) { st.engine ^= 1; store("fm1sid.engine", st.engine); restarted(); }
  else if (id === KEY.FX) { st.model = st.model === "6581" ? "8580" : "6581"; restarted(); }
  else if (id === KEY.OCTUP) stepped(1);
  else if (id === KEY.OCTDN) stepped(-1);
  showNow();
}
function tap(id) { setKey(id, true); setTimeout(() => setKey(id, false), 90); }
function turnMachine(enc, clicks) {
  send({ type: "enc", enc, clicks });
  if (st.booted && (enc === 6 || enc === 0)) stepped(clicks);
}
function turn(i, clicks) {           // a panel knob (i: the panel's numbering)
  encClicks[i] += clicks;
  turning[i] = 10;
  turnMachine(ui.panel_enc_id(i), clicks);
}
function stepped(n) {                // the firmware moved n entries along its pack
  st.idx = ((st.idx + n) % packed.length + packed.length) % packed.length;
  st.model = modelOf(packed[st.idx]);
  restarted();
  showList();
  showNow();
}
function restarted() { st.elapsed = 0; st.paused = false; }
function modelOf(e) { return st.chip ? (st.chip === 1 ? "6581" : "8580") : (e.info?.model || "6581"); }

const at = (e) => {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
};
let grab = -1, lastY = 0, acc = 0, held = -1;
canvas.addEventListener("pointerdown", (e) => {
  if (!node) return;
  const [x, y] = at(e);
  grab = ui.panel_hit(x, y);
  lastY = y;
  acc = 0;
  canvas.setPointerCapture(e.pointerId);
  if (grab >= 100) { held = grab - 100; setKey(held, true); }
});
canvas.addEventListener("pointermove", (e) => {
  if (grab < 0) return;
  const [x, y] = at(e);
  if (grab >= 100 && held >= 14) {
    const h = ui.panel_hit(x, y);
    if (h >= 114 && h - 100 !== held) { setKey(held, false); held = h - 100; setKey(held, true); }
  } else if (grab >= 0 && grab < 7) {
    acc += lastY - y;
    while (acc >= 14) { acc -= 14; turn(grab, 1); }
    while (acc <= -14) { acc += 14; turn(grab, -1); }
  }
  lastY = y;
});
const release = () => { if (held >= 0) setKey(held, false); held = -1; grab = -1; };
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
let wheelAcc = 0;
canvas.addEventListener("wheel", (e) => {
  if (!node) return;
  const [x, y] = at(e);
  const h = ui.panel_hit(x, y);
  if (h < 0 || h > 6) return;
  e.preventDefault();
  wheelAcc -= e.deltaY;
  while (wheelAcc >= 60) { wheelAcc -= 60; turn(h, 1); }
  while (wheelAcc <= -60) { wheelAcc += 60; turn(h, -1); }
}, { passive: false });

// keyboard: the FM-1 page's layout, plus N / P for the next / previous tune
const PIANO = "awsedftgyhujkolp;'";
const BUTTONS = { z: 0, x: 1, " ": 12, r: 13, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 0: 11 };
const ENC_KEYS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowDown: [1, -1], ArrowUp: [1, 1] };
const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement && e.key === " ";
function keyId(k) {
  const i = PIANO.indexOf(k.toLowerCase());
  if (i >= 0) return 21 + i;
  const b = BUTTONS[k.toLowerCase()];
  return b === undefined ? -1 : b;
}
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || !node) return;
  if (e.key === "n" || e.key === "N") { e.preventDefault(); go(st.idx + 1); return; }
  if (e.key === "p" || e.key === "P") { e.preventDefault(); go(st.idx - 1); return; }
  if (ENC_KEYS[e.key]) { e.preventDefault(); turn(...ENC_KEYS[e.key]); return; }
  const id = keyId(e.key);
  if (id < 0 || e.repeat) return;
  e.preventDefault();
  setKey(id, true);
});
addEventListener("keyup", (e) => { const id = keyId(e.key); if (id >= 0) setKey(id, false); });

// ------------------------------------------------------------------------------ tunes
async function load(e) {
  if (!bytesOf.has(e.src)) {
    const r = await fetch(e.src);
    if (!r.ok) throw new Error(`${r.status} from ${new URL(e.src, location).host}`);
    bytesOf.set(e.src, new Uint8Array(await r.arrayBuffer()));
  }
  e.bytes = bytesOf.get(e.src);
  e.info = sidInfo(e.bytes);
  if (!e.info) throw new Error("not a .sid file");
  if (e.info.kind === "RSID") throw new Error("an RSID tune: it needs a whole C64 (interrupts, VIC, both CIAs), which this player does not have yet");
  if (!e.title) Object.assign(e, { title: e.info.title, author: e.info.author, released: e.info.released, songs: e.info.songs });
  return e;
}

// (re)boot the machine on the playlist, starting at entry `first`
async function boot(first) {
  const seq = ++bootSeq;
  status(`fetching ${list.filter((e) => !e.bytes && !e.failed).length || "the"} tunes from HVSC…`);
  await Promise.all(list.map((e) => e.bytes || e.failed ? null : load(e).catch((err) => { e.failed = err.message; })));
  if (seq !== bootSeq) return;
  const want = list[first];
  packed = list.filter((e) => e.bytes);
  let image;
  for (;;) {
    try {
      image = bootImage(base, buildPack(packed, 0, 0));
      break;
    } catch {                                        // too big: drop the oldest added tune
      const i = packed.findIndex((e) => e.group !== "picks" && e !== want);
      if (i < 0) throw new Error("the tunes do not fit");
      list.splice(list.indexOf(packed[i]), 1);
      packed.splice(i, 1);
    }
  }
  st.idx = Math.max(0, packed.indexOf(want));
  image = bootImage(base, buildPack(packed, st.idx, st.engine | st.chip << 1));
  st.model = modelOf(packed[st.idx]);
  st.booted = false;
  restarted();
  st.lastMs = null;
  frame = null;
  down.fill(0);
  node.port.postMessage({ type: "boot", wasm: wasm.slice(0), image: image.buffer, mhz: MHZ, seq }, [image.buffer]);
  status("booting the FM-1…");
  showList();
  showNow();
}

// play entry i of the playlist: the firmware steps there if it has it, else a reboot
function go(i) {
  if (!list.length) return;
  i = ((i % list.length) + list.length) % list.length;
  const e = list[i];
  if (e.failed) { toast(`${e.title}: ${e.failed}`); return; }
  if (!node) { start(i); return; }
  const k = packed.indexOf(e);
  if (k < 0 || !st.booted) { boot(i); return; }
  let d = k - st.idx;
  const n = packed.length;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  if (d) turnMachine(ENC_TUNE, d);
  else { turnMachine(ENC_TUNE, 1); turnMachine(ENC_TUNE, -1); }   // the same one: from the top
}
const current = () => packed[st.idx];

// a tune from HVSC (search, random, a link) or a file: into the playlist, then play it
async function add(entry) {
  let e = list.find((x) => x.src === entry.src && x.song === entry.song);
  if (!e) {
    e = { ...entry };
    try {
      await load(e);
    } catch (err) {
      toast(`${entry.title || entry.path || "That file"}: ${err.message}`);
      return false;
    }
    list.push(e);
  }
  go(list.indexOf(e));
  return true;
}

async function setSong(delta) {
  const e = current();
  if (!e || !e.songs || e.songs < 2) return;
  if (e.path) await loadIndex().catch(() => {});       // the other songs' lengths
  const song = ((e.song || e.info?.start || 1) - 1 + delta + e.songs) % e.songs + 1;
  const copy = { ...e, song, group: e.group === "picks" ? "added" : e.group, length: lengthOf(e.path, song) };
  const i = list.indexOf(e);
  if (e.group === "picks") list.splice(i + 1, 0, copy);
  else list[i] = copy;
  boot(list.indexOf(copy));
}

// ------------------------------------------------------------------------------ HVSC index
let index = null;                      // { paths: [], lens: [] } from Songlengths.md5
let indexing = null;
async function loadIndex() {
  if (index) return index;
  if (indexing) return indexing;
  indexing = (async () => {
    const r = await fetch(HVSC + "DOCUMENTS/Songlengths.md5");
    if (!r.ok) throw new Error(`HVSC answered ${r.status}`);
    const total = Number(r.headers.get("content-length")) || 5.2e6;
    const reader = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      $("search").placeholder = `loading the HVSC index… ${Math.round(100 * got / total)} %`;
    }
    const text = new TextDecoder("latin1").decode(await new Blob(parts).arrayBuffer());
    const paths = [], lens = [];
    let path = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("; /")) path = line.slice(3);
      else if (path && line.includes("=")) {
        paths.push(path);
        lens.push(line.slice(line.indexOf("=") + 1));
        path = null;
      }
    }
    index = { paths, lens, lower: paths.map((p) => p.toLowerCase().replace(/_/g, " ")) };
    $("search").placeholder = `Search ${paths.length.toLocaleString("en")} tunes: title, composer, game…`;
    $("count").textContent = $("facts-n").textContent = paths.length.toLocaleString("en");
    return index;
  })();
  return indexing;
}
function secs(t) {
  const m = /^(\d+):(\d+(?:\.\d+)?)/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function lengthOf(path, song) {
  if (!index || !path) return null;
  const i = index.paths.indexOf(path);
  return i < 0 ? null : secs(index.lens[i].split(" ")[song - 1]);
}
// "MUSICIANS/H/Hubbard_Rob/Sanxion.sid" -> Sanxion, Rob Hubbard
function describe(path) {
  const parts = path.split("/");
  const title = parts.at(-1).replace(/\.sid$/i, "").replace(/_/g, " ");
  let who = parts.at(-2) || "";
  if (parts[0] === "MUSICIANS") {
    const w = who.split("_");
    who = w.length > 1 ? `${w.slice(1).join(" ")} ${w[0]}` : w[0];
  } else {
    who = `${parts[0].toLowerCase()} · ${who.replace(/_/g, " ")}`;
  }
  return { title, who };
}
function entryOf(i) {
  const path = index.paths[i];
  const d = describe(path);
  const lens = index.lens[i].split(" ");
  return { path, src: HVSC + path, song: 0, songs: lens.length, title: d.title, author: d.who,
    length: secs(lens[0]), group: "hvsc" };
}

let searchTimer = 0;
async function search(q) {
  const out = $("results");
  try {
    await loadIndex();
  } catch (err) {
    out.replaceChildren(el("li", "empty", `Could not load the HVSC index (${err.message}).`));
    return;
  }
  const words = q.toLowerCase().replace(/_/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) { out.replaceChildren(); return; }
  const hits = [];
  for (let i = 0; i < index.lower.length && hits.length < 120; i++) {
    const p = index.lower[i];
    if (words.every((w) => p.includes(w))) hits.push(i);
  }
  out.replaceChildren(...(hits.length ? hits.map((i) => resultRow(entryOf(i))) :
    [el("li", "empty", "Nothing in HVSC matches that.")]));
}
function resultRow(e) {
  const li = el("li");
  const b = el("button", "row");
  b.append(el("span", "t", e.title), el("span", "a", e.author),
    el("span", "m", `${e.songs > 1 ? `${e.songs} songs · ` : ""}${fmt(e.length)}`));
  b.title = e.path;
  b.addEventListener("click", async () => {
    b.classList.add("busy");
    await add(e);
    b.classList.remove("busy");
  });
  li.append(b);
  return li;
}
async function surprise() {
  const btn = $("random");
  btn.disabled = true;
  try {
    await loadIndex();
    for (let tries = 0; tries < 8; tries++) {
      const e = entryOf(Math.floor(Math.random() * index.paths.length));
      const probe = { ...e };
      try { await load(probe); } catch { continue; }    // RSID and friends: draw again
      await add(probe);
      break;
    }
  } catch (err) {
    toast(`HVSC: ${err.message}`);
  }
  btn.disabled = false;
}

// ------------------------------------------------------------------------------ drawing the page
function status(t) { $("status").textContent = t; }
let toastTimer = 0;
function toast(t) {
  const e = $("toast");
  e.textContent = t;
  e.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => e.classList.remove("on"), 6000);
}

function tagChips(tags) {
  const f = document.createDocumentFragment();
  for (const t of tags || []) f.append(el("span", `tag ${t}`, t));
  return f;
}

function showList() {
  const ul = $("playlist");
  const playing = current();
  ul.replaceChildren(...list.map((e, i) => {
    const li = el("li");
    const b = el("button", "row");
    if (e === playing && node) b.classList.add("on");
    if (e.failed) b.classList.add("failed");
    const n = el("span", "n");
    n.append(el("span", "num", String(i + 1).padStart(2, "0")), eq());
    const t = el("span", "t", e.title || describe(e.path || e.src).title);
    if (e.songs > 1) t.append(el("span", "song", ` #${e.song || e.info?.start || 1}`));
    b.append(n, t, el("span", "a", [e.author, (e.released || "").slice(0, 4)].filter(Boolean).join(" · ")));
    const m = el("span", "m");
    m.append(tagChips(e.tags), el("span", "len", e.failed ? "unavailable" : fmt(e.length)));
    b.append(m);
    b.title = e.failed ? e.failed : (e.path || e.note || "");
    b.addEventListener("click", () => go(i));
    li.append(b);
    return li;
  }));
}
function eq() {
  const s = el("span", "eq");
  s.setAttribute("aria-hidden", "true");
  s.append(el("i"), el("i"), el("i"));
  return s;
}

function showNow() {
  const e = current() || list[0];
  if (!e) return;
  $("np-title").textContent = e.title || "";
  $("np-author").textContent = [e.author, e.released].filter(Boolean).join(" · ");
  const src = $("np-src");
  if (e.path) { src.href = HVSC + e.path; src.textContent = `HVSC /${e.path}`; }
  else { src.removeAttribute("href"); src.textContent = e.note || "your file"; }
  const songs = e.songs || 1;
  $("np-song").textContent = `${e.song || e.info?.start || 1} / ${songs}`;
  $("song-prev").disabled = $("song-next").disabled = songs < 2 || !node;
  $("np-tags").replaceChildren(tagChips(e.tags));
  $("np-chip").textContent = node ? st.model : "";
  $("play").setAttribute("aria-label", st.paused ? "Play" : "Pause");
  $("play").classList.toggle("paused", st.paused || !node);
  for (const b of document.querySelectorAll("[data-engine]")) b.setAttribute("aria-pressed", String(Number(b.dataset.engine) === st.engine));
  for (const b of document.querySelectorAll("[data-chip]")) b.setAttribute("aria-pressed", String(Number(b.dataset.chip) === st.chip));
  document.title = node && e.title ? `${e.title} · FM-1 SID` : "FM-1 SID";
  if (node) {                          // the address follows the tune (HVSC ones only)
    const q = e.path ? `?t=${encodeURI(e.path)}${e.song ? `&s=${e.song}` : ""}` : location.pathname;
    history.replaceState(null, "", q);
  }
}

function showTime() {
  const e = current();
  const len = e?.length;
  $("np-time").textContent = `${fmt(st.elapsed)} / ${fmt(len)}`;
  $("np-bar").style.transform = `scaleX(${len ? Math.min(1, st.elapsed / len) : 0})`;
}

// the audio, as the machine made it: an oscilloscope under the title
const scope = $("scope");
const sctx = scope.getContext("2d");
let scopeBuf = null;
function drawScope() {
  const w = scope.clientWidth * devicePixelRatio, h = scope.clientHeight * devicePixelRatio;
  if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
  sctx.clearRect(0, 0, w, h);
  if (!analyser) return;
  if (!scopeBuf) scopeBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(scopeBuf);
  let start = 0;                       // a rising zero crossing, so the picture stands still
  for (let i = 1; i < scopeBuf.length / 2; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { start = i; break; }
  const n = Math.min(scopeBuf.length - start, 1024);
  let peak = 0.05;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(scopeBuf[start + i]));
  sctx.lineWidth = 1.5 * devicePixelRatio;
  sctx.strokeStyle = getComputedStyle(scope).color;
  sctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w, y = h / 2 - (scopeBuf[start + i] / peak) * h * 0.42;
    i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
  }
  sctx.stroke();
}

// ------------------------------------------------------------------------------ start
async function start(first) {
  if (node) return;
  $("power").disabled = true;
  status("starting audio…");
  ac = new AudioContext({ sampleRate: 44100, latencyHint: "interactive" });
  await ac.audioWorklet.addModule("worklet.js");
  node = new AudioWorkletNode(ac, "fm1", { numberOfInputs: 0, outputChannelCount: [2] });
  gain = ac.createGain();
  gain.gain.value = Number($("vol").value);
  analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(gain).connect(ac.destination);
  gain.connect(analyser);
  let last = null;
  node.port.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "error") { status(`the emulator stopped: ${m.message}`); return; }
    if (m.type === "booted") {
      if (m.seq === bootSeq) { st.booted = true; st.lastMs = null; st.elapsed = 0; showNow(); }
      return;
    }
    if (m.type !== "frame" || !st.booted) return;      // (frames from the machine before a reboot)
    frame = m;
    if (st.lastMs != null && !st.paused) st.elapsed += Math.max(0, m.ms - st.lastMs) / 1000;
    st.lastMs = m.ms;
    showTime();
    const e = current();
    if (e?.length && st.elapsed > e.length + 0.4 && !st.paused && $("advance").checked) go(st.idx + 1 < packed.length ? list.indexOf(packed[st.idx + 1]) : 0);
    const now = performance.now();
    if (!last || now - last.t > 1000) {
      if (last) {
        const mips = (m.minsns - last.minsns) / ((now - last.t) / 1000);
        const speed = (m.ms - last.ms) / (now - last.t);
        status(m.halted ? "the emulated CPU halted" :
          `pi32v2 @ ${MHZ} MHz · ${mips.toFixed(0)} M instructions/s · ${speed.toFixed(2)}× real time` +
          (m.short > (last.short || 0) ? " · audio dropouts: your machine is not keeping up" : ""));
      }
      last = { t: now, minsns: m.minsns, ms: m.ms, short: m.short };
    }
  };
  document.body.classList.add("running");
  if (list.some((e) => e.path && e.length == null)) {  // a linked tune: its length is in the index
    loadIndex().then(() => {
      for (const e of list) if (e.path && e.length == null) e.length = lengthOf(e.path, e.song || 1);
      showList();
    }).catch(() => {});
  }
  await boot(first);
  await ac.resume();
  $("power").hidden = true;
}

// ------------------------------------------------------------------------------ wiring
$("power").addEventListener("click", () => start(initial));
$("play").addEventListener("click", () => (node ? tap(KEY.PLAY) : start(initial)));
$("next").addEventListener("click", () => go(st.idx + 1 < packed.length ? list.indexOf(packed[st.idx + 1]) : list.indexOf(current()) + 1));
$("prev").addEventListener("click", () => go(Math.max(0, list.indexOf(current())) - 1));
$("song-prev").addEventListener("click", () => setSong(-1));
$("song-next").addEventListener("click", () => setSong(1));
for (const b of document.querySelectorAll("[data-engine]")) {
  b.addEventListener("click", () => {
    if (Number(b.dataset.engine) === st.engine) return;
    if (node && st.booted) tap(KEY.EDIT);
    else { st.engine = Number(b.dataset.engine); store("fm1sid.engine", st.engine); showNow(); }
  });
}
for (const b of document.querySelectorAll("[data-chip]")) {
  b.addEventListener("click", () => {
    st.chip = Number(b.dataset.chip);
    store("fm1sid.chip", st.chip);
    showNow();
    if (node) boot(list.indexOf(current()));
  });
}
$("vol").addEventListener("input", () => { if (gain) gain.gain.value = Number($("vol").value); store("fm1sid.vol", $("vol").value); });
$("vol").value = stored("fm1sid.vol") || "0.8";
$("advance").checked = stored("fm1sid.advance") !== "0";
$("advance").addEventListener("change", () => store("fm1sid.advance", $("advance").checked ? "1" : "0"));

const tabs = [...document.querySelectorAll("[role=tab]")];
function pickTab(t) {
  for (const x of tabs) {
    const on = x === t;
    x.setAttribute("aria-selected", String(on));
    x.tabIndex = on ? 0 : -1;
    $(x.getAttribute("aria-controls")).hidden = !on;
  }
  if (t.id === "tab-hvsc") loadIndex().catch((err) => { $("search").placeholder = `HVSC index: ${err.message}`; });
}
for (const t of tabs) {
  t.addEventListener("click", () => pickTab(t));
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      n.focus();
      pickTab(n);
    }
  });
}
$("search").addEventListener("focus", () => loadIndex().catch(() => {}));
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(e.target.value), 160);
});
$("random").addEventListener("click", surprise);

// your own .sid files: the picker or a drop anywhere on the page
async function openFiles(files) {
  let first = true;
  for (const f of files) {
    if (!/\.sid$/i.test(f.name)) continue;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const src = `file:${f.name}:${f.size}`;
    bytesOf.set(src, bytes);
    const info = sidInfo(bytes);
    const e = { src, song: 0, songs: info?.songs, title: info?.title || f.name, author: info?.author,
      released: info?.released, length: null, group: "file", note: `${f.name}, from this computer` };
    if (first) { await add(e); first = false; }
    else if (info?.kind === "PSID" && !list.some((x) => x.src === src)) {
      try { await load(e); list.push(e); } catch (err) { toast(`${f.name}: ${err.message}`); }
    }
  }
  showList();
  if (!first) pickTab($("tab-list"));
}
$("files").addEventListener("change", (e) => { openFiles([...e.target.files]); e.target.value = ""; });
addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dropping"); });
addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dropping"); });
addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dropping");
  openFiles([...e.dataTransfer.files]);
});

// a link to a tune: ?t=MUSICIANS/H/Hubbard_Rob/Sanxion.sid&s=2
const params = new URLSearchParams(location.search);
let initial = 0;
if (params.get("t")) {
  const path = params.get("t").replace(/^\/+/, "");
  const song = Number(params.get("s") || 0);
  let i = list.findIndex((e) => e.path === path && (!song || e.song === song));
  if (i < 0 && /^[\w\-./ ]+\.sid$/i.test(path) && !path.includes("..")) {
    const d = describe(path);
    list.unshift({ path, src: HVSC + path, song, title: d.title, author: d.who, group: "hvsc" });
    i = 0;
  }
  initial = Math.max(0, i);
}
st.idx = initial;
packed = list.slice();
showList();
showNow();
showTime();
status("press Power to boot the FM-1");
