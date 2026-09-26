var graphData = null;
var cy = null;
var currentView = null;
var ontology = null;
var selectedId = null;

// The curated public build (build_public.py) is a static directory with no
// Flask app behind it, so it reads the filtered data.json straight off disk.
var DATA_URL = window.PUBLIC_BUILD ? 'data.json' : '/api/data';

var FONT = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, -apple-system, sans-serif';
var INK = '#141B3D', INK_2 = '#535C78', PAPER = '#F3F5F9', NAVY = '#00057D';

// Canvas text is drawn once with whatever font is loaded at that moment, so the
// typeface has to be ready BEFORE the first render or every label comes out in
// the fallback. Capped so a missing font file can never stall the tool.
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  var load = Promise.all([
    document.fonts.load('600 16px "Atkinson Hyperlegible Next"'),
    document.fonts.load('800 16px "Atkinson Hyperlegible Next"')
  ]);
  var cap = new Promise(function(resolve) { setTimeout(resolve, 1500); });
  return Promise.race([load, cap]).catch(function() {});
}

Promise.all([
  fetch(DATA_URL).then(function(r) { return r.json(); }),
  fetch('ontology.json').then(function(r) { return r.json(); }),
  fontsReady()
]).then(function(res) {
  graphData = res[0];
  ontology = window.ontology = res[1];
  initGraph();
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Per-type sizing for the graph views; shape and colour come from ontology.json.
var NODE_SIZE = {
  topic:        { width: 52, height: 52 },
  researcher:   { width: 104, height: 46, 'font-size': 13, 'text-max-width': '94px' },
  group:        { width: 138, height: 58, 'font-size': 13.5, 'text-max-width': '124px' },
  project:      { width: 96,  height: 84, 'font-size': 13, 'text-max-width': '80px' },
  publication:  { width: 64,  height: 64, 'font-size': 10.5, 'text-max-width': '56px' },
  partner:      { width: 118, height: 50, 'font-size': 13 },
  funding_call: { width: 118, height: 50, 'font-size': 13 },
  testbed:      { width: 118, height: 50, 'font-size': 13 }
};

// Roadmap palette: one colour per journey. Okabe–Ito derived so the lines stay
// distinguishable for colour-blind viewers, each darkened until it holds >=3:1
// on both the canvas and the zone tint (and white labels on the terminus sign).
var LINE_COLORS = ['#0072B2', '#C8570A', '#00805F', '#A4468A', '#A86A00', '#5E4A9C', '#0F7C8C'];
var SLATE = '#6B7489';   // stones not yet on a journey

function getNodeStyle() {
  var styles = [
    { selector: 'node', style: {
        'label': 'data(label)',
        'font-family': FONT, 'font-size': 14, 'font-weight': 600,
        'color': INK,
        'text-wrap': 'wrap', 'text-max-width': '124px',
        'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 7,
        'text-background-color': PAPER, 'text-background-opacity': 0.88,
        'text-background-padding': 2, 'text-background-shape': 'round-rectangle',
        'width': 52, 'height': 52,
        'background-color': NAVY, 'border-width': 0
      } }
  ];

  // Filled reality-layer shapes carry their label inside, in white.
  Object.keys(ontology.nodeTypes).forEach(function(type) {
    var t = ontology.nodeTypes[type];
    var s = { 'shape': t.shape, 'background-color': t.color };
    if (type !== 'topic') {
      Object.assign(s, { 'color': '#fff', 'text-valign': 'center', 'text-margin-y': 0,
                         'text-background-opacity': 0, 'font-weight': 700 });
    }
    Object.assign(s, NODE_SIZE[type] || {});
    styles.push({ selector: 'node[type="' + type + '"]', style: s });
  });
  // Publications are many and small: their label sits outside, like a caption.
  styles.push({ selector: 'node[type="publication"]', style: {
    'color': INK_2, 'text-valign': 'bottom', 'text-margin-y': 5, 'font-weight': 600,
    'text-background-opacity': 0.85
  } });

  // Topic icons are white line art, so they need the filled navy disc behind them.
  styles.push({ selector: 'node[type="topic"][image]', style: {
    'background-image': 'data(image)', 'background-fit': 'contain',
    'background-width': '66%', 'background-height': '66%', 'background-clip': 'none'
  } });

  var topicKinds = (ontology.nodeTypes.topic && ontology.nodeTypes.topic.kinds) || {};
  Object.keys(topicKinds).forEach(function(kind) {
    var k = topicKinds[kind];
    styles.push({ selector: 'node[type="topic"][kind="' + kind + '"]', style: {
      'shape': k.shape, 'background-color': k.color
    } });
  });
  styles.push({ selector: 'node[type="topic"][kind="destination"], node[type="topic"][kind="enabler"]', style: {
    'width': 170, 'height': 58, 'color': '#fff', 'font-weight': 800, 'font-size': 14.5,
    'text-valign': 'center', 'text-margin-y': 0, 'text-max-width': '150px',
    'text-background-opacity': 0, 'background-image': 'none'
  } });

  // Edges.
  styles.push({ selector: 'edge', style: {
    'curve-style': 'bezier', 'width': 2.5,
    'line-color': '#9AA3B5', 'target-arrow-color': '#9AA3B5',
    'target-arrow-shape': 'triangle', 'arrow-scale': 0.9
  } });
  Object.keys(ontology.edgeTypes).forEach(function(type) {
    var e = ontology.edgeTypes[type];
    styles.push({ selector: 'edge[type="' + type + '"]', style: {
      'line-color': e.color, 'target-arrow-color': e.color,
      'line-style': e.style || 'solid', 'width': Math.max(2, (e.width || 3) - 0.5)
    } });
  });

  // --- Roadmap: a transit map. Declared after the type rules so it wins. -----
  // Journey lines, station colours and ghosts get their colour per element
  // (style bypass) because it depends on which journey they sit on.
  styles.push({ selector: 'node.rm-stone', style: {
    'shape': 'ellipse', 'width': 30, 'height': 30,
    'background-color': '#fff', 'background-image': 'none',
    'border-width': 7, 'border-color': SLATE,
    'font-size': 16.5, 'font-weight': 600, 'color': INK,
    'text-max-width': '150px', 'text-margin-y': 11,
    // Labels sit below the line, never on it, so they need no backing box —
    // and a box shows as a patch on the tinted zones.
    'text-background-opacity': 0
  } });
  styles.push({ selector: 'node.rm-dest', style: {
    'shape': 'round-rectangle', 'width': 196, 'height': 62,
    'background-color': SLATE, 'border-width': 0, 'background-image': 'none',
    'color': '#fff', 'font-size': 19, 'font-weight': 800,
    'text-valign': 'center', 'text-margin-y': 0, 'text-max-width': '172px',
    'text-background-opacity': 0
  } });
  styles.push({ selector: 'node.rm-enabler', style: {
    'shape': 'round-rectangle', 'width': 150, 'height': 44, 'background-image': 'none',
    'font-size': 14, 'color': '#fff', 'text-valign': 'center', 'text-margin-y': 0,
    'text-background-opacity': 0
  } });
  styles.push({ selector: 'edge.rm', style: {
    // A branch leaves its trunk right after the station, like a metro line,
    // instead of running on top of the trunk for most of the gap.
    'curve-style': 'taxi', 'taxi-direction': 'horizontal', 'taxi-turn': 44, 'taxi-turn-min-distance': 20,
    'width': 9, 'line-cap': 'round', 'target-arrow-shape': 'none',
    'line-style': 'solid'
  } });
  // A step that points back in time — a later horizon depending forward on an
  // earlier one — is worth a second look, so it reads as provisional.
  styles.push({ selector: 'edge.rm-backward', style: { 'line-style': 'dashed', 'line-dash-pattern': [14, 9] } });

  styles.push({ selector: 'node.rm-anchor', style: {
    'width': 1, 'height': 1, 'opacity': 0, 'label': '', 'events': 'no'
  } });
  styles.push({ selector: 'edge.rm-planned', style: {
    'line-style': 'dashed', 'line-dash-pattern': [16, 12], 'opacity': 0.45, 'events': 'no'
  } });
  styles.push({ selector: 'node.rm-ghost', style: {
    'shape': 'ellipse', 'width': 30, 'height': 30,
    'background-color': PAPER, 'background-opacity': 1, 'background-image': 'none',
    'border-width': 2.5, 'border-style': 'dashed', 'border-color': SLATE,
    'label': '+', 'font-size': 22, 'font-weight': 700, 'color': SLATE,
    'text-valign': 'center', 'text-margin-y': -1, 'text-background-opacity': 0,
    'opacity': 0.72
  } });
  styles.push({ selector: 'node.rm-ghost.is-hover', style: { 'opacity': 1, 'background-color': '#fff', 'border-style': 'solid' } });
  styles.push({ selector: 'node.rm-ghost.is-composing', style: { 'opacity': 0 } });
  styles.push({ selector: 'node.rm-new-journey', style: {
    'shape': 'round-rectangle', 'width': 196, 'height': 54,
    'label': 'New journey', 'font-size': 16, 'color': NAVY, 'border-color': NAVY
  } });

  // --- Interaction states ------------------------------------------------------
  styles.push({ selector: '.is-selected', style: {
    'underlay-color': NAVY, 'underlay-opacity': 0.16, 'underlay-padding': 10,
    'underlay-shape': 'ellipse'
  } });
  styles.push({ selector: 'node.rm-dest.is-selected, node[kind="destination"].is-selected', style: {
    'underlay-shape': 'round-rectangle', 'underlay-padding': 7
  } });
  styles.push({ selector: '.connect-from', style: {
    'underlay-color': NAVY, 'underlay-opacity': 0.34, 'underlay-padding': 14, 'underlay-shape': 'ellipse'
  } });
  styles.push({ selector: '.faded', style: { 'opacity': 0.16 } });
  styles.push({ selector: '.person-linked', style: {
    'underlay-color': '#00805F', 'underlay-opacity': 0.34, 'underlay-padding': 12, 'underlay-shape': 'ellipse'
  } });
  styles.push({ selector: '.person-unlinked', style: { 'opacity': 0.28 } });

  return styles;
}

// ---------------------------------------------------------------------------
// View filtering and generic layouts
// ---------------------------------------------------------------------------

// A view may declare "*" for nodeTypes/edgeTypes, meaning "every type in the
// ontology". Full Map uses this so a type added to ontology.json renders
// immediately instead of being silently invisible (PLAN §2.5). `excludeNodeTypes`
// subtracts from that — Full Map drops `publication` because 455 papers bury the
// 26 topics that are the point of the map; they keep their own view, and re-enter
// the picture through the stones they `evidences`.
function viewTypes(spec, ontologyKey, exclude) {
  var types = spec === '*' ? Object.keys(ontology[ontologyKey]) : spec;
  if (!exclude || !exclude.length) return types;
  return types.filter(function(t) { return exclude.indexOf(t) < 0; });
}

function getFilteredElements(view) {
  var nodeTypes = viewTypes(view.nodeTypes, 'nodeTypes', view.excludeNodeTypes);
  var edgeTypes = viewTypes(view.edgeTypes, 'edgeTypes', view.excludeEdgeTypes);
  var nodes = graphData.nodes.filter(function(n) {
    return nodeTypes.indexOf(n.data.type) >= 0;
  });
  var nodeIds = {};
  nodes.forEach(function(n) { nodeIds[n.data.id] = true; });
  var edges = graphData.edges.filter(function(e) {
    return edgeTypes.indexOf(e.data.type) >= 0 && nodeIds[e.data.source] && nodeIds[e.data.target];
  });

  // `dropIsolated` keeps a view to what is actually connected. Delivery & Gaps
  // uses it so only publications that evidence a stone appear, instead of 438
  // unlinked papers tiling the canvas. Views where an unlinked node IS the
  // point (Roadmap — the curation backlog, PLAN §2.6) must not set it.
  if (view.dropIsolated) {
    var linked = {};
    edges.forEach(function(e) { linked[e.data.source] = linked[e.data.target] = true; });
    nodes = nodes.filter(function(n) { return linked[n.data.id]; });
  }
  return { nodes: nodes, edges: edges };
}

function getLayout(view) {
  if (view.layout === 'klay') {
    return { name: 'klay', directed: true, padding: 10, klay: { spacing: 110, fixedAlignment: 'LEFTDOWN' } };
  }
  return {
    name: 'cose', padding: 40, animate: false, numIter: 1000, gravity: 0.3,
    nodeRepulsion: function() { return 9000; },
    idealEdgeLength: function() { return 120; }
  };
}

// ---------------------------------------------------------------------------
// Roadmap: the transit map
// ---------------------------------------------------------------------------
//
// One journey per row, drawn as a STRAIGHT horizontal line of stones ending in
// its destination. Horizon zones (now / next / beyond) are the columns, so a
// stone's x reads as "when". Within a zone a journey's stones spread sideways,
// never stacked vertically — stacking is what would bend the line.
//
// Rows follow DESTINATION order, not the order stones happen to sit in the
// data. Adding a stone at the start of a journey must never reshuffle the rows
// (or recolour them) in front of a room.

var RM = {
  SLOT_W: 175,     // distance between two stations in the same zone
  GHOST_DX: 104,   // an add-slot sits this far after the last station in its zone
  BAND_GAP: 64,    // breathing room between zones
  LANE_H: 150,     // distance between journeys
  DEST_W: 196,
  HEADER: 78,      // the zone titles at the top of the canvas
  PAD: 36
};
var RM_BANDS = [
  { key: 'now',         label: 'Now',          sub: '0–2 years' },
  { key: 'next',        label: 'Next',         sub: '2–5 years' },
  { key: 'beyond',      label: 'Beyond',       sub: '5–10 years' },
  { key: 'destination', label: 'Destinations', sub: 'Where the journeys lead' }
];
var BAND_INDEX = { now: 0, next: 1, beyond: 2, destination: 3 };
var HORIZONS = ['now', 'next', 'beyond'];
var ROADMAP_MAX_CHAINS = 400;   // guard against combinatorial blow-up on dense graphs
var roadmapModel = null;

function bandOf(d) {
  if (d.kind === 'destination') return 'destination';
  return HORIZONS.indexOf(d.horizon) >= 0 ? d.horizon : 'now';
}

function computeRoadmap(elements, withGhosts) {
  var byId = {};
  elements.nodes.forEach(function(n) { byId[n.data.id] = n.data; });

  var fwd = {}, hasIncoming = {};
  elements.edges.forEach(function(e) {
    if (e.data.type !== 'journey') return;
    (fwd[e.data.source] = fwd[e.data.source] || []).push(e.data.target);
    hasIncoming[e.data.target] = true;
  });

  // Every root -> sink chain.
  var chains = [];
  function walk(id, acc, onPath) {
    if (chains.length >= ROADMAP_MAX_CHAINS) return;
    var extended = false;
    (fwd[id] || []).forEach(function(t) {
      if (onPath[t]) return;            // cycle guard
      onPath[t] = true;
      walk(t, acc.concat([t]), onPath);
      delete onPath[t];
      extended = true;
    });
    if (!extended) chains.push(acc);
  }
  elements.nodes.forEach(function(n) {
    var id = n.data.id;
    if (hasIncoming[id] || !(fwd[id] || []).length) return;
    var onPath = {}; onPath[id] = true;
    walk(id, [id], onPath);
  });

  var destIds = elements.nodes
    .filter(function(n) { return n.data.kind === 'destination'; })
    .map(function(n) { return n.data.id; });
  var chainsBySink = {};
  chains.forEach(function(c) { (chainsBySink[c[c.length - 1]] = chainsBySink[c[c.length - 1]] || []).push(c); });

  var lanes = [], laneOf = {}, slotOf = {};
  function claim(chain, dest, color) {
    // A chain whose every node already has a row adds nothing new to draw.
    if (!chain.some(function(id) { return !(id in laneOf); })) return;
    var row = lanes.length, used = {};
    chain.forEach(function(id) {
      // Advance the zone's slot counter for every node on the chain — including
      // already-claimed ones — so a branch stays aligned with its trunk.
      var b = bandOf(byId[id]);
      var slot = used[b] || 0;
      used[b] = slot + 1;
      if (!(id in laneOf)) { laneOf[id] = row; slotOf[id] = slot; }
    });
    lanes.push({ row: row, chain: chain, dest: dest, color: color, used: used });
  }

  destIds.forEach(function(d, i) {
    var color = LINE_COLORS[i % LINE_COLORS.length];
    var cs = chainsBySink[d] || [];
    cs.forEach(function(c) { claim(c, d, color); });
    if (!(d in laneOf)) {   // a destination nobody has built a journey to yet
      var row = lanes.length;
      laneOf[d] = row; slotOf[d] = 0;
      lanes.push({ row: row, chain: [d], dest: d, color: color, used: { destination: 1 } });
    }
  });
  // Chains that end on a stone rather than a destination: journeys without a north star.
  chains.filter(function(c) { return byId[c[c.length - 1]].kind !== 'destination'; })
    .forEach(function(c, i) { claim(c, null, LINE_COLORS[(destIds.length + i) % LINE_COLORS.length]); });

  // The new-journey slot, then a parking row for stones not on any journey.
  var journeyRows = lanes.length;
  var newJourney = withGhosts ? { row: journeyRows } : null;
  var loose = elements.nodes.filter(function(n) { return !(n.data.id in laneOf); });
  var parking = null;
  if (loose.length || withGhosts) {
    parking = { row: journeyRows + (withGhosts ? 1 : 0), chain: [], dest: null, color: SLATE, used: {}, parking: true };
    loose.forEach(function(n) {
      var b = bandOf(n.data);
      var slot = parking.used[b] || 0;
      parking.used[b] = slot + 1;
      laneOf[n.data.id] = parking.row; slotOf[n.data.id] = slot;
    });
    lanes.push(parking);
  }

  // Add-slots: one per journey per horizon, just after that journey's last
  // station in the zone — where a new stone would actually land.
  var ghosts = [];
  if (withGhosts) {
    lanes.forEach(function(l) {
      HORIZONS.forEach(function(b) { ghosts.push({ lane: l.row, band: b, slot: l.used[b] || 0 }); });
    });
  }

  // Zone widths grow with the deepest station (or add-slot) in them.
  var span = { now: 0, next: 0, beyond: 0, destination: 0 };
  elements.nodes.forEach(function(n) {
    var b = bandOf(n.data);
    span[b] = Math.max(span[b], slotOf[n.data.id] * RM.SLOT_W);
  });
  ghosts.forEach(function(g) {
    g.dx = g.slot > 0 ? (g.slot - 1) * RM.SLOT_W + RM.GHOST_DX : 0;
    span[g.band] = Math.max(span[g.band], g.dx);
  });

  var bandX = {}, zones = [], x = 0;
  RM_BANDS.forEach(function(b) {
    var w = b.key === 'destination' ? RM.DEST_W : span[b.key] + RM.SLOT_W;
    bandX[b.key] = x + (b.key === 'destination' ? RM.DEST_W / 2 : RM.SLOT_W / 2);
    zones.push({ key: b.key, label: b.label, sub: b.sub,
                 x0: x - RM.BAND_GAP / 2, x1: x + w + RM.BAND_GAP / 2 });
    x += w + RM.BAND_GAP;
  });

  var positions = {};
  elements.nodes.forEach(function(n) {
    var d = n.data, b = bandOf(d);
    positions[d.id] = {
      x: b === 'destination' ? bandX.destination : bandX[b] + slotOf[d.id] * RM.SLOT_W,
      y: laneOf[d.id] * RM.LANE_H
    };
  });
  ghosts.forEach(function(g) {
    g.id = 'ghost:' + g.lane + ':' + g.band;
    g.x = bandX[g.band] + g.dx;
    g.y = g.lane * RM.LANE_H;
  });
  if (newJourney) {
    newJourney.id = 'ghost:new-journey';
    newJourney.x = bandX.destination;
    newJourney.y = newJourney.row * RM.LANE_H;
  }

  var rowLabels = [];
  if (parking) rowLabels.push({ y: parking.row * RM.LANE_H, text: 'Not on a journey yet' });

  return { positions: positions, zones: zones, lanes: lanes, laneOf: laneOf,
           ghosts: ghosts, newJourney: newJourney, rowLabels: rowLabels, byId: byId };
}

function laneColorOf(id) {
  if (!roadmapModel || !(id in roadmapModel.laneOf)) return SLATE;
  var lane = roadmapModel.lanes.filter(function(l) { return l.row === roadmapModel.laneOf[id]; })[0];
  return lane ? lane.color : SLATE;
}

function laneByRow(row) {
  return roadmapModel && roadmapModel.lanes.filter(function(l) { return l.row === row; })[0];
}

function applyRoadmap(elements) {
  var editing = !!(window.Edit && Edit.active);
  var rm = roadmapModel = computeRoadmap(elements, editing);

  cy.nodes().forEach(function(n) {
    var p = rm.positions[n.id()];
    if (p) n.position(p);
    var d = n.data();
    var color = laneColorOf(n.id());
    if (d.kind === 'destination') {
      n.addClass('rm rm-dest');
      n.style('background-color', color);
    } else if (d.kind === 'enabler') {
      n.addClass('rm rm-enabler');
    } else {
      n.addClass('rm rm-stone');
      n.style('border-color', color);
    }
  });

  cy.edges().forEach(function(e) {
    e.addClass('rm');
    var s = rm.byId[e.data('source')], t = rm.byId[e.data('target')];
    var color = laneColorOf(e.data('target'));
    e.style({ 'line-color': color, 'target-arrow-color': color });
    if (s && t && BAND_INDEX[bandOf(s)] > BAND_INDEX[bandOf(t)]) e.addClass('rm-backward');
  });

  // A journey with no stones yet is drawn as a faint dashed line from Now to
  // its destination: "a journey still to plan", not an orphaned sign.
  var planned = [];
  rm.lanes.forEach(function(l) {
    if (!l.dest || l.chain.length !== 1) return;
    var aid = 'anchor:' + l.row, y = l.row * RM.LANE_H;
    planned.push({ group: 'nodes', classes: 'rm-anchor', position: { x: rm.zones[0].x0 + 40, y: y },
                   data: { id: aid, ghost: true, anchor: true } });
    planned.push({ group: 'edges', classes: 'rm rm-planned',
                   data: { id: 'planned:' + l.row, source: aid, target: l.dest, type: 'journey' } });
  });
  if (planned.length) {
    cy.add(planned).forEach(function(el) {
      if (el.isEdge()) el.style({ 'line-color': laneColorOf(el.data('target')) });
      else el.ungrabify();
    });
  }

  if (editing) {
    var add = rm.ghosts.map(function(g) {
      var lane = laneByRow(g.lane);
      var band = RM_BANDS[BAND_INDEX[g.band]].label;
      var where = lane && lane.dest ? ' on the way to ' + nodeLabelById(lane.dest)
                : lane && lane.parking ? ', not yet on a journey' : '';
      return { group: 'nodes', classes: 'rm-ghost', position: { x: g.x, y: g.y },
               data: { id: g.id, ghost: true, lane: g.lane, band: g.band,
                       description: 'Add a stepping stone in ' + band + where } };
    });
    if (rm.newJourney) {
      add.push({ group: 'nodes', classes: 'rm-ghost rm-new-journey',
                 position: { x: rm.newJourney.x, y: rm.newJourney.y },
                 data: { id: rm.newJourney.id, ghost: true, newJourney: true,
                         description: 'Start a new journey by naming where it leads' } });
    }
    cy.add(add).forEach(function(g) {
      g.ungrabify();
      if (!g.data('newJourney')) {
        var c = laneByRow(g.data('lane'));
        var color = c ? c.color : SLATE;
        g.style({ 'border-color': color, 'color': color });
      }
    });
  }

  renderBands();
}

// ---------------------------------------------------------------------------
// Horizon zones (HTML behind the canvas, kept in step with pan and zoom)
// ---------------------------------------------------------------------------

function renderBands() {
  var el = document.getElementById('bands');
  el.innerHTML = '';
  if (!roadmapModel || !isRoadmapView()) return;
  roadmapModel.zones.forEach(function(z) {
    var zone = document.createElement('div');
    zone.className = 'zone';
    zone.dataset.band = z.key;
    zone.innerHTML = '<div class="zone-head"><span class="zone-title"></span><span class="zone-sub"></span></div>';
    zone.querySelector('.zone-title').textContent = z.label;
    zone.querySelector('.zone-sub').textContent = z.sub;
    el.appendChild(zone);
  });
  roadmapModel.rowLabels.forEach(function(r) {
    var lab = document.createElement('div');
    lab.className = 'row-label';
    lab.textContent = r.text;
    el.appendChild(lab);
  });
  syncBands();
}

function syncBands() {
  if (!roadmapModel || !isRoadmapView()) return;
  var z = cy.zoom(), pan = cy.pan();
  var zones = document.querySelectorAll('#bands .zone');
  roadmapModel.zones.forEach(function(m, i) {
    if (!zones[i]) return;
    var w = (m.x1 - m.x0) * z;
    zones[i].style.left = (m.x0 * z + pan.x) + 'px';
    zones[i].style.width = w + 'px';
    // Titles are fixed-size type on a zooming zone. When the zone gets too
    // narrow for them, step the title down and drop the subtitle rather than
    // clip "Destinations" to "Destinatio".
    zones[i].classList.toggle('is-narrow', w < 190);
    zones[i].classList.toggle('is-tiny', w < 120);
  });
  var labels = document.querySelectorAll('#bands .row-label');
  roadmapModel.rowLabels.forEach(function(r, i) {
    if (!labels[i]) return;
    labels[i].style.left = (roadmapModel.zones[0].x0 * z + pan.x + 18) + 'px';
    // Sit a fixed number of screen pixels above the row's + slots (radius 15
    // in map units); a map-unit offset collapsed onto them when zoomed out.
    labels[i].style.top = (r.y * z + pan.y - 15 * z - 28) + 'px';
  });
}

function isRoadmapView() { return currentView && currentView.layout === 'roadmap'; }

// ---------------------------------------------------------------------------
// Fitting the viewport
// ---------------------------------------------------------------------------

// Is the map in "overview" — framed by the tool rather than by a person?
// While it is, the tool keeps it framed: after every edit and whenever a panel
// closes, so the projector always shows the whole map. The moment someone pans
// or zooms by hand, their view is theirs and the tool stops re-framing it.
var userMoved = false;

function inspectorOpen() { return document.body.classList.contains('inspector-open'); }

// Fit everything into the canvas. The roadmap keeps a strip clear at the top
// for the zone titles, and never zooms past 1.2 — a small journey blown up to
// fill a projector looks like a mistake, not a map.
function fitView() {
  var eles = cy.elements();
  userMoved = false;
  if (eles.empty()) return;
  var roadmap = isRoadmapView();
  var top = roadmap ? RM.HEADER : 0;
  var pad = roadmap ? RM.PAD : 40;
  // While editing, the helper line sits along the bottom; keep the parking
  // row's add-slots clear of it or they can't be clicked.
  var bottom = roadmap && window.Edit && Edit.active ? 56 : 0;
  var w = cy.width(), h = cy.height() - top - bottom;
  var bb = eles.boundingBox({ includeLabels: true });
  if (roadmap && roadmapModel) {
    // Include the zones themselves, so the columns always read edge to edge.
    bb = { x1: roadmapModel.zones[0].x0, x2: roadmapModel.zones[roadmapModel.zones.length - 1].x1,
           y1: bb.y1, y2: bb.y2 };
    bb.w = bb.x2 - bb.x1; bb.h = bb.y2 - bb.y1;
  }
  var zoom = Math.min((w - 2 * pad) / bb.w, (h - 2 * pad) / bb.h, roadmap ? 1.2 : 1.6);
  zoom = Math.max(cy.minZoom(), zoom);
  cy.zoom(zoom);
  cy.pan({
    x: roadmap ? -bb.x1 * zoom + Math.max(0, (w - bb.w * zoom) / 2)
               : (w - bb.w * zoom) / 2 - bb.x1 * zoom,
    y: top + Math.max(pad, (h - bb.h * zoom) / 2) - bb.y1 * zoom
  });
}

// After an edit, keep the viewport if everything still fits in it; only refit
// when the map has outgrown the screen. Constant re-zooming while a room is
// watching makes every change feel like the ground moved.
function fitsViewport() {
  var eles = cy.elements();
  if (eles.empty()) return true;
  var bb = eles.renderedBoundingBox({ includeLabels: true });
  var top = isRoadmapView() ? RM.HEADER - 10 : 0;
  return bb.x1 >= 4 && bb.y1 >= top && bb.x2 <= cy.width() - 4 && bb.y2 <= cy.height() - 4;
}

// Node icons can come out unpainted after a programmatic zoom right after a
// layout (Cytoscape caches the rasterised image at the old scale). cy.resize()
// invalidates that cache; forceRender() alone does not.
function repaint() {
  requestAnimationFrame(function() { cy.resize(); });
  setTimeout(function() { cy.resize(); }, 250);
}

// ---------------------------------------------------------------------------
// Switching views
// ---------------------------------------------------------------------------

function switchView(viewId, opts) {
  opts = opts || {};
  var view = graphData.views.find(function(v) { return v.id === viewId; });
  if (!view) return;
  var changedView = !currentView || currentView.id !== view.id;
  currentView = view;
  document.body.classList.toggle('view-roadmap', view.layout === 'roadmap');

  var keep = opts.keepViewport && !changedView;
  var zoom = cy.zoom(), pan = cy.pan();
  // Refit after an edit only if the whole map WAS in view and no longer is —
  // that keeps the projector overview whole, without yanking the zoom out
  // from under someone who has zoomed in, or who has the details panel open.
  var wasWhole = keep && cy.elements().nonempty() && fitsViewport();

  var elements = getFilteredElements(view);
  cy.elements().remove();
  cy.add(elements.nodes);
  cy.add(elements.edges);

  if (view.layout === 'roadmap') {
    applyRoadmap(elements);
    // On the roadmap, position IS meaning; only editing may move a station.
    cy.nodes().forEach(function(n) {
      if (!(window.Edit && Edit.active) || n.data('ghost')) n.ungrabify();
    });
  } else {
    roadmapModel = null;
    renderBands();
    cy.layout(getLayout(view)).run();
  }

  if (keep && !userMoved && !inspectorOpen()) {
    fitView();                       // overview: stay framed as the map grows
  } else if (keep) {
    cy.zoom(zoom); cy.pan(pan);
    if (wasWhole && !fitsViewport()) fitView();
  } else {
    fitView();
  }
  syncBands();
  repaint();

  if (selectedId && cy.getElementById(selectedId).nonempty()) {
    applySelection(selectedId);
  }
  if (linkModePerson) updateLinkModeHighlights();

  var visibleTypes = viewTypes(view.nodeTypes, 'nodeTypes', view.excludeNodeTypes);
  document.querySelectorAll('.legend-item').forEach(function(item) {
    item.style.display = visibleTypes.indexOf(item.dataset.type) >= 0 ? 'flex' : 'none';
  });

  var sel = document.getElementById('view-select');
  if (sel) sel.value = view.id;
  document.dispatchEvent(new CustomEvent('view:changed', { detail: { id: view.id } }));
}

function setView(viewId) { switchView(viewId); }

// ---------------------------------------------------------------------------
// View tabs
// ---------------------------------------------------------------------------

// The workshop views get a tab each; the rest live under More. Short names on
// purpose — a tab bar is read at a glance.
var PRIMARY_VIEWS = [
  ['roadmap', 'Roadmap'], ['people-topics', 'People'], ['state-of-the-art', 'Prior art'],
  ['delivery', 'Delivery'], ['everything', 'Full map']
];

function buildViewTabs() {
  var nav = document.getElementById('view-tabs');
  var sel = document.getElementById('view-select');
  nav.innerHTML = '';
  var known = {};
  graphData.views.forEach(function(v) {
    known[v.id] = v;
    var o = document.createElement('option');
    o.value = v.id; o.textContent = v.label;
    sel.appendChild(o);
  });

  PRIMARY_VIEWS.forEach(function(p) {
    if (!known[p[0]]) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.dataset.view = p[0];
    b.textContent = p[1];
    b.addEventListener('click', function() { setView(p[0]); });
    nav.appendChild(b);
  });

  var primary = PRIMARY_VIEWS.map(function(p) { return p[0]; });
  var rest = graphData.views.filter(function(v) { return primary.indexOf(v.id) < 0; });
  if (rest.length) {
    var wrap = document.createElement('div');
    wrap.className = 'menu-wrap';
    wrap.style.display = 'flex';
    var more = document.createElement('button');
    more.type = 'button'; more.className = 'tab tab-more';
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    more.innerHTML = '<span>More</span><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4z"/></svg>';
    var menu = document.createElement('div');
    menu.className = 'menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    menu.style.left = '0'; menu.style.right = 'auto';
    rest.forEach(function(v) {
      var i = document.createElement('button');
      i.type = 'button'; i.setAttribute('role', 'menuitem'); i.dataset.view = v.id;
      i.textContent = v.label;
      i.addEventListener('click', function() { menu.hidden = true; setView(v.id); });
      menu.appendChild(i);
    });
    more.addEventListener('click', function(e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function() { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); });
    wrap.appendChild(more); wrap.appendChild(menu);
    nav.appendChild(wrap);
  }

  // Mark the tab strip when it overflows, so CSS can fade its edge.
  var markOverflow = function() { nav.classList.toggle('is-overflowing', nav.scrollWidth > nav.clientWidth + 1); };
  window.addEventListener('resize', markOverflow);
  nav.addEventListener('scroll', function() {
    nav.classList.toggle('is-overflowing', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  });
  setTimeout(markOverflow, 0);

  document.addEventListener('view:changed', function(e) {
    var id = e.detail.id, inMore = primary.indexOf(id) < 0;
    nav.querySelectorAll('.tab[data-view]').forEach(function(t) {
      if (t.dataset.view === id) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    var moreBtn = nav.querySelector('.tab-more');
    if (moreBtn) {
      if (inMore) {
        moreBtn.setAttribute('aria-current', 'page');
        moreBtn.querySelector('span').textContent = known[id] ? known[id].label : 'More';
      } else {
        moreBtn.removeAttribute('aria-current');
        moreBtn.querySelector('span').textContent = 'More';
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function swatchRadius(shape) {
  if (shape === 'ellipse') return '50%';
  if (shape === 'round-rectangle') return '3px';
  return '0';
}

// Built from ontology.nodeTypes (+ topic kinds). data-type drives per-view show/hide.
function buildLegend() {
  var legend = document.getElementById('legend');
  if (!legend) return;
  legend.innerHTML = '';
  function addItem(type, color, shape, label) {
    var item = document.createElement('div');
    item.className = 'legend-item';
    item.dataset.type = type;
    var sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = color;
    sw.style.borderRadius = swatchRadius(shape);
    item.appendChild(sw);
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  }
  Object.keys(ontology.nodeTypes).forEach(function(type) {
    var t = ontology.nodeTypes[type];
    if (type === 'topic' && t.kinds) {
      Object.keys(t.kinds).forEach(function(kind) { addItem('topic', t.kinds[kind].color, t.kinds[kind].shape, t.kinds[kind].label); });
    } else {
      addItem(type, t.color, t.shape, t.label);
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initGraph() {
  cy = window.cy = cytoscape({
    container: document.getElementById('cy'),
    boxSelectionEnabled: false,
    autounselectify: true,
    minZoom: 0.25,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
    pixelRatio: 2,
    textureOnViewport: false,
    style: getNodeStyle(),
    elements: [],
    layout: { name: 'preset' }
  });

  buildViewTabs();
  buildLegend();
  setupTopbar();
  switchView(graphData.views[0].id);

  // Tooltip: a stone's description, or what an add-slot does.
  var tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  document.body.appendChild(tooltip);
  function placeTooltip(node) {
    var rect = cy.container().getBoundingClientRect();
    var p = node.renderedPosition();
    var h = node.renderedHeight() / 2;
    tooltip.style.left = (rect.left + p.x + 14) + 'px';
    tooltip.style.top = (rect.top + p.y + h + 8) + 'px';
  }
  cy.on('mouseover', 'node', function(e) {
    var n = e.target;
    if (n.data('ghost')) n.addClass('is-hover');
    var desc = n.data('description');
    // A stone's own label already sits under it; the ghost's hint would sit on
    // top of that, so ghosts use the tooltip and stones only when described.
    if (desc && !(window.Edit && Edit.composerOpen())) {
      tooltip.textContent = desc;
      tooltip.style.display = 'block';
      placeTooltip(n);
    }
  });
  cy.on('mouseout', 'node', function(e) {
    e.target.removeClass('is-hover');
    tooltip.style.display = 'none';
  });
  cy.on('viewport', function() {
    tooltip.style.display = 'none';
    syncBands();
    if (window.Edit) Edit.syncComposer();
  });
  cy.on('grab tap', 'node', function() { tooltip.style.display = 'none'; });

  cy.on('tap', 'node', function(evt) {
    var n = evt.target;
    if (linkModePerson) { handleLinkModeTap(n.id()); return; }
    if (window.Edit && Edit.handleTap(n)) return;
    if (n.data('ghost')) return;
    selectNode(n.id());
  });
  cy.on('dbltap', 'node', function(evt) {
    if (window.Edit) Edit.handleDoubleTap(evt.target);
  });
  cy.on('tap', function(event) {
    if (event.target !== cy) return;
    if (linkModePerson) return;
    if (window.Edit && Edit.handleBackgroundTap()) return;
    clearSelection();
  });

  window.addEventListener('resize', function() {
    if (!userMoved && !inspectorOpen()) { cy.resize(); fitView(); }
    syncBands();
  });

  // Hand pan (drag on empty canvas) or zoom (wheel, pinch) ends overview mode.
  var bgDown = false;
  cy.on('tapstart', function(e) { bgDown = e.target === cy; });
  cy.on('tapdrag', function() { if (bgDown) userMoved = true; });
  cy.on('tapend', function() { bgDown = false; });
  cy.container().addEventListener('wheel', function() { userMoved = true; }, { passive: true });
  document.addEventListener('keydown', onGlobalKey);

  setupPersonLinkMode();
  document.dispatchEvent(new CustomEvent('graph:ready'));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function applySelection(id) {
  cy.elements().removeClass('is-selected faded');
  var node = cy.getElementById(id);
  if (node.empty()) return;
  node.addClass('is-selected');
  // In the free-form graph views a selection also dims everything unrelated —
  // that's how you read a hairball. On the roadmap the lines ARE the context,
  // and dimming the whole map on every click would make editing flicker.
  if (!isRoadmapView()) {
    cy.elements().addClass('faded');
    node.closedNeighborhood().removeClass('faded');
  }
}

function selectNode(id, opts) {
  opts = opts || {};
  selectedId = id;
  applySelection(id);
  if (window.Inspector) Inspector.open(id);
  var node = cy.getElementById(id);
  if (node.nonempty()) {
    // Opening the details panel narrows the canvas; make sure the thing you
    // just picked is not now hiding behind it. Done synchronously — the new
    // canvas size is readable immediately, and animation frames are paused in
    // background tabs, so correctness must not wait for one.
    cy.resize();
    if (opts.center) moveViewport({ center: { eles: node } });
    else ensureVisible(node);
    syncBands();
  }
}

// Animate viewport moves when someone can see them; jump when the page is in
// the background (no animation frames run there, so an animation would never finish).
function moveViewport(to) {
  if (document.hidden) {
    if (to.center) cy.center(to.center.eles);
    if (to.panBy) cy.panBy(to.panBy);
    syncBands();
    return;
  }
  cy.animate(Object.assign({ duration: 240 }, to));
}

function clearSelection() {
  selectedId = null;
  cy.elements().removeClass('is-selected faded');
  if (window.Inspector) Inspector.close();
}

function ensureVisible(node) {
  var p = node.renderedPosition(), m = 70;
  var w = cy.width(), h = cy.height();
  var dx = 0, dy = 0;
  if (p.x < m) dx = m - p.x;
  if (p.x > w - m) dx = (w - m) - p.x;
  if (p.y < m) dy = m - p.y;
  if (p.y > h - m) dy = (h - m) - p.y;
  if (dx || dy) moveViewport({ panBy: { x: dx, y: dy } });
}

// Kept for older callers (queries.js): "show details" is now "select".
function showDetailPanel(node) { selectNode(node.id()); }
function closeDetailPanel() { clearSelection(); }

// Canvas area changed size (a drawer opened or closed).
function onCanvasResized() {
  cy.resize();
  // Opening the details panel keeps the map still (only the pick is kept in
  // view); closing it restores the overview if nobody has taken over the view.
  if (!userMoved && !inspectorOpen()) fitView();
  syncBands();
  if (selectedId && cy.getElementById(selectedId).nonempty()) ensureVisible(cy.getElementById(selectedId));
}

// ---------------------------------------------------------------------------
// Top bar: save status, present, menu, toast
// ---------------------------------------------------------------------------

function setupTopbar() {
  var status = document.getElementById('save-status');
  var copy = {
    saving: 'Saving…',
    saved: 'All changes saved',
    error: 'Not saved: can’t reach the server',
    conflict: 'Reloaded someone else’s changes'
  };
  document.addEventListener('graph:save', function(e) {
    var s = e.detail.state;
    status.dataset.state = s;
    status.textContent = copy[s] || '';
    if (s === 'error') toast('Your last change was not saved. Check that the server is running, then try again.', { tone: 'bad' });
  });
  if (window.PUBLIC_BUILD) status.hidden = true;

  var present = document.getElementById('present-btn');
  if (present) present.addEventListener('click', togglePresent);
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement && document.body.classList.contains('present')) togglePresent(false);
  });

  var more = document.getElementById('more-btn'), menu = document.getElementById('more-menu');
  if (more && menu) {
    more.addEventListener('click', function(e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      more.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', function() { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); });
    menu.addEventListener('click', function(e) {
      var cmd = e.target.dataset && e.target.dataset.cmd;
      if (cmd === 'export') downloadData();
      if (cmd === 'shortcuts') openDialog('shortcuts');
      if (cmd === 'insights') document.getElementById('insights-btn').click();
      if (cmd === 'present') togglePresent(true);
    });
  }

  document.querySelectorAll('.overlay [data-close]').forEach(function(b) {
    b.addEventListener('click', function() { b.closest('.overlay').hidden = true; });
  });
  document.querySelectorAll('.overlay').forEach(function(o) {
    o.addEventListener('click', function(e) { if (e.target === o && o.id !== 'editor-container') o.hidden = true; });
  });
}

// The keyboard. Editing (editing.js) gets first refusal on its own keys; the
// rest — search, present, shortcuts, Esc — work everywhere, public build too.
function onGlobalKey(e) {
  var t = e.target;
  var typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                       t.tagName === 'SELECT' || t.isContentEditable);
  var mod = e.metaKey || e.ctrlKey;

  if (mod && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    if (window.Palette) Palette.open();
    return;
  }
  if (e.key === 'Escape' && !typing) {
    var open = document.querySelector('.overlay:not([hidden])');
    if (open && open.id !== 'editor-container') { open.hidden = true; return; }
    if (window.Edit && Edit.onEscape()) return;
    if (linkModePerson) { exitPersonLinkMode(); return; }
    if (selectedId) { clearSelection(); return; }
    return;
  }
  if (window.Edit && Edit.onKey(e, typing)) return;
  if (typing || mod || e.altKey) return;

  if (e.key === '/') { e.preventDefault(); if (window.Palette) Palette.open(); }
  else if (e.key === '?') { openDialog('shortcuts'); }
  else if (e.key === 'p' || e.key === 'P') { togglePresent(); }
}

function openDialog(id) {
  var d = document.getElementById(id);
  if (!d) return;
  d.hidden = false;
  var focusable = d.querySelector('input, button');
  if (focusable) focusable.focus();
}

function togglePresent(on) {
  var body = document.body;
  var next = typeof on === 'boolean' ? on : !body.classList.contains('present');
  body.classList.toggle('present', next);
  if (next) {
    if (window.Edit && Edit.composerOpen()) Edit.closeComposer();
    if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function() {});
    }
    toast('Presenting. Press Esc to leave.');
  } else if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(function() {});
  }
  // Wait for the fullscreen resize to land before fitting.
  setTimeout(function() { cy.resize(); fitView(); syncBands(); repaint(); }, 180);
}

function downloadData() {
  var blob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'technology-journeys-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
}

var toastTimer = null;
function toast(message, opts) {
  opts = opts || {};
  var el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.innerHTML = '';
  el.dataset.tone = opts.tone || '';
  var span = document.createElement('span');
  span.textContent = message;
  el.appendChild(span);
  if (opts.actionLabel && opts.onAction) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = opts.actionLabel;
    b.addEventListener('click', function() { el.hidden = true; opts.onAction(); });
    el.appendChild(b);
  }
  el.hidden = false;
  // Re-trigger the entrance so consecutive toasts visibly replace each other.
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  toastTimer = setTimeout(function() { el.hidden = true; }, opts.tone === 'bad' ? 9000 : 5000);
}

// ---------------------------------------------------------------------------
// Labels and small helpers (shared with inspector.js / editing.js)
// ---------------------------------------------------------------------------

function formatEdgeType(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

// Prefer the ontology's label so edge naming lives in one place (PLAN §2.5).
function edgeTypeLabel(type) {
  var e = ontology && ontology.edgeTypes && ontology.edgeTypes[type];
  return (e && e.label) || formatEdgeType(type);
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function nodeById(id) {
  return graphData.nodes.find(function(x) { return x.data.id === id; });
}

function nodeLabelById(id) {
  var n = nodeById(id);
  return n ? String(n.data.label || id).replace(/\n/g, ' ') : id;
}

// ---------------------------------------------------------------------------
// Person link mode: "click the stones this person works on"
// ---------------------------------------------------------------------------

var linkModePerson = null;

function enterPersonLinkMode(researcherId) {
  var r = nodeById(researcherId);
  if (!r) return;
  linkModePerson = r;
  clearSelection();
  if (currentView.id !== 'roadmap' && graphData.views.some(function(v) { return v.id === 'roadmap'; })) setView('roadmap');
  document.getElementById('link-banner-name').textContent = nodeLabelById(researcherId);
  document.getElementById('link-banner').hidden = false;
  updateLinkModeHighlights();
}

function exitPersonLinkMode() {
  linkModePerson = null;
  var banner = document.getElementById('link-banner');
  if (banner) banner.hidden = true;
  if (cy) cy.elements().removeClass('person-linked person-unlinked');
}

function updateLinkModeHighlights() {
  if (!linkModePerson) return;
  var linked = {};
  graphData.edges.forEach(function(e) {
    if (e.data.source === linkModePerson.data.id && e.data.type === 'works_on') linked[e.data.target] = true;
  });
  cy.elements().removeClass('person-linked person-unlinked is-selected faded');
  cy.nodes().forEach(function(n) {
    if (n.data('type') !== 'topic' || n.data('ghost')) return;
    n.addClass(linked[n.id()] ? 'person-linked' : 'person-unlinked');
  });
  cy.edges().addClass('person-unlinked');
}

function handleLinkModeTap(nodeId) {
  if (!linkModePerson) return;
  var target = nodeById(nodeId);
  if (!target || target.data.type !== 'topic') return;
  var pid = linkModePerson.data.id;
  var idx = graphData.edges.findIndex(function(e) {
    return e.data.source === pid && e.data.target === nodeId && e.data.type === 'works_on';
  });
  var who = nodeLabelById(pid), what = nodeLabelById(nodeId);
  var mutate = function() {
    if (idx >= 0) {
      graphData.edges.splice(idx, 1);
    } else {
      var edgeData = { source: pid, target: nodeId, type: 'works_on' };
      stampProvenance(edgeData);
      graphData.edges.push({ data: edgeData });
    }
  };
  var message = idx >= 0 ? who + ' no longer works on ' + what : who + ' works on ' + what;
  if (window.Edit) Edit.commit(message, mutate);
  else { mutate(); updateLinkModeHighlights(); persistData(); }
}

function setupPersonLinkMode() {
  var done = document.getElementById('link-banner-done');
  if (done) done.addEventListener('click', exitPersonLinkMode);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

// Stamp provenance on a node/edge data object (updatedBy = SSO user once auth lands).
// The provenance field `source` collides with an edge's `source` node id, so it is
// only written on nodes; edges carry updatedBy/updatedAt only.
function stampProvenance(data) {
  data.updatedAt = new Date().toISOString();
  data.updatedBy = 'manual';
  var isEdge = data.source !== undefined && data.target !== undefined;
  if (!isEdge && !data.source) data.source = 'manual';
}

function emitSave(state) {
  document.dispatchEvent(new CustomEvent('graph:save', { detail: { state: state } }));
}

function reloadData() {
  return fetch(DATA_URL)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      graphData = data;
      document.dispatchEvent(new CustomEvent('graph:reloaded'));
      if (currentView) switchView(currentView.id, { keepViewport: true });
    });
}

// Saves are SERIALISED. The server rejects a write based on a stale version
// (optimistic concurrency), and every save bumps the version — so two saves in
// flight at once means the second is always rejected, which used to trigger a
// reload that threw away the change. Typing stones quickly (Enter, Enter,
// Enter) did exactly that. Now a save requested while one is in flight just
// marks the graph dirty, and one more save goes out when the first returns.
var saveQueue = { inFlight: false, dirty: false };

function persistData() {
  // The public build is read-only and has no write endpoint; never call out.
  if (window.PUBLIC_BUILD) return Promise.resolve();
  if (saveQueue.inFlight) { saveQueue.dirty = true; return Promise.resolve(); }
  saveQueue.inFlight = true;
  emitSave('saving');
  return fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graphData)
  }).then(function(res) {
    if (res.status === 409) {
      // Someone else saved first: take theirs rather than clobber it.
      saveQueue.dirty = false;
      emitSave('conflict');
      return reloadData();
    }
    if (!res.ok) { emitSave('error'); return; }
    return res.json().then(function(body) {
      if (body && typeof body.version !== 'undefined') graphData.version = body.version;
      if (!saveQueue.dirty) emitSave('saved');
    });
  }).catch(function() {
    emitSave('error');
  }).then(function() {
    saveQueue.inFlight = false;
    if (saveQueue.dirty) { saveQueue.dirty = false; persistData(); }
  });
}

// Kept for callers that batch rapid toggles; the queue above already coalesces.
function persistDataDebounced() { persistData(); }
