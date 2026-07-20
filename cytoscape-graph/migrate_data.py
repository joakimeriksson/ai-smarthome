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

It never removes or reorders data, backs up first, and can be re-run safely.

Usage:
  python migrate_data.py --dry-run                 # preview only
  python migrate_data.py                           # add `kind` to topics
  python migrate_data.py --auto-destinations       # + mark journey sinks as destinations
  python migrate_data.py --set-sensitivity         # + stamp default sensitivity
"""
import argparse
import json
import os
import shutil
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

    print("\nChanges:")
    print(f"  kind added to topics : {changes['kind_added']}")
    print(f"  marked as destination: {changes['destinations']}")
    print(f"  sensitivity stamped  : {changes['sensitivity_added']}")

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
