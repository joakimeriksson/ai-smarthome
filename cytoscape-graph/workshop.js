// workshop.js — a stripped-down authoring mode for live sessions.
//
// The full editor is fine at a desk but unusable in a room: adding a stone means
// typing a raw id and filling eight fields, and adding an edge means finding both
// ends in a 600-option <select>. Workshop mode removes both:
//
//   * a stone is created from its LABEL alone (id derived, kind/sensitivity/
//     provenance filled in) plus one horizon click;
//   * a link is made by CLICKING the two nodes on the canvas — the graph is
//     already on screen, so pointing at it beats searching a list.
//
// Every action is undoable and saved immediately, so a session can move fast
// without anyone worrying about losing the last ten minutes.
//
// Depends on globals from code.js: graphData, cy, currentView, switchView,
// persistData, stampProvenance, ontology, showDetailPanel, closeDetailPanel.

(function () {
  'use strict';

  // Edge types worth offering mid-workshop. The full set stays in the editor —
  // a room is authoring journeys and ownership, not funding instruments.
  var WORKSHOP_EDGES = ['journey', 'advances', 'works_on', 'enabledBy'];
  var HORIZONS = [
    { key: 'now', label: 'NOW', hint: '0–2 yrs' },
    { key: 'next', label: 'NEXT', hint: '2–5 yrs' },
    { key: 'beyond', label: 'BEYOND', hint: '5–10 yrs' }
  ];

  var panel, active = false;
  var horizon = 'next';
  var linkType = 'journey';
  var linkFrom = null;          // first node clicked in link mode
  var undoStack = [];           // [{kind:'node'|'edge', id|edge, label}]

  // --- ids ------------------------------------------------------------------
  // Derive a readable id from the label, since nobody should type "detMeshStack"
  // in front of an audience. Collisions get a numeric suffix.
  function makeId(label) {
    var base = label.toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      .split('-').slice(0, 4).join('-') || 'stone';
    var id = base, n = 2;
    while (graphData.nodes.some(function (x) { return x.data.id === id; })) {
      id = base + '-' + (n++);
    }
    return id;
  }

  // Wrap long labels the way the seeded stones do, so a new node doesn't render
  // as one wide line next to the existing ones.
  function wrapLabel(text) {
    var words = text.trim().split(/\s+/);
    if (words.length < 3) return words.join(' ');
    var mid = Math.ceil(words.length / 2);
    return words.slice(0, mid).join(' ') + '\n' + words.slice(mid).join(' ');
  }

  function toast(msg, tone) {
    var el = document.getElementById('workshop-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'workshop-status' + (tone ? ' workshop-status-' + tone : '');
  }

  function refresh() {
    if (currentView) switchView(currentView.id);
    renderUndo();
  }

  // --- actions --------------------------------------------------------------
  function addStone() {
    var input = document.getElementById('workshop-label');
    var text = (input.value || '').trim();
    if (!text) { toast('Type what the stone is first.', 'warn'); input.focus(); return; }

    var id = makeId(text);
    var data = {
      id: id,
      type: 'topic',
      kind: 'stone',
      label: wrapLabel(text),
      description: '',
      horizon: horizon,
      sensitivity: (ontology.sensitivity && ontology.sensitivity.default) || 'internal'
    };
    stampProvenance(data);
    data.source = 'workshop';
    graphData.nodes.push({ data: data });
    undoStack.push({ kind: 'node', id: id, label: text });

    input.value = '';
    input.focus();
    refresh();
    persistData();
    toast('Added "' + text + '" to ' + horizon.toUpperCase() + '. Click it, then another node, to link.', 'ok');
  }

  // Returns true when the tap was consumed by link mode (code.js checks this).
  function handleTap(nodeId) {
    if (!active) return false;

    if (!linkFrom) {
      linkFrom = nodeId;
      cy.getElementById(nodeId).addClass('workshop-from');
      toast('From "' + labelOf(nodeId) + '" — now click the node it points to.', 'ok');
      return true;
    }
    if (linkFrom === nodeId) {           // clicking the same node cancels
      cancelLink();
      toast('Link cancelled.', null);
      return true;
    }

    var exists = graphData.edges.some(function (e) {
      return e.data.source === linkFrom && e.data.target === nodeId && e.data.type === linkType;
    });
    if (exists) {
      toast('That link already exists.', 'warn');
      cancelLink();
      return true;
    }

    var edge = { source: linkFrom, target: nodeId, type: linkType };
    stampProvenance(edge);
    graphData.edges.push({ data: edge });
    undoStack.push({ kind: 'edge', edge: edge, label: labelOf(linkFrom) + ' → ' + labelOf(nodeId) });

    var msg = labelOf(linkFrom) + ' → ' + labelOf(nodeId);
    cancelLink();
    refresh();
    persistData();
    toast('Linked ' + msg + '.', 'ok');
    return true;
  }

  function cancelLink() {
    if (linkFrom) cy.getElementById(linkFrom).removeClass('workshop-from');
    linkFrom = null;
  }

  function labelOf(id) {
    var n = graphData.nodes.find(function (x) { return x.data.id === id; });
    return n ? (n.data.label || id).replace(/\n/g, ' ') : id;
  }

  function undo() {
    var last = undoStack.pop();
    if (!last) { toast('Nothing to undo.', null); return; }
    if (last.kind === 'node') {
      graphData.nodes = graphData.nodes.filter(function (n) { return n.data.id !== last.id; });
      // Drop anything attached to it, or the graph keeps dangling edges.
      graphData.edges = graphData.edges.filter(function (e) {
        return e.data.source !== last.id && e.data.target !== last.id;
      });
    } else {
      var i = graphData.edges.findIndex(function (e) {
        return e.data.source === last.edge.source && e.data.target === last.edge.target &&
               e.data.type === last.edge.type;
      });
      if (i >= 0) graphData.edges.splice(i, 1);
    }
    cancelLink();
    refresh();
    persistData();
    toast('Undid: ' + last.label, null);
  }

  function renderUndo() {
    var el = document.getElementById('workshop-undo');
    if (!el) return;
    el.disabled = undoStack.length === 0;
    el.textContent = undoStack.length
      ? '↶ Undo (' + undoStack.length + ')'
      : '↶ Undo';
  }

  // --- panel ----------------------------------------------------------------
  function build() {
    panel = document.createElement('div');
    panel.id = 'workshop-panel';
    panel.style.display = 'none';

    var edgeOpts = WORKSHOP_EDGES.filter(function (t) { return ontology.edgeTypes[t]; })
      .map(function (t) {
        return '<option value="' + t + '">' + ontology.edgeTypes[t].label + '</option>';
      }).join('');

    panel.innerHTML =
      '<button id="workshop-close">&times;</button>' +
      '<h3>Workshop</h3>' +
      '<div class="workshop-step">' +
        '<div class="workshop-step-head">1 · Add a stepping stone</div>' +
        '<input type="text" id="workshop-label" placeholder="What capability? e.g. Batteryless sensing" autocomplete="off">' +
        '<div class="workshop-horizons">' +
          HORIZONS.map(function (h) {
            return '<button class="workshop-horizon" data-h="' + h.key + '">' +
                   h.label + '<span>' + h.hint + '</span></button>';
          }).join('') +
        '</div>' +
        '<button id="workshop-add" class="workshop-primary">Add stone</button>' +
      '</div>' +
      '<div class="workshop-step">' +
        '<div class="workshop-step-head">2 · Connect two nodes</div>' +
        '<select id="workshop-edge-type">' + edgeOpts + '</select>' +
        '<div class="workshop-hint">Click a node on the map, then the node it leads to.</div>' +
      '</div>' +
      '<div id="workshop-status" class="workshop-status">Type a capability and pick a horizon.</div>' +
      '<button id="workshop-undo" class="workshop-undo">↶ Undo</button>';

    document.body.appendChild(panel);

    document.getElementById('workshop-close').addEventListener('click', function () { toggle(false); });
    document.getElementById('workshop-add').addEventListener('click', addStone);
    document.getElementById('workshop-undo').addEventListener('click', undo);
    document.getElementById('workshop-label').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addStone();
    });
    document.getElementById('workshop-edge-type').addEventListener('change', function () {
      linkType = this.value;
      cancelLink();
      toast('Linking with "' + ontology.edgeTypes[linkType].label + '". Click the first node.', null);
    });
    panel.querySelectorAll('.workshop-horizon').forEach(function (b) {
      b.addEventListener('click', function () { setHorizon(this.dataset.h); });
    });
    setHorizon(horizon);
    renderUndo();
  }

  function setHorizon(h) {
    horizon = h;
    panel.querySelectorAll('.workshop-horizon').forEach(function (b) {
      b.classList.toggle('selected', b.dataset.h === h);
    });
  }

  function toggle(on) {
    if (!panel) build();
    active = (on === undefined) ? !active : on;
    panel.style.display = active ? 'block' : 'none';
    document.body.classList.toggle('workshop-active', active);
    cancelLink();
    var target = currentView && currentView.id;
    if (active) {
      closeDetailPanel();
      cy.elements().removeClass('highlighted-node highlighted-edge faded neighbor-highlight');
      // The Roadmap is where a workshop actually works — one straight line per
      // journey — so land there rather than wherever the last click left us.
      if (graphData.views.some(function (v) { return v.id === 'roadmap'; })) {
        target = 'roadmap';
        var sel = document.getElementById('view-select');
        if (sel) sel.value = target;
      }
    }
    // Always re-lay-out: switchView re-applies (or drops) the panel inset that
    // keeps nodes from hiding underneath this panel.
    if (target) switchView(target);
    if (active) document.getElementById('workshop-label').focus();
  }

  // code.js calls this before its own tap handling.
  window.workshopTapHandler = handleTap;
  window.workshopActive = function () { return active; };

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('workshop-btn');
    if (btn) btn.addEventListener('click', function () { toggle(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && active) {
        if (linkFrom) { cancelLink(); toast('Link cancelled.', null); }
        else toggle(false);
      }
    });
  });
})();
