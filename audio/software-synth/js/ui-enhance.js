// Progressive UI enhancement shared by the six synths.
//
// Sets a `--pct` custom property on every range input so css/synth-base.css
// can paint the filled portion of the fader track. Purely additive: it only
// reads .value and writes a CSS variable, so no synth behaviour changes and
// everything still works if this file is absent.

(function () {
  'use strict';

  function refresh(el) {
    const min = parseFloat(el.min === '' ? 0 : el.min);
    const max = parseFloat(el.max === '' ? 100 : el.max);
    const val = parseFloat(el.value);
    if (!isFinite(min) || !isFinite(max) || !isFinite(val) || max === min) return;
    const pct = ((val - min) / (max - min)) * 100;
    el.style.setProperty('--pct', pct.toFixed(2));
  }

  function refreshAll() {
    document.querySelectorAll('input[type="range"]').forEach(refresh);
  }

  // User interaction — capture so it fires regardless of stopPropagation.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'range') refresh(t);
  }, true);

  document.addEventListener('DOMContentLoaded', refreshAll);
  if (document.readyState !== 'loading') refreshAll();

  // Presets and patch loads set .value programmatically, which fires no
  // event. A slow poll keeps the fills honest without measurable cost
  // (a few dozen inputs, four times a second).
  setInterval(refreshAll, 250);
})();
