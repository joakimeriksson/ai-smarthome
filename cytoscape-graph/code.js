var graphData = null;
var cy = null;
var currentView = null;

fetch('/api/data')
  .then(response => response.json())
  .then(data => {
    graphData = data;
    initGraph();
  });

function getNodeStyle() {
  return cytoscape.stylesheet()
    // Base node
    .selector('node')
      .css({
        'height': 80,
        'width': 80,
        'background-color': '#00057D',
        'border-color': 'white',
        'border-width': 3,
        'color': 'white',
        'label': 'data(label)',
        'font-size': 13,
        'text-max-width': '110px',
        'text-wrap': 'wrap',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 5
      })
    // Topic nodes — circle with icon (original look)
    .selector('node[type="topic"]')
      .css({
        'shape': 'ellipse',
        'background-color': '#00057D',
        'border-color': 'white'
      })
    .selector('node[type="topic"][image]')
      .css({
        'background-image': 'data(image)',
        'background-fit': 'cover',
        'background-clip': 'node'
      })
    // Researcher nodes — rounded rectangle, green
    .selector('node[type="researcher"]')
      .css({
        'shape': 'round-rectangle',
        'background-color': '#2ecc71',
        'border-color': '#27ae60',
        'width': 90,
        'height': 60,
        'font-size': 12,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'text-margin-x': 0,
        'color': 'white'
      })
    // Group nodes — larger rounded rectangle, orange
    .selector('node[type="group"]')
      .css({
        'shape': 'round-rectangle',
        'background-color': '#e67e22',
        'border-color': '#d35400',
        'width': 130,
        'height': 70,
        'font-size': 13,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'text-margin-x': 0,
        'color': 'white'
      })
    // Project nodes — hexagon, purple
    .selector('node[type="project"]')
      .css({
        'shape': 'hexagon',
        'background-color': '#9b59b6',
        'border-color': '#8e44ad',
        'width': 90,
        'height': 90,
        'font-size': 12,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'text-margin-x': 0,
        'color': 'white'
      })
    // Publication nodes — diamond, red
    .selector('node[type="publication"]')
      .css({
        'shape': 'diamond',
        'background-color': '#e74c3c',
        'border-color': '#c0392b',
        'width': 90,
        'height': 90,
        'font-size': 11,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-margin-y': 0,
        'text-margin-x': 0,
        'color': 'white'
      })
    // Topic center variant
    .selector('.center')
      .css({
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'shape': 'rectangle',
        'width': '150px',
        'background-color': '#3565DA',
        'border-color': '#3565DA',
        'text-margin-y': 0,
        'text-margin-x': 0
      })
    // Edges
    .selector('edge')
      .css({
        'curve-style': 'bezier',
        'width': 3,
        'line-color': 'rgba(255,255,255,0.6)',
        'target-arrow-color': 'rgba(255,255,255,0.6)',
        'target-arrow-shape': 'triangle'
      })
    .selector('edge[type="journey"]')
      .css({
        'width': 4,
        'line-color': 'white',
        'target-arrow-color': 'white'
      })
    .selector('edge[type="works_on"]')
      .css({
        'line-color': '#2ecc71',
        'target-arrow-color': '#2ecc71',
        'line-style': 'solid'
      })
    .selector('edge[type="member_of"]')
      .css({
        'line-color': '#e67e22',
        'target-arrow-color': '#e67e22'
      })
    .selector('edge[type="leads"]')
      .css({
        'line-color': '#f1c40f',
        'target-arrow-color': '#f1c40f',
        'width': 4
      })
    .selector('edge[type="participates"]')
      .css({
        'line-color': '#9b59b6',
        'target-arrow-color': '#9b59b6',
        'line-style': 'dashed'
      })
    .selector('edge[type="related_to"]')
      .css({
        'line-color': 'rgba(255,255,255,0.3)',
        'target-arrow-color': 'rgba(255,255,255,0.3)',
        'line-style': 'dotted'
      })
    .selector('edge[type="authored"]')
      .css({
        'line-color': '#e74c3c',
        'target-arrow-color': '#e74c3c'
      })
    // Interaction states
    .selector('.highlighted-node')
      .css({
        'border-color': 'yellow',
        'border-width': 5
      })
    .selector('.highlighted-edge')
      .css({
        'line-color': 'yellow',
        'target-arrow-color': 'yellow',
        'width': 6
      })
    .selector('.faded')
      .css({
        'opacity': 0.15
      })
    .selector('.person-linked')
      .css({
        'border-color': '#5cb85c',
        'border-width': 5
      })
    .selector('.person-unlinked')
      .css({
        'opacity': 0.5
      })
    .selector('.neighbor-highlight')
      .css({
        'opacity': 1
      });
}

function getFilteredElements(view) {
  var nodes = graphData.nodes.filter(function(n) {
    return view.nodeTypes.indexOf(n.data.type) >= 0;
  });
  var nodeIds = nodes.map(function(n) { return n.data.id; });
  var edges = graphData.edges.filter(function(e) {
    return view.edgeTypes.indexOf(e.data.type) >= 0 &&
           nodeIds.indexOf(e.data.source) >= 0 &&
           nodeIds.indexOf(e.data.target) >= 0;
  });
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

function switchView(viewId) {
  var view = graphData.views.find(function(v) { return v.id === viewId; });
  if (!view) return;
  currentView = view;
  var elements = getFilteredElements(view);
  cy.elements().remove();
  cy.add(elements.nodes);
  cy.add(elements.edges);
  cy.layout(getLayout(view)).run();
  cy.fit(undefined, 40);

  // Update legend visibility
  var legendItems = document.querySelectorAll('.legend-item');
  legendItems.forEach(function(item) {
    var type = item.dataset.type;
    if (type && view.nodeTypes.indexOf(type) >= 0) {
      item.style.display = 'flex';
    } else if (type) {
      item.style.display = 'none';
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

  // Set legend data-type attributes
  var legendItems = document.querySelectorAll('.legend-item');
  var typeNames = ['topic', 'researcher', 'group', 'project', 'publication'];
  legendItems.forEach(function(item, i) {
    if (i < typeNames.length) item.dataset.type = typeNames[i];
  });

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
  });

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
  var metaHtml = '';
  if (node.data('title')) metaHtml += '<div><strong>Title:</strong> ' + escapeHtml(node.data('title')) + '</div>';
  if (node.data('email')) metaHtml += '<div><strong>Email:</strong> ' + escapeHtml(node.data('email')) + '</div>';
  if (node.data('year')) metaHtml += '<div><strong>Year:</strong> ' + node.data('year') + '</div>';
  if (node.data('venue')) metaHtml += '<div><strong>Venue:</strong> ' + escapeHtml(node.data('venue')) + '</div>';
  if (node.data('funder')) metaHtml += '<div><strong>Funder:</strong> ' + escapeHtml(node.data('funder')) + '</div>';
  if (node.data('startYear')) metaHtml += '<div><strong>Period:</strong> ' + node.data('startYear') + ' - ' + node.data('endYear') + '</div>';
  meta.innerHTML = metaHtml;

  // Connections from full data (not just visible view)
  var nodeId = node.id();
  var connList = [];
  graphData.edges.forEach(function(e) {
    if (e.data.source === nodeId) {
      var targetNode = graphData.nodes.find(function(n) { return n.data.id === e.data.target; });
      if (targetNode) {
        connList.push({ type: e.data.type, label: targetNode.data.label.replace(/\n/g, ' '), id: targetNode.data.id, nodeType: targetNode.data.type });
      }
    }
    if (e.data.target === nodeId) {
      var sourceNode = graphData.nodes.find(function(n) { return n.data.id === e.data.source; });
      if (sourceNode) {
        connList.push({ type: e.data.type, label: sourceNode.data.label.replace(/\n/g, ' '), id: sourceNode.data.id, nodeType: sourceNode.data.type });
      }
    }
  });

  // Group connections by edge type
  var grouped = {};
  connList.forEach(function(c) {
    var key = formatEdgeType(c.type);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  });

  var connHtml = '';
  Object.keys(grouped).forEach(function(key) {
    connHtml += '<div class="conn-group"><strong>' + key + ':</strong>';
    grouped[key].forEach(function(c) {
      connHtml += '<span class="conn-tag type-' + c.nodeType + '" data-id="' + c.id + '">' + escapeHtml(c.label) + '</span>';
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

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
      graphData.edges.push({ data: { source: linkModePerson.data.id, target: clickedNodeId, type: 'works_on' } });
    }
    updateLinkModeHighlights();
    persistData();
  };
}

function persistData() {
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(graphData)
  }).then(function(res) {
    if (!res.ok) console.error('Failed to save data');
  });
}
