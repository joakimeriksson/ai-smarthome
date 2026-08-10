// Shared main-thread plumbing for the software synths.
//
// Every synth page had its own copy of the same four jobs: voice allocation,
// binding DOM controls to worklet params, drawing the scope, and the preset
// store. The copies were the same algorithms with different formatting, so
// this is a de-duplication rather than a redesign — with one exception noted
// on `slider()` below, where VA's option style differs and both are accepted.
//
// Plain script, not a module (the pages load it with a <script src> tag like
// keyboard.js), so it publishes one global: `SynthShell`.

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Voice allocation
  // ---------------------------------------------------------------------

  /**
   * Round-robin voice pool with oldest-voice stealing. Re-uses the voice
   * already holding a note so a retrigger doesn't consume a second slot.
   */
  class VoicePool {
    constructor(numVoices) {
      this.size = numVoices;
      this.voices = Array.from({ length: numVoices }, () => ({ note: -1, active: false, age: 0 }));
      this._age = 0;
    }

    /** Allocate a voice for `note` and return its index. */
    alloc(note) {
      const v = this.voices;
      for (let i = 0; i < this.size; i++) if (v[i].note === note && v[i].active) return i;
      for (let i = 0; i < this.size; i++) {
        if (!v[i].active) { v[i].note = note; v[i].active = true; v[i].age = ++this._age; return i; }
      }
      let oldest = 0;
      for (let i = 1; i < this.size; i++) if (v[i].age < v[oldest].age) oldest = i;
      v[oldest].note = note; v[oldest].active = true; v[oldest].age = ++this._age;
      return oldest;
    }

    /** Free the voice holding `note`; returns its index, or -1 if not held. */
    release(note) {
      const v = this.voices;
      for (let i = 0; i < this.size; i++) {
        if (v[i].note === note && v[i].active) { v[i].active = false; return i; }
      }
      return -1;
    }

    releaseAll() {
      const freed = [];
      this.voices.forEach((v, i) => { if (v.active) { v.active = false; freed.push(i); } });
      return freed;
    }

    get activeCount() {
      let n = 0;
      for (const v of this.voices) if (v.active) n++;
      return n;
    }
  }

  // ---------------------------------------------------------------------
  // Control binding
  // ---------------------------------------------------------------------

  /**
   * Bind DOM controls to a parameter sink. `send(param, value)` is whatever
   * the synth uses to reach its worklet.
   */
  function createBinder(send) {
    const $ = (id) => document.getElementById(id);

    return {
      /**
       * Slider → param, with the value read-out kept in sync.
       *
       * Two option styles are supported because the pages disagree:
       *   { map, format }                — ws / sid / fm / pm
       *   { transform, suffix, decimals } — va
       * `map`/`transform` convert the raw slider value; `format` renders the
       * read-out, or `suffix`/`decimals` compose one.
       */
      slider(id, param, opts = {}) {
        const el = $(id);
        if (!el) return;
        const valEl = $(id + '-val');
        const map = opts.map || opts.transform || ((v) => parseFloat(v));
        const format = opts.format || ((raw) => {
          const v = map(raw);
          const decimals = opts.decimals !== undefined ? opts.decimals : 2;
          return (typeof v === 'number' ? v.toFixed(decimals) : v) + (opts.suffix || '');
        });
        const update = () => {
          if (valEl) valEl.textContent = format(el.value);
          send(param, map(el.value));
        };
        el.addEventListener('input', update);
        if (valEl) valEl.textContent = format(el.value);
      },

      /** Select → param. Values are parsed as ints unless `raw` is set. */
      select(id, param, opts = {}) {
        const el = $(id);
        if (!el) return;
        el.addEventListener('change', () =>
          send(param, opts.raw ? el.value : parseInt(el.value, 10)));
      },

      /** Checkbox → boolean param. */
      checkbox(id, param) {
        const el = $(id);
        if (!el) return;
        el.addEventListener('change', () => send(param, el.checked));
      },
    };
  }

  // ---------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------

  /**
   * Animate an oscilloscope trace from an AnalyserNode. Colours default to
   * the page's own accent so each synth keeps its identity.
   */
  function startScope(opts) {
    const canvas = document.getElementById(opts.canvasId || 'scope');
    const analyser = opts.analyser;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const buf = new Float32Array(analyser.frequencyBinCount);
    const bg = opts.background || '#0a0a0d';
    const stroke = opts.stroke || '#00ff88';
    const lineWidth = opts.lineWidth || 1.5;

    (function draw() {
      requestAnimationFrame(draw);
      analyser.getFloatTimeDomainData(buf);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const sw = canvas.width / buf.length;
      for (let i = 0, x = 0; i < buf.length; i++, x += sw) {
        const y = (1 - buf[i]) * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    })();
  }

  // ---------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------

  /**
   * Factory + user preset store backed by localStorage, with the
   * `<select>` and Save button wiring the pages all repeat.
   *
   * `apply(preset)` pushes a preset into the synth and its UI; `capture()`
   * reads the current UI back out into a preset. Both stay with the synth,
   * since only it knows its own controls.
   */
  class PresetStore {
    constructor(opts) {
      this.storageKey = opts.storageKey;
      this.factory = opts.factory || [];
      this.apply = opts.apply;
      this.capture = opts.capture;
      this.selectId = opts.selectId || 'preset-select';
      this.saveBtnId = opts.saveBtnId || 'save-preset-btn';
      this.user = [];
    }

    load() {
      try {
        const s = localStorage.getItem(this.storageKey);
        if (s) this.user = JSON.parse(s) || [];
      } catch (e) { /* corrupt or unavailable storage — start empty */ }
      return this.user;
    }

    persist() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.user));
      } catch (e) { /* quota or private mode — presets stay in memory */ }
    }

    populateSelect() {
      const sel = document.getElementById(this.selectId);
      if (!sel) return;
      sel.innerHTML = '<option value="">-- Preset --</option>';
      this.factory.forEach((p, i) => {
        sel.innerHTML += `<option value="f:${i}">${p.name}</option>`;
      });
      if (this.user.length > 0) {
        sel.innerHTML += '<option disabled>──────────</option>';
        this.user.forEach((p, i) => {
          sel.innerHTML += `<option value="u:${i}">${p.name}</option>`;
        });
      }
    }

    get(value) {
      if (!value) return null;
      const [type, idx] = value.split(':');
      return (type === 'f' ? this.factory[idx] : this.user[idx]) || null;
    }

    /** Load presets, fill the select, and wire the select + save button. */
    init() {
      this.load();
      this.populateSelect();

      const sel = document.getElementById(this.selectId);
      if (sel) {
        sel.addEventListener('change', (e) => {
          const preset = this.get(e.target.value);
          if (preset && this.apply) this.apply(preset);
        });
      }

      const btn = document.getElementById(this.saveBtnId);
      if (btn && this.capture) {
        btn.addEventListener('click', () => {
          const name = prompt('Preset name:');
          if (!name) return;
          this.user.push(Object.assign({ name }, this.capture()));
          this.persist();
          this.populateSelect();
        });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Small DOM helpers the pages repeat
  // ---------------------------------------------------------------------

  /** Write "Voices: n/max" into an element. */
  function showVoiceCount(elId, pool) {
    const el = document.getElementById(elId || 'voice-display');
    if (el) el.textContent = `Voices: ${pool.activeCount}/${pool.size}`;
  }

  /** Set a slider/number input and fire `input` so its binding runs. */
  function setControl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function setSelectValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function setChecked(id, value) {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  }

  global.SynthShell = {
    VoicePool, createBinder, startScope, PresetStore,
    showVoiceCount, setControl, setSelectValue, setChecked,
  };
})(window);
