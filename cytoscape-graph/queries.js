// queries.js — live "Insights" query panel (PLAN.md Phase 1).
// Runs graph queries against the FULL graph (graphData), not the filtered view,
// so it surfaces capability gaps a roadmap slide can't: stones with no advancing
// project, stones with no expert, isolated stones, unreached destinations, plus
// distribution overviews (by horizon / TRL) and an expert map.
//
// Depends on globals from code.js: graphData, cy, switchView, showDetailPanel.
// Loaded after code.js in index.html.

(function () {
  'use strict';

  // --- small graph helpers (operate on the full graphData) -------------------
  function nodeById(id) {
    return graphData.nodes.find(function (n) { return n.data.id === id; });
  }
  function lbl(n) {
    return (n.data.label || n.data.id).replace(/\n/g, ' ');
  }
  // A topic is a stone when kind === 'stone' or kind is unset (migration default).
  function isStone(n) {
    return n.data.type === 'topic' && (n.data.kind === 'stone' || n.data.kind == null);
  }
  function stones() { return graphData.nodes.filter(isStone); }
  function destinations() {
    return graphData.nodes.filter(function (n) {
      return n.data.type === 'topic' && n.data.kind === 'destination';
    });
  }
  function researchers() {
    return graphData.nodes.filter(function (n) { return n.data.type === 'researcher'; });
  }
  function incoming(id) {
    return graphData.edges.filter(function (e) { return e.data.target === id; });
  }
  function outgoing(id) {
    return graphData.edges.filter(function (e) { return e.data.source === id; });
  }
  // Any incoming edge of `edgeType` whose source node is of `srcType` (srcType optional).
  function hasIncoming(id, edgeType, srcType) {
    return incoming(id).some(function (e) {
      if (e.data.type !== edgeType) return false;
      if (!srcType) return true;
      var s = nodeById(e.data.source);
      return s && s.data.type === srcType;
    });
  }
  function degreeOfTypes(id, edgeTypes) {
    return graphData.edges.filter(function (e) {
      return edgeTypes.indexOf(e.data.type) >= 0 &&
             (e.data.source === id || e.data.target === id);
    }).length;
  }
  function horizonNote(n) {
    var h = n.data.horizon;
    return h ? h.toUpperCase() : 'horizon unset';
  }

  // --- query registry --------------------------------------------------------
  // Each query.run() returns an array of items: { id, label, note, section? }.
  // If items carry `section`, the renderer inserts subheaders in first-seen order.
  var QUERIES = [
    {
      group: 'Capability gaps',
      id: 'gap-no-project',
      label: 'Stones with no advancing project',
      help: 'Stepping stones that no project is advancing (no incoming "advances" edge from a project) — the delivery backlog.',
      run: function () {
        return stones()
          .filter(function (s) { return !hasIncoming(s.data.id, 'advances', 'project'); })
          .map(function (s) { return { id: s.data.id, label: lbl(s), note: horizonNote(s) }; });
      }
    },
    {
      group: 'Capability gaps',
      id: 'gap-no-expert',
      label: 'Stones with no expert',
      help: 'Stepping stones no researcher is linked to (no incoming "works_on") — the competence gap.',
      run: function () {
        return stones()
          .filter(function (s) { return !hasIncoming(s.data.id, 'works_on', 'researcher'); })
          .map(function (s) { return { id: s.data.id, label: lbl(s), note: horizonNote(s) }; });
      }
    },
    {
      group: 'Capability gaps',
      id: 'gap-isolated',
      label: 'Isolated stones (no links)',
      help: 'Stones with no journey, advances, works_on or evidences links at all. PLAN §2.6: these are the curation backlog, not failures.',
      run: function () {
        var linkTypes = ['journey', 'advances', 'works_on', 'evidences', 'enabledBy'];
        return stones()
          .filter(function (s) { return degreeOfTypes(s.data.id, linkTypes) === 0; })
          .map(function (s) { return { id: s.data.id, label: lbl(s), note: horizonNote(s) }; });
      }
    },
    {
      group: 'Capability gaps',
      id: 'gap-dest-unreached',
      label: 'Destinations no journey reaches',
      help: 'North-star destinations with no incoming journey or advances edge — nothing is pointed at them yet.',
      run: function () {
        return destinations()
          .filter(function (d) {
            return !hasIncoming(d.data.id, 'journey') && !hasIncoming(d.data.id, 'advances');
          })
          .map(function (d) { return { id: d.data.id, label: lbl(d), note: 'destination' }; });
      }
    },
    {
      group: 'Capability gaps',
      id: 'gap-pub-no-evidence',
      label: 'Publications evidencing no stone',
      help: 'Publications not linked to any stepping stone via "evidences" — results the roadmap cannot see yet.',
      run: function () {
        return graphData.nodes
          .filter(function (p) {
            if (p.data.type !== 'publication') return false;
            return !outgoing(p.data.id).some(function (e) { return e.data.type === 'evidences'; });
          })
          .map(function (p) { return { id: p.data.id, label: lbl(p), note: p.data.year || '' }; });
      }
    },
    {
      group: 'Capability gaps',
      id: 'gap-no-readiness',
      label: 'Stones missing readiness data',
      help: 'Stones with no TRL and no confidence set — incomplete records to curate.',
      run: function () {
        return stones()
          .filter(function (s) { return s.data.trl == null && !s.data.confidence; })
          .map(function (s) { return { id: s.data.id, label: lbl(s), note: horizonNote(s) }; });
      }
    },
    {
      group: 'Overview',
      id: 'by-horizon',
      label: 'Stones by horizon',
      help: 'Every stepping stone banded by horizon (now / next / beyond).',
      run: function () {
        var order = ['now', 'next', 'beyond', null];
        var secLabel = { now: 'NOW (0–2 yrs)', next: 'NEXT (2–5 yrs)', beyond: 'BEYOND (5–10 yrs)' };
        var items = [];
        order.forEach(function (h) {
          stones()
            .filter(function (s) { return (s.data.horizon || null) === h; })
            .forEach(function (s) {
              items.push({
                id: s.data.id, label: lbl(s),
                note: s.data.trl != null ? ('TRL ' + s.data.trl) : '',
                section: h ? secLabel[h] : 'HORIZON UNSET'
              });
            });
        });
        return items;
      }
    },
    {
      group: 'Overview',
      id: 'by-trl',
      label: 'Stones by TRL',
      help: 'Stepping stones grouped by Technology Readiness Level (9 = highest).',
      run: function () {
        var items = [];
        for (var t = 9; t >= 1; t--) {
          (function (trl) {
            stones()
              .filter(function (s) { return s.data.trl === trl; })
              .forEach(function (s) {
                items.push({ id: s.data.id, label: lbl(s), note: horizonNote(s), section: 'TRL ' + trl });
              });
          })(t);
        }
        stones()
          .filter(function (s) { return s.data.trl == null; })
          .forEach(function (s) {
            items.push({ id: s.data.id, label: lbl(s), note: horizonNote(s), section: 'TRL unset' });
          });
        return items;
      }
    },
    {
      group: 'Overview',
      id: 'expert-map',
      label: 'Expert map (who works on most)',
      help: 'Researchers ranked by how many stepping stones they work on.',
      run: function () {
        return researchers()
          .map(function (r) {
            var n = outgoing(r.data.id).filter(function (e) {
              if (e.data.type !== 'works_on') return false;
              var t = nodeById(e.data.target);
              return t && isStone(t);
            }).length;
            return { id: r.data.id, label: lbl(r), count: n };
          })
          .filter(function (x) { return x.count > 0; })
          .sort(function (a, b) { return b.count - a.count; })
          .map(function (x) {
            return { id: x.id, label: x.label, note: x.count + (x.count === 1 ? ' stone' : ' stones') };
          });
      }
    }
  ];

  // --- rendering -------------------------------------------------------------
  var panel, body, titleEl;

  function open() {
    if (!panel) build();
    panel.style.display = 'block';
    showMenu();
  }
  function close() {
    if (panel) panel.style.display = 'none';
  }

  function build() {
    panel = document.getElementById('query-panel');
    titleEl = document.getElementById('query-panel-title');
    body = document.getElementById('query-panel-body');
    document.getElementById('close-query-panel-btn').addEventListener('click', close);
  }

  function showMenu() {
    titleEl.textContent = 'Insights';
    body.innerHTML = '';

    // Quick counts across the whole graph.
    var summary = document.createElement('div');
    summary.className = 'query-summary';
    summary.textContent = stones().length + ' stones · ' + destinations().length +
      ' destinations · ' + researchers().length + ' researchers';
    body.appendChild(summary);

    // Group query buttons by their `group`.
    var groups = [];
    QUERIES.forEach(function (q) { if (groups.indexOf(q.group) < 0) groups.push(q.group); });

    groups.forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'query-group-head';
      h.textContent = g;
      body.appendChild(h);

      QUERIES.filter(function (q) { return q.group === g; }).forEach(function (q) {
        var btn = document.createElement('button');
        btn.className = 'query-item-btn';
        btn.textContent = q.label;
        btn.title = q.help;
        btn.addEventListener('click', function () { runQuery(q); });
        body.appendChild(btn);
      });
    });
  }

  function runQuery(q) {
    var items = q.run();
    titleEl.textContent = q.label;
    body.innerHTML = '';

    var back = document.createElement('button');
    back.className = 'query-back-btn';
    back.textContent = '‹ All insights';
    back.addEventListener('click', showMenu);
    body.appendChild(back);

    var help = document.createElement('div');
    help.className = 'query-help';
    help.textContent = q.help;
    body.appendChild(help);

    var count = document.createElement('div');
    count.className = 'query-count';
    count.textContent = items.length + (items.length === 1 ? ' result' : ' results');
    body.appendChild(count);

    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'query-empty';
      empty.textContent = 'Nothing matches — nice, no gap here (or the data is not linked yet).';
      body.appendChild(empty);
      return;
    }

    var list = document.createElement('div');
    list.className = 'query-results';
    var lastSection = undefined;
    items.forEach(function (it) {
      if (it.section !== undefined && it.section !== lastSection) {
        lastSection = it.section;
        var sh = document.createElement('div');
        sh.className = 'query-section-head';
        sh.textContent = it.section;
        list.appendChild(sh);
      }
      var row = document.createElement('div');
      row.className = 'query-result';
      var name = document.createElement('span');
      name.className = 'query-result-label';
      name.textContent = it.label;
      row.appendChild(name);
      if (it.note) {
        var note = document.createElement('span');
        note.className = 'query-result-note';
        note.textContent = it.note;
        row.appendChild(note);
      }
      row.addEventListener('click', function () { focusNode(it.id); });
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  // Focus a node by id: switch to Full Map if it's outside the current view,
  // then open its detail panel and centre it.
  function focusNode(id) {
    var node = cy.getElementById(id);
    if (node.empty()) {
      var full = graphData.views.find(function (v) { return v.id === 'everything'; }) ||
                 graphData.views[graphData.views.length - 1];
      if (full) {
        var sel = document.getElementById('view-select');
        if (sel) sel.value = full.id;
        switchView(full.id);
        node = cy.getElementById(id);
      }
    }
    if (node.nonempty()) {
      showDetailPanel(node);
      cy.animate({ center: { eles: node }, duration: 300 });
    }
  }

  // --- wire the toolbar button ----------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('insights-btn');
    if (btn) btn.addEventListener('click', function () {
      if (panel && panel.style.display === 'block') { close(); } else { open(); }
    });
  });
})();
