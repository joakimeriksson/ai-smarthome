// photos from flickr with creative commons license

var cy = cytoscape({
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
        })
      .selector('node[label]')
        .css({
            "label": "data(label)",
            'color': 'white',
            'font-size': 15
        })
      .selector('.eater')
        .css({
          'border-width': 9
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
          'background-image': 'data(image)'
        }),
  
    elements: graphData,
  
    layout: {
      name: 'klay',
      directed: true,
      padding: 10,
      klay: {spacing: 120}
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
