// palette.js — ⌘K: search or jump to anything.
//
// In a workshop someone always says "where's the thing about mesh networks?".
// Typing three letters beats scanning a projected map. The palette finds
// stones, destinations, people and publications, and runs the commands that
// otherwise live in buttons (so the keyboard can drive a whole session).
//
// Depends on globals from code.js; uses editing.js when it is loaded.

(function () {
  'use strict';

  var overlay, input, list, items = [], active = 0;

  var KIND_ORDER = { command: 0, stone: 1, destination: 1, person: 2, view: 3, publication: 4, other: 5 };
  var KIND_LABEL = { command: 'Command', stone: 'Stepping stone', destination: 'Destination',
                     person: 'Person', view: 'View', publication: 'Publication', other: 'Item' };

  function commands() {
    var editing = window.Edit && Edit.active;
    var cmds = [];
    if (window.Edit && !window.PUBLIC_BUILD) {
      cmds.push({ label: editing ? 'Stop editing journeys' : 'Edit journeys', keys: 'edit', run: function () { Edit.toggle(); } });
      cmds.push({ label: 'Start a new journey', keys: 'add destination north star', run: function () { Edit.newJourney(); } });
      cmds.push({ label: 'Undo the last change', keys: 'revert', run: function () { Edit.undo(); } });
    }
    cmds.push({ label: 'Present full screen', keys: 'projector slideshow', run: function () { togglePresent(true); } });
    cmds.push({ label: 'Show insights and gaps', keys: 'analysis gaps queries', run: function () { document.getElementById('insights-btn').click(); } });
    cmds.push({ label: 'Show keyboard shortcuts', keys: 'help keys', run: function () { openDialog('shortcuts'); } });
    return cmds.map(function (c) { c.kind = 'command'; return c; });
  }

  function catalogue() {
    var out = commands();
    graphData.views.forEach(function (v) {
      out.push({ kind: 'view', label: 'Show the ' + v.label + ' view', keys: v.id, run: function () { setView(v.id); } });
    });
    graphData.nodes.forEach(function (n) {
      var d = n.data;
      var kind = d.type === 'topic' ? (d.kind === 'destination' ? 'destination' : 'stone')
               : d.type === 'researcher' ? 'person'
               : d.type === 'publication' ? 'publication' : 'other';
      out.push({ kind: kind, label: nodeLabelById(d.id), keys: (d.description || '') + ' ' + (d.authors || ''),
                 run: function () { Inspector.go(d.id); } });
    });
    return out;
  }

  // Rank: label starts with the query, then a word in the label does, then it
  // appears anywhere, then only the description/keywords match.
  function score(item, q) {
    var l = item.label.toLowerCase();
    if (l.indexOf(q) === 0) return 0;
    if ((' ' + l).indexOf(' ' + q) >= 0) return 1;
    if (l.indexOf(q) >= 0) return 2;
    if (item.keys && item.keys.toLowerCase().indexOf(q) >= 0) return 3;
    return -1;
  }

  function search(q) {
    q = q.trim().toLowerCase();
    var all = catalogue();
    if (!q) return all.filter(function (i) { return i.kind === 'command'; });
    return all.map(function (i) { return { item: i, s: score(i, q) }; })
      .filter(function (x) { return x.s >= 0; })
      .sort(function (a, b) {
        return a.s - b.s || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
               a.item.label.localeCompare(b.item.label);
      })
      .slice(0, 40)
      .map(function (x) { return x.item; });
  }

  function render() {
    items = search(input.value);
    active = Math.min(active, Math.max(0, items.length - 1));
    if (!items.length) {
      list.innerHTML = '<div class="palette-empty">Nothing matches ' + escapeHtml('“' + input.value.trim() + '”') + '.</div>';
      return;
    }
    list.innerHTML = items.map(function (it, i) {
      return '<div class="palette-item" role="option" id="pal-' + i + '" data-i="' + i + '" aria-selected="' + (i === active) + '">' +
        '<span class="palette-item-label">' + escapeHtml(it.label) + '</span>' +
        '<span class="palette-item-kind">' + KIND_LABEL[it.kind] + '</span></div>';
    }).join('');
    input.setAttribute('aria-activedescendant', 'pal-' + active);
    var el = list.querySelector('[aria-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    var it = items[i];
    if (!it) return;
    close();
    it.run();
  }

  function open() {
    if (!overlay) return;
    overlay.hidden = false;
    input.value = '';
    active = 0;
    render();
    input.focus();
  }

  function close() { if (overlay) overlay.hidden = true; }

  document.addEventListener('DOMContentLoaded', function () {
    overlay = document.getElementById('palette');
    input = document.getElementById('palette-input');
    list = document.getElementById('palette-list');
    if (!overlay) return;

    input.addEventListener('input', function () { active = 0; render(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    list.addEventListener('mousemove', function (e) {
      var row = e.target.closest('.palette-item');
      if (row && +row.dataset.i !== active) { active = +row.dataset.i; render(); }
    });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('.palette-item');
      if (row) choose(+row.dataset.i);
    });
    var trigger = document.getElementById('search-btn');
    if (trigger) trigger.addEventListener('click', open);
  });

  window.Palette = { open: open, close: close };
})();
