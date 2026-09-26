// editing.js — building journeys live, on the map.
//
// Everything a workshop driver does happens where the room is looking:
//
//   * each journey shows a dashed + slot in every horizon. Click it, type,
//     Enter: the stone is created AND wired into the journey, and the field
//     reopens at the next slot so a room can dictate a whole journey in a row.
//     Tab moves the field to the next horizon.
//   * double-click (or Enter) renames in place; Delete removes a stone and
//     rejoins the line around it; arrow keys or a drag move it between horizons.
//   * every change is one undo step (⌘Z), saved immediately, and announced.
//
// Depends on globals from code.js.

(function () {
  'use strict';

  var MAX_HISTORY = 100;
  var state = {
    active: false,
    undo: [], redo: [],
    connectFrom: null,
    composer: null,          // { mode: 'stone'|'journey'|'rename', anchorId, lane, band, nodeId }
    toldAboutEditing: false
  };

  // ---- small helpers -------------------------------------------------------

  function data(id) { var n = nodeById(id); return n && n.data; }
  function name(id) { return nodeLabelById(id); }
  function isTopic(d) { return d && d.type === 'topic'; }
  function isStone(d) { return isTopic(d) && (d.kind || 'stone') === 'stone'; }
  function quote(s) { return '“' + s + '”'; }
  function hasEdge(s, t, type) {
    return graphData.edges.some(function (e) {
      return e.data.source === s && e.data.target === t && e.data.type === type;
    });
  }
  function addEdge(s, t, type) {
    if (s === t || hasEdge(s, t, type)) return;
    var d = { source: s, target: t, type: type };
    stampProvenance(d);
    graphData.edges.push({ data: d });
  }
  function removeEdge(s, t, type) {
    graphData.edges = graphData.edges.filter(function (e) {
      return !(e.data.source === s && e.data.target === t && e.data.type === type);
    });
  }

  // Readable ids from labels, so nobody types "detMeshStack" in front of a room.
  function makeId(label) {
    var base = label.toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      .split('-').slice(0, 5).join('-') || 'stone';
    var id = base, n = 2;
    while (nodeById(id)) id = base + '-' + (n++);
    return id;
  }

  // ---- history -------------------------------------------------------------
  // Whole-graph snapshots. The graph is a few hundred KB, so a hundred steps is
  // cheap, and a snapshot can never get out of step the way a hand-written
  // inverse operation can.

  function snapshot() { return JSON.stringify({ nodes: graphData.nodes, edges: graphData.edges }); }
  function restore(s) { var o = JSON.parse(s); graphData.nodes = o.nodes; graphData.edges = o.edges; }

  function rerender(select) {
    var keepId = select === undefined ? selectedId : select;
    if (keepId && !nodeById(keepId)) keepId = null;
    selectedId = keepId;
    switchView(currentView.id, { keepViewport: true });
    if (keepId) { applySelection(keepId); if (window.Inspector) Inspector.open(keepId); }
    else if (window.Inspector) Inspector.close();
    syncComposer();
  }

  function commit(message, mutate, opts) {
    opts = opts || {};
    var before = snapshot();
    if (mutate() === false) return false;
    state.undo.push({ message: message, state: before });
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo.length = 0;
    rerender(opts.select);
    persistData();
    if (!opts.quiet) toast(message + '.', { actionLabel: 'Undo', onAction: undo });
    return true;
  }

  // For bulk edits made elsewhere (the raw data editor): record the state
  // BEFORE the change so it can still be undone.
  function checkpoint(message) {
    state.undo.push({ message: message, state: snapshot() });
    if (state.undo.length > MAX_HISTORY) state.undo.shift();
    state.redo.length = 0;
  }

  function undo() {
    var step = state.undo.pop();
    if (!step) { toast('Nothing to undo.'); return; }
    state.redo.push({ message: step.message, state: snapshot() });
    closeComposer(true); cancelConnect();
    restore(step.state);
    rerender();
    persistData();
    toast('Undid: ' + step.message + '.', { actionLabel: 'Redo', onAction: redo });
  }

  function redo() {
    var step = state.redo.pop();
    if (!step) { toast('Nothing to redo.'); return; }
    state.undo.push({ message: step.message, state: snapshot() });
    closeComposer(true); cancelConnect();
    restore(step.state);
    rerender();
    persistData();
    toast('Redid: ' + step.message + '.', { actionLabel: 'Undo', onAction: undo });
  }

  // Someone else's save replaced the graph underneath us; old steps would now
  // restore a graph that no longer exists.
  document.addEventListener('graph:reloaded', function () {
    state.undo.length = 0; state.redo.length = 0;
    closeComposer(true); cancelConnect();
    toast('Someone else saved changes, so the map was reloaded with theirs. Your last change may need redoing.', { tone: 'bad' });
  });

  // ---- operations ----------------------------------------------------------

  // Insert a new stone into a journey at a horizon, keeping the line unbroken:
  // it goes after the last station at or before that horizon and before the
  // next one, taking over the link between them.
  function addStone(text, row, band) {
    var lane = laneByRow(row);
    if (!lane) return null;
    var id = makeId(text);
    var chain = lane.parking ? [] : lane.chain.slice();
    var where = lane.dest ? ' to ' + name(lane.dest) : '';
    commit('Added ' + quote(text) + where, function () {
      var d = { id: id, type: 'topic', kind: 'stone', label: text, description: '',
                horizon: band, sensitivity: (ontology.sensitivity && ontology.sensitivity.default) || 'internal' };
      stampProvenance(d);
      d.source = 'workshop';
      graphData.nodes.push({ data: d });
      if (!chain.length) return;
      var bi = BAND_INDEX[band], idx = -1;
      chain.forEach(function (cid, i) {
        var cd = data(cid);
        if (cd && BAND_INDEX[bandOf(cd)] <= bi) idx = i;
      });
      var prev = idx >= 0 ? chain[idx] : null, next = chain[idx + 1] || null;
      if (prev && next) removeEdge(prev, next, 'journey');
      if (prev) addEdge(prev, id, 'journey');
      if (next) addEdge(id, next, 'journey');
    }, { select: null, quiet: true });
    toast('Added ' + quote(text) + where + '.', { actionLabel: 'Undo', onAction: undo });
    return id;
  }

  function addJourney(text) {
    var id = makeId(text);
    commit('Started the journey to ' + quote(text), function () {
      var d = { id: id, type: 'topic', kind: 'destination', label: text, description: '',
                sensitivity: (ontology.sensitivity && ontology.sensitivity.default) || 'internal' };
      stampProvenance(d);
      d.source = 'workshop';
      graphData.nodes.push({ data: d });
    }, { select: null, quiet: true });
    return id;
  }

  function rename(id, text) {
    var d = data(id);
    if (!d) return;
    var old = name(id);
    if (!text || text === old) return;
    commit('Renamed ' + quote(old) + ' to ' + quote(text), function () {
      d.label = text;
      stampProvenance(d);
    });
  }

  // Remove a stone and rejoin its journey: everything that led into it now
  // leads to whatever it led to, so the line never breaks in two.
  function remove(id) {
    var d = data(id);
    if (!isTopic(d)) return;
    var label = name(id);
    commit('Deleted ' + quote(label), function () {
      var preds = [], succs = [];
      graphData.edges.forEach(function (e) {
        if (e.data.type !== 'journey') return;
        if (e.data.target === id) preds.push(e.data.source);
        if (e.data.source === id) succs.push(e.data.target);
      });
      graphData.edges = graphData.edges.filter(function (e) {
        return e.data.source !== id && e.data.target !== id;
      });
      graphData.nodes = graphData.nodes.filter(function (n) { return n.data.id !== id; });
      preds.forEach(function (p) { succs.forEach(function (s) { addEdge(p, s, 'journey'); }); });
    }, { select: null });
  }

  function setHorizon(id, band) {
    var d = data(id);
    if (!isStone(d) || HORIZONS.indexOf(band) < 0 || d.horizon === band) return false;
    return commit('Moved ' + quote(name(id)) + ' to ' + RM_BANDS[BAND_INDEX[band]].label, function () {
      d.horizon = band;
      stampProvenance(d);
    });
  }

  function setAttr(id, key, value, message) {
    var d = data(id);
    if (!d) return;
    var cur = d[key];
    if ((cur == null || cur === '') && (value == null || value === '')) return;
    if (cur === value) return;
    commit(message, function () {
      if (value == null || value === '') delete d[key]; else d[key] = value;
      stampProvenance(d);
    });
  }

  function connect(from, to) {
    if (from === to || hasEdge(from, to, 'journey')) return false;
    return commit('Connected ' + quote(name(from)) + ' to ' + quote(name(to)), function () {
      addEdge(from, to, 'journey');
    });
  }

  function disconnect(from, to, type, message) {
    type = type || 'journey';
    commit(message || 'Removed the link from ' + quote(name(from)) + ' to ' + quote(name(to)), function () {
      removeEdge(from, to, type);
    });
  }

  function link(from, to, type, message) {
    if (hasEdge(from, to, type)) return;
    commit(message, function () { addEdge(from, to, type); });
  }

  // ---- connect mode --------------------------------------------------------

  function startConnect(id) {
    if (!state.active) return;
    cancelConnect();
    state.connectFrom = id;
    cy.getElementById(id).addClass('connect-from');
    toast('Click the stone or destination that ' + quote(name(id)) + ' leads to. Esc cancels.');
  }
  function cancelConnect() {
    if (state.connectFrom && cy) cy.getElementById(state.connectFrom).removeClass('connect-from');
    state.connectFrom = null;
  }

  // ---- the composer --------------------------------------------------------

  var composerEl, inputEl, hintEl;

  function composerOpen() { return !!state.composer; }

  function openComposer(c) {
    closeComposer(true);
    state.composer = c;
    if (c.anchorId) cy.getElementById(c.anchorId).addClass('is-composing');
    inputEl.value = c.mode === 'rename' ? name(c.nodeId) : '';
    inputEl.placeholder = c.mode === 'journey' ? 'Name the destination'
                        : c.mode === 'rename' ? '' : 'Name a stepping stone';
    renderHint();
    composerEl.hidden = false;
    syncComposer();
    ensureComposerVisible();
    inputEl.focus();
    if (c.mode === 'rename') inputEl.select();
  }

  // The field must never open half off-screen: nudge the map until it fits.
  function ensureComposerVisible() {
    if (!state.composer || composerEl.hidden) return;
    var r = composerEl.getBoundingClientRect(), c = cy.container().getBoundingClientRect();
    var m = 14, dx = 0, dy = 0;
    if (r.left < c.left + m) dx = c.left + m - r.left;
    else if (r.right > c.right - m) dx = c.right - m - r.right;
    if (r.bottom > c.bottom - m) dy = c.bottom - m - r.bottom;
    if (dx || dy) { cy.panBy({ x: dx, y: dy }); syncComposer(); syncBands(); }
  }

  function renderHint() {
    var c = state.composer;
    if (!c) return;
    var html;
    if (c.mode === 'stone') {
      var lane = laneByRow(c.lane);
      var band = RM_BANDS[BAND_INDEX[c.band]].label;
      html = 'In <strong>' + band + '</strong>' +
        (lane && lane.dest ? ', on the way to <strong>' + escapeHtml(name(lane.dest)) + '</strong>'
         : ', not yet on a journey') +
        '<span class="keys"><kbd>Enter</kbd> add &nbsp; <kbd>Tab</kbd> next horizon &nbsp; <kbd>Esc</kbd> done</span>';
    } else if (c.mode === 'journey') {
      html = 'Where does this journey lead? Name the destination, the north star it works towards.' +
        '<span class="keys"><kbd>Enter</kbd> create &nbsp; <kbd>Esc</kbd> cancel</span>';
    } else {
      html = 'Rename this ' + (data(c.nodeId) && data(c.nodeId).kind === 'destination' ? 'destination' : 'stone') + '.' +
        '<span class="keys"><kbd>Enter</kbd> save &nbsp; <kbd>Esc</kbd> cancel</span>';
    }
    hintEl.innerHTML = html;
  }

  // Keep the field pinned under its anchor as the map pans, zooms or re-lays out.
  function syncComposer() {
    var c = state.composer;
    if (!c || !composerEl) return;
    var anchor = cy.getElementById(c.anchorId || c.nodeId);
    if (anchor.empty()) { closeComposer(true); return; }
    anchor.addClass('is-composing');
    // Sit just below the slot and hang to the RIGHT of it. Add-slots are always
    // the last thing in their horizon, so the right is free — while the left is
    // the stone you just typed, which the room wants to see land.
    var p = anchor.renderedPosition();
    composerEl.style.left = (p.x - 26) + 'px';
    composerEl.style.top = (p.y + anchor.renderedHeight() / 2 + 8) + 'px';
  }

  function closeComposer(discard) {
    var c = state.composer;
    if (!c) return;
    if (!discard) {
      var text = inputEl.value.trim();
      if (text) submit(text, false);
    }
    state.composer = null;
    if (cy) cy.nodes('.is-composing').removeClass('is-composing');
    composerEl.hidden = true;
    inputEl.value = '';
  }

  function submit(text, keepGoing) {
    var c = state.composer;
    inputEl.value = '';
    if (c.mode === 'stone') {
      addStone(text, c.lane, c.band);
      // Reopen at the slot that just moved one station to the right, so the
      // next name goes straight after this one.
      if (keepGoing) reanchor('ghost:' + c.lane + ':' + c.band);
    } else if (c.mode === 'journey') {
      var id = addJourney(text);
      if (keepGoing && roadmapModel && id in roadmapModel.laneOf) {
        var row = roadmapModel.laneOf[id];
        state.composer = { mode: 'stone', anchorId: 'ghost:' + row + ':now', lane: row, band: 'now' };
        inputEl.placeholder = 'Name its first stone';
        renderHint(); syncComposer(); ensureComposerVisible();
        toast('Started the journey to ' + quote(text) + '. Now add its first stepping stone.', { actionLabel: 'Undo', onAction: undo });
        return;
      }
    } else {
      rename(c.nodeId, text);
      keepGoing = false;
    }
    if (!keepGoing) {
      state.composer = null;
      cy.nodes('.is-composing').removeClass('is-composing');
      composerEl.hidden = true;
    }
  }

  function reanchor(ghostId) {
    var c = state.composer;
    if (!c) return;
    cy.nodes('.is-composing').removeClass('is-composing');
    c.anchorId = ghostId;
    renderHint();
    syncComposer();
    ensureComposerVisible();
    inputEl.focus();
  }

  function cycleBand(dir) {
    var c = state.composer;
    if (!c || c.mode !== 'stone') return;
    var i = (HORIZONS.indexOf(c.band) + dir + HORIZONS.length) % HORIZONS.length;
    c.band = HORIZONS[i];
    reanchor('ghost:' + c.lane + ':' + c.band);
  }

  function wireComposer() {
    composerEl = document.getElementById('composer');
    inputEl = document.getElementById('composer-input');
    hintEl = document.getElementById('composer-hint');
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var text = inputEl.value.trim();
        if (!text) { closeComposer(true); return; }
        submit(text, true);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        closeComposer(true);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (state.composer && state.composer.mode === 'stone') {
          var text2 = inputEl.value.trim();
          if (text2) submit(text2, true);   // Tab also commits what's typed
          cycleBand(e.shiftKey ? -1 : 1);
        }
      }
    });
    // Clicking away keeps what was typed: losing a half-typed stone because
    // someone touched the trackpad is worse than an extra one you can undo.
    inputEl.addEventListener('blur', function () {
      setTimeout(function () {
        if (state.composer && document.activeElement !== inputEl) closeComposer(false);
      }, 120);
    });
  }

  // ---- canvas events (called from code.js) ---------------------------------

  function handleTap(node) {
    var d = node.data();
    if (d.ghost) {
      if (!state.active) return true;
      cancelConnect();
      if (d.newJourney) openComposer({ mode: 'journey', anchorId: d.id });
      else openComposer({ mode: 'stone', anchorId: d.id, lane: d.lane, band: d.band });
      return true;
    }
    if (state.connectFrom) {
      if (d.id === state.connectFrom) { cancelConnect(); toast('Connecting cancelled.'); return true; }
      if (!isTopic(d)) { toast('Journeys connect stones and destinations. Pick one of those.'); return true; }
      var from = state.connectFrom;
      cancelConnect();
      connect(from, d.id);
      return true;
    }
    return false;
  }

  function handleDoubleTap(node) {
    var d = node.data();
    if (!state.active || d.ghost || !isTopic(d)) return;
    openComposer({ mode: 'rename', nodeId: d.id });
  }

  function handleBackgroundTap() {
    if (state.connectFrom) { cancelConnect(); toast('Connecting cancelled.'); return true; }
    return false;
  }

  // Drag a station sideways into another horizon zone.
  function wireDrag() {
    cy.on('dragfree', 'node', function (e) {
      if (!state.active || !isRoadmapView() || !roadmapModel) return;
      var n = e.target, d = n.data();
      if (!isStone(d)) { rerender(); return; }
      var x = n.position('x'), band = null;
      roadmapModel.zones.forEach(function (z) { if (x >= z.x0 && x < z.x1) band = z.key; });
      if (band === 'destination') band = 'beyond';
      if (!band) band = x < roadmapModel.zones[0].x0 ? 'now' : 'beyond';
      if (!setHorizon(d.id, band)) rerender();   // same horizon: snap back
    });
  }

  // ---- mode ----------------------------------------------------------------

  function setActive(on) {
    if (window.PUBLIC_BUILD) return;
    state.active = Edit.active = !!on;
    document.body.classList.toggle('editing', state.active);
    var btn = document.getElementById('edit-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.active));
      btn.textContent = state.active ? 'Done editing' : 'Edit journeys';
    }
    if (!state.active) { closeComposer(false); cancelConnect(); exitPersonLinkMode(); }
    if (state.active && currentView.layout !== 'roadmap' &&
        graphData.views.some(function (v) { return v.id === 'roadmap'; })) {
      setView('roadmap');
    } else {
      switchView(currentView.id);   // add or remove the + slots
    }
    if (selectedId && window.Inspector) Inspector.open(selectedId);
    if (state.active && !state.toldAboutEditing) {
      state.toldAboutEditing = true;
      toast('Editing. Click a + to add a stepping stone. Every change can be undone.');
    }
  }

  // ---- keyboard ------------------------------------------------------------

  // Editing's own keys. code.js owns the keyboard and asks here first; this
  // returns true when it handled the key. (Split this way so the read-only
  // public build, which has no editing.js, keeps ⌘K, / , P and Esc.)
  function onKey(e, typing) {
    var mod = e.metaKey || e.ctrlKey;
    if (mod && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return true; }
    if (mod && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return true; }
    if (typing || mod || e.altKey) return false;
    if (e.key === 'e' || e.key === 'E') { setActive(!state.active); return true; }

    if (!state.active || !selectedId) return false;
    var d = data(selectedId);
    if (!isTopic(d)) return false;

    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      openComposer({ mode: 'rename', nodeId: selectedId });
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      remove(selectedId);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isStone(d)) {
      e.preventDefault();
      var i = HORIZONS.indexOf(bandOf(d)) + (e.key === 'ArrowLeft' ? -1 : 1);
      if (i < 0 || i >= HORIZONS.length) {
        toast(quote(name(selectedId)) + ' is already in ' + RM_BANDS[BAND_INDEX[bandOf(d)]].label + '.');
      } else {
        setHorizon(selectedId, HORIZONS[i]);
      }
    } else if ((e.key === 'n' || e.key === 'N') && isRoadmapView() && roadmapModel) {
      e.preventDefault();
      var row = roadmapModel.laneOf[selectedId];
      var band = isStone(d) ? bandOf(d) : 'beyond';
      if (row != null) openComposer({ mode: 'stone', anchorId: 'ghost:' + row + ':' + band, lane: row, band: band });
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      startConnect(selectedId);
    } else {
      return false;
    }
    return true;
  }

  function onEscape() {
    if (state.connectFrom) { cancelConnect(); toast('Connecting cancelled.'); return true; }
    return false;
  }

  // ---- public API ------------------------------------------------------------

  var Edit = window.Edit = {
    active: false,
    commit: commit,
    checkpoint: checkpoint,
    undo: undo,
    redo: redo,
    setActive: setActive,
    toggle: function () { setActive(!state.active); },
    handleTap: handleTap,
    handleDoubleTap: handleDoubleTap,
    handleBackgroundTap: handleBackgroundTap,
    composerOpen: composerOpen,
    closeComposer: function () { closeComposer(false); },
    syncComposer: syncComposer,
    startConnect: startConnect,
    rename: function (id) { openComposer({ mode: 'rename', nodeId: id }); },
    newJourney: function () {
      if (!state.active) setActive(true);
      openComposer({ mode: 'journey', anchorId: 'ghost:new-journey' });
    },
    remove: remove,
    setHorizon: setHorizon,
    setAttr: setAttr,
    disconnect: disconnect,
    link: link,
    canUndo: function () { return state.undo.length > 0; },
    onKey: onKey,
    onEscape: onEscape
  };

  document.addEventListener('DOMContentLoaded', function () {
    wireComposer();
    var btn = document.getElementById('edit-toggle');
    if (btn) btn.addEventListener('click', function () { setActive(!state.active); });
  });
  document.addEventListener('graph:ready', wireDrag);
})();
