#!/usr/bin/env python3
"""Import researchers and publications from ORCID into data.json.

Two ways to pick people:
  --orcids unit.txt          # explicit ORCID iDs, one per line (precise — use this for a unit)
  --search "Org name"        # ORCID affiliation search (noisy; review with --dry-run first)

Typical run for one unit:
  python import_orcid.py --orcids my_unit.txt --group "RISE Cyber-Physical Systems" --dry-run
  python import_orcid.py --orcids my_unit.txt --group "RISE Cyber-Physical Systems"

Only data the researcher has made public on ORCID is fetched. Imported nodes are
stamped sensitivity=internal, so nothing reaches a public build without an
explicit curation step (PLAN.md section 3).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
ONTOLOGY_FILE = os.path.join(BASE_DIR, "ontology.json")
CONFIG_FILE = os.path.join(BASE_DIR, "orcid_config.json")
ORCID_API = "https://pub.orcid.org/v3.0"
HEADERS = {"Accept": "application/orcid+json"}

# Demo/seed researchers carry this fake mail domain; --prune-demo removes them.
DEMO_EMAIL_DOMAIN = "@cs.example.edu"


def load_config():
    """Load optional ORCID API credentials for higher rate limits."""
    if not os.path.exists(CONFIG_FILE):
        return None
    with open(CONFIG_FILE) as f:
        return json.load(f)


def get_access_token(config):
    """Get OAuth token. Returns None if no credentials configured."""
    if not config or not config.get("client_id"):
        return None
    data = urllib.parse.urlencode({
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "grant_type": "client_credentials",
        "scope": "/read-public",
    }).encode()
    req = urllib.request.Request("https://orcid.org/oauth/token", data=data)
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def api_get(path, token):
    url = f"{ORCID_API}/{path}"
    headers = dict(HEADERS)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    time.sleep(0.25)  # rate limit courtesy
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limited
                wait = 2 ** (attempt + 1)
                print(f"  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            print(f"  API error {e.code} for {url}")
            return None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 2:
                time.sleep(1)
                continue
            print(f"  Timeout for {url}")
            return None
    return None


def search_by_affiliation(query, token, max_results=200):
    encoded = urllib.parse.quote(f'affiliation-org-name:"{query}"')
    data = api_get(f"search/?q={encoded}&rows={max_results}", token)
    if not data:
        return []
    results = data.get("result", [])
    orcid_ids = []
    for r in results:
        orcid_id = r.get("orcid-identifier", {}).get("path")
        if orcid_id:
            orcid_ids.append(orcid_id)
    print(f"Found {len(orcid_ids)} ORCID profiles for '{query}'")
    return orcid_ids


def fetch_profile(orcid_id, token):
    data = api_get(f"{orcid_id}/record", token)
    if not data:
        return None

    person = data.get("person", {})
    name_data = person.get("name", {})
    given_obj = name_data.get("given-names") if name_data else None
    given = given_obj.get("value", "") if given_obj else ""
    family_obj = name_data.get("family-name") if name_data else None
    family = family_obj.get("value", "") if family_obj else ""

    if not given and not family:
        return None

    bio_data = person.get("biography", {})
    bio = bio_data.get("content", "") if bio_data else ""

    # Get current affiliation
    activities = data.get("activities-summary", {})
    employments = activities.get("employments", {}).get("affiliation-group", [])
    current_role = ""
    current_org = ""
    for group in employments:
        summaries = group.get("summaries", [])
        for s in summaries:
            emp = s.get("employment-summary", {})
            org = emp.get("organization", {}).get("name", "")
            role = emp.get("role-title", "") or ""
            end = emp.get("end-date")
            if not end:  # current employment (no end date)
                current_role = role
                current_org = org
                break

    description = bio.strip() if bio else ""
    if not description and current_role:
        description = f"{current_role} at {current_org}"
    elif not description and current_org:
        description = f"Researcher at {current_org}"

    return {
        "orcid": orcid_id,
        "given": given,
        "family": family,
        "description": description,
        "role": current_role,
        "org": current_org,
    }


def fetch_works(orcid_id, token, max_works=50):
    data = api_get(f"{orcid_id}/works", token)
    if not data:
        return []

    works = []
    groups = data.get("group", [])
    for group in groups[:max_works]:
        summaries = group.get("work-summary", [])
        if not summaries:
            continue
        summary = summaries[0]  # take first (preferred) summary

        title_data = summary.get("title", {})
        title = title_data.get("title", {}).get("value", "") if title_data else ""
        if not title:
            continue

        pub_date = summary.get("publication-date", {})
        year = None
        if pub_date and pub_date.get("year"):
            year_val = pub_date["year"].get("value")
            if year_val:
                try:
                    year = int(year_val)
                except ValueError:
                    pass

        journal = summary.get("journal-title", {})
        venue = journal.get("value", "") if journal else ""

        # Extract DOI from external IDs
        doi = None
        ext_ids = summary.get("external-ids", {}).get("external-id", [])
        for eid in ext_ids:
            if eid.get("external-id-type") == "doi":
                doi = eid.get("external-id-value")
                break

        work_type = summary.get("type", "")

        works.append({
            "title": title,
            "year": year,
            "venue": venue,
            "doi": doi,
            "type": work_type,
        })

    return works


def make_researcher_id(given, family):
    slug = re.sub(r"[^a-z0-9]+", "-", f"{given} {family}".lower()).strip("-")
    return f"r-{slug}"


def make_pub_id(doi, title, year):
    if doi:
        slug = re.sub(r"[^a-z0-9]+", "-", doi.lower()).strip("-")
        return f"pub-{slug}"
    raw = f"{title}-{year}".lower()
    h = hashlib.md5(raw.encode()).hexdigest()[:10]
    return f"pub-{h}"


def truncate_label(title, max_len=30):
    if len(title) <= max_len:
        return title
    words = title.split()
    label = ""
    for w in words:
        if len(label) + len(w) + 1 > max_len:
            break
        label = f"{label} {w}" if label else w
    return label + "..." if label != title else title


def default_sensitivity():
    try:
        with open(ONTOLOGY_FILE, encoding="utf-8") as f:
            return json.load(f).get("sensitivity", {}).get("default", "internal")
    except (OSError, json.JSONDecodeError):
        return "internal"


def stamp_provenance(d, source="orcid"):
    """PLAN section 2.4. `source` is only written on nodes — on an edge that key
    is the source node id (same collision guarded in migrate_data.py / code.js)."""
    is_edge = "source" in d and "target" in d
    if not is_edge:
        d.setdefault("source", source)
    d["updatedBy"] = "import_orcid.py"
    d["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_data():
    with open(DATA_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_data(data, backup=True):
    """Atomic write + version bump, matching server.py's persistence contract.

    Bumping `version` means a browser holding a pre-import copy gets a 409 on its
    next save instead of silently clobbering everything this import added.
    """
    if backup:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest = f"{DATA_FILE}.bak-{stamp}"
        shutil.copy2(DATA_FILE, dest)
        print(f"Backup written: {os.path.basename(dest)}")

    data["version"] = data.get("version", 0) + 1

    fd, tmp = tempfile.mkstemp(dir=BASE_DIR, prefix=".data-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, DATA_FILE)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    print(f"data.json now at version {data['version']}")


def prune_demo_researchers(data):
    """Remove the seeded placeholder researchers (and every edge touching them)."""
    demo_ids = {
        n["data"]["id"] for n in data["nodes"]
        if n["data"].get("type") == "researcher"
        and str(n["data"].get("email", "")).endswith(DEMO_EMAIL_DOMAIN)
    }
    if not demo_ids:
        return 0, 0

    before_edges = len(data["edges"])
    data["nodes"] = [n for n in data["nodes"] if n["data"]["id"] not in demo_ids]
    data["edges"] = [
        e for e in data["edges"]
        if e["data"]["source"] not in demo_ids and e["data"]["target"] not in demo_ids
    ]
    return len(demo_ids), before_edges - len(data["edges"])


def merge_into_data(data, researchers, publications, edges):
    existing_node_ids = {n["data"]["id"] for n in data["nodes"]}
    existing_edges = {
        (e["data"]["source"], e["data"]["target"], e["data"]["type"])
        for e in data["edges"]
    }

    # Remove placeholder researchers (r-* nodes not from ORCID)
    # Keep them for now — user can remove manually if desired

    added_nodes = 0
    added_edges = 0

    for r in researchers:
        if r["data"]["id"] not in existing_node_ids:
            data["nodes"].append(r)
            existing_node_ids.add(r["data"]["id"])
            added_nodes += 1

    for p in publications:
        if p["data"]["id"] not in existing_node_ids:
            data["nodes"].append(p)
            existing_node_ids.add(p["data"]["id"])
            added_nodes += 1

    for e in edges:
        key = (e["data"]["source"], e["data"]["target"], e["data"]["type"])
        if key not in existing_edges:
            data["edges"].append(e)
            existing_edges.add(key)
            added_edges += 1

    return added_nodes, added_edges


def make_group_id(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"g-{slug}"


def run_import(orcid_ids, token, dry_run=False, max_works=50, group=None,
               prune_demo=False):
    all_researchers = []
    all_publications = []
    all_edges = []
    pub_index = {}  # doi/hash -> pub node id (for dedup)
    sensitivity = default_sensitivity()

    # The unit itself, so imported people hang off one group node.
    group_node = None
    if group:
        group_data = {
            "id": make_group_id(group),
            "type": "group",
            "label": group,
            "description": f"Unit imported alongside its ORCID researchers.",
            "sensitivity": sensitivity,
        }
        stamp_provenance(group_data)
        group_node = {"data": group_data}

    for i, orcid_id in enumerate(orcid_ids):
        print(f"\n[{i+1}/{len(orcid_ids)}] Fetching {orcid_id}...")
        profile = fetch_profile(orcid_id, token)
        if not profile:
            print(f"  Skipped (no name found)")
            continue

        r_id = make_researcher_id(profile["given"], profile["family"])
        print(f"  {profile['given']} {profile['family']} ({profile['org']})")

        researcher_data = {
            "id": r_id,
            "type": "researcher",
            "label": f"{profile['given']}\n{profile['family']}",
            "description": profile["description"],
            "orcid": orcid_id,
            "title": profile["role"] or "Researcher",
            "sensitivity": sensitivity,
        }
        stamp_provenance(researcher_data, source=f"orcid:{orcid_id}")
        all_researchers.append({"data": researcher_data})

        if group_node:
            member_edge = {
                "source": r_id,
                "target": group_node["data"]["id"],
                "type": "member_of",
            }
            stamp_provenance(member_edge)
            all_edges.append({"data": member_edge})

        works = fetch_works(orcid_id, token, max_works=max_works)
        print(f"  {len(works)} publications")

        for w in works:
            pub_id = make_pub_id(w["doi"], w["title"], w["year"])

            if pub_id not in pub_index:
                pub_data = {
                    "id": pub_id,
                    "type": "publication",
                    "label": truncate_label(w["title"]),
                    "description": w["title"],
                    "year": w["year"],
                    "venue": w["venue"] or None,
                    "sensitivity": sensitivity,
                }
                if w["doi"]:
                    pub_data["doi"] = w["doi"]
                stamp_provenance(pub_data, source=f"orcid:{orcid_id}")
                all_publications.append({"data": pub_data})
                pub_index[pub_id] = True

            authored_edge = {"source": r_id, "target": pub_id, "type": "authored"}
            stamp_provenance(authored_edge)
            all_edges.append({"data": authored_edge})

    if group_node:
        all_researchers.insert(0, group_node)

    print(f"\n--- Summary ---")
    print(f"Researchers: {len(all_researchers) - (1 if group_node else 0)}")
    print(f"Publications: {len(all_publications)}")
    print(f"Edges (authored + member_of): {len(all_edges)}")

    if dry_run:
        print("\n[DRY RUN] No changes written.")
        print("\nResearchers found:")
        for r in all_researchers:
            d = r["data"]
            if d["type"] != "researcher":
                continue
            print(f"  {d['label'].replace(chr(10), ' ')} (ORCID: {d['orcid']})")
        if prune_demo:
            n_demo, n_demo_edges = prune_demo_researchers(load_data())
            print(f"\n--prune-demo would remove {n_demo} placeholder researchers "
                  f"and {n_demo_edges} edges.")
        return

    data = load_data()
    if prune_demo:
        n_demo, n_demo_edges = prune_demo_researchers(data)
        print(f"\nPruned {n_demo} placeholder researchers and {n_demo_edges} edges.")

    added_nodes, added_edges = merge_into_data(data, all_researchers, all_publications, all_edges)
    save_data(data)
    print(f"Added {added_nodes} nodes, {added_edges} edges to data.json")


def main():
    parser = argparse.ArgumentParser(description="Import ORCID data into data.json")
    parser.add_argument("--search", help="Search ORCID by affiliation name")
    parser.add_argument("--orcids", help="File with ORCID IDs (one per line)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--max-works", type=int, default=50, help="Max publications per researcher")
    parser.add_argument("--group", help="Unit name: creates a group node + member_of edges")
    parser.add_argument("--prune-demo", action="store_true",
                        help=f"Remove the seeded placeholder researchers ({DEMO_EMAIL_DOMAIN}) first")
    args = parser.parse_args()

    if not args.search and not args.orcids:
        parser.print_help()
        sys.exit(1)

    config = load_config()
    token = get_access_token(config)
    if token:
        print("Authenticated with ORCID API credentials.\n")
    else:
        print("Using ORCID public API (no credentials needed).\n")

    orcid_ids = []

    if args.search:
        orcid_ids = search_by_affiliation(args.search, token)

    if args.orcids:
        with open(args.orcids) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    orcid_ids.append(line)
        print(f"Loaded {len(orcid_ids)} ORCID IDs from {args.orcids}")

    if not orcid_ids:
        print("No ORCID IDs to process.")
        sys.exit(0)

    run_import(orcid_ids, token, dry_run=args.dry_run, max_works=args.max_works,
               group=args.group, prune_demo=args.prune_demo)


if __name__ == "__main__":
    main()
