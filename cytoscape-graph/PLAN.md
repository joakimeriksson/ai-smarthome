# PLAN.md — RISE CS Department Foresight Graph

> Evolve this prototype (the **CS Department Explorer**) into a living, self-hosted,
> multi-user **foresight knowledge graph** for the RISE Computer Science department —
> inspired by Ericsson's "technology journeys" (stepping stones on a timeline toward
> north-star destinations), but more alive than a slide: queryable, linked to what RISE
> actually does, curated internally, and selectively publishable.

This file is the working plan and the handoff brief for Claude Code. Work top-to-bottom
through the task backlog in §4. Keep changes small, run `server.py`, and click through the
views after each change.

---

## 0. Where we are (current prototype)

A working single-page app already implements most of the *viewer*:

| File | Role |
|------|------|
| `server.py` | Flask backend: serves static files, `GET/POST /api/data` (reads/writes `data.json`), `GET /api/images`. |
| `index.html` | UI shell: `#cy` canvas, view switcher, detail panel, editor, legend, person-link bar. Title: *CS Department Explorer*. |
| `code.js` | Cytoscape init, per-type styles, view filtering, klay/cose layouts, tooltip, detail panel, person-link mode, `persistData()`. |
| `editor.js` | In-browser add/edit/delete of nodes & edges; export JSON. |
| `data.json` | The graph: `{ views[], nodes[], edges[] }`. Single source of truth at runtime. |
| `import_orcid.py` | Feed: imports researchers + publications from ORCID by affiliation, idempotent merge into `data.json`. |
| `imgs/` | SVG icon set (chips, sensors, robots, network, AI accelerator…). |
| `data.js` | Dead code (offline fallback) — noted in-file. |

**Model today**

- Node `type`: `topic`, `researcher`, `group`, `project`, `publication`.
- Edge `type`: `journey`, `works_on`, `member_of`, `leads`, `participates`, `related_to`, `authored`.
- `views[]`: named filters over node/edge types + a layout (`klay` for the directed tech-journey, `cose` otherwise).
- Node data carries free-form fields already (`description`, `image`, `orcid`, `title`, `email`, `year`, `venue`, `doi`, `funder`, `startYear`, `endYear`) — the detail panel renders whatever is present, so **adding attributes is cheap**.

The prototype already contains the **reality layer** (people, groups, projects, publications) and
a working feed (ORCID). What's missing is a richer **foresight layer** and the hardening needed for
many people to use it safely.

---

## 1. The concept: two layers, connected

- **Foresight layer** — what a roadmap slide shows: `destination` (north star) → `journey` → `stepping stone`, plus `driver/trend/enabler`. Deliberately authored; you cannot extract intent from documents.
- **Reality layer** — what RISE actually has: `project`, `researcher`, `group`, `partner`, `funding_call`, `testbed`, `publication`. Largely importable via feeds.
- **Bridging links** are the payoff — they let the graph answer questions a slide can't ("which stepping stones have no project?", "who could lead this?", "which open call fits this horizon?").

Today's `topic` node collapses destination + stepping stone + enabler into one type. v1 keeps the JSON
shape but distinguishes them (see §2).

---

## 2. Ontology v1 (concrete, backward-compatible)

Keep the `{ "data": { ... } }` node/edge shape and the `views[]` mechanism. Change the model as follows.

### 2.1 Foresight nodes: add a `kind` to `topic`

Rather than break existing `type:"topic"` styling/filters, add a `kind` field:

```jsonc
// Destination (north star)
{ "data": { "id": "trustworthy-ai", "type": "topic", "kind": "destination",
            "label": "Trustworthy &\nVerifiable AI", "description": "...",
            "sensitivity": "internal" } }

// Stepping stone (capability milestone) — the core node
{ "data": { "id": "formal-verif-ml", "type": "topic", "kind": "stone",
            "label": "Formal verification\nof ML components",
            "horizon": "next",          // now | next | beyond
            "trl": 4,                    // 1..9
            "status": "in_progress",     // aspiration | in_progress | achieved | parked
            "confidence": "medium",      // high | medium | low
            "priority": "core",          // core | watch | optional
            "owner": "r-jane-doe",       // person/unit node id
            "sensitivity": "internal",   // public | internal | restricted
            "description": "...", "image": "imgs/microchip-ai.svg" } }

// Enabler / trend / driver
{ "data": { "id": "eu-ai-act", "type": "topic", "kind": "enabler",
            "label": "EU AI Act", "description": "Regulatory driver", "sensitivity": "public" } }
```

- **Migration:** default any `topic` without `kind` to `"stone"`; hand-mark the current end goals as `"destination"`. Provide a one-shot `migrate_data.py`.
- Style/legend: give `destination` and `enabler` distinct visuals (destination = filled north-star block on the right; enabler = amber). Stones keep the current topic look.

### 2.2 Reality nodes: add types

Add `partner`, `funding_call`, `testbed` to the node-type set (and to the editor dropdown, `getNodeStyle()`, and the legend). `researcher`, `group`, `project`, `publication` stay as-is.

### 2.3 Edge semantics (keep names, add a few)

| Edge `type` | From → To | Meaning |
|-------------|-----------|---------|
| `journey` | stone → stone / destination | dependency/sequence — the roadmap backbone |
| `advances` *(new)* | project → stone · stone → destination | real activity moving a stone; stone advancing a north star |
| `works_on` | researcher → stone | competence/contribution |
| `member_of` | researcher → group | org structure |
| `leads` / `participates` | researcher/partner → project | who's on it |
| `authored` | researcher → publication | evidence (publication → stone via `evidences`) |
| `evidences` *(new)* | publication → stone | proof a stone is being reached |
| `enabledBy` / `gates` *(new)* | enabler/trend → stone | why/what must be true |
| `funds` *(new)* | funding_call → project | resourcing |
| `supports` *(new)* | testbed → project | infrastructure |

### 2.4 Provenance on every node & edge

Add `source` (free text / URL / "orcid" / "manual"), `updatedBy`, `updatedAt` (ISO 8601). Feeds set
`source` automatically; the editor sets `updatedBy` from the logged-in user (post-SSO).

### 2.5 Single source of truth for the schema

Extract types, edge types, attribute enums, colours and default icons into **`ontology.json`** (or `ontology.js`).
`editor.js` dropdowns, `code.js` styles, validation, and the views should all read from it — so adding a
type/attribute is a one-file change, not four.

### 2.6 Definition of a good stepping stone

A capability milestone (not a product, not a task), phrased as an outcome, with a `horizon`, a stated
`confidence`, and at least one link (`advances` a destination or `journey`-depends on another stone).
Stones with no links are the curation backlog, not failures.

---

## 3. Target architecture

Keep the **Cytoscape + Flask** stack — this prototype *is* the recommended front-end. Harden it (Path A);
graduate to Wikibase only if/when crowd-editing + provenance review + SPARQL become priorities (Path B).

```
Contributors (web, SSO)          Feeds (ORCID ✓, DiVA, project DB)
        │                                   │
        ▼                                   ▼
   Flask API  ──►  Graph store (git-backed JSON now → Postgres later)
        │                 │  provenance + history
        ▼                 ▼
  Cytoscape viewer   Curated public build (sensitivity == "public")
  (internal, SSO)    (read-only static export)
        │
        ▼  (Phase 3, optional)
  GraphRAG ask-layer: pgvector over reality-layer docs → hybrid retrieval → LLM synth (cited) → MCP endpoint
```

**Storage decision:** replace flat last-writer-wins `data.json` writes with either
(a) **git-backed JSON** — atomic write + a commit per save (free history + provenance), recommended for the pilot; or
(b) **SQLite/Postgres** — when concurrency/volume grows. Design the API so the store is swappable.

**Access:** put the app behind RISE **SSO** via a reverse proxy (nginx + `oauth2-proxy` with OIDC, or
MediaWiki-style if you go Wikibase). Everyone at RISE can view/edit; stewards curate. "Accessible to
anyone at RISE" = just log in.

**Public views:** a read-only build filtered to `sensitivity == "public"` — never the raw graph.

---

## 4. Task backlog (phased, with acceptance criteria)

### Phase 0 — data model & safety
- [ ] **`ontology.json` as single source of truth** (types, edge types, attribute enums, colours, icons). `editor.js` + `code.js` read from it. *Done when adding a node type requires editing only `ontology.json`.*
- [ ] **`kind` on topics + `migrate_data.py`** (default `stone`; mark current goals `destination`). *Done when existing `data.json` loads unchanged and destinations render distinctly.*
- [ ] **Stepping-stone attributes** (`horizon`, `trl`, `status`, `confidence`, `priority`, `owner`, `sensitivity`) in schema, editor form, and detail panel. *Done when a stone can be fully edited in-browser and its attributes show in the detail panel.*
- [ ] **Fix the persistence race.** Today `POST /api/data` rewrites the whole file (last-writer-wins), and person-link mode calls `persistData()` on every toggle. Move to atomic writes + optimistic concurrency (version/etag) or git-commit-per-save; make edits granular (PATCH a node/edge) and debounce link toggles. *Done when two concurrent editors don't clobber each other.*
- [ ] **Provenance** (`source`, `updatedBy`, `updatedAt`) written on every mutation.

### Phase 1 — roadmap view & prove the value
- [ ] **"Roadmap" view**: klay layout banded by `horizon` (now / next / beyond), destinations anchored right — the Ericsson-style swimlane generated from the graph.
- [ ] **Reality-layer types** (`partner`, `funding_call`, `testbed`) + edges (`advances`, `funds`, `supports`, `enabledBy`, `evidences`) in editor/styles/legend.
- [ ] **Live queries** surfaced in the UI: "stones with no advancing project" (capability gaps), "who works on X" (expert map), "stones by horizon/TRL". Saved views or a small query panel.
- [ ] **Curated public build**: read-only export filtered by `sensitivity`.

### Phase 2 — multi-user & feeds
- [ ] **SSO** reverse proxy; simple role model (viewer / contributor / steward) — steward-only for publish + delete.
- [ ] **Feeds**: generalise `import_orcid.py`; add **DiVA** (RISE publications) and a **project DB** importer; scheduled refresh; keep idempotent merge.
- [ ] **Deploy**: `Dockerfile` + `docker-compose`; run on a RISE VM behind the proxy; back up data + git history.

### Phase 3 — AI ask-layer (optional, after the graph has content)
- [ ] **GraphRAG**: pgvector store over reality-layer docs (DiVA abstracts, project texts, reports); hybrid retrieval + rerank; LLM synthesis with citations; expose via an **MCP endpoint**. **Do not RAG the foresight layer** — intent stays curated. Inspired by Cerebras Knowledge ("meet data where it lives", NL ask front door).

---

## 5. Known issues in the current code (fix as you touch them)

- `server.py` runs `app.run(debug=True)` — dev only; disable for any shared deployment.
- No authentication; `GET/POST /api/data` is open. Gate behind SSO before multi-user.
- `POST /api/data` overwrites the entire file with no locking/versioning → **data-loss race** with concurrent editors.
- `code.js` `persistData()` fires on every person-link toggle → heavy full-file writes; batch/debounce.
- `@app.route('/<path:path>')` serves arbitrary files from the app dir — restrict to known asset folders (`imgs/`, JS, CSS) to avoid serving unintended files.
- `data.js` is dead code — remove or clearly keep as an offline fallback only.

---

## 6. First moves for Claude Code

1. Start with **Phase 0** in order. Suggested first PR: `ontology.json` + refactor `editor.js`/`code.js` to read from it + add `kind` and `migrate_data.py`.
2. After each change: `uv run python server.py`, open `http://127.0.0.1:5000`, click through every view and the editor.
3. Keep the stack simple: vanilla JS (no build step), Python stdlib + Flask, `uv` for deps. Prefer small, reviewable commits; write a one-line provenance in each node you touch.
4. Don't migrate to Wikibase or add the ask-layer yet — those are Phase 2/3 decisions.

---

## 7. References

- Ericsson "Technology journeys" (stepping stones toward north stars) — the storytelling model this graph encodes.
- Phaal, Farrukh & Probert (2004), *Technology roadmapping — a planning framework* — the layered method behind it.
- Cytoscape.js (MIT) + `cytoscape-klay` — the current renderer/layout.
- Wikibase (`wikiba.se`) — Path B store if crowd-editing/provenance/SPARQL become priorities.
- GraphRAG (Microsoft; Enterprise Knowledge) + Postgres/pgvector — Phase 3 ask-layer.
- Cerebras Knowledge (Jul 2026) — inspiration for the NL ask front door (RAG, not a KG).
- ORCID public API (in use) and DiVA — reality-layer feeds.
