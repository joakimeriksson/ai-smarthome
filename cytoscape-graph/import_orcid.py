#!/usr/bin/env python3
"""Import researchers and publications from ORCID into data.json.

Three ways to pick people:
  --names roster.txt         # a list of people's names -> resolve to ORCID iDs for review
  --orcids unit.txt          # explicit ORCID iDs, one per line (what actually imports)
  --search "Org name"        # ORCID affiliation search (noisy; review with --dry-run first)

Typical run for one unit, starting from a roster of names:

  # 1. resolve names -> ORCID iDs. Writes resolved_roster.txt. Imports nothing.
  python import_orcid.py --names roster.txt --affiliation-hint "RISE,KTH,Uppsala"

  # 2. review resolved_roster.txt by hand: confirm the RESOLVED lines, uncomment
  #    any LIKELY/UNCERTAIN ones you recognise, delete the rest.

  # 3. import the reviewed list
  python import_orcid.py --orcids resolved_roster.txt --group "RISE Computer Science" --dry-run
  python import_orcid.py --orcids resolved_roster.txt --group "RISE Computer Science"

Name resolution is deliberately a separate, human-reviewed step: names are not
unique, and silently importing the wrong person's publications is worse than
importing nobody. --names never writes to data.json.

Only data the researcher has made public on ORCID is fetched. Imported nodes are
stamped sensitivity=internal, so nothing reaches a public build without an
explicit curation step (PLAN.md section 3).
"""

import argparse
import hashlib
import json
import os
import re
import re
import shutil
import sys
import tempfile
import time
import unicodedata
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


def strip_accents(s):
    """Fold diacritics so a roster's 'Hook' can match ORCID's 'Höök'."""
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c)).lower()


def parse_roster(path):
    """Parse a roster file into [{name, title, location}].

    Blocks are separated by blank lines; the first line of a block is the name
    and any following lines are hints (title, location) — which is how a unit
    listing is usually pasted. A plain one-name-per-line file also works, since
    each line then forms its own block.
    """
    with open(path, encoding="utf-8") as f:
        lines = [ln.rstrip() for ln in f]

    entries, block = [], []

    def flush():
        if not block:
            return
        name = block[0].strip()
        rest = [b.strip() for b in block[1:] if b.strip()]
        # Trailing location line ("Kista") is not a job title.
        title = rest[0] if rest and len(rest) > 1 else ""
        location = rest[-1] if rest else ""
        entries.append({"name": name, "title": title, "location": location})

    for ln in lines:
        if ln.strip().startswith("#"):
            continue
        if not ln.strip():
            flush()
            block = []
        else:
            block.append(ln)
    flush()
    return [e for e in entries if e["name"]]


def search_by_name(name, token, hints=None):
    """Return ORCID candidates for a person's name.

    Uses expanded-search, which — unlike the plain search endpoint — returns
    `institution-name` per hit. That affiliation field is what makes a common
    name resolvable, so it is the whole reason this uses expanded-search.
    """
    parts = name.split()
    if len(parts) < 2:
        return []
    given, family = parts[0], parts[-1]
    # Multi-word surnames ("Ben Abdesslem") — try the full tail as family too.
    family_alt = " ".join(parts[1:]) if len(parts) > 2 else None

    hints = hints or []
    queries = [f'given-names:"{given}" AND family-name:"{family}"']
    if family_alt:
        queries.append(f'given-names:"{given}" AND family-name:"{family_alt}"')
    for h in hints[:2]:
        queries.append(f'family-name:"{family}" AND affiliation-org-name:"{h}"')
    queries.append(f'"{name}"')

    seen, candidates = set(), []
    for q in queries:
        data = api_get("expanded-search/?q=" + urllib.parse.quote(q) + "&rows=20", token)
        for r in (data or {}).get("expanded-result") or []:
            oid = r.get("orcid-id")
            if not oid or oid in seen:
                continue
            seen.add(oid)
            candidates.append({
                "orcid": oid,
                "name": f"{r.get('given-names') or ''} {r.get('family-names') or ''}".strip(),
                "institutions": r.get("institution-name") or [],
            })
        if candidates and q == queries[0]:
            break  # strict name match already worked; skip the looser queries

    # Try Swedish diacritic spellings when the ASCII roster name found nothing,
    # or found only people who are clearly elsewhere ("Hook" vs "Höök").
    hint_hit = any(matches_hint(" | ".join(c["institutions"]), hints) for c in candidates)
    if hints and not hint_hit or not candidates:
        for fam in name_variants(family)[1:]:
            q = f'given-names:"{given}" AND family-name:"{fam}"'
            data = api_get("expanded-search/?q=" + urllib.parse.quote(q) + "&rows=10", token)
            for r in (data or {}).get("expanded-result") or []:
                oid = r.get("orcid-id")
                if not oid or oid in seen:
                    continue
                seen.add(oid)
                candidates.append({
                    "orcid": oid,
                    "name": f"{r.get('given-names') or ''} {r.get('family-names') or ''}".strip(),
                    "institutions": r.get("institution-name") or [],
                    "spelling": fam,
                })
            if any(matches_hint(" | ".join(c["institutions"]), hints) for c in candidates):
                break
    return candidates


# Deep-verify at most this many candidates per name (one API call each).
DEEP_VERIFY_LIMIT = 6


def fetch_affiliations(orcid_id, token):
    """All organisation names on a record: employments + educations, past included.

    expanded-search only reports a summary institution list, which is frequently
    empty even when the record has a full employment history — so a search-only
    match badly under-reports affiliation.
    """
    data = api_get(f"{orcid_id}/record", token)
    if not data:
        return []
    orgs = []
    activities = data.get("activities-summary", {}) or {}
    for section, key in (("employments", "employment-summary"),
                         ("educations", "education-summary")):
        for group in (activities.get(section, {}) or {}).get("affiliation-group", []) or []:
            for s in group.get("summaries", []) or []:
                org = ((s.get(key) or {}).get("organization") or {}).get("name")
                if org:
                    orgs.append(org)
    return orgs


def matches_hint(text, hints):
    """Whole-word affiliation match on accent-folded text.

    Word boundaries are essential, not cosmetic: a plain substring test matched
    the hint 'SICS' inside 'Institute of Nuclear Physics' and confidently
    resolved a particle physicist as a RISE colleague.
    """
    t = strip_accents(text)
    for h in hints:
        h = strip_accents(h.strip())
        if h and re.search(r"\b" + re.escape(h) + r"\b", t):
            return True
    return False


# Swedish vowels that a roster typed in ASCII commonly loses ("Hook" -> "Höök").
DIACRITIC_VARIANTS = {"a": "aåä", "o": "oö", "u": "uü", "e": "eé"}
MAX_NAME_VARIANTS = 16


def name_variants(word):
    """Bounded ASCII -> Swedish-diacritic expansions of a single name word."""
    variants = [""]
    for ch in word:
        opts = DIACRITIC_VARIANTS.get(ch.lower(), ch)
        if len(variants) * len(opts) > MAX_NAME_VARIANTS:
            opts = ch  # stop expanding rather than explode combinatorially
        variants = [v + (o.upper() if ch.isupper() else o) for v in variants for o in opts]
    return variants


def score_candidates(entry, candidates, hints, token=None, deep=True):
    """Classify a name's candidates. Returns (status, matches, all_candidates).

    A candidate is 'strong' when any affiliation hint appears in its institutions
    — checked first against the search summary, then, if that misses, against the
    full employment/education history fetched from the record.

    Statuses:
      RESOLVED  one strong candidate — safe to import
      LIKELY    no affiliation evidence, but the name matched exactly one record
      AMBIGUOUS several strong candidates
      UNCERTAIN several candidates, none confirmed
    """
    strong = [c for c in candidates if matches_hint(" | ".join(c["institutions"]), hints)]

    # Search summaries often omit affiliation; confirm against the full record.
    if not strong and deep and token is not None and 0 < len(candidates) <= DEEP_VERIFY_LIMIT:
        for c in candidates:
            if c["institutions"]:
                continue  # summary had affiliation and it did not match
            orgs = fetch_affiliations(c["orcid"], token)
            if orgs:
                c["institutions"] = orgs
                c["deep"] = True
            if matches_hint(" | ".join(orgs), hints):
                strong.append(c)

    if len(strong) == 1:
        return "RESOLVED", strong, candidates
    if len(strong) > 1:
        return "AMBIGUOUS", strong, candidates
    if not candidates:
        return "NOT_FOUND", [], []
    # A distinctive name with exactly one public record and NO affiliation data
    # anywhere is probably right — nothing confirms it, but nothing contradicts
    # it either. If the record does list institutions and none matched, that is
    # evidence against, so it stays UNCERTAIN.
    if len(candidates) == 1 and not candidates[0]["institutions"]:
        return "LIKELY", candidates, candidates
    return "UNCERTAIN", [], candidates


MARKS = {"RESOLVED": "OK", "LIKELY": "~ ", "AMBIGUOUS": "??", "UNCERTAIN": "??", "NOT_FOUND": "--"}


def resolve_roster(entries, token, hints=None):
    hints = hints or []
    results = []
    for i, e in enumerate(entries, 1):
        print(f"[{i}/{len(entries)}] {e['name']}...", flush=True)
        cands = search_by_name(e["name"], token, hints=hints)
        status, strong, allc = score_candidates(e, cands, hints, token=token)
        results.append({**e, "status": status, "matches": strong, "candidates": allc})
        detail = strong[0]["orcid"] if strong else f"{len(allc)} candidate(s)"
        print(f"    [{MARKS[status]}] {status:10} {detail}")
    return results


def write_resolution_file(results, path, hint=None):
    """Write a reviewable file that --orcids can consume directly.

    Resolved people are live lines; everything else is commented out with its
    candidates listed, so reviewing means uncommenting the right line.
    """
    lines = [
        "# ORCID resolution for review.",
        "# Live (uncommented) lines are imported by:",
        "#   python import_orcid.py --orcids <this file> --group \"<your unit>\"",
        f"# Affiliation hints used: {hint or '(none)'}",
        "#",
        "# RESOLVED  = affiliation confirmed against the full ORCID record. Live below.",
        "# LIKELY    = exactly one record for this name, and it lists no affiliation at",
        "#             all — probably right, but unconfirmed. Uncomment to accept.",
        "# UNCERTAIN = several candidates, or the only one is affiliated elsewhere.",
        "# AMBIGUOUS = several candidates all at the hinted institution.",
        "# NOT_FOUND = no public ORCID record matched this name.",
        "",
    ]
    order = {"RESOLVED": 0, "LIKELY": 1, "AMBIGUOUS": 2, "UNCERTAIN": 3, "NOT_FOUND": 4}
    for r in sorted(results, key=lambda x: (order[x["status"]], x["name"])):
        lines.append(f"# --- {r['name']}  [{r['status']}]"
                     + (f"  ({r['title']})" if r["title"] else ""))
        if r["status"] == "RESOLVED":
            m = r["matches"][0]
            insts = ", ".join(m["institutions"][:3]) or "(none)"
            lines.append(f"#     {m['name']} | {insts[:90]}")
            lines.append(m["orcid"])
        else:
            for c in r["candidates"][:6]:
                insts = ", ".join(c["institutions"][:2]) or "(no institution listed)"
                lines.append(f"#   {c['orcid']}  {c['name']} | {insts[:70]}")
            if not r["candidates"]:
                lines.append("#   (no candidates)")
        lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


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
    parser.add_argument("--names", help="Roster file of people's names to resolve to ORCID iDs")
    parser.add_argument("--affiliation-hint", default="RISE",
                        help="Institution substring used to disambiguate names (default: RISE)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--max-works", type=int, default=50, help="Max publications per researcher")
    parser.add_argument("--group", help="Unit name: creates a group node + member_of edges")
    parser.add_argument("--prune-demo", action="store_true",
                        help=f"Remove the seeded placeholder researchers ({DEMO_EMAIL_DOMAIN}) first")
    args = parser.parse_args()

    if not args.search and not args.orcids and not args.names:
        parser.print_help()
        sys.exit(1)

    config = load_config()
    token = get_access_token(config)
    if token:
        print("Authenticated with ORCID API credentials.\n")
    else:
        print("Using ORCID public API (no credentials needed).\n")

    orcid_ids = []

    if args.names:
        entries = parse_roster(args.names)
        hints = [h.strip() for h in args.affiliation_hint.split(",") if h.strip()]
        print(f"Resolving {len(entries)} names from {args.names} "
              f"(hints: {', '.join(hints)})\n")
        results = resolve_roster(entries, token, hints=hints)

        counts = {}
        for r in results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        print("\n--- Resolution summary ---")
        for status in ("RESOLVED", "LIKELY", "AMBIGUOUS", "UNCERTAIN", "NOT_FOUND"):
            if counts.get(status):
                print(f"  {status:10} {counts[status]}")

        stem = os.path.splitext(os.path.basename(args.names))[0]
        out = os.path.join(BASE_DIR, f"resolved_{stem}.txt")
        write_resolution_file(results, out, hint=", ".join(hints))
        print(f"\nReview file written: {os.path.basename(out)}")

        # Resolution is a review step: never import straight from a name list.
        print("Review it, uncomment the iDs you accept, then run:")
        print(f"  python import_orcid.py --orcids {os.path.basename(out)} "
              f"--group \"<your unit>\"")
        sys.exit(0)

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
