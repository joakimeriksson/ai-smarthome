// Hardware front panel shared by the six synths.
//
// The pages are written as rows of `label + range + value`. That markup is
// kept exactly as it is, because every page's main.js binds to it by id. This
// file only adds a face on top of it:
//
//   - each range becomes a rotary knob or a vertical fader,
//   - rows are laid out as control banks, label under the control,
//   - the preset picker becomes a display window, and the keyboard gets a
//     nameplate.
//
// The native <input type=range> stays in the DOM, hidden, and is still the
// only source of truth. Turning a knob writes input.value and dispatches the
// same `input` / `change` events a user drag would; a preset load that writes
// input.value is picked up by the redraw loop. So no synth code changes, and
// removing this file (plus css/panel-hw.css) gives back the plain page.
//
// Which widget a range gets comes from the CSS custom property --hw-control
// on its row: `knob` (default) or `fader`. Envelope groups default to faders;
// a synth's stylesheet can switch a whole section by setting the property.

(function () {
  'use strict';

  const SWEEP = 270;              // knob travel in degrees, centred on 12 o'clock
  const TICKS = 11;               // scale marks, 0..10 like a hardware legend
  const DRAG_PX = 200;            // pointer travel for the full range
  const FINE = 0.1;               // Shift-drag multiplier
  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** @type {Set<Control>} */
  const controls = new Set();

  // ---------------------------------------------------------------------
  // A widget bound to one native range input
  // ---------------------------------------------------------------------

  class Control {
    constructor(input, kind, labelText) {
      this.input = input;
      this.kind = kind;
      this.el = document.createElement('div');
      this.el.className = kind === 'fader' ? 'hw-fader' : 'hw-knob';
      this.el.tabIndex = 0;
      this.el.setAttribute('role', 'slider');
      if (labelText) this.el.setAttribute('aria-label', labelText);
      this._last = null;

      if (kind === 'fader') this._buildFader(); else this._buildKnob();
      this._bind();
      this.sync(true);
    }

    get min() { return parseFloat(this.input.min || '0'); }
    get max() { return parseFloat(this.input.max || '100'); }

    /** Current value as 0..1 of the input's range. */
    norm() {
      const span = this.max - this.min;
      if (!(span > 0)) return 0;
      return Math.min(1, Math.max(0, (parseFloat(this.input.value) - this.min) / span));
    }

    /** Write a 0..1 position through the native input, as a user edit would. */
    setNorm(n, commit) {
      n = Math.min(1, Math.max(0, n));
      const before = this.input.value;
      // The browser snaps to `step`, exactly as for a real drag.
      this.input.value = String(this.min + n * (this.max - this.min));
      if (this.input.value !== before) {
        this.input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (commit) this.input.dispatchEvent(new Event('change', { bubbles: true }));
      this.sync();
    }

    /** Redraw if the value moved — whoever moved it. */
    sync(force) {
      const v = this.input.value;
      if (!force && v === this._last) return;
      this._last = v;
      const n = this.norm();
      this.el.style.setProperty('--n', n.toFixed(4));
      this.el.setAttribute('aria-valuemin', this.input.min || '0');
      this.el.setAttribute('aria-valuemax', this.input.max || '100');
      this.el.setAttribute('aria-valuenow', v);
      const readout = this.input.parentElement && this.input.parentElement.querySelector('.val');
      if (readout && readout.textContent) this.el.setAttribute('aria-valuetext', readout.textContent);
      if (this.kind === 'knob') this._paintScale(n);
    }

    // --- Knob ------------------------------------------------------------

    _buildKnob() {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 64 64');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add('hw-scale');
      this.ticks = [];
      for (let i = 0; i < TICKS; i++) {
        const a = (-SWEEP / 2 + (SWEEP * i) / (TICKS - 1)) * Math.PI / 180;
        const major = i === 0 || i === TICKS - 1 || i === (TICKS - 1) / 2;
        const r0 = major ? 26.5 : 27.5, r1 = 31;
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', (32 + r0 * Math.sin(a)).toFixed(2));
        line.setAttribute('y1', (32 - r0 * Math.cos(a)).toFixed(2));
        line.setAttribute('x2', (32 + r1 * Math.sin(a)).toFixed(2));
        line.setAttribute('y2', (32 - r1 * Math.cos(a)).toFixed(2));
        if (major) line.classList.add('major');
        svg.appendChild(line);
        this.ticks.push(line);
      }
      const cap = document.createElement('div');
      cap.className = 'hw-cap';
      const pointer = document.createElement('div');
      pointer.className = 'hw-pointer';
      this.el.append(svg, cap, pointer);
      // A range that straddles zero is bipolar: light the scale from centre.
      this.bipolar = this.min < 0 && this.max > 0;
      if (this.bipolar) this.el.classList.add('bipolar');
    }

    _paintScale(n) {
      const pos = n * (TICKS - 1);
      const zero = this.bipolar ? (-this.min / (this.max - this.min)) * (TICKS - 1) : 0;
      const lo = Math.min(zero, pos) - 0.01, hi = Math.max(zero, pos) + 0.01;
      this.ticks.forEach((t, i) => t.classList.toggle('lit', i >= lo && i <= hi));
    }

    // --- Fader -----------------------------------------------------------

    _buildFader() {
      const scale = document.createElement('div');
      scale.className = 'hw-fader-scale';
      const slot = document.createElement('div');
      slot.className = 'hw-fader-slot';
      const cap = document.createElement('div');
      cap.className = 'hw-fader-cap';
      this.el.append(scale, slot, cap);
    }

    // --- Interaction -----------------------------------------------------

    _bind() {
      const el = this.el;
      let start = null;

      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.focus({ preventScroll: true });
        el.setPointerCapture(e.pointerId);
        const cell = el.closest('.hw-cell');
        if (cell) cell.classList.add('hw-active');
        if (this.kind === 'fader' && !e.target.classList.contains('hw-fader-cap')) {
          // A click on a fader's track jumps there, like a real slot would
          // if you put your finger on it.
          this.setNorm(this._faderPos(e.clientY));
        }
        start = { x: e.clientX, y: e.clientY, n: this.norm() };
      });

      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        const fine = e.shiftKey ? FINE : 1;
        let dn;
        if (this.kind === 'fader') {
          const h = el.querySelector('.hw-fader-slot').getBoundingClientRect().height || DRAG_PX;
          dn = ((start.y - e.clientY) / h) * fine;
        } else {
          // Up or right turns it up; either axis works, as on most plugins.
          dn = ((start.y - e.clientY) + (e.clientX - start.x)) / DRAG_PX * fine;
        }
        this.setNorm(start.n + dn);
        if (fine !== 1) start = { x: e.clientX, y: e.clientY, n: this.norm() };
      });

      const end = () => {
        if (!start) return;
        start = null;
        const cell = el.closest('.hw-cell');
        if (cell) cell.classList.remove('hw-active');
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      // Double-click returns to the value the page was written with.
      el.addEventListener('dblclick', () => {
        const d = parseFloat(this.input.defaultValue);
        if (isFinite(d)) this.setNorm((d - this.min) / (this.max - this.min), true);
      });

      // Wheel only once the control has focus, so scrolling a long page past
      // a bank of knobs never changes a sound by accident.
      el.addEventListener('wheel', (e) => {
        if (document.activeElement !== el) return;
        e.preventDefault();
        const unit = e.shiftKey ? 0.002 : 0.02;
        this.setNorm(this.norm() - Math.sign(e.deltaY) * unit, true);
      }, { passive: false });

      el.addEventListener('keydown', (e) => {
        const unit = e.shiftKey ? 0.002 : 0.01;
        const moves = {
          ArrowUp: unit, ArrowRight: unit, ArrowDown: -unit, ArrowLeft: -unit,
          PageUp: 0.1, PageDown: -0.1,
        };
        if (e.key in moves) this.setNorm(this.norm() + moves[e.key], true);
        else if (e.key === 'Home') this.setNorm(0, true);
        else if (e.key === 'End') this.setNorm(1, true);
        else return;           // every other key still plays the synth
        e.preventDefault();
        e.stopPropagation();
      });
    }

    _faderPos(clientY) {
      const r = this.el.querySelector('.hw-fader-slot').getBoundingClientRect();
      return 1 - (clientY - r.top) / r.height;
    }
  }

  // ---------------------------------------------------------------------
  // Turning rows into cells, and cells into banks
  // ---------------------------------------------------------------------

  function controlKind(row) {
    const v = getComputedStyle(row).getPropertyValue('--hw-control').trim();
    return v === 'fader' ? 'fader' : 'knob';
  }

  function enhanceRow(row) {
    if (row.classList.contains('hw-cell')) return;
    const ranges = row.querySelectorAll(':scope > input[type="range"]');
    const label = row.querySelector(':scope > label');

    if (row.classList.contains('checkbox-row')) {
      if (!row.querySelector(':scope > input[type="checkbox"]')) return;
      row.classList.add('hw-cell', 'hw-switch');
      return;
    }
    if (ranges.length === 0) {
      if (!row.querySelector(':scope > select')) return;
      row.classList.add('hw-cell', 'hw-choice');
      return;
    }
    if (ranges.length !== 1) return;     // not a shape this layer understands

    const input = ranges[0];
    const kind = controlKind(row);
    const text = label ? label.textContent.trim() : input.id;
    const control = new Control(input, kind, text);
    input.classList.add('hw-native');
    input.tabIndex = -1;
    input.after(control.el);
    row.classList.add('hw-cell', kind === 'fader' ? 'hw-fader-cell' : 'hw-knob-cell');
    if (label) {
      label.addEventListener('click', () => control.el.focus());
      if (!label.title) label.title = text;
    }
    controls.add(control);
  }

  /** Wrap each run of adjacent cells in one bank, so they sit side by side. */
  function groupBanks(root) {
    const parents = new Set();
    root.querySelectorAll('.hw-cell').forEach(c => {
      if (!c.parentElement.classList.contains('hw-bank')) parents.add(c.parentElement);
    });
    for (const parent of parents) {
      // A container holding nothing but controls (an envelope group, the
      // arpeggiator's grid) becomes the bank itself; its own grid layout
      // would otherwise squeeze a wrapped bank into one column.
      const kids = Array.from(parent.children);
      if (kids.every(k => k.classList.contains('hw-cell'))) {
        parent.classList.add('hw-bank');
        continue;
      }
      let bank = null;
      for (const child of Array.from(parent.children)) {
        if (child.classList.contains('hw-cell')) {
          if (!bank) {
            bank = document.createElement('div');
            bank.className = 'hw-bank';
            parent.insertBefore(bank, child);
          }
          bank.appendChild(child);
        } else if (child !== bank) {
          bank = null;
        }
      }
    }
  }

  function enhance(root) {
    root.querySelectorAll('.control-row, .checkbox-row').forEach(enhanceRow);
    groupBanks(root);
    // Rows a page re-renders replace their inputs; drop the stale widgets.
    for (const c of controls) if (!c.input.isConnected) controls.delete(c);
  }

  // ---------------------------------------------------------------------
  // Header display, keyboard nameplate
  // ---------------------------------------------------------------------

  function dressHeader() {
    const header = document.querySelector('.synth-header');
    if (!header || header.dataset.hw) return;
    header.dataset.hw = '1';

    const select = document.getElementById('preset-select');
    if (select && !select.closest('.hw-display')) {
      const first = select.options[0] ? select.options[0].textContent : '';
      const box = document.createElement('label');
      box.className = 'hw-display';
      const cap = document.createElement('span');
      cap.className = 'hw-display-caption';
      cap.textContent = /pattern/i.test(first) ? 'Pattern' : 'Program';
      select.before(box);
      box.append(cap, select);
    }

    const start = document.getElementById('start-btn');
    if (start && !start.querySelector('.hw-led')) {
      const led = document.createElement('span');
      led.className = 'hw-led';
      led.setAttribute('aria-hidden', 'true');
      start.prepend(led);
      // The pages rewrite textContent when audio starts, which would drop the
      // LED; put it back.
      new MutationObserver(() => {
        if (!start.querySelector('.hw-led')) start.prepend(led);
      }).observe(start, { childList: true });
    }
  }

  function addNameplate() {
    const piano = document.getElementById('piano-keyboard');
    const h1 = document.querySelector('.synth-header h1');
    if (!piano || !h1 || document.querySelector('.hw-nameplate')) return;
    const panel = piano.closest('.panel') || piano;
    panel.classList.add('hw-keybed');
    const plate = document.createElement('div');
    plate.className = 'hw-nameplate';
    const sub = document.querySelector('.synth-header .subtitle');
    const left = document.createElement('span');
    left.className = 'hw-nameplate-sub';
    left.textContent = sub ? sub.textContent : '';
    const right = document.createElement('span');
    right.className = 'hw-nameplate-logo';
    // The h1 may carry the home link from ui-enhance.js; copy text only.
    right.textContent = Array.from(h1.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
    plate.append(left, right);
    panel.before(plate);
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  // Presets and patch loads write input.value, which fires no event. Ten
  // checks a second is quick enough to look immediate and costs nothing;
  // the knob being dragged redraws itself directly.
  function redraw() {
    for (const c of controls) c.sync();
  }

  function boot() {
    document.documentElement.classList.add('hw-panel');
    dressHeader();
    addNameplate();
    enhance(document);

    // Pages render some panels later (FM operators, the drum channel editor,
    // WaveSynth's step editor) and re-render them on selection.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; enhance(document); });
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(redraw, 100);
  }

  // Run after each page's own DOMContentLoaded setup (this script is loaded
  // after main.js, so its listener is registered — and runs — later).
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
