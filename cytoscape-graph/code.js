// photos from flickr with creative commons license

var cy = window.cy = cytoscape({
    container: document.getElementById('cy'),
  
    boxSelectionEnabled: false,
    autounselectify: true,
  
    style: cytoscape.stylesheet()
      .selector('node')
        .css({
          'height': 80,
          'width': 80,
          'background-fit': 'cover',
          'background-color': '#00057D',
          'border-color': 'white',
          'border-width': 3,
          'color': 'white'
        })
      .selector('node[label]')
        .css({
            "label": "data(label)",
            'color': 'white',
            'font-size': 15,
            'text-max-width': '100px' // Added for text wrapping
        })
      
      .selector('edge')
        .css({
          'curve-style': 'bezier',
          'width': 4,
          'line-color': 'white',
          'target-arrow-color': 'white'
        })
      .selector('.top-right')
        .css({
          "text-valign": "center",
          "text-halign": "right",
          "text-wrap": "wrap",
          "text-margin-y": -22,
        })
      .selector('.center')
        .css({
          "text-valign": "center",
          "text-halign": "center",
          "text-wrap": "wrap",
          'shape': 'rectangle',
          'width':'150px',
          'background-color': '#3565DA',
          'border-color': '#3565DA'
        })
      .selector('node[image]')
        .css({
          'background-image': 'data(image)',
          'background-position': 'center',
          'color': 'white'
        })
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
          'opacity': 0.3
        }),
  
    elements: graphData,
  
    layout: {
      name: 'klay',
      directed: true,
      padding: 10,
      klay: {
        spacing: 120,
        fixedAlignment: "LEFTDOWN"
      }
    }
}); // cy init
  
  // Create tooltip div
  const tooltip = document.createElement('div');
  tooltip.classList.add('tooltip');
  document.body.appendChild(tooltip);

  // Add mouse events for tooltip
  cy.on('mouseover', 'node', function(e) {
    const node = e.target;
    const description = node.data('description');
    
    if (description) {
      tooltip.innerHTML = description;
      tooltip.style.display = 'block';
      
      // Position tooltip near mouse
      const renderedPosition = node.renderedPosition();
      const zoom = cy.zoom();
      const padding = 10;
      
      tooltip.style.left = (renderedPosition.x + padding) + 'px';
      tooltip.style.top = (renderedPosition.y + padding) + 'px';
    }
  });

  cy.on('mouseout', 'node', function() {
    tooltip.style.display = 'none';
  });

  // Update tooltip position on node drag
  cy.on('position', 'node', function(e) {
    if (tooltip.style.display === 'block') {
      const node = e.target;
      const renderedPosition = node.renderedPosition();
      const padding = 10;
      
      tooltip.style.left = (renderedPosition.x + padding) + 'px';
      tooltip.style.top = (renderedPosition.y + padding) + 'px';
    }
  });

  // Hide tooltip during pan/zoom
  cy.on('viewport', function() {
    tooltip.style.display = 'none';
  });

  const showPersonsBtn = document.getElementById('show-persons-btn');
  const personsDisplayContainer = document.getElementById('persons-display-container');
  const personsDisplayList = document.getElementById('persons-display-list');
  const closePersonsDisplayBtn = document.getElementById('close-persons-display-btn');

  showPersonsBtn.addEventListener('click', () => {
    populatePersonsDisplayList();
    personsDisplayContainer.style.display = 'block';
  });

  closePersonsDisplayBtn.addEventListener('click', () => {
    personsDisplayContainer.style.display = 'none';
    cy.elements().removeClass('highlighted-node highlighted-edge faded'); // Clear highlighting when closing
  });

  function populatePersonsDisplayList() {
    personsDisplayList.innerHTML = '';
    if (graphData.persons) {
      graphData.persons.forEach(person => {
        const listItem = document.createElement('li');
        listItem.classList.add('person-list-item');
        listItem.textContent = person.name;
        listItem.dataset.email = person.email; // Store email for lookup
        listItem.addEventListener('click', () => highlightPersonNodes(person.linkedNodes));
        personsDisplayList.appendChild(listItem);
      });
    }
  }

  function highlightPersonNodes(nodeIds) {
    cy.elements().removeClass('highlighted-node highlighted-edge faded');
    cy.elements().addClass('faded');

    nodeIds.forEach(nodeId => {
      const node = cy.$('#' + nodeId);
      if (node.length > 0) {
        node.removeClass('faded').addClass('highlighted-node');
      }
    });
  }

  cy.on('tap', 'node', function(evt) {
    const clickedNodeId = evt.target.id();
    
    // Clear previous node highlighting
    cy.elements().removeClass('highlighted-node faded');
    cy.elements().addClass('faded');
    evt.target.removeClass('faded').addClass('highlighted-node');

    // Clear previous person highlighting
    document.querySelectorAll('.person-list-item').forEach(item => {
      item.classList.remove('highlighted');
    });

    // Show persons display container if not already visible
    personsDisplayContainer.style.display = 'block';
    populatePersonsDisplayList(); // Re-populate to ensure all items are there

    // Highlight persons linked to the clicked node
    if (graphData.persons) {
      graphData.persons.forEach(person => {
        if (person.linkedNodes.includes(clickedNodeId)) {
          const personListItem = personsDisplayList.querySelector(`[data-email="${person.email}"]`);
          if (personListItem) {
            personListItem.classList.add('highlighted');
          }
        }
      });
    }
  });

  cy.on('tap', function(event) {
      if (event.target === cy) { // Clicked on background
          cy.elements().removeClass('highlighted-node faded');
          document.querySelectorAll('.person-list-item').forEach(item => {
            item.classList.remove('highlighted');
          });
      }
  });
