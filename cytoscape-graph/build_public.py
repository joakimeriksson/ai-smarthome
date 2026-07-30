#!/usr/bin/env python3
"""Build the curated public site: only `sensitivity == "public"` (PLAN.md 3, 4).

The internal graph is never the public one. This produces a SEPARATE static
directory containing a filtered copy of the data and a read-only viewer — no
editor, no workshop mode, no person-link bar, no write API. Serving `public/`
with any static file server exposes nothing but what was explicitly curated.

The default is to publish nothing: `sensitivity` defaults to "internal" in
ontology.json, so a node has to be marked public deliberately, one at a time.

  python build_public.py                # build ./public
  python build_public.py --out /srv/foo  # elsewhere
  python build_public.py --dry-run       # report what would ship, write nothing

Then:  cd public && python -m http.server 8000
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
DEFAULT_OUT = os.path.join(BASE_DIR, "public")

# Copied verbatim. Note editor.js / workshop.js are absent by design.
ASSETS = [
    "code.js", "queries.js", "style.css",
    "cytoscape.min.js", "cytoscape.klay.js", "cytoscape-icons.js",
    "ontology.json",
]
ASSET_DIRS = ["imgs"]

# Node fields allowed into the public build. An allowlist, not a blocklist:
# a new internal-only attribute must be added here deliberately before it can
# ever leak, rather than shipping by default because nobody remembered it.
PUBLIC_NODE_FIELDS = {
    "id", "type", "kind", "label", "description", "image",
    "horizon", "trl", "status", "confidence", "priority",
    "year", "venue", "doi", "authors", "citations", "url",
    "title", "orcid", "funder", "startYear", "endYear",
    "sensitivity",
}
PUBLIC_EDGE_FIELDS = {"source", "target", "type", "id"}

# Removed from index.html to make the viewer read-only. Each MUST be found —
# a silent miss would ship an editor to the public, so the build fails instead.
HTML_CUTS = [
    ('<script src="editor.js"></script>', "editor script"),
    ('<script src="workshop.js"></script>', "workshop script"),
    ('<button id="edit-graph-btn">Edit Graph</button>', "Edit Graph button"),
    ('<button id="workshop-btn">Workshop</button>', "Workshop button"),
]
# Larger regions cut by their first/last line (inclusive).
HTML_BLOCK_CUTS = [
    ('<div id="person-link-bar">', "</div>", "person-link bar"),
    ('<div id="editor-container" style="display: none;">', "</div>", "editor markup"),
]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def is_public(node_data):
    return node_data.get("sensitivity") == "public"


def filter_graph(data):
    """Keep public nodes, the edges wholly between them, and non-empty views."""
    kept_nodes, kept_ids = [], set()
    for n in data["nodes"]:
        if not is_public(n["data"]):
            continue
        kept_ids.add(n["data"]["id"])
        kept_nodes.append({"data": {k: v for k, v in n["data"].items()
                                    if k in PUBLIC_NODE_FIELDS}})

    kept_edges = []
    for e in data["edges"]:
        d = e["data"]
        if d["source"] in kept_ids and d["target"] in kept_ids:
            kept_edges.append({"data": {k: v for k, v in d.items()
                                        if k in PUBLIC_EDGE_FIELDS}})

    # A view whose types match nothing would render as a blank canvas.
    node_types = {n["data"]["type"] for n in kept_nodes}
    edge_types = {e["data"]["type"] for e in kept_edges}
    kept_views = []
    for v in data.get("views", []):
        nt = set(node_types) if v["nodeTypes"] == "*" else set(v["nodeTypes"])
        nt -= set(v.get("excludeNodeTypes") or [])
        if nt & node_types:
            kept_views.append(v)

    return {"views": kept_views, "nodes": kept_nodes, "edges": kept_edges,
            "version": 0,
            "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def make_public_html(src_html):
    html = src_html
    for needle, what in HTML_CUTS:
        if needle not in html:
            raise SystemExit(f"BUILD ABORTED: could not find the {what} in index.html "
                             f"to remove it. index.html changed shape — fix "
                             f"HTML_CUTS in build_public.py before publishing.")
        html = html.replace(needle, "")

    for start, end, what in HTML_BLOCK_CUTS:
        i = html.find(start)
        if i < 0:
            raise SystemExit(f"BUILD ABORTED: could not find the {what} in index.html. "
                             f"Fix HTML_BLOCK_CUTS in build_public.py before publishing.")
        depth, j = 0, i
        while j < len(html):                      # match nested <div>s
            if html.startswith("<div", j):
                depth += 1
            elif html.startswith(end, j):
                depth -= 1
                if depth == 0:
                    j += len(end)
                    break
            j += 1
        html = html[:i] + html[j:]

    html = html.replace("<title>CS Department Explorer</title>",
                        "<title>RISE Computer Science — Technology Journeys</title>")
    return html


def verify_no_leaks(out_dir):
    """Belt and braces: the built directory must contain no internal data."""
    problems = []
    for banned in ("editor.js", "workshop.js", "server.py", "orcid_config.json",
                   "import_orcid.py", "suggest_links.py", "unit_kista.txt",
                   "resolved_unit_kista.txt", "researcher_topics.txt"):
        if os.path.exists(os.path.join(out_dir, banned)):
            problems.append(f"internal file present: {banned}")

    built = load(os.path.join(out_dir, "data.json"))
    for n in built["nodes"]:
        if n["data"].get("sensitivity") != "public":
            problems.append(f"non-public node shipped: {n['data']['id']}")
        for k in n["data"]:
            if k not in PUBLIC_NODE_FIELDS:
                problems.append(f"field outside the allowlist: {n['data']['id']}.{k}")

    ids = {n["data"]["id"] for n in built["nodes"]}
    for e in built["edges"]:
        if e["data"]["source"] not in ids or e["data"]["target"] not in ids:
            problems.append(f"dangling edge: {e['data']['source']} -> {e['data']['target']}")

    html = open(os.path.join(out_dir, "index.html"), encoding="utf-8").read()
    for marker in ("editor.js", "workshop.js", "edit-graph-btn", "person-link-search"):
        if marker in html:
            problems.append(f"index.html still references {marker}")
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=DEFAULT_OUT, help="Output directory (default ./public)")
    ap.add_argument("--dry-run", action="store_true", help="Report only, write nothing")
    args = ap.parse_args()

    data = load(DATA_FILE)
    total = len(data["nodes"])
    pub = filter_graph(data)

    from collections import Counter
    by_type = Counter(n["data"]["type"] for n in pub["nodes"])
    stones = sum(1 for n in pub["nodes"]
                 if n["data"]["type"] == "topic" and n["data"].get("kind", "stone") == "stone")

    print(f"Internal graph : {total} nodes, {len(data['edges'])} edges")
    print(f"Public subset  : {len(pub['nodes'])} nodes, {len(pub['edges'])} edges, "
          f"{len(pub['views'])} view(s)")
    print(f"  by type      : {dict(by_type) or '(nothing)'}")

    if not pub["nodes"]:
        print("\nNothing is marked public, so there is nothing to publish.")
        print("Set sensitivity=\"public\" on the nodes you want to show first.")
        return
    if not stones:
        print("\nNOTE: no stepping stones are public, so this build has no roadmap —")
        print("      it publishes supporting material only. Mark the stones you want")
        print("      to show as public if the journeys are meant to be visible.")

    if args.dry_run:
        print("\n[DRY RUN] Nothing written.")
        return

    out = args.out
    if os.path.exists(out):
        shutil.rmtree(out)      # a stale file from a previous build must not linger
    os.makedirs(out)

    with open(os.path.join(out, "data.json"), "w", encoding="utf-8") as f:
        json.dump(pub, f, indent=2, ensure_ascii=False)

    for name in ASSETS:
        src = os.path.join(BASE_DIR, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(out, name))
    for d in ASSET_DIRS:
        src = os.path.join(BASE_DIR, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(out, d))

    with open(os.path.join(BASE_DIR, "index.html"), encoding="utf-8") as f:
        html = make_public_html(f.read())
    # The viewer fetches /api/data from the Flask app; a static build has no API.
    html = html.replace("<script src=\"code.js\"></script>",
                        "<script>window.PUBLIC_BUILD = true;</script>\n"
                        "  <script src=\"code.js\"></script>")
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    problems = verify_no_leaks(out)
    if problems:
        print("\nBUILD ABORTED — the output failed its own checks:")
        for p in problems:
            print("   " + p)
        shutil.rmtree(out)
        sys.exit(1)

    print(f"\nBuilt {out} — verified: public-only, no editor, no dangling edges.")
    print(f"Serve it with:  cd {os.path.relpath(out, BASE_DIR)} && python -m http.server 8000")


if __name__ == "__main__":
    main()
