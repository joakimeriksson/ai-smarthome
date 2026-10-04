// Progressive UI enhancement shared by the six synths.
//
// Three additive jobs. Each page still works if this file is absent — it just
// needs the Start Audio button pressed by hand, like before.
//
//   1. Fader fills: a `--pct` custom property on every range input so
//      css/synth-base.css can paint the filled portion of the track.
//   2. Audio auto-start: the first key press or click anywhere starts audio,
//      and the note that started it still sounds.
//   3. A link back to the synth index in each page's title.

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 1. Fader fills
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // 2. Audio auto-start
  // ---------------------------------------------------------------------
  //
  // Browsers only allow an AudioContext to start inside a user gesture, so
  // every page has a Start Audio button — and before it is pressed, notes are
  // silently dropped (`if (!workletNode) return`). Instead, the first gesture
  // presses the button for you.
  //
  // Loading the worklet is async, so the gesture that triggered the start
  // would still arrive before there is anything to play it. Those events are
  // held back and replayed, in order, once the page reports ready. "Ready" is
  // the signal every page already gives: it disables #start-btn at the end of
  // its start function.
  //
  // Only events that play something are held — never a click on a checkbox
  // or select, whose replay would toggle it twice or not open it at all.

  const START_TIMEOUT_MS = 5000;
  const replayed = new WeakSet();
  let pending = null;       // events held while audio is starting
  let mouseHeld = false;    // a held mousedown needs its mouseup held too

  function startButton() { return document.getElementById('start-btn'); }

  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' &&
      !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(el.type);
  }

  function playsSomething(e) {
    const t = e.target instanceof Element ? e.target : null;
    switch (e.type) {
      case 'keydown':
      case 'keyup':
        // Navigation keys move focus or turn a knob; they never play a note.
        if (/^(Arrow|Page|Home|End|Tab|Escape|Shift|Enter)/.test(e.key)) return false;
        return !e.ctrlKey && !e.metaKey && !e.altKey && !isTextEntry(t);
      case 'mousedown':
        return !!(t && t.closest('.white-key, .black-key'));
      case 'mouseup':
        return mouseHeld;
      case 'click':
        return !!(t && t.closest('#play-btn'));
    }
    return false;
  }

  function flush() {
    const events = pending || [];
    pending = null;
    mouseHeld = false;
    for (const e of events) {
      const Ctor = e instanceof KeyboardEvent ? KeyboardEvent : MouseEvent;
      const copy = new Ctor(e.type, e);
      replayed.add(copy);
      e.target.dispatchEvent(copy);
    }
  }

  function startAudio(btn) {
    pending = [];
    let timer = 0;
    const observer = new MutationObserver(() => {
      if (!btn.disabled) return;
      observer.disconnect();
      clearTimeout(timer);
      flush();
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    // A failed start never disables the button; don't hold input forever.
    timer = setTimeout(() => { observer.disconnect(); flush(); }, START_TIMEOUT_MS);
    btn.click();
  }

  function onGesture(e) {
    if (replayed.has(e)) return;
    const btn = startButton();
    if (!btn) return;

    if (!pending) {
      if (btn.disabled) return;                      // audio already running
      if (e.target instanceof Element && e.target.closest('#start-btn')) return;
      const starts = e.type === 'keydown' ? playsSomething(e)
        : e.type === 'mousedown' || e.type === 'touchstart';
      if (!starts) return;
      startAudio(btn);
    }

    if (playsSomething(e)) {
      if (e.type === 'mousedown') mouseHeld = true;
      e.stopImmediatePropagation();
      pending.push(e);
    }
  }

  // Window-level capture runs before every page handler (they sit on
  // document or on the elements themselves).
  for (const type of ['keydown', 'keyup', 'mousedown', 'mouseup', 'click', 'touchstart']) {
    window.addEventListener(type, onGesture, true);
  }

  // ---------------------------------------------------------------------
  // 3. Link back to the index
  // ---------------------------------------------------------------------

  function addHomeLink() {
    const h1 = document.querySelector('.synth-header h1');
    if (!h1 || h1.querySelector('.home-link')) return;
    const a = document.createElement('a');
    a.className = 'home-link';
    a.href = 'index.html';
    a.title = 'All synths';
    a.setAttribute('aria-label', 'All synths');
    a.textContent = '‹';
    h1.prepend(a);
  }

  document.addEventListener('DOMContentLoaded', addHomeLink);
  if (document.readyState !== 'loading') addHomeLink();
})();
