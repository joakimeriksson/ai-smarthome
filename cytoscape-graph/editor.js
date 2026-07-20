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

  var extraFieldsEl = document.getElementById('node-extra-fields');

  // --- Ontology-driven helpers ------------------------------------------------
  function ont() { return window.ontology || { nodeTypes: {}, edgeTypes: {}, stoneAttributes: {}, sensitivity: {} }; }

  function typeColor(type) {
    var nt = ont().nodeTypes;
    return (nt[type] && nt[type].color) || '#666';
  }

  // Populate the node-type and edge-type dropdowns from the ontology (once).
  function buildTypeDropdowns() {
    var o = ont();
    if (nodeTypeSelect.options.length === 0) {
      Object.keys(o.nodeTypes).forEach(function(type) {
        var opt = document.createElement('option');
        opt.value = type;
        opt.textContent = o.nodeTypes[type].label || type;
        nodeTypeSelect.appendChild(opt);
      });
    }
    if (edgeTypeSelect.options.length === 0) {
      Object.keys(o.edgeTypes).forEach(function(type) {
        var opt = document.createElement('option');
        opt.value = type;
        opt.textContent = o.edgeTypes[type].label || type;
        edgeTypeSelect.appendChild(opt);
      });
    }
  }

  function makeSelect(id, values, labels, includeBlank) {
    var sel = document.createElement('select');
    sel.id = id;
    if (includeBlank !== false) {
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = '—';
      sel.appendChild(blank);
    }
    values.forEach(function(v, i) {
      var o = document.createElement('option');
      o.value = v; o.textContent = labels ? labels[i] : v;
      sel.appendChild(o);
    });
    return sel;
  }

  function makeField(fieldKey, labelText, inputEl) {
    var wrap = document.createElement('div');
    wrap.className = 'editor-field';
    wrap.dataset.field = fieldKey;
    var lab = document.createElement('label');
    lab.textContent = labelText;
    wrap.appendChild(lab);
    wrap.appendChild(inputEl);
    return wrap;
  }

  // Build the kind + stepping-stone + sensitivity fields from the ontology.
  // Rebuilt each time the editor opens so node_ref (owner) options stay fresh.
  function buildExtraFields() {
    var o = ont();
    if (!extraFieldsEl) return;
    extraFieldsEl.innerHTML = '';

    // Kind (topic only).
    var kinds = (o.nodeTypes.topic && o.nodeTypes.topic.kinds) || {};
    var kindVals = Object.keys(kinds);
    var kindSel = makeSelect('node-kind', kindVals, kindVals.map(function(k) { return kinds[k].label; }));
    kindSel.addEventListener('change', updateExtraFieldVisibility);
    extraFieldsEl.appendChild(makeField('node-kind', 'Kind (topic)', kindSel));

    // Stepping-stone attributes.
    var sa = o.stoneAttributes || {};
    Object.keys(sa).forEach(function(key) {
      var def = sa[key], input;
      if (def.enum) {
        input = makeSelect('node-attr-' + key, def.enum);
      } else if (def.type === 'integer') {
        input = document.createElement('input');
        input.type = 'number'; input.id = 'node-attr-' + key;
        if (def.min != null) input.min = def.min;
        if (def.max != null) input.max = def.max;
      } else if (def.type === 'node_ref') {
        var refTypes = def.refTypes || [];
        var refs = (currentGraphData ? currentGraphData.nodes : []).filter(function(n) {
          return refTypes.indexOf(n.data.type) >= 0;
        });
        input = makeSelect('node-attr-' + key,
          refs.map(function(n) { return n.data.id; }),
          refs.map(function(n) { return (n.data.label || n.data.id).replace(/\n/g, ' '); }));
      } else {
        input = document.createElement('input');
        input.type = 'text'; input.id = 'node-attr-' + key;
      }
      extraFieldsEl.appendChild(makeField('node-attr-' + key, def.label || key, input));
    });

    // Sensitivity (every node).
    var sens = o.sensitivity || {};
    var sensSel = makeSelect('node-sensitivity', sens.enum || [], null, false);
    sensSel.value = sens.default || '';
    extraFieldsEl.appendChild(makeField('node-sensitivity', sens.label || 'Sensitivity', sensSel));

    updateExtraFieldVisibility();
  }

  // Kind shows for topics; stone attributes show for kind=stone; sensitivity always.
  function updateExtraFieldVisibility() {
    if (!extraFieldsEl) return;
    var isTopic = nodeTypeSelect.value === 'topic';
    var kindSel = document.getElementById('node-kind');
    var isStone = isTopic && (!kindSel || !kindSel.value || kindSel.value === 'stone');
    extraFieldsEl.querySelectorAll('.editor-field').forEach(function(f) {
      var key = f.dataset.field;
      if (key === 'node-kind') f.style.display = isTopic ? 'block' : 'none';
      else if (key.indexOf('node-attr-') === 0) f.style.display = isStone ? 'block' : 'none';
      else f.style.display = 'block';
    });
  }

  // Read the extra fields into a node data object (delete blanks).
  function applyExtraFields(data) {
    var o = ont();
    if (nodeTypeSelect.value === 'topic') {
      var kindSel = document.getElementById('node-kind');
      data.kind = (kindSel && kindSel.value) || 'stone';
      var sa = o.stoneAttributes || {};
      Object.keys(sa).forEach(function(key) {
        var el = document.getElementById('node-attr-' + key);
        var v = el ? el.value : '';
        if (v === '') { delete data[key]; return; }
        if (sa[key].type === 'integer') v = parseInt(v, 10);
        data[key] = v;
      });
    } else {
      delete data.kind;
    }
    var sensEl = document.getElementById('node-sensitivity');
    if (sensEl) data.sensitivity = sensEl.value || (o.sensitivity && o.sensitivity.default) || 'internal';
  }

  // Set the extra fields from a node data object.
  function populateExtraFields(data) {
    var o = ont();
    var kindSel = document.getElementById('node-kind');
    if (kindSel) kindSel.value = data.kind || '';
    var sa = o.stoneAttributes || {};
    Object.keys(sa).forEach(function(key) {
      var el = document.getElementById('node-attr-' + key);
      if (el) el.value = (data[key] != null ? data[key] : '');
    });
    var sensEl = document.getElementById('node-sensitivity');
    if (sensEl) sensEl.value = data.sensitivity || (o.sensitivity && o.sensitivity.default) || 'internal';
    updateExtraFieldVisibility();
  }

  // stampProvenance() is provided globally by code.js and shared here.

  nodeTypeSelect.addEventListener('change', updateExtraFieldVisibility);

  editGraphBtn.addEventListener('click', function() {
    currentGraphData = JSON.parse(JSON.stringify(graphData));
    buildTypeDropdowns();
    buildExtraFields();
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

    applyExtraFields(newNode.data);
    stampProvenance(newNode.data);

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
      var nd = currentGraphData.nodes[nodeIndex].data;
      nd.label = nodeLabelInput.value;
      nd.description = nodeDescriptionInput.value;
      nd.type = nodeTypeSelect.value;
      nd.image = nodeImageSelect.value || undefined;
      applyExtraFields(nd);
      stampProvenance(nd);
    }
    populateEditor();
    clearNodeInputs();
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    selectedNodeId = null;
  });

  addEdgeBtn.addEventListener('click', function() {
    var edgeData = {
      source: edgeSourceSelect.value,
      target: edgeTargetSelect.value,
      type: edgeTypeSelect.value
    };
    stampProvenance(edgeData);
    currentGraphData.edges.push({ data: edgeData });
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
      badge.style.backgroundColor = typeColor(node.data.type);
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
      populateExtraFields(node.data);
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
    populateExtraFields({});
    addNodeBtn.textContent = 'Add Node';
  }
});
