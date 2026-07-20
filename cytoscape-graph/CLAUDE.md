# CLAUDE.md — repo guide for the coding agent

## What this is
An interactive **foresight knowledge graph** for the RISE Computer Science department
("CS Department Explorer") — Cytoscape.js front-end + small Flask backend. It visualises
technology **stepping stones** toward **destinations** (Ericsson "technology journeys" style)
and links them to the department's reality (people, groups, projects, publications).

**Read `PLAN.md` first** — it holds the vision, the ontology v1, and the phased task backlog.
Work through `PLAN.md` §4 top to bottom.

## Run it
```bash
uv run python server.py       # http://127.0.0.1:5000
```
No build step. Vanilla JS in the browser; Python stdlib + Flask on the server; `uv` for deps.

## File map
- `server.py` — Flask: static serving + `GET/POST /api/data` (reads/writes `data.json`), `GET /api/images`.
- `index.html` — UI shell (graph canvas, view switcher, detail panel, editor, legend, person-link bar).
- `code.js` — Cytoscape init, per-type styles, view filtering, klay/cose layouts, detail panel, person-link mode.
- `editor.js` — in-browser add/edit/delete of nodes & edges, JSON export.
- `data.json` — the graph: `{ views[], nodes[], edges[] }` (runtime source of truth).
- `import_orcid.py` — ORCID feed (researchers + publications) with idempotent merge.
- `imgs/` — SVG node icons. `data.js` — dead offline fallback.

## Data model (see PLAN.md §2 for v1 changes)
- Node `type`: `topic` (→ gaining a `kind`: destination | stone | enabler), `researcher`, `group`, `project`, `publication` (+ new: `partner`, `funding_call`, `testbed`).
- Edge `type`: `journey`, `works_on`, `member_of`, `leads`, `participates`, `related_to`, `authored` (+ new: `advances`, `evidences`, `enabledBy`/`gates`, `funds`, `supports`).
- Nodes carry free-form data fields; the detail panel renders whatever is present, so adding attributes is cheap.

## Conventions
- Keep it simple: single-file-per-concern, no framework, no bundler.
- Small, reviewable commits; after each change run the server and click through all views + the editor.
- When you add/change a node or edge, write provenance (`source`, `updatedBy`, `updatedAt`).
- Centralise schema in `ontology.json` (PLAN.md §2.5) — editor, styles, validation read from it.

## Guardrails
- Don't migrate the store to Wikibase or add the AI ask-layer yet (Phase 2/3 in PLAN.md).
- Fix, don't ignore, the known issues in PLAN.md §5 when you touch that code (esp. the full-file
  write race in `POST /api/data` and `debug=True`).
- Nothing becomes public except via an explicit `sensitivity == "public"` build.
