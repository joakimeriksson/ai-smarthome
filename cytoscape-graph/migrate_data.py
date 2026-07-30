#!/usr/bin/env python3
"""
One-shot, backward-compatible migration of data.json to ontology v1.

What it does (safe + idempotent):
  * Adds `kind` to every `topic` node that lacks one (default: "stone").
  * Detects likely destinations (topic nodes that are the *sink* of `journey`
    edges — targets but never sources) and, with --auto-destinations, marks
    them `kind: "destination"`. Without the flag it only prints suggestions.
  * With --set-sensitivity, stamps a default `sensitivity` on every node that
    lacks one (default from ontology.json, else "internal").
  * With --reclassify-edges, retypes project -> topic `related_to` edges to
    `advances` (ontology v1 semantics, PLAN section 2.3: a project advancing a
    stepping stone). Only that exact source/target type pair is touched.
  * With --wire-views, makes the ontology's reality types reachable: Full Map
    declares "*" (every ontology type), the projects/publications views gain the
    new types, and a "Delivery & Gaps" view is added.

It never removes or reorders data, backs up first, and can be re-run safely.

Usage:
  python migrate_data.py --dry-run                 # preview only
  python migrate_data.py                           # add `kind` to topics
  python migrate_data.py --auto-destinations       # + mark journey sinks as destinations
  python migrate_data.py --set-sensitivity         # + stamp default sensitivity
  python migrate_data.py --reclassify-edges        # + related_to -> advances
  python migrate_data.py --wire-views              # + expose reality types in views
"""
import argparse
import json
import os
import re
import shutil
import unicodedata
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "data.json")
DEFAULT_ONTOLOGY = os.path.join(HERE, "ontology.json")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def default_sensitivity(ontology_path):
    try:
        onto = load_json(ontology_path)
        return onto.get("sensitivity", {}).get("default", "internal")
    except (FileNotFoundError, json.JSONDecodeError):
        return "internal"


def find_journey_sinks(data):
    """Topic nodes that are targets of a 'journey' edge but never a source."""
    topic_ids = {n["data"]["id"] for n in data["nodes"] if n["data"].get("type") == "topic"}
    journey_sources, journey_targets = set(), set()
    for e in data["edges"]:
        if e["data"].get("type") == "journey":
            journey_sources.add(e["data"]["source"])
            journey_targets.add(e["data"]["target"])
    return sorted((journey_targets - journey_sources) & topic_ids)


def label_of(data, node_id):
    for n in data["nodes"]:
        if n["data"]["id"] == node_id:
            return (n["data"].get("label") or node_id).replace("\n", " ")
    return node_id


def stamp_provenance(d, source):
    """Write provenance (PLAN section 2.4).

    NOTE: the provenance field `source` collides with an edge's `source` node id,
    so it is only written on nodes. Edges get updatedBy/updatedAt only.
    """
    is_edge = "source" in d and "target" in d
    if not is_edge:
        d.setdefault("source", source)
    d["updatedBy"] = "migrate_data.py"
    d["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


PREPRINT_HOSTS = ("techrxiv", "preprints", "arxiv", "biorxiv", "ssrn", "researchsquare")


def title_key(d):
    text = d.get("description") or d.get("label") or ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()[:90]


def _version_penalty(d):
    """Lower is more canonical: prefer the published paper over its preprints."""
    doi = str(d.get("doi") or "").lower()
    p = 0
    if any(h in doi for h in PREPRINT_HOSTS):
        p += 4
    if re.search(r"\.v\d+$", doi):
        p += 2
    if not doi:
        p += 1
    return (p, len(d.get("id", "")))


def dedupe_publications(data):
    """Collapse publications that are the same paper under different DOIs.

    ORCID lists preprint versions (TechRxiv v1/v2/v3, PeerJ Preprints) next to
    the published article, each with its own DOI, so DOI-based dedup misses them.
    Edges are rewired to the surviving node before the duplicates are dropped, so
    no authorship is lost.
    """
    groups = {}
    for n in data["nodes"]:
        if n["data"].get("type") == "publication":
            groups.setdefault(title_key(n["data"]), []).append(n["data"])

    alias, removed = {}, set()
    for key, nodes in groups.items():
        if len(nodes) < 2 or not key:
            continue
        nodes = sorted(nodes, key=_version_penalty)
        keeper = nodes[0]["id"]
        for dup in nodes[1:]:
            alias[dup["id"]] = keeper
            removed.add(dup["id"])

    if not alias:
        return {"pubs_removed": 0, "edges_rewired": 0, "edges_removed": 0}

    data["nodes"] = [n for n in data["nodes"] if n["data"]["id"] not in removed]

    rewired = 0
    seen, kept_edges = set(), []
    for e in data["edges"]:
        d = e["data"]
        for end in ("source", "target"):
            if d[end] in alias:
                d[end] = alias[d[end]]
                rewired += 1
        key = (d["source"], d["target"], d.get("type"))
        if key in seen or d["source"] == d["target"]:
            continue
        seen.add(key)
        kept_edges.append(e)

    dropped = len(data["edges"]) - len(kept_edges)
    data["edges"] = kept_edges
    return {"pubs_removed": len(removed), "edges_rewired": rewired,
            "edges_removed": dropped}


def reclassify_edges(data):
    """project -> topic `related_to` edges become `advances` (ontology v1)."""
    types = {n["data"]["id"]: n["data"].get("type") for n in data["nodes"]}
    n = 0
    for e in data["edges"]:
        d = e["data"]
        if (d.get("type") == "related_to"
                and types.get(d.get("source")) == "project"
                and types.get(d.get("target")) == "topic"):
            d["type"] = "advances"
            stamp_provenance(d, "migration:related_to->advances")
            n += 1
    return n


# Views added/extended by --wire-views. Full Map uses "*" so any type added to
# ontology.json later shows up without another migration.
VIEW_UPDATES = {
    # Publications are the evidence layer, not the map: 455 of them bury the
    # 26 topics. They keep their own view and re-enter via `evidences`.
    "everything": {"nodeTypes": "*", "edgeTypes": "*",
                   "excludeNodeTypes": ["publication"]},
    "projects": {
        "nodeTypes": ["project", "researcher", "topic", "partner", "funding_call", "testbed"],
        "edgeTypes": ["leads", "participates", "advances", "funds", "supports", "related_to"],
    },
    "publications": {
        "nodeTypes": ["publication", "researcher", "topic"],
        "edgeTypes": ["authored", "evidences", "priorArt"],
    },
}

# Views this migration creates if absent. Both drop isolated nodes: they answer
# "what is connected", so an unlinked publication is noise. A missing link is a
# gap for the Insights panel to report, not a floating dot on the canvas.
NEW_VIEWS = [
    {
        "id": "delivery",
        "label": "Delivery & Gaps",
        "nodeTypes": ["topic", "project", "publication"],
        "edgeTypes": ["journey", "advances", "evidences"],
        "layout": "cose",
        "dropIsolated": True,
    },
    {
        # The literature behind the roadmap: stones and the papers that define them.
        "id": "state-of-the-art",
        "label": "State of the Art",
        "nodeTypes": ["topic", "publication"],
        "edgeTypes": ["priorArt", "evidences", "journey"],
        "layout": "cose",
        "dropIsolated": True,
    },
]


def wire_views(data):
    """Expose the ontology v1 reality types/edges in the views."""
    changes = {"views_updated": 0, "views_added": 0}
    by_id = {v["id"]: v for v in data.get("views", [])}

    for vid, spec in VIEW_UPDATES.items():
        v = by_id.get(vid)
        if not v:
            continue
        if all(v.get(k) == val for k, val in spec.items()):
            continue
        v.update(spec)
        changes["views_updated"] += 1

    for spec in NEW_VIEWS:
        if spec["id"] in by_id:
            continue
        # Sits next to the other topic-centric views, before the catch-all Full Map.
        views = data["views"]
        idx = next((i for i, v in enumerate(views) if v["id"] == "everything"), len(views))
        views.insert(idx, dict(spec))
        changes["views_added"] += 1

    return changes


def migrate(data, ontology_path, auto_destinations=False, set_sensitivity=False):
    changes = {"kind_added": 0, "destinations": 0, "sensitivity_added": 0}
    sink_ids = set(find_journey_sinks(data))

    for n in data["nodes"]:
        d = n["data"]
        if d.get("type") == "topic" and "kind" not in d:
            if auto_destinations and d["id"] in sink_ids:
                d["kind"] = "destination"
                changes["destinations"] += 1
            else:
                d["kind"] = "stone"
            changes["kind_added"] += 1

        if set_sensitivity and "sensitivity" not in d:
            d["sensitivity"] = default_sensitivity(ontology_path)
            changes["sensitivity_added"] += 1

    return changes, sorted(sink_ids)


def main():
    ap = argparse.ArgumentParser(description="Migrate data.json to ontology v1.")
    ap.add_argument("--data", default=DEFAULT_DATA, help="Path to data.json")
    ap.add_argument("--ontology", default=DEFAULT_ONTOLOGY, help="Path to ontology.json")
    ap.add_argument("--auto-destinations", action="store_true",
                    help="Mark journey-sink topics as kind=destination")
    ap.add_argument("--set-sensitivity", action="store_true",
                    help="Stamp a default sensitivity on nodes that lack one")
    ap.add_argument("--reclassify-edges", action="store_true",
                    help="Retype project->topic related_to edges as advances")
    ap.add_argument("--wire-views", action="store_true",
                    help="Expose ontology v1 reality types/edges in the views")
    ap.add_argument("--dedupe-publications", action="store_true",
                    help="Collapse the same paper imported under different DOIs (preprint versions)")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing")
    ap.add_argument("--no-backup", action="store_true", help="Skip writing a .bak copy")
    args = ap.parse_args()

    data = load_json(args.data)
    n_nodes, n_edges = len(data.get("nodes", [])), len(data.get("edges", []))
    print(f"Loaded {args.data}: {n_nodes} nodes, {n_edges} edges")

    sinks = find_journey_sinks(data)
    if sinks:
        print("\nLikely destinations (journey sinks):")
        for sid in sinks:
            print(f"  - {sid}  ({label_of(data, sid)})")
        if not args.auto_destinations:
            print("  (run with --auto-destinations to mark these as kind=destination)")

    changes, _ = migrate(data, args.ontology,
                         auto_destinations=args.auto_destinations,
                         set_sensitivity=args.set_sensitivity)

    retyped = reclassify_edges(data) if args.reclassify_edges else 0
    view_changes = wire_views(data) if args.wire_views else {"views_updated": 0, "views_added": 0}
    dedupe = (dedupe_publications(data) if args.dedupe_publications
              else {"pubs_removed": 0, "edges_rewired": 0, "edges_removed": 0})

    print("\nChanges:")
    print(f"  kind added to topics : {changes['kind_added']}")
    print(f"  marked as destination: {changes['destinations']}")
    print(f"  sensitivity stamped  : {changes['sensitivity_added']}")
    print(f"  related_to->advances : {retyped}")
    print(f"  views updated/added  : {view_changes['views_updated']}/{view_changes['views_added']}")
    if args.dedupe_publications:
        print(f"  duplicate pubs removed: {dedupe['pubs_removed']} "
              f"(edges rewired {dedupe['edges_rewired']}, redundant edges dropped {dedupe['edges_removed']})")

    if args.dry_run:
        print("\n[DRY RUN] Nothing written.")
        return

    if not args.no_backup:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = f"{args.data}.bak-{stamp}"
        shutil.copy2(args.data, backup)
        print(f"\nBackup written: {backup}")

    with open(args.data, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Updated {args.data}")


if __name__ == "__main__":
    main()
