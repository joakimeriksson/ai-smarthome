var graphData = null;
var cy = null;
var currentView = null;
var ontology = null;

Promise.all([
  fetch('/api/data').then(function(r) { return r.json(); }),
  fetch('/ontology.json').then(function(r) { return r.json(); })
]).then(function(res) {
  graphData = res[0];
  ontology = window.ontology = res[1];
  initGraph();
});

// Per-type visual sizing (presentation defaults; shape/colour come from ontology).
// A new node type still renders with these fallbacks — only ontology.json needs editing.
var NODE_SIZE = {
  topic:        { 'text-valign': 'bottom', 'text-margin-y': 5 },
  researcher:   { width: 90,  height: 60, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0 },
  group:        { width: 130, height: 70, 'font-size': 13, 'text-valign': 'center', 'text-margin-y': 0 },
  project:      { width: 90,  height: 90, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0 },
  publication:  { width: 90,  height: 90, 'font-size': 11, 'text-valign': 'center', 'text-margin-y': 0 },
  partner:      { width: 110, height: 60, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0 },
  funding_call: { width: 110, height: 60, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0 },
  testbed:      { width: 110, height: 60, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0 }
};
var KIND_SIZE = {
  stone:       {},  // keeps the base topic look (icon circle, label below)
  destination: { width: 170, height: 72, 'font-size': 14, 'text-valign': 'center', 'text-margin-y': 0,
                 'text-max-width': '150px', 'background-image': 'none' },
  enabler:     { width: 120, height: 60, 'font-size': 12, 'text-valign': 'center', 'text-margin-y': 0,
                 'text-max-width': '110px', 'background-image': 'none' }
};

// Build the Cytoscape stylesheet from ontology.json so types/colours live in one place.
function getNodeStyle() {
  var styles = [
    { selector: 'node', style: {
        'height': 80, 'width': 80,
        'background-color': '#00057D', 'border-color': 'white', 'border-width': 3,
        'color': 'white', 'label': 'data(label)', 'font-size': 13,
        'text-max-width': '110px', 'text-wrap': 'wrap',
        'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 5
      } }
  ];

  // Per node-type shape/colour from ontology + size fallbacks from NODE_SIZE.
  Object.keys(ontology.nodeTypes).forEach(function(type) {
    var t = ontology.nodeTypes[type];
    var s = { 'shape': t.shape, 'background-color': t.color, 'border-color': t.border, 'color': 'white' };
    Object.assign(s, NODE_SIZE[type] || { 'text-valign': 'center', 'text-margin-y': 0 });
    styles.push({ selector: 'node[type="' + type + '"]', style: s });
  });

  // Topic icon image applies to stones; kind overrides below can turn it off.
  styles.push({ selector: 'node[type="topic"][image]', style: {
    'background-image': 'data(image)', 'background-fit': 'cover', 'background-clip': 'node'
  } });

  // Topic kinds (stone / destination / enabler) — declared after the image rule so
  // destinations/enablers render as solid blocks even if they carry an icon.
  var topicKinds = (ontology.nodeTypes.topic && ontology.nodeTypes.topic.kinds) || {};
  Object.keys(topicKinds).forEach(function(kind) {
    var k = topicKinds[kind];
    var s = { 'shape': k.shape, 'background-color': k.color, 'border-color': k.border };
    Object.assign(s, KIND_SIZE[kind] || {});
    styles.push({ selector: 'node[type="topic"][kind="' + kind + '"]', style: s });
  });

  // Legacy centre variant retained.
  styles.push({ selector: '.center', style: {
    'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
    'shape': 'rectangle', 'width': '150px',
    'background-color': '#3565DA', 'border-color': '#3565DA',
    'text-margin-y': 0, 'text-margin-x': 0
  } });

  // Edges: base + per-type from ontology.
  styles.push({ selector: 'edge', style: {
    'curve-style': 'bezier', 'width': 3,
    'line-color': 'rgba(255,255,255,0.6)', 'target-arrow-color': 'rgba(255,255,255,0.6)',
    'target-arrow-shape': 'triangle'
  } });
  Object.keys(ontology.edgeTypes).forEach(function(type) {
    var e = ontology.edgeTypes[type];
    styles.push({ selector: 'edge[type="' + type + '"]', style: {
      'line-color': e.color, 'target-arrow-color': e.color,
      'line-style': e.style || 'solid', 'width': e.width || 3
    } });
  });

  // Interaction states.
  styles.push({ selector: '.highlighted-node', style: { 'border-color': 'yellow', 'border-width': 5 } });
  styles.push({ selector: '.highlighted-edge', style: { 'line-color': 'yellow', 'target-arrow-color': 'yellow', 'width': 6 } });
  styles.push({ selector: '.faded', style: { 'opacity': 0.15 } });
  styles.push({ selector: '.person-linked', style: { 'border-color': '#5cb85c', 'border-width': 5 } });
  styles.push({ selector: '.person-unlinked', style: { 'opacity': 0.5 } });
  styles.push({ selector: '.neighbor-highlight', style: { 'opacity': 1 } });

  return styles;
}

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
  var nodeIds = nodes.map(function(n) { return n.data.id; });
  var edges = graphData.edges.filter(function(e) {
    return edgeTypes.indexOf(e.data.type) >= 0 &&
           nodeIds.indexOf(e.data.source) >= 0 &&
           nodeIds.indexOf(e.data.target) >= 0;
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
    return {
      name: 'klay',
      directed: true,
      padding: 10,
      klay: {
        spacing: 120,
        fixedAlignment: 'LEFTDOWN'
      }
    };
  }
  return {
    name: 'cose',
    padding: 40,
    nodeRepulsion: function() { return 8000; },
    idealEdgeLength: function() { return 120; },
    gravity: 0.3,
    numIter: 1000,
    animate: false
  };
}

// --- Roadmap swimlane layout ------------------------------------------------
// Ericsson technology-journey style: one journey per row, drawn as a STRAIGHT
// horizontal line of stones ending in its destination. Horizon bands (now /
// next / beyond) give the columns, so a stone's x still reads as "when".
// Within a band a chain's stones spread sideways into sub-slots — never
// stacked vertically, which is what would bend the line.
// Keep the total width modest: a wider graph forces a lower fit-zoom, and below
// ~0.7 Cytoscape stops painting the SVG stone icons.
var ROADMAP_SLOT_W = 180;   // x-distance between two stones in the same band
var ROADMAP_BAND_GAP = 95;  // extra breathing room between bands (holds the divider)
var ROADMAP_LANE_H = 190;   // y-distance between journeys
var ROADMAP_BANDS = [
  { key: 'now',         label: 'NOW · 0–2 YRS' },
  { key: 'next',        label: 'NEXT · 2–5 YRS' },
  { key: 'beyond',      label: 'BEYOND · 5–10 YRS' },
  { key: 'destination', label: 'DESTINATIONS' }
];
var ROADMAP_MAX_CHAINS = 400; // guard against combinatorial blow-up on dense graphs

function computeRoadmapPositions(elements) {
  var nodesById = {};
  elements.nodes.forEach(function(n) { nodesById[n.data.id] = n.data; });

  // Destinations always occupy the anchor band on the right.
  function bandOf(d) { return d.kind === 'destination' ? 'destination' : (d.horizon || 'now'); }

  // Forward journey adjacency (restricted to the elements in this view).
  var fwd = {}, hasIncoming = {};
  elements.edges.forEach(function(e) {
    if (e.data.type !== 'journey') return;
    (fwd[e.data.source] = fwd[e.data.source] || []).push(e.data.target);
    hasIncoming[e.data.target] = true;
  });

  // Enumerate every root -> sink journey chain; each becomes one straight lane.
  var chains = [];
  function walk(id, acc, onPath) {
    if (chains.length >= ROADMAP_MAX_CHAINS) return;
    var extended = false;
    (fwd[id] || []).forEach(function(t) {
      if (onPath[t]) return;          // cycle guard
      onPath[t] = true;
      walk(t, acc.concat([t]), onPath);
      delete onPath[t];
      extended = true;
    });
    if (!extended) chains.push(acc);  // reached a sink — the chain is complete
  }
  elements.nodes.forEach(function(n) {
    var id = n.data.id;
    if (hasIncoming[id] || !(fwd[id] || []).length) return;
    var onPath = {}; onPath[id] = true;
    walk(id, [id], onPath);
  });

  // Each chain claims a lane for the nodes no earlier chain has claimed, so a
  // branch (shared prefix) diverges into its own row instead of overlapping.
  var laneOf = {}, slotOf = {}, laneCount = 0;
  chains.forEach(function(chain) {
    if (!chain.some(function(id) { return !(id in laneOf); })) return;
    var lane = laneCount++;
    var used = {};
    chain.forEach(function(id) {
      // Advance the band's slot counter for every node on the chain — including
      // already-claimed ones — so slots stay aligned across branches.
      var b = bandOf(nodesById[id]);
      var slot = used[b] || 0;
      used[b] = slot + 1;
      if (!(id in laneOf)) { laneOf[id] = lane; slotOf[id] = slot; }
    });
  });

  // Nodes on no chain (the curation backlog, PLAN §2.6) share one trailing lane.
  var orphanLane = null, orphanUsed = {};
  elements.nodes.forEach(function(n) {
    if (n.data.id in laneOf) return;
    if (orphanLane === null) orphanLane = laneCount++;
    var b = bandOf(n.data);
    var slot = orphanUsed[b] || 0;
    orphanUsed[b] = slot + 1;
    laneOf[n.data.id] = orphanLane;
    slotOf[n.data.id] = slot;
  });

  // Band widths adapt to the deepest slot actually used in each band.
  var bandSlots = {};
  ROADMAP_BANDS.forEach(function(b) { bandSlots[b.key] = 1; });
  elements.nodes.forEach(function(n) {
    var b = bandOf(n.data);
    bandSlots[b] = Math.max(bandSlots[b] || 1, slotOf[n.data.id] + 1);
  });

  var bandX = {}, cols = [], dividers = [], x = 0;
  ROADMAP_BANDS.forEach(function(b, i) {
    bandX[b.key] = x;
    var lastX = x + (bandSlots[b.key] - 1) * ROADMAP_SLOT_W;
    cols.push({ key: b.key, label: b.label, x: (x + lastX) / 2 });
    if (i < ROADMAP_BANDS.length - 1) dividers.push(lastX + (ROADMAP_SLOT_W + ROADMAP_BAND_GAP) / 2);
    x = lastX + ROADMAP_SLOT_W + ROADMAP_BAND_GAP;
  });

  // One shared y per lane — this is what keeps each journey a straight line.
  var positions = {};
  elements.nodes.forEach(function(n) {
    var d = n.data;
    positions[d.id] = {
      x: bandX[bandOf(d)] + slotOf[d.id] * ROADMAP_SLOT_W,
      y: laneOf[d.id] * ROADMAP_LANE_H
    };
  });

  return { positions: positions, cols: cols, dividers: dividers };
}

function applyRoadmapLayout(elements) {
  var rm = computeRoadmapPositions(elements);
  cy.nodes().forEach(function(n) {
    var p = rm.positions[n.id()];
    if (p) n.position(p);
  });
  cy.layout({ name: 'preset' }).run();
  cy.fit(undefined, 70);
  // Nudge content down so the first lane clears the fixed band-header strip.
  cy.panBy({ x: 0, y: 45 });
  showRoadmapBands(rm.cols, rm.dividers);
  updateRoadmapBands();
}

// --- Roadmap band overlay (headers + column dividers, synced to viewport) ----
var roadmapBandsEl = null;
var roadmapModel = null;

function ensureRoadmapBands() {
  if (!roadmapBandsEl) {
    roadmapBandsEl = document.createElement('div');
    roadmapBandsEl.id = 'roadmap-bands';
    document.body.appendChild(roadmapBandsEl);
  }
  return roadmapBandsEl;
}

function showRoadmapBands(cols, dividers) {
  roadmapModel = { cols: cols, dividers: dividers };
  var el = ensureRoadmapBands();
  el.style.display = 'block';
  el.innerHTML = '';
  dividers.forEach(function() {
    var ln = document.createElement('div');
    ln.className = 'roadmap-divider';
    el.appendChild(ln);
  });
  cols.forEach(function(c) {
    var h = document.createElement('div');
    h.className = 'roadmap-band-label';
    h.textContent = c.label;
    el.appendChild(h);
  });
}

function hideRoadmapBands() {
  if (roadmapBandsEl) roadmapBandsEl.style.display = 'none';
}

function updateRoadmapBands() {
  if (!roadmapBandsEl || roadmapBandsEl.style.display === 'none' || !roadmapModel) return;
  var z = cy.zoom(), pan = cy.pan();
  var lines = roadmapBandsEl.querySelectorAll('.roadmap-divider');
  roadmapModel.dividers.forEach(function(mx, i) { if (lines[i]) lines[i].style.left = (mx * z + pan.x) + 'px'; });
  var labels = roadmapBandsEl.querySelectorAll('.roadmap-band-label');
  roadmapModel.cols.forEach(function(c, i) { if (labels[i]) labels[i].style.left = (c.x * z + pan.x) + 'px'; });
}

function switchView(viewId) {
  var view = graphData.views.find(function(v) { return v.id === viewId; });
  if (!view) return;
  currentView = view;
  var elements = getFilteredElements(view);
  cy.elements().remove();
  cy.add(elements.nodes);
  cy.add(elements.edges);

  if (view.layout === 'roadmap') {
    applyRoadmapLayout(elements);
  } else {
    hideRoadmapBands();
    cy.layout(getLayout(view)).run();
    cy.fit(undefined, 40);
  }

  // Update legend visibility
  var visibleTypes = viewTypes(view.nodeTypes, 'nodeTypes', view.excludeNodeTypes);
  var legendItems = document.querySelectorAll('.legend-item');
  legendItems.forEach(function(item) {
    var type = item.dataset.type;
    if (type && visibleTypes.indexOf(type) >= 0) {
      item.style.display = 'flex';
    } else if (type) {
      item.style.display = 'none';
    }
  });
}

function swatchRadius(shape) {
  if (shape === 'ellipse') return '50%';
  if (shape === 'round-rectangle') return '4px';
  return '0';
}

// Build the legend from ontology.nodeTypes (+ topic kinds). data-type drives per-view
// show/hide in switchView; topic kinds map to the 'topic' type for filtering.
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
    item.appendChild(document.createTextNode(' ' + label));
    legend.appendChild(item);
  }

  Object.keys(ontology.nodeTypes).forEach(function(type) {
    var t = ontology.nodeTypes[type];
    if (type === 'topic' && t.kinds) {
      // Show each topic kind as its own legend entry.
      Object.keys(t.kinds).forEach(function(kind) {
        var k = t.kinds[kind];
        addItem('topic', k.color, k.shape, k.label);
      });
    } else {
      addItem(type, t.color, t.shape, t.label);
    }
  });
}

function initGraph() {
  cy = window.cy = cytoscape({
    container: document.getElementById('cy'),
    boxSelectionEnabled: false,
    autounselectify: true,
    minZoom: 0.3,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
    pixelRatio: 2,
    textureOnViewport: false,
    style: getNodeStyle(),
    elements: [],
    layout: { name: 'preset' }
  });

  // Populate view switcher
  var viewSelect = document.getElementById('view-select');
  graphData.views.forEach(function(view) {
    var option = document.createElement('option');
    option.value = view.id;
    option.textContent = view.label;
    viewSelect.appendChild(option);
  });

  viewSelect.addEventListener('change', function() {
    closeDetailPanel();
    switchView(this.value);
  });

  // Build the legend from the ontology.
  buildLegend();

  // Load default view
  switchView(graphData.views[0].id);

  // Tooltip
  var tooltip = document.createElement('div');
  tooltip.classList.add('tooltip');
  document.body.appendChild(tooltip);

  cy.on('mouseover', 'node', function(e) {
    var node = e.target;
    var desc = node.data('description');
    if (desc) {
      tooltip.innerHTML = desc;
      tooltip.style.display = 'block';
      var pos = node.renderedPosition();
      tooltip.style.left = (pos.x + 10) + 'px';
      tooltip.style.top = (pos.y + 10) + 'px';
    }
  });

  cy.on('mouseout', 'node', function() {
    tooltip.style.display = 'none';
  });

  cy.on('position', 'node', function(e) {
    if (tooltip.style.display === 'block') {
      var pos = e.target.renderedPosition();
      tooltip.style.left = (pos.x + 10) + 'px';
      tooltip.style.top = (pos.y + 10) + 'px';
    }
  });

  cy.on('viewport', function() {
    tooltip.style.display = 'none';
    updateRoadmapBands();
  });

  window.addEventListener('resize', updateRoadmapBands);

  // --- Detail panel on tap ---
  cy.on('tap', 'node', function(evt) {
    if (linkModePerson) {
      handleLinkModeTap(evt.target.id());
      return;
    }
    showDetailPanel(evt.target);
  });

  cy.on('tap', function(event) {
    if (event.target === cy) {
      if (linkModePerson) return;
      cy.elements().removeClass('highlighted-node highlighted-edge faded neighbor-highlight');
      closeDetailPanel();
    }
  });

  // --- Persons display ---
  var showPersonsBtn = document.getElementById('show-persons-btn');
  var personsDisplayContainer = document.getElementById('persons-display-container');
  var personsDisplayList = document.getElementById('persons-display-list');
  var closePersonsDisplayBtn = document.getElementById('close-persons-display-btn');

  showPersonsBtn.addEventListener('click', function() {
    populatePersonsDisplayList();
    personsDisplayContainer.style.display = 'block';
  });

  closePersonsDisplayBtn.addEventListener('click', function() {
    personsDisplayContainer.style.display = 'none';
    cy.elements().removeClass('highlighted-node highlighted-edge faded');
  });

  function populatePersonsDisplayList() {
    personsDisplayList.innerHTML = '';
    var researchers = graphData.nodes.filter(function(n) { return n.data.type === 'researcher'; });
    researchers.forEach(function(r) {
      var li = document.createElement('li');
      li.classList.add('person-list-item');
      li.textContent = r.data.label.replace(/\n/g, ' ');
      li.dataset.id = r.data.id;
      li.addEventListener('click', function() {
        highlightResearcherConnections(r.data.id);
      });
      personsDisplayList.appendChild(li);
    });
  }

  function highlightResearcherConnections(researcherId) {
    cy.elements().removeClass('highlighted-node highlighted-edge faded');
    cy.elements().addClass('faded');
    var node = cy.$('#' + researcherId);
    if (node.length > 0) {
      node.removeClass('faded').addClass('highlighted-node');
      var connectedEdges = node.connectedEdges();
      connectedEdges.forEach(function(edge) {
        edge.removeClass('faded').addClass('highlighted-edge');
        edge.source().removeClass('faded').addClass('neighbor-highlight');
        edge.target().removeClass('faded').addClass('neighbor-highlight');
      });
    }
  }

  // --- Person link mode ---
  setupPersonLinkMode();
}

// --- Detail panel ---
function showDetailPanel(node) {
  cy.elements().removeClass('highlighted-node highlighted-edge faded neighbor-highlight');
  cy.elements().addClass('faded');
  node.removeClass('faded').addClass('highlighted-node');

  // Highlight neighbors
  var connectedEdges = node.connectedEdges();
  connectedEdges.forEach(function(edge) {
    edge.removeClass('faded').addClass('highlighted-edge');
    edge.source().removeClass('faded').addClass('neighbor-highlight');
    edge.target().removeClass('faded').addClass('neighbor-highlight');
  });

  var panel = document.getElementById('detail-panel');
  var title = document.getElementById('detail-title');
  var typeBadge = document.getElementById('detail-type-badge');
  var desc = document.getElementById('detail-description');
  var meta = document.getElementById('detail-meta');
  var connections = document.getElementById('detail-connections');

  title.textContent = node.data('label').replace(/\n/g, ' ');
  typeBadge.textContent = node.data('type');
  typeBadge.className = 'type-badge type-' + node.data('type');
  desc.textContent = node.data('description') || '';

  // Meta info
  var d = node.data();
  var metaHtml = '';

  // Foresight layer: kind + stepping-stone attributes (ontology-driven).
  if (d.type === 'topic' && ontology) {
    var kinds = (ontology.nodeTypes.topic && ontology.nodeTypes.topic.kinds) || {};
    if (d.kind && kinds[d.kind]) metaHtml += metaRow('Kind', kinds[d.kind].label);
    var sa = ontology.stoneAttributes || {};
    Object.keys(sa).forEach(function(key) {
      var v = d[key];
      if (v === undefined || v === null || v === '') return;
      if (sa[key].type === 'node_ref') v = nodeLabelById(v);
      metaHtml += metaRow(sa[key].label, v);
    });
  }

  // Reality layer fields.
  if (d.title) metaHtml += metaRow('Title', d.title);
  if (d.email) metaHtml += metaRow('Email', d.email);
  if (d.year) metaHtml += metaRow('Year', d.year);
  if (d.venue) metaHtml += metaRow('Venue', d.venue);
  // External prior art has no researcher nodes to hang authorship off, so the
  // author list and citation count live on the publication node itself.
  if (d.authors) metaHtml += metaRow('Authors', d.authors);
  if (d.citations != null) metaHtml += metaRow('Citations', d.citations);
  if (d.funder) metaHtml += metaRow('Funder', d.funder);
  if (d.startYear) metaHtml += metaRow('Period', d.startYear + ' - ' + (d.endYear || ''));

  // Sensitivity (applies to every node).
  if (d.sensitivity) metaHtml += metaRow((ontology && ontology.sensitivity.label) || 'Sensitivity', d.sensitivity);

  // Provenance.
  var pf = (ontology && ontology.provenanceFields) || {};
  var provHtml = '';
  Object.keys(pf).forEach(function(key) {
    if (d[key]) provHtml += metaRow(pf[key].label, d[key]);
  });
  if (provHtml) metaHtml += '<div class="detail-provenance">' + provHtml + '</div>';

  meta.innerHTML = metaHtml;

  // Connections from full data (not just visible view)
  var nodeId = node.id();
  var connList = [];
  graphData.edges.forEach(function(e) {
    if (e.data.source === nodeId) {
      var targetNode = graphData.nodes.find(function(n) { return n.data.id === e.data.target; });
      if (targetNode) {
        connList.push({ type: e.data.type, label: targetNode.data.label.replace(/\n/g, ' '), id: targetNode.data.id, nodeType: targetNode.data.type, year: targetNode.data.year });
      }
    }
    if (e.data.target === nodeId) {
      var sourceNode = graphData.nodes.find(function(n) { return n.data.id === e.data.source; });
      if (sourceNode) {
        connList.push({ type: e.data.type, label: sourceNode.data.label.replace(/\n/g, ' '), id: sourceNode.data.id, nodeType: sourceNode.data.type, year: sourceNode.data.year });
      }
    }
  });

  // Group connections by edge type (raw type, so ordering/sorting can key off it).
  var grouped = {};
  connList.forEach(function(c) {
    if (!grouped[c.type]) grouped[c.type] = [];
    grouped[c.type].push(c);
  });

  var connHtml = '';
  orderedEdgeTypes(Object.keys(grouped)).forEach(function(type) {
    var items = grouped[type];
    // Publication-backed groups read as a timeline: oldest first, year shown.
    // Prior art is only legible in chronological order — it IS the timeline.
    if (YEAR_SORTED_EDGES.indexOf(type) >= 0) {
      items = items.slice().sort(function(a, b) { return (a.year || 0) - (b.year || 0); });
    }
    connHtml += '<div class="conn-group"><strong>' + escapeHtml(edgeTypeLabel(type)) + ':</strong>';
    items.forEach(function(c) {
      var text = c.label + (YEAR_SORTED_EDGES.indexOf(type) >= 0 && c.year ? ' · ' + c.year : '');
      connHtml += '<span class="conn-tag type-' + c.nodeType + ' edge-' + type +
                  '" data-id="' + c.id + '">' + escapeHtml(text) + '</span>';
    });
    connHtml += '</div>';
  });
  connections.innerHTML = connHtml;

  // Make connection tags clickable — navigate to that node
  connections.querySelectorAll('.conn-tag').forEach(function(tag) {
    tag.addEventListener('click', function() {
      var targetId = this.dataset.id;
      var targetNode = cy.$('#' + targetId);
      if (targetNode.length > 0) {
        showDetailPanel(targetNode);
        cy.animate({ center: { eles: targetNode }, duration: 300 });
      }
    });
  });

  panel.style.display = 'block';
}

function closeDetailPanel() {
  document.getElementById('detail-panel').style.display = 'none';
}

document.getElementById('close-detail-btn').addEventListener('click', function() {
  closeDetailPanel();
  cy.elements().removeClass('highlighted-node highlighted-edge faded neighbor-highlight');
});

function formatEdgeType(type) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

// Prefer the ontology's label so edge naming lives in one place (PLAN §2.5);
// fall back to prettifying the raw type for anything not yet in the ontology.
function edgeTypeLabel(type) {
  var e = ontology && ontology.edgeTypes && ontology.edgeTypes[type];
  return (e && e.label) || formatEdgeType(type);
}

// Publication-backed relations, shown oldest-first with the year.
var YEAR_SORTED_EDGES = ['priorArt', 'evidences', 'authored'];

// Detail-panel group order: the stone's story, baseline before progress before
// people. Anything unlisted keeps its natural order at the end.
var EDGE_GROUP_ORDER = ['journey', 'priorArt', 'evidences', 'advances', 'works_on',
                        'enabledBy', 'authored', 'member_of', 'leads', 'participates',
                        'funds', 'supports', 'related_to'];

function orderedEdgeTypes(types) {
  return types.slice().sort(function(a, b) {
    var ia = EDGE_GROUP_ORDER.indexOf(a), ib = EDGE_GROUP_ORDER.indexOf(b);
    if (ia < 0) ia = EDGE_GROUP_ORDER.length;
    if (ib < 0) ib = EDGE_GROUP_ORDER.length;
    return ia - ib;
  });
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function metaRow(label, value) {
  return '<div><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(String(value)) + '</div>';
}

function nodeLabelById(id) {
  var n = graphData.nodes.find(function(x) { return x.data.id === id; });
  return n ? n.data.label.replace(/\n/g, ' ') : id;
}

// --- Person link mode ---
var linkModePerson = null;

function setupPersonLinkMode() {
  var personLinkSearch = document.getElementById('person-link-search');
  var personLinkResults = document.getElementById('person-link-results');
  var personLinkActive = document.getElementById('person-link-active');
  var personLinkName = document.getElementById('person-link-name');
  var personLinkDone = document.getElementById('person-link-done');
  var personLinkSearchWrap = document.getElementById('person-link-search-wrap');

  personLinkSearch.addEventListener('input', function() {
    var query = personLinkSearch.value.toLowerCase().trim();
    personLinkResults.innerHTML = '';
    if (!query) {
      personLinkResults.style.display = 'none';
      return;
    }
    var researchers = graphData.nodes.filter(function(n) {
      return n.data.type === 'researcher' &&
        (n.data.label.toLowerCase().includes(query) ||
         (n.data.email && n.data.email.toLowerCase().includes(query)));
    });
    if (researchers.length === 0) {
      personLinkResults.style.display = 'none';
      return;
    }
    researchers.forEach(function(r) {
      var item = document.createElement('div');
      item.classList.add('person-link-result-item');
      item.textContent = r.data.label.replace(/\n/g, ' ') + ' (' + (r.data.email || '') + ')';
      item.addEventListener('click', function() { enterLinkMode(r); });
      personLinkResults.appendChild(item);
    });
    personLinkResults.style.display = 'block';
  });

  personLinkSearch.addEventListener('blur', function() {
    setTimeout(function() { personLinkResults.style.display = 'none'; }, 200);
  });

  function enterLinkMode(researcher) {
    linkModePerson = researcher;
    personLinkSearch.value = '';
    personLinkResults.style.display = 'none';
    personLinkSearchWrap.style.display = 'none';
    personLinkActive.style.display = 'flex';
    personLinkName.textContent = researcher.data.label.replace(/\n/g, ' ');
    updateLinkModeHighlights();
  }

  function exitLinkMode() {
    linkModePerson = null;
    personLinkSearchWrap.style.display = 'block';
    personLinkActive.style.display = 'none';
    cy.elements().removeClass('person-linked person-unlinked faded');
  }

  function updateLinkModeHighlights() {
    if (!linkModePerson) return;
    // Find all topic nodes this researcher works_on
    var linkedTopicIds = graphData.edges
      .filter(function(e) { return e.data.source === linkModePerson.data.id && e.data.type === 'works_on'; })
      .map(function(e) { return e.data.target; });

    cy.nodes().forEach(function(node) {
      node.removeClass('person-linked person-unlinked highlighted-node faded');
      if (node.data('type') === 'topic') {
        if (linkedTopicIds.indexOf(node.id()) >= 0) {
          node.addClass('person-linked');
        } else {
          node.addClass('person-unlinked');
        }
      }
    });
    cy.edges().removeClass('faded highlighted-edge').addClass('person-unlinked');
  }

  personLinkDone.addEventListener('click', exitLinkMode);

  window.handleLinkModeTap = function(clickedNodeId) {
    if (!linkModePerson) return;
    var clickedNode = graphData.nodes.find(function(n) { return n.data.id === clickedNodeId; });
    if (!clickedNode || clickedNode.data.type !== 'topic') return;

    var existingIdx = graphData.edges.findIndex(function(e) {
      return e.data.source === linkModePerson.data.id && e.data.target === clickedNodeId && e.data.type === 'works_on';
    });

    if (existingIdx >= 0) {
      graphData.edges.splice(existingIdx, 1);
    } else {
      var edgeData = { source: linkModePerson.data.id, target: clickedNodeId, type: 'works_on' };
      stampProvenance(edgeData);
      graphData.edges.push({ data: edgeData });
    }
    updateLinkModeHighlights();
    persistDataDebounced();
  };
}

// Stamp provenance on a node/edge data object (updatedBy = SSO user once auth lands).
// The provenance field `source` collides with an edge's `source` node id, so it is
// only written on nodes; edges carry updatedBy/updatedAt only.
function stampProvenance(data) {
  data.updatedAt = new Date().toISOString();
  data.updatedBy = 'manual';
  var isEdge = data.source !== undefined && data.target !== undefined;
  if (!isEdge && !data.source) data.source = 'manual';
}

function reloadData() {
  return fetch('/api/data')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      graphData = data;
      if (currentView) switchView(currentView.id);
    });
}

function persistData() {
  return fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graphData)
  }).then(function(res) {
    if (res.status === 409) {
      // Another editor saved first — reload the latest so we don't clobber it.
      console.warn('Save conflict: graph changed elsewhere; reloading latest.');
      return reloadData();
    }
    if (!res.ok) {
      console.error('Failed to save data:', res.status);
      return;
    }
    return res.json().then(function(body) {
      if (body && typeof body.version !== 'undefined') graphData.version = body.version;
    });
  });
}

// Person-link toggles fire rapidly; batch the writes into one save.
var persistTimer = null;
function persistDataDebounced(delay) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(function() {
    persistTimer = null;
    persistData();
  }, delay || 600);
}
