document.addEventListener('DOMContentLoaded', function() {
  var editGraphBtn = document.getElementById('edit-graph-btn');
  var editorContainer = document.getElementById('editor-container');
  var closeEditorBtn = document.getElementById('close-editor-btn');
  var saveEditorBtn = document.getElementById('save-editor-btn');
  var exportJsonBtn = document.getElementById('export-json-btn');

  var nodesList = document.getElementById('nodes-list');
  var edgesList = document.getElementById('edges-list');

  var nodeIdInput = document.getElementById('node-id');
  var nodeLabelInput = document.getElementById('node-label');
  var nodeDescriptionInput = document.getElementById('node-description');
  var nodeTypeSelect = document.getElementById('node-type');
  var nodeImageSelect = document.getElementById('node-image');
  var addNodeBtn = document.getElementById('add-node-btn');
  var updateNodeBtn = document.getElementById('update-node-btn');

  var edgeSourceSelect = document.getElementById('edge-source');
  var edgeTargetSelect = document.getElementById('edge-target');
  var edgeTypeSelect = document.getElementById('edge-type');
  var addEdgeBtn = document.getElementById('add-edge-btn');

  var currentGraphData;
  var insertMode = false;
  var insertSource = null;
  var insertTarget = null;
  var selectedNodeId = null;

  var typeBgColors = {
    topic: '#00057D',
    researcher: '#2ecc71',
    group: '#e67e22',
    project: '#9b59b6',
    publication: '#e74c3c'
  };

  editGraphBtn.addEventListener('click', function() {
    currentGraphData = JSON.parse(JSON.stringify(graphData));
    populateEditor();
    fetchImages();
    editorContainer.style.display = 'block';
    insertMode = false;
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    clearNodeInputs();
  });

  closeEditorBtn.addEventListener('click', function() {
    editorContainer.style.display = 'none';
    insertMode = false;
    clearNodeInputs();
  });

  saveEditorBtn.addEventListener('click', function() {
    graphData = JSON.parse(JSON.stringify(currentGraphData));

    // Re-render current view
    if (currentView) {
      switchView(currentView.id);
    }

    persistData();
    editorContainer.style.display = 'none';
    insertMode = false;
    clearNodeInputs();
  });

  exportJsonBtn.addEventListener('click', function() {
    var dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(currentGraphData, null, 2));
    var a = document.createElement('a');
    a.setAttribute('href', dataStr);
    a.setAttribute('download', 'data.json');
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  addNodeBtn.addEventListener('click', function() {
    var newNode = {
      data: {
        id: nodeIdInput.value,
        type: nodeTypeSelect.value,
        label: nodeLabelInput.value,
        description: nodeDescriptionInput.value,
        image: nodeImageSelect.value || undefined
      }
    };

    if (nodeTypeSelect.value === 'topic') {
      newNode.classes = 'top-right';
    }

    if (insertMode) {
      currentGraphData.edges = currentGraphData.edges.filter(function(edge) {
        return !(edge.data.source === insertSource && edge.data.target === insertTarget);
      });
      currentGraphData.edges.push({ data: { source: insertSource, target: newNode.data.id, type: 'journey' } });
      currentGraphData.edges.push({ data: { source: newNode.data.id, target: insertTarget, type: 'journey' } });
      insertMode = false;
      insertSource = null;
      insertTarget = null;
      addNodeBtn.textContent = 'Add Node';
    }

    currentGraphData.nodes.push(newNode);
    populateEditor();
    clearNodeInputs();
  });

  updateNodeBtn.addEventListener('click', function() {
    var nodeIndex = currentGraphData.nodes.findIndex(function(n) { return n.data.id === selectedNodeId; });
    if (nodeIndex !== -1) {
      currentGraphData.nodes[nodeIndex].data.label = nodeLabelInput.value;
      currentGraphData.nodes[nodeIndex].data.description = nodeDescriptionInput.value;
      currentGraphData.nodes[nodeIndex].data.type = nodeTypeSelect.value;
      currentGraphData.nodes[nodeIndex].data.image = nodeImageSelect.value || undefined;
    }
    populateEditor();
    clearNodeInputs();
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    selectedNodeId = null;
  });

  addEdgeBtn.addEventListener('click', function() {
    currentGraphData.edges.push({
      data: {
        source: edgeSourceSelect.value,
        target: edgeTargetSelect.value,
        type: edgeTypeSelect.value
      }
    });
    populateEditor();
  });

  function populateEditor() {
    nodesList.innerHTML = '';
    edgeSourceSelect.innerHTML = '';
    edgeTargetSelect.innerHTML = '';

    // Sort nodes by type then label
    var sortedNodes = currentGraphData.nodes.slice().sort(function(a, b) {
      if (a.data.type !== b.data.type) return a.data.type.localeCompare(b.data.type);
      return (a.data.label || '').localeCompare(b.data.label || '');
    });

    sortedNodes.forEach(function(node) {
      var nodeDiv = document.createElement('div');
      nodeDiv.classList.add('editor-item');

      var badge = document.createElement('span');
      badge.classList.add('editor-type-badge');
      badge.style.backgroundColor = typeBgColors[node.data.type] || '#666';
      badge.textContent = node.data.type;

      var text = document.createTextNode(' ' + (node.data.label || node.data.id).replace(/\n/g, ' '));

      var leftSpan = document.createElement('span');
      leftSpan.appendChild(badge);
      leftSpan.appendChild(text);
      nodeDiv.appendChild(leftSpan);

      var btnWrap = document.createElement('span');

      var editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', function() { editNode(node.data.id); });
      btnWrap.appendChild(editBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function() { deleteNode(node.data.id); });
      btnWrap.appendChild(deleteBtn);

      nodeDiv.appendChild(btnWrap);
      nodesList.appendChild(nodeDiv);
    });

    // Populate source/target selects
    currentGraphData.nodes.forEach(function(node) {
      var label = (node.data.label || node.data.id).replace(/\n/g, ' ');
      var optText = '[' + node.data.type + '] ' + label;

      var opt1 = document.createElement('option');
      opt1.value = node.data.id;
      opt1.textContent = optText;
      edgeSourceSelect.appendChild(opt1);

      var opt2 = document.createElement('option');
      opt2.value = node.data.id;
      opt2.textContent = optText;
      edgeTargetSelect.appendChild(opt2);
    });

    edgesList.innerHTML = '';
    currentGraphData.edges.forEach(function(edge) {
      var edgeDiv = document.createElement('div');
      edgeDiv.classList.add('editor-item');

      var text = document.createTextNode(edge.data.source + ' --[' + edge.data.type + ']--> ' + edge.data.target);
      var leftSpan = document.createElement('span');
      leftSpan.appendChild(text);
      edgeDiv.appendChild(leftSpan);

      var deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function() { deleteEdge(edge.data.source, edge.data.target, edge.data.type); });
      edgeDiv.appendChild(deleteBtn);

      edgesList.appendChild(edgeDiv);
    });
  }

  function editNode(nodeId) {
    var node = currentGraphData.nodes.find(function(n) { return n.data.id === nodeId; });
    if (node) {
      nodeIdInput.value = node.data.id;
      nodeLabelInput.value = node.data.label;
      nodeDescriptionInput.value = node.data.description || '';
      nodeTypeSelect.value = node.data.type || 'topic';
      nodeImageSelect.value = node.data.image || '';
      selectedNodeId = nodeId;
      addNodeBtn.style.display = 'none';
      updateNodeBtn.style.display = 'inline-block';
    }
  }

  function deleteNode(nodeId) {
    currentGraphData.nodes = currentGraphData.nodes.filter(function(n) { return n.data.id !== nodeId; });
    currentGraphData.edges = currentGraphData.edges.filter(function(e) {
      return e.data.source !== nodeId && e.data.target !== nodeId;
    });
    populateEditor();
    clearNodeInputs();
  }

  function deleteEdge(sourceId, targetId, type) {
    var idx = currentGraphData.edges.findIndex(function(e) {
      return e.data.source === sourceId && e.data.target === targetId && e.data.type === type;
    });
    if (idx >= 0) currentGraphData.edges.splice(idx, 1);
    populateEditor();
  }

  function fetchImages() {
    fetch('/api/images')
      .then(function(response) { return response.json(); })
      .then(function(images) {
        nodeImageSelect.innerHTML = '<option value="">No Image</option>';
        images.forEach(function(image) {
          var option = document.createElement('option');
          option.value = image;
          option.textContent = image.split('/').pop();
          nodeImageSelect.appendChild(option);
        });
      });
  }

  function clearNodeInputs() {
    nodeIdInput.value = '';
    nodeLabelInput.value = '';
    nodeDescriptionInput.value = '';
    nodeTypeSelect.value = 'topic';
    nodeImageSelect.selectedIndex = 0;
    addNodeBtn.textContent = 'Add Node';
  }
});
