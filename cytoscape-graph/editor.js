document.addEventListener('DOMContentLoaded', () => {
  const editGraphBtn = document.getElementById('edit-graph-btn');
  const editorContainer = document.getElementById('editor-container');
  const closeEditorBtn = document.getElementById('close-editor-btn');
  const saveEditorBtn = document.getElementById('save-editor-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');

  const nodesList = document.getElementById('nodes-list');
  const edgesList = document.getElementById('edges-list');

  const nodeIdInput = document.getElementById('node-id');
  const nodeLabelInput = document.getElementById('node-label');
  const nodeDescriptionInput = document.getElementById('node-description');
  const nodeImageSelect = document.getElementById('node-image');
  const addNodeBtn = document.getElementById('add-node-btn');
  const updateNodeBtn = document.getElementById('update-node-btn');

  const edgeSourceSelect = document.getElementById('edge-source');
  const edgeTargetSelect = document.getElementById('edge-target');
  const addEdgeBtn = document.getElementById('add-edge-btn');

  const personsList = document.getElementById('persons-list');
  const personNameInput = document.getElementById('person-name');
  const personEmailInput = document.getElementById('person-email');
  const personLinkedNodesSelect = document.getElementById('person-linked-nodes');
  const addPersonBtn = document.getElementById('add-person-btn');
  const updatePersonBtn = document.getElementById('update-person-btn');

  let currentGraphData;
  let insertMode = false;
  let insertSource = null;
  let insertTarget = null;
  let selectedNodeId = null; // To keep track of the node being edited
  let selectedPersonEmail = null; // To keep track of the person being edited

  editGraphBtn.addEventListener('click', () => {
    currentGraphData = JSON.parse(JSON.stringify(graphData));
    console.log('Opening editor. Initial graphData:', graphData);
    console.log('Opening editor. currentGraphData (copy):', currentGraphData);
    populateEditor();
    fetchImages();
    editorContainer.style.display = 'block';
    insertMode = false;
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    clearNodeInputs();
    addPersonBtn.style.display = 'inline-block';
    updatePersonBtn.style.display = 'none';
    clearPersonInputs();
  });

  document.addEventListener('insertNode', (event) => {
    currentGraphData = JSON.parse(JSON.stringify(graphData));
    populateEditor();
    fetchImages();
    editorContainer.style.display = 'block';
    insertMode = true;
    insertSource = event.detail.source;
    insertTarget = event.detail.target;
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    addNodeBtn.textContent = `Insert Node between ${insertSource} and ${insertTarget}`;
    nodeIdInput.value = `${insertSource}-${insertTarget}-new`; // Suggest an ID
    nodeLabelInput.value = `New Node`;
  });

  closeEditorBtn.addEventListener('click', () => {
    editorContainer.style.display = 'none';
    insertMode = false;
    insertSource = null;
    insertTarget = null;
    clearNodeInputs();
    clearPersonInputs();
  });

  saveEditorBtn.addEventListener('click', () => {
    console.log('Saving changes. currentGraphData before save:', currentGraphData);
    graphData = JSON.parse(JSON.stringify(currentGraphData)); // Deep copy to ensure no lingering references
    console.log('graphData after assignment:', graphData);
    window.cy.elements().remove();
    window.cy.add(graphData.nodes);
    window.cy.add(graphData.edges);
    window.cy.layout({ name: 'klay', directed: true, padding: 10, klay: { spacing: 120, fixedAlignment: "LEFTDOWN" } }).run();
    console.log('Graph re-rendered with new data.');
    editorContainer.style.display = 'none';
    insertMode = false;
    insertSource = null;
    insertTarget = null;
    clearNodeInputs();
    clearPersonInputs();
  });

  exportJsonBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent("let graphData = " + JSON.stringify(currentGraphData, null, 2) + ";");
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "data.js");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  });

  addNodeBtn.addEventListener('click', () => {
    const newNode = {
      data: {
        id: nodeIdInput.value,
        label: nodeLabelInput.value,
        description: nodeDescriptionInput.value,
        image: nodeImageSelect.value || undefined
      },
      classes: 'top-right'
    };

    if (insertMode) {
      // Remove the old edge
      currentGraphData.edges = currentGraphData.edges.filter(edge => 
        !(edge.data.source === insertSource && edge.data.target === insertTarget)
      );
      // Add two new edges
      currentGraphData.edges.push({ data: { source: insertSource, target: newNode.data.id } });
      currentGraphData.edges.push({ data: { source: newNode.data.id, target: insertTarget } });
      insertMode = false;
      insertSource = null;
      insertTarget = null;
      addNodeBtn.textContent = 'Add Node';
    }

    currentGraphData.nodes.push(newNode);
    populateEditor();
    clearNodeInputs();
  });

  updateNodeBtn.addEventListener('click', () => {
    const nodeIndex = currentGraphData.nodes.findIndex(node => node.data.id === selectedNodeId);
    if (nodeIndex !== -1) {
      currentGraphData.nodes[nodeIndex].data.label = nodeLabelInput.value;
      currentGraphData.nodes[nodeIndex].data.description = nodeDescriptionInput.value;
      currentGraphData.nodes[nodeIndex].data.image = nodeImageSelect.value || undefined;
    }
    populateEditor();
    clearNodeInputs();
    addNodeBtn.style.display = 'inline-block';
    updateNodeBtn.style.display = 'none';
    selectedNodeId = null;
  });

  addEdgeBtn.addEventListener('click', () => {
    const newEdge = {
      data: {
        source: edgeSourceSelect.value,
        target: edgeTargetSelect.value
      }
    };
    currentGraphData.edges.push(newEdge);
    populateEditor();
  });

  addPersonBtn.addEventListener('click', () => {
    const newPerson = {
      name: personNameInput.value,
      email: personEmailInput.value,
      linkedNodes: Array.from(personLinkedNodesSelect.selectedOptions).map(option => option.value)
    };

    // Basic validation for unique email
    if (currentGraphData.persons.some(p => p.email === newPerson.email)) {
      alert('Person with this email already exists!');
      return;
    }

    currentGraphData.persons.push(newPerson);
    populateEditor();
    clearPersonInputs();
  });

  updatePersonBtn.addEventListener('click', () => {
    const personIndex = currentGraphData.persons.findIndex(p => p.email === selectedPersonEmail);
    if (personIndex !== -1) {
      currentGraphData.persons[personIndex].name = personNameInput.value;
      currentGraphData.persons[personIndex].linkedNodes = Array.from(personLinkedNodesSelect.selectedOptions).map(option => option.value);
    }
    populateEditor();
    clearPersonInputs();
    addPersonBtn.style.display = 'inline-block';
    updatePersonBtn.style.display = 'none';
    selectedPersonEmail = null;
  });

  function populateEditor() {
    nodesList.innerHTML = '';
    edgeSourceSelect.innerHTML = '';
    edgeTargetSelect.innerHTML = '';
    personLinkedNodesSelect.innerHTML = '';

    currentGraphData.nodes.forEach(node => {
      const nodeDiv = document.createElement('div');
      nodeDiv.classList.add('editor-item');
      nodeDiv.textContent = `ID: ${node.data.id}, Label: ${node.data.label}`;
      nodeDiv.dataset.nodeId = node.data.id; // Store ID for easy access

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => editNode(node.data.id));
      nodeDiv.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deleteNode(node.data.id));
      nodeDiv.appendChild(deleteBtn);

      nodesList.appendChild(nodeDiv);

      const option = document.createElement('option');
      option.value = node.data.id;
      option.textContent = node.data.label;
      edgeSourceSelect.appendChild(option.cloneNode(true));
      edgeTargetSelect.appendChild(option.cloneNode(true));
      personLinkedNodesSelect.appendChild(option);
    });

    edgesList.innerHTML = '';
    currentGraphData.edges.forEach(edge => {
      const edgeDiv = document.createElement('div');
      edgeDiv.classList.add('editor-item');
      edgeDiv.textContent = `${edge.data.source} -> ${edge.data.target}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deleteEdge(edge.data.source, edge.data.target));
      edgeDiv.appendChild(deleteBtn);

      edgesList.appendChild(edgeDiv);
    });

    populatePersonsList();
  }

  function populatePersonsList() {
    personsList.innerHTML = '';
    currentGraphData.persons.forEach(person => {
      const personDiv = document.createElement('div');
      personDiv.classList.add('editor-item');
      personDiv.textContent = `Name: ${person.name}, Email: ${person.email} (Nodes: ${person.linkedNodes.join(', ')})`;

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => editPerson(person.email));
      personDiv.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => deletePerson(person.email));
      personDiv.appendChild(deleteBtn);

      personsList.appendChild(personDiv);
    });
  }

  function editNode(nodeId) {
    const node = currentGraphData.nodes.find(n => n.data.id === nodeId);
    if (node) {
      nodeIdInput.value = node.data.id;
      nodeLabelInput.value = node.data.label;
      nodeDescriptionInput.value = node.data.description;
      nodeImageSelect.value = node.data.image || '';
      selectedNodeId = nodeId;
      addNodeBtn.style.display = 'none';
      updateNodeBtn.style.display = 'inline-block';
    }
  }

  function deleteNode(nodeId) {
    currentGraphData.nodes = currentGraphData.nodes.filter(node => node.data.id !== nodeId);
    currentGraphData.edges = currentGraphData.edges.filter(edge => 
      edge.data.source !== nodeId && edge.data.target !== nodeId
    );
    // Also remove this node from any linked persons
    currentGraphData.persons.forEach(person => {
      person.linkedNodes = person.linkedNodes.filter(id => id !== nodeId);
    });
    populateEditor();
    clearNodeInputs();
  }

  function deleteEdge(sourceId, targetId) {
    currentGraphData.edges = currentGraphData.edges.filter(edge => 
      !(edge.data.source === sourceId && edge.data.target === targetId)
    );
    populateEditor();
  }

  function editPerson(email) {
    const person = currentGraphData.persons.find(p => p.email === email);
    if (person) {
      personNameInput.value = person.name;
      personEmailInput.value = person.email;
      personEmailInput.disabled = true; // Email is unique ID, prevent editing
      
      // Select linked nodes
      Array.from(personLinkedNodesSelect.options).forEach(option => {
        option.selected = person.linkedNodes.includes(option.value);
      });

      selectedPersonEmail = email;
      addPersonBtn.style.display = 'none';
      updatePersonBtn.style.display = 'inline-block';
    }
  }

  function deletePerson(email) {
    currentGraphData.persons = currentGraphData.persons.filter(person => person.email !== email);
    populateEditor();
    clearPersonInputs();
  }

  function fetchImages() {
    fetch('/api/images')
      .then(response => response.json())
      .then(images => {
        nodeImageSelect.innerHTML = '<option value="">No Image</option>';
        images.forEach(image => {
          const option = document.createElement('option');
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
    nodeImageSelect.selectedIndex = 0;
    addNodeBtn.textContent = 'Add Node';
  }

  function clearPersonInputs() {
    personNameInput.value = '';
    personEmailInput.value = '';
    personEmailInput.disabled = false;
    Array.from(personLinkedNodesSelect.options).forEach(option => {
      option.selected = false;
    });
    addPersonBtn.textContent = 'Add Person';
  }
});
