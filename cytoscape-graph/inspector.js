// inspector.js — the details panel on the right.
//
// One place to read AND change a stone: horizon, status, readiness, who works
// on it, what it connects to, the literature behind it and our own evidence.
// It is editable while "Edit journeys" is on and read-only otherwise, so a
// presentation can't be changed by a stray click. Every change goes through
// Edit.commit, so it is one undo step and saved immediately.
//
// Depends on globals from code.js and (optionally) editing.js.

(function () {
  'use strict';

  var panel = null, currentId = null;

  var VALUE_LABELS = {
    now: 'Now', next: 'Next', beyond: 'Beyond',
    aspiration: 'Aspiration', in_progress: 'In progress', achieved: 'Achieved', parked: 'Parked',
    high: 'High', medium: 'Medium', low: 'Low',
    core: 'Core', watch: 'Watch', optional: 'Optional'
  };
  var ATTR_HELP = {
    horizon: 'When this capability should exist.',
    trl: 'Technology readiness, 1 (idea) to 9 (proven in use).'
  };

  function editable() { return !!(window.Edit && Edit.active) && !window.PUBLIC_BUILD; }
  function data(id) { var n = nodeById(id); return n && n.data; }
  function label(id) { return nodeLabelById(id); }
  function quote(s) { return '“' + s + '”'; }
  function valueLabel(v) {
    return VALUE_LABELS[v] || String(v).replace(/_/g, ' ').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }
  function typeColor(type) { var t = ontology.nodeTypes[type]; return t ? t.color : '#6B7489'; }
  function formatDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function edgesOf(id, type, dir) {
    return graphData.edges.filter(function (e) {
      return e.data.type === type && (dir === 'in' ? e.data.target === id : e.data.source === id);
    }).map(function (e) { return dir === 'in' ? e.data.source : e.data.target; })
      .filter(function (x) { return !!nodeById(x); });
  }

  // ---- building blocks -----------------------------------------------------

  function section(title, count, inner) {
    var c = count != null ? ' <span class="count">' + count + '</span>' : '';
    return '<section class="insp-section"><h3>' + escapeHtml(title) + c + '</h3>' + inner + '</section>';
  }

  function seg(attr, values, current, opts) {
    opts = opts || {};
    var dis = editable() ? '' : ' disabled';
    var buttons = values.map(function (v) {
      var on = String(current) === String(v);
      return '<button type="button" role="radio" aria-checked="' + on + '" data-attr="' + attr +
        '" data-value="' + escapeHtml(v) + '"' + dis + '>' + escapeHtml(opts.raw ? v : valueLabel(v)) + '</button>';
    }).join('');
    var help = ATTR_HELP[attr] ? ' title="' + escapeHtml(ATTR_HELP[attr]) + '"' : '';
    return '<div class="field"><span class="field-label"' + help + '>' + escapeHtml(opts.label) + '</span>' +
      '<div class="seg' + (opts.cls ? ' ' + opts.cls : '') + '" role="radiogroup" aria-label="' + escapeHtml(opts.label) + '">' +
      buttons + '</div></div>';
  }

  function chip(id, opts) {
    opts = opts || {};
    var d = data(id);
    var dot = opts.dot ? '<span class="chip-dot" style="background:' + opts.dot + '"></span>' : '';
    var x = opts.removable && editable()
      ? '<button type="button" class="chip-x" data-remove="' + escapeHtml(opts.removable) + '" data-id="' + escapeHtml(id) +
        '" aria-label="Remove ' + escapeHtml(label(id)) + '"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 3l6 6M9 3l-6 6"/></svg></button>'
      : '';
    return '<span class="chip">' + dot + '<button type="button" class="chip-go" data-go="' + escapeHtml(id) + '" title="' +
      escapeHtml(d && d.description ? d.description : label(id)) + '">' + escapeHtml(label(id)) + '</button>' + x + '</span>';
  }

  function chips(ids, opts, empty) {
    if (!ids.length) return '<span class="chip-empty">' + escapeHtml(empty || 'None yet') + '</span>';
    return '<div class="chips">' + ids.map(function (i) {
      var o = Object.assign({}, opts);
      if (typeof o.dot === 'function') o.dot = o.dot(i);
      return chip(i, o);
    }).join('') + '</div>';
  }

  function paperList(ids, cls) {
    var rows = ids.map(function (i) { return data(i); })
      .sort(function (a, b) { return (a.year || 0) - (b.year || 0); })
      .map(function (p) {
        return '<li><span class="paper-year">' + escapeHtml(p.year || '') + '</span>' +
          '<button type="button" class="' + (cls || '') + '" data-go="' + escapeHtml(p.id) + '">' +
          escapeHtml(p.description || p.label) + '</button></li>';
      });
    return '<ul class="paper-list">' + rows.join('') + '</ul>';
  }

  function addPersonRow() {
    if (!editable()) return '';
    var people = graphData.nodes.filter(function (n) { return n.data.type === 'researcher'; })
      .map(function (n) { return '<option value="' + escapeHtml(label(n.data.id)) + '">'; }).join('');
    return '<div class="add-row"><input class="insp-input" id="insp-add-person" list="insp-people" ' +
      'placeholder="Add a person" autocomplete="off"><datalist id="insp-people">' + people + '</datalist></div>';
  }

  function provenance(d) {
    var src = String(d.source || '');
    var from = src === 'workshop' ? 'Added in a workshop'
      : src.indexOf('orcid') === 0 ? 'Imported from ORCID'
      : src.indexOf('openalex') === 0 ? 'Found through OpenAlex'
      : src.indexOf('semanticscholar') === 0 ? 'Found through Semantic Scholar'
      : src ? 'Entered by hand' : '';
    var when = d.updatedAt ? 'last changed ' + formatDate(d.updatedAt) : '';
    var text = [from, when].filter(Boolean).join(', ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) + '.' : '';
  }

  function head(kindHtml, title, canRename) {
    var ro = canRename && editable() ? '' : ' readonly';
    return '<div class="insp-head"><div class="insp-head-main">' +
      '<div class="insp-kind">' + kindHtml + '</div>' +
      '<textarea class="insp-title" id="insp-title" rows="1" spellcheck="true" aria-label="Name"' + ro + '>' +
      escapeHtml(title) + '</textarea></div>' +
      '<button type="button" class="btn-close" id="insp-close" aria-label="Close details">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></div>';
  }

  function descriptionField(d) {
    if (!editable() && !d.description) return '';
    var ro = editable() ? '' : ' readonly';
    return section('Description', null,
      '<textarea class="insp-textarea" id="insp-desc" placeholder="What does reaching this mean? One or two sentences."' + ro + '>' +
      escapeHtml(d.description || '') + '</textarea>');
  }

  // ---- renderers -------------------------------------------------------------

  function renderTopic(d) {
    var kind = d.kind || 'stone';
    var isStone = kind === 'stone', isDest = kind === 'destination';
    var color = laneColorOf(d.id);
    var laneRow = roadmapModel && roadmapModel.laneOf[d.id];
    var lane = laneRow != null ? laneByRow(laneRow) : null;

    var kindText;
    if (isDest) kindText = 'Destination';
    else if (kind === 'enabler') kindText = 'Enabler or driver';
    else if (lane && lane.dest && lane.dest !== d.id) kindText = 'Stepping stone on the way to ' + escapeHtml(label(lane.dest));
    else if (lane && lane.parking) kindText = 'Stepping stone, not yet on a journey';
    else kindText = 'Stepping stone';
    var kindHtml = '<span class="insp-swatch' + (isDest ? ' is-dest' : '') + '" style="color:' + color + '"></span><span>' + kindText + '</span>';

    var html = head(kindHtml, label(d.id), true) + '<div class="insp-body">';

    if (isStone) {
      var sa = ontology.stoneAttributes || {};
      html += section('Assessment', null,
        seg('horizon', HORIZONS, d.horizon, { label: 'Horizon' }) +
        seg('status', (sa.status && sa.status.enum) || [], d.status, { label: 'Status' }) +
        seg('confidence', (sa.confidence && sa.confidence.enum) || [], d.confidence, { label: 'Confidence' }) +
        seg('trl', [1, 2, 3, 4, 5, 6, 7, 8, 9], d.trl, { label: 'Readiness (TRL)', raw: true, cls: 'seg-trl' }) +
        seg('priority', (sa.priority && sa.priority.enum) || [], d.priority, { label: 'Strategic priority' }));
    }

    html += descriptionField(d);

    if (isStone || kind === 'enabler') {
      var people = edgesOf(d.id, 'works_on', 'in');
      var owner = d.owner && nodeById(d.owner) ? d.owner : null;
      var ownerHtml = '<div class="field" style="margin-top:12px"><span class="field-label">Owner, keeps this stone current</span>' +
        (owner ? chips([owner], { removable: 'owner', dot: typeColor(data(owner).type) }) : '') +
        (editable() && !owner ? '<div class="add-row"><input class="insp-input" id="insp-owner" list="insp-owners" placeholder="Choose an owner" autocomplete="off"><datalist id="insp-owners">' +
          graphData.nodes.filter(function (n) { return n.data.type === 'researcher' || n.data.type === 'group'; })
            .map(function (n) { return '<option value="' + escapeHtml(label(n.data.id)) + '">'; }).join('') + '</datalist></div>'
          : (!owner ? '<span class="chip-empty">No owner yet</span>' : '')) + '</div>';
      html += section('People', people.length || null,
        chips(people, { removable: 'works_on', dot: typeColor('researcher') }, 'Nobody linked yet') + addPersonRow() + ownerHtml);
    }

    var before = edgesOf(d.id, 'journey', 'in'), after = edgesOf(d.id, 'journey', 'out');
    var connectBtn = editable() ? '<div style="margin-top:10px"><button type="button" class="btn btn-quiet" id="insp-connect">Connect to another stone</button></div>' : '';
    var journeyHtml = '';
    if (!isDest || before.length) {
      journeyHtml += '<div class="field"><span class="field-label">Comes after</span>' +
        chips(before, { removable: 'journey-in', dot: laneColorOf }, isStone ? 'Nothing: this is where the journey starts' : 'No stones lead here yet') + '</div>';
    }
    if (!isDest) {
      journeyHtml += '<div class="field"><span class="field-label">Leads to</span>' +
        chips(after, { removable: 'journey-out', dot: laneColorOf }, 'Nothing yet') + '</div>';
    }
    html += section('Journey', null, journeyHtml + connectBtn);

    var projects = edgesOf(d.id, 'advances', 'in');
    if (projects.length) html += section('Advanced by', projects.length, chips(projects, { dot: typeColor('project') }));

    var prior = edgesOf(d.id, 'priorArt', 'in');
    var evidence = edgesOf(d.id, 'evidences', 'in');
    if (prior.length || isStone) {
      html += section('Prior art', prior.length || null,
        prior.length ? paperList(prior, 'prior') : '<span class="chip-empty">No state of the art captured yet</span>');
    }
    if (evidence.length || isStone) {
      html += section('Our evidence', evidence.length || null,
        evidence.length ? paperList(evidence) : '<span class="chip-empty">No publications linked yet</span>');
    }

    html += foot(d, editable() ? '<button type="button" class="btn btn-danger" id="insp-delete">Delete ' + (isDest ? 'destination' : 'stepping stone') + '</button>' : '');
    return html + '</div>';
  }

  function renderResearcher(d) {
    var groups = edgesOf(d.id, 'member_of', 'out');
    var kindHtml = '<span class="insp-swatch is-dest" style="color:' + typeColor('researcher') + '"></span><span>Researcher' +
      (groups.length ? ', ' + escapeHtml(label(groups[0])) : '') + '</span>';
    var html = head(kindHtml, label(d.id), false) + '<div class="insp-body">';

    var facts = [];
    if (d.title) facts.push(['Role', escapeHtml(d.title)]);
    if (d.email) facts.push(['Email', '<a href="mailto:' + escapeHtml(d.email) + '">' + escapeHtml(d.email) + '</a>']);
    if (d.orcid) facts.push(['ORCID', '<a href="https://orcid.org/' + escapeHtml(d.orcid) + '" target="_blank" rel="noopener">' + escapeHtml(d.orcid) + '</a>']);
    if (facts.length) html += section('About', null, factList(facts));

    var stones = edgesOf(d.id, 'works_on', 'out');
    var linkBtn = editable() ? '<div style="margin-top:10px"><button type="button" class="btn btn-quiet" id="insp-link-person">Pick stones on the map</button></div>' : '';
    html += section('Works on', stones.length || null,
      chips(stones, { removable: 'works_on-out', dot: laneColorOf }, 'Not linked to any stone yet') + linkBtn);

    var pubs = edgesOf(d.id, 'authored', 'out');
    if (pubs.length) {
      var recent = pubs.slice().sort(function (a, b) { return (data(b).year || 0) - (data(a).year || 0); }).slice(0, 8);
      html += section('Publications', pubs.length, paperList(recent) +
        (pubs.length > 8 ? '<span class="chip-empty">Showing the 8 most recent.</span>' : ''));
    }
    html += foot(d, '');
    return html + '</div>';
  }

  function renderPublication(d) {
    var prior = edgesOf(d.id, 'priorArt', 'out');
    var ev = edgesOf(d.id, 'evidences', 'out');
    var kind = prior.length && !ev.length ? 'Prior art' : 'Publication';
    var kindHtml = '<span class="insp-swatch is-dest" style="color:' + typeColor('publication') + '"></span><span>' + kind + (d.year ? ', ' + escapeHtml(d.year) : '') + '</span>';
    var html = head(kindHtml, d.description || label(d.id), false) + '<div class="insp-body">';

    var facts = [];
    if (d.authors) facts.push(['Authors', escapeHtml(d.authors)]);
    if (d.venue) facts.push(['Venue', escapeHtml(d.venue)]);
    if (d.citations != null) facts.push(['Citations', escapeHtml(d.citations)]);
    if (d.doi) facts.push(['DOI', '<a href="https://doi.org/' + escapeHtml(d.doi) + '" target="_blank" rel="noopener">' + escapeHtml(d.doi) + '</a>']);
    if (facts.length) html += section('About', null, factList(facts));

    var authors = edgesOf(d.id, 'authored', 'in');
    if (authors.length) html += section('Our authors', authors.length, chips(authors, { dot: typeColor('researcher') }));
    if (ev.length) html += section('Evidence for', ev.length, chips(ev, { dot: laneColorOf }));
    if (prior.length) html += section('Prior art for', prior.length, chips(prior, { dot: laneColorOf }));
    html += foot(d, '');
    return html + '</div>';
  }

  function renderGeneric(d) {
    var t = ontology.nodeTypes[d.type];
    var kindHtml = '<span class="insp-swatch is-dest" style="color:' + typeColor(d.type) + '"></span><span>' + escapeHtml(t ? t.label : d.type) + '</span>';
    var html = head(kindHtml, label(d.id), false) + '<div class="insp-body">';
    var facts = [];
    ['title', 'funder', 'year', 'venue'].forEach(function (k) { if (d[k]) facts.push([valueLabel(k), escapeHtml(d[k])]); });
    if (d.startYear) facts.push(['Period', escapeHtml(d.startYear + (d.endYear ? '–' + d.endYear : ''))]);
    if (d.description) html += section('Description', null, '<p style="margin:0">' + escapeHtml(d.description) + '</p>');
    if (facts.length) html += section('About', null, factList(facts));

    var groups = {};
    graphData.edges.forEach(function (e) {
      var other = e.data.source === d.id ? e.data.target : e.data.target === d.id ? e.data.source : null;
      if (!other || !nodeById(other)) return;
      (groups[e.data.type] = groups[e.data.type] || []).push(other);
    });
    Object.keys(groups).forEach(function (type) {
      html += section(edgeTypeLabel(type), groups[type].length, chips(groups[type], { dot: function (i) { return typeColor(data(i).type); } }));
    });
    html += foot(d, '');
    return html + '</div>';
  }

  function factList(rows) {
    return '<dl class="facts">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>';
  }

  function foot(d, action) {
    var prov = provenance(d);
    if (!prov && !action) return '';
    return '<div class="insp-foot"><span class="provenance">' + escapeHtml(prov) + '</span>' + action + '</div>';
  }

  // ---- behaviour -------------------------------------------------------------

  function bind(d) {
    var id = d.id;
    panel.querySelector('#insp-close').addEventListener('click', function () { clearSelection(); });

    var title = panel.querySelector('#insp-title');
    autosize(title);
    title.addEventListener('input', function () { autosize(title); });
    if (!title.readOnly) {
      title.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
        if (e.key === 'Escape') { title.value = label(id); title.blur(); }
      });
      title.addEventListener('blur', function () {
        var v = title.value.replace(/\s+/g, ' ').trim();
        if (v && v !== label(id)) Edit.setAttr(id, 'label', v, 'Renamed ' + quote(label(id)) + ' to ' + quote(v));
        else title.value = label(id);
      });
    }

    var desc = panel.querySelector('#insp-desc');
    if (desc && !desc.readOnly) {
      desc.addEventListener('blur', function () {
        var v = desc.value.trim();
        if (v !== (d.description || '')) Edit.setAttr(id, 'description', v, 'Updated the description of ' + quote(label(id)));
      });
    }

    panel.querySelectorAll('.seg button[data-attr]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!editable()) return;
        var attr = b.dataset.attr;
        var value = attr === 'trl' ? parseInt(b.dataset.value, 10) : b.dataset.value;
        if (attr === 'horizon') { Edit.setHorizon(id, value); return; }
        var isOn = b.getAttribute('aria-checked') === 'true';
        var niceAttr = { status: 'status', confidence: 'confidence', trl: 'readiness', priority: 'priority' }[attr] || attr;
        if (isOn) Edit.setAttr(id, attr, null, 'Cleared the ' + niceAttr + ' of ' + quote(label(id)));
        else Edit.setAttr(id, attr, value, 'Set the ' + niceAttr + ' of ' + quote(label(id)) + ' to ' +
                           (attr === 'trl' ? 'TRL ' + value : valueLabel(value)));
      });
    });

    panel.querySelectorAll('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.go); });
    });

    panel.querySelectorAll('[data-remove]').forEach(function (b) {
      b.addEventListener('click', function () {
        var other = b.dataset.id, kind = b.dataset.remove;
        if (kind === 'works_on') Edit.disconnect(other, id, 'works_on', label(other) + ' no longer works on ' + quote(label(id)));
        else if (kind === 'works_on-out') Edit.disconnect(id, other, 'works_on', label(id) + ' no longer works on ' + quote(label(other)));
        else if (kind === 'journey-in') Edit.disconnect(other, id, 'journey');
        else if (kind === 'journey-out') Edit.disconnect(id, other, 'journey');
        else if (kind === 'owner') Edit.setAttr(id, 'owner', null, 'Cleared the owner of ' + quote(label(id)));
      });
    });

    var addPerson = panel.querySelector('#insp-add-person');
    if (addPerson) {
      var pick = function () {
        var v = addPerson.value.trim();
        if (!v) return;
        addPerson.value = '';
        // Leave the field first, so the panel is free to redraw with the new chip.
        addPerson.blur();
        var match = findByLabel(v, ['researcher']);
        if (match) {
          Edit.link(match, id, 'works_on', label(match) + ' works on ' + quote(label(id)));
        } else {
          // People in the room are not all in ORCID yet. Offer, don't guess.
          toast('Nobody called ' + quote(v) + ' is in the map yet.', {
            actionLabel: 'Add them', onAction: function () { addPersonNode(v, id); }
          });
        }
        addPerson.value = '';
      };
      addPerson.addEventListener('change', pick);
      addPerson.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pick(); } });
    }

    var ownerInput = panel.querySelector('#insp-owner');
    if (ownerInput) {
      var setOwner = function () {
        var v = ownerInput.value.trim();
        if (!v) return;
        ownerInput.value = '';
        ownerInput.blur();
        var match = findByLabel(v, ['researcher', 'group']);
        if (match) Edit.setAttr(id, 'owner', match, label(match) + ' now owns ' + quote(label(id)));
        else toast('Choose the owner from the list of people and groups.');
        ownerInput.value = '';
      };
      ownerInput.addEventListener('change', setOwner);
      ownerInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setOwner(); } });
    }

    var connectBtn = panel.querySelector('#insp-connect');
    if (connectBtn) connectBtn.addEventListener('click', function () { Edit.startConnect(id); });
    var delBtn = panel.querySelector('#insp-delete');
    if (delBtn) delBtn.addEventListener('click', function () { Edit.remove(id); });
    var linkBtn = panel.querySelector('#insp-link-person');
    if (linkBtn) linkBtn.addEventListener('click', function () { enterPersonLinkMode(id); });
  }

  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

  function findByLabel(text, types) {
    var t = text.toLowerCase();
    var hit = graphData.nodes.filter(function (n) {
      return types.indexOf(n.data.type) >= 0 && label(n.data.id).toLowerCase() === t;
    });
    return hit.length === 1 ? hit[0].data.id : null;
  }

  function addPersonNode(name, stoneId) {
    var base = 'r-' + name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var pid = base, n = 2;
    while (nodeById(pid)) pid = base + '-' + (n++);
    Edit.commit('Added ' + name + ' and linked them to ' + quote(label(stoneId)), function () {
      var d = { id: pid, type: 'researcher', label: name, title: 'Researcher',
                sensitivity: (ontology.sensitivity && ontology.sensitivity.default) || 'internal' };
      stampProvenance(d);
      d.source = 'workshop';
      graphData.nodes.push({ data: d });
      var e = { source: pid, target: stoneId, type: 'works_on' };
      stampProvenance(e);
      graphData.edges.push({ data: e });
    });
  }

  // Navigate to a node, switching to a view that contains it if needed.
  function go(id) {
    if (cy.getElementById(id).empty()) {
      var d = data(id);
      var prefer = d && d.type === 'publication' ? ['state-of-the-art', 'publications']
                 : d && d.type === 'topic' ? ['roadmap', 'everything'] : ['everything'];
      var target = prefer.concat(['everything']).filter(function (v) {
        return graphData.views.some(function (x) { return x.id === v; }) &&
               getFilteredElements(graphData.views.find(function (x) { return x.id === v; }))
                 .nodes.some(function (n) { return n.data.id === id; });
      })[0];
      if (!target) { toast('That item is not shown in any view.'); return; }
      setView(target);
    }
    selectNode(id, { center: true });
  }

  // ---- open / close ----------------------------------------------------------

  function open(id) {
    var n = nodeById(id);
    if (!n) { close(); return; }
    if (!panel) panel = document.getElementById('inspector');
    // Don't rebuild the panel under someone's cursor while they are typing in it.
    var active = document.activeElement;
    if (currentId === id && active && panel.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) return;
    currentId = id;
    var d = n.data;
    panel.innerHTML = d.type === 'topic' ? renderTopic(d)
      : d.type === 'researcher' ? renderResearcher(d)
      : d.type === 'publication' ? renderPublication(d)
      : renderGeneric(d);
    bind(d);
    var wasOpen = !panel.hidden;
    panel.hidden = false;
    // Size the name field only now: measured while the panel was hidden, it
    // reads a height of 0 and the title vanishes.
    autosize(panel.querySelector('#insp-title'));
    document.body.classList.add('inspector-open');
    if (!wasOpen) onCanvasResized();
  }

  function close() {
    if (!panel) panel = document.getElementById('inspector');
    currentId = null;
    if (panel.hidden) return;
    panel.hidden = true;
    panel.innerHTML = '';
    document.body.classList.remove('inspector-open');
    onCanvasResized();
  }

  window.Inspector = {
    open: open,
    close: close,
    refresh: function () { if (currentId) open(currentId); },
    go: go
  };
})();
