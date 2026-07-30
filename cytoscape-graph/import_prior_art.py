#!/usr/bin/env python3
"""Attach prior art (state of the art) to stepping stones, from OpenAlex.

`evidences` says "we are reaching this stone". `priorArt` says something else:
here is the foundational work that DEFINES this area, usually written by other
people. Reading the literature is not progress, so the two are separate edge
types and rendered differently (see ontology.json).

Ranking is relevance FIRST, then citations WITHIN that relevant set. This order
matters more than it sounds: asking OpenAlex to sort "intermittent computing"
matches by citation count returns a 1968 fractional-Brownian-motion paper and
a myocardial infarction consensus statement, because the most-cited work that
loosely matches anywhere beats the on-topic work every time. So: take the top
relevance hits, then re-rank those by citations, which surfaces the foundational
paper of the area (an older paper has had years to accumulate citations).

Nothing is written without review. The search pass writes a reviewable file;
`--apply` merges only the lines you left uncommented, using the same atomic
write + version bump + provenance contract as import_orcid.py.

Usage:
  # 1. search for every stone, using its label (+ any `keywords`) as the query
  python import_prior_art.py --all-stones

  # or one stone with a query you control
  python import_prior_art.py --stone intermittent --query "intermittent computing"

  # or a seeds file of `stone_id: query` lines (best for a curated sweep)
  python import_prior_art.py --seeds prior_art_seeds.txt

  # 2. review suggested_prior_art.txt — comment out (#) anything wrong
  # 3. apply
  python import_prior_art.py --apply

No API key needed — OpenAlex is free and CC0. Pass --mailto you@rise.se to use
its faster "polite pool".
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
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")
REVIEW_FILE = os.path.join(BASE_DIR, "suggested_prior_art.txt")
# Metadata for the candidates in the review file. Keeps the human-facing file to
# one short line per paper instead of embedded JSON, and means --apply does not
# have to re-query the API for what it already fetched.
CACHE_FILE = os.path.join(BASE_DIR, ".prior_art_cache.json")

OPENALEX_WORKS = "https://api.openalex.org/works"
OPENALEX_SELECT = ("display_name,publication_year,cited_by_count,doi,authorships,"
                   "primary_location,type,abstract_inverted_index")

# Non-research records OpenAlex indexes alongside papers.
EXCLUDED_TYPES = {"paratext", "editorial", "erratum", "letter", "grant", "peer-review"}

# Words too generic to prove a paper is on-topic.
QUERY_STOPWORDS = {
    "and", "the", "for", "with", "using", "based", "toward", "towards", "into",
    "system", "systems", "framework", "platform", "technology", "technologies",
    "tools", "tech", "advanced", "next", "new", "novel", "open", "smart",
}
MIN_TERM_LEN = 4
# How many top-relevance results to re-rank by citations. Too small and the
# foundational paper may sit just outside the window; too large and relevance
# thins out until unrelated megahits creep back in.
RELEVANCE_WINDOW = 40
REQUEST_PAUSE = 1.0  # OpenAlex is generous; this is courtesy, not necessity


# --- shared helpers (kept in step with import_orcid.py) ----------------------

def norm_title(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()[:90]


def make_pub_id(doi, title, year):
    """Identical scheme to import_orcid.make_pub_id, so a paper that is both our
    output and prior art lands on ONE node rather than two."""
    if doi:
        slug = re.sub(r"[^a-z0-9]+", "-", doi.lower()).strip("-")
        return f"pub-{slug}"
    raw = f"{title}-{year}".lower()
    return f"pub-{hashlib.md5(raw.encode()).hexdigest()[:10]}"


def truncate_label(title, max_len=30):
    if len(title) <= max_len:
        return title
    label = ""
    for w in title.split():
        if len(label) + len(w) + 1 > max_len:
            break
        label = f"{label} {w}" if label else w
    return label + "..." if label != title else title


def stamp_provenance(d, source):
    """`source` is a node key only — on an edge that key is the source node id."""
    is_edge = "source" in d and "target" in d
    if not is_edge:
        d.setdefault("source", source)
    d["updatedBy"] = "import_prior_art.py"
    d["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_data():
    with open(DATA_FILE, encoding="utf-8") as f:
        return json.load(f)


def save_data(data, backup=True):
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


def stones_of(data):
    return [n["data"] for n in data["nodes"]
            if n["data"].get("type") == "topic"
            and n["data"].get("kind", "stone") == "stone"]


def label_of(d):
    return (d.get("label") or d.get("id", "")).replace("\n", " ")


# --- Semantic Scholar --------------------------------------------------------

def stem(w):
    """Crude suffix fold, applied to both sides so it only has to be consistent
    ("Mesh Networking" must match a paper saying "mesh networks")."""
    for suf, repl in (("ies", "y"), ("ing", ""), ("es", ""), ("s", "")):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            return w[: -len(suf)] + repl
    return w


def content_terms(text):
    """Stemmed words of `text` that actually carry topic meaning."""
    words = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).split()
    return {stem(w) for w in words
            if len(w) >= MIN_TERM_LEN and w not in QUERY_STOPWORDS}


def work_terms(work):
    """Every stemmed word in a work's title and abstract.

    OpenAlex stores abstracts as an inverted index, whose KEYS are exactly the
    set of words — which is all this check needs, no reconstruction required.
    """
    text = work.get("display_name") or ""
    words = re.sub(r"[^a-z0-9]+", " ", text.lower()).split()
    terms = {stem(w) for w in words if len(w) >= MIN_TERM_LEN}
    for w in (work.get("abstract_inverted_index") or {}):
        w = re.sub(r"[^a-z0-9]", "", w.lower())
        if len(w) >= MIN_TERM_LEN:
            terms.add(stem(w))
    return terms


def clean_query(query):
    """Commas and colons are OpenAlex filter syntax, so strip them from values."""
    return re.sub(r"\s+", " ", re.sub(r"[,:|]", " ", query)).strip()


def openalex_search(query, mailto=None):
    """Top-relevance works for a query. NO server-side citation sort — see the
    module docstring for why that ruins the results."""
    params = {
        "filter": f"title_and_abstract.search:{clean_query(query)}",
        "per-page": RELEVANCE_WINDOW,
        "select": OPENALEX_SELECT,
    }
    if mailto:
        params["mailto"] = mailto
    url = f"{OPENALEX_WORKS}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "rise-foresight-graph/1.0 (mailto:%s)" % (mailto or "n/a")})
    time.sleep(REQUEST_PAUSE)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read()).get("results") or []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 5 * (attempt + 1)
                print(f"    rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue
            print(f"    API error {e.code} for query {query!r}")
            return []
        except (urllib.error.URLError, TimeoutError):
            if attempt < 2:
                time.sleep(2)
                continue
            print(f"    timeout for query {query!r}")
            return []
    return []


def author_string(authorships, max_names=3):
    names = [(a.get("author") or {}).get("display_name")
             for a in (authorships or [])]
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) <= max_names:
        return ", ".join(names)
    return ", ".join(names[:max_names]) + " et al."


def find_prior_art(query, limit, min_citations, mailto=None):
    """Return (candidates, skipped_counts): relevant first, then most-cited."""
    raw = openalex_search(query, mailto=mailto)
    skipped = {"no_doi": 0, "few_citations": 0, "off_topic": 0, "not_research": 0}
    required = content_terms(query)
    out = []
    for w in raw:
        title = (w.get("display_name") or "").strip()
        if not title:
            continue
        if (w.get("type") or "") in EXCLUDED_TYPES:
            skipped["not_research"] += 1
            continue
        # Every content word of the query must actually appear. Without this,
        # citation re-ranking hands "Intermittent Computing" a 1997 paper on
        # intermittent CLAUDICATION: one word matched, 674 citations did the rest.
        if required and not required.issubset(work_terms(w)):
            skipped["off_topic"] += 1
            continue
        doi = w.get("doi")  # OpenAlex returns a URL; store the bare DOI
        if doi:
            doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi)
        if not doi:
            skipped["no_doi"] += 1  # no stable id -> would duplicate on re-import
            continue
        cites = w.get("cited_by_count") or 0
        if cites < min_citations:
            skipped["few_citations"] += 1
            continue
        source = (w.get("primary_location") or {}).get("source") or {}
        out.append({
            "title": title,
            "year": w.get("publication_year"),
            "venue": (source.get("display_name") or "").strip() or None,
            "doi": doi,
            "citations": cites,
            "authors": author_string(w.get("authorships")),
        })
    # Re-rank WITHIN the relevance window only.
    out.sort(key=lambda c: -c["citations"])
    return out[:limit], skipped


# --- review file -------------------------------------------------------------

def skip_note(skipped):
    """Never silently drop candidates — say what was filtered and why."""
    labels = [("off_topic", "missing a query term"), ("few_citations", "below the citation floor"),
              ("no_doi", "without a DOI"), ("not_research", "not research articles")]
    parts = [f"{skipped[k]} {text}" for k, text in labels if skipped.get(k)]
    return ", ".join(parts) or "nothing filtered"


def write_review(results, path, cache_path):
    """results: [(stone_data, query, candidates, skipped)]"""
    lines = [
        "# Suggested PRIOR ART (state of the art) per stepping stone.",
        "# NOTHING has been written to data.json.",
        "#",
        "# Apply the lines you accept with:",
        f"#   python import_prior_art.py --apply",
        "#",
        "# Ranked by citation count, which favours foundational work: an older",
        "# paper has had years to accumulate citations, a 2025 one has not.",
        "# Comment out (#) or delete any line that is not really prior art for",
        "# that stone — a keyword match is not the same as a foundational paper.",
        "",
    ]
    cache = {}
    for stone, query, cands, skipped in results:
        lines.append(f"## {label_of(stone)}   (query: {query!r})")
        if not cands:
            lines.append("#   (no candidates — " + skip_note(skipped) + ")")
            lines.append("#   Try a better query:  python import_prior_art.py "
                         f"--stone {stone['id']} --query \"...\"")
            lines.append("")
            continue
        for c in cands:
            pid = make_pub_id(c["doi"], c["title"], c["year"])
            cache[pid] = c
            authors = c["authors"] or "unknown authors"
            venue = f" · {c['venue']}" if c["venue"] else ""
            lines.append(f"#   {c['citations']:>6} cites | {c['year']} | {authors}{venue}")
            lines.append(f"#   {c['title']}")
            lines.append(f"priorArt {stone['id']} {pid}")
        lines.append("#   (skipped: " + skip_note(skipped) + ")")
        lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)


def read_accepted(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) == 3 and parts[0] == "priorArt":
                out.append((parts[1], parts[2]))  # (stone_id, pub_id)
    return out


# --- apply -------------------------------------------------------------------

def apply_prior_art(data, accepted, cache):
    node_ids = {n["data"]["id"] for n in data["nodes"]}
    # Index existing publications by title so a paper already in the graph (e.g.
    # imported from a unit member's ORCID) gets the edge instead of a twin node.
    title_index = {}
    for n in data["nodes"]:
        if n["data"].get("type") == "publication":
            title_index.setdefault(norm_title(n["data"].get("description")
                                              or n["data"].get("label")),
                                   n["data"]["id"])
    existing_edges = {(e["data"]["source"], e["data"]["target"], e["data"].get("type"))
                      for e in data["edges"]}

    stats = {"nodes": 0, "edges": 0, "reused": 0, "skipped": 0}
    for stone_id, pub_id in accepted:
        if stone_id not in node_ids:
            print(f"  skip (unknown stone): {stone_id}")
            stats["skipped"] += 1
            continue
        meta = cache.get(pub_id)
        if not meta and pub_id not in node_ids:
            print(f"  skip (no cached metadata): {pub_id} — re-run the search pass")
            stats["skipped"] += 1
            continue

        target_id = pub_id
        if pub_id not in node_ids:
            existing = title_index.get(norm_title(meta["title"]))
            if existing:
                target_id = existing  # same paper, different DOI/route
                stats["reused"] += 1
            else:
                pub = {
                    "id": pub_id,
                    "type": "publication",
                    "label": truncate_label(meta["title"]),
                    "description": meta["title"],
                    "year": meta["year"],
                    "venue": meta["venue"],
                    "doi": meta["doi"],
                    "citations": meta["citations"],
                    "authors": meta["authors"] or None,
                    # Published papers are citable, so prior art is the first
                    # content that can legitimately reach a public build.
                    "sensitivity": "public",
                }
                stamp_provenance(pub, f"openalex:{meta['doi']}")
                data["nodes"].append({"data": pub})
                node_ids.add(pub_id)
                title_index[norm_title(meta["title"])] = pub_id
                stats["nodes"] += 1
        else:
            stats["reused"] += 1

        key = (target_id, stone_id, "priorArt")
        if key in existing_edges:
            stats["skipped"] += 1
            continue
        edge = {"source": target_id, "target": stone_id, "type": "priorArt"}
        stamp_provenance(edge, "prior_art")
        data["edges"].append({"data": edge})
        existing_edges.add(key)
        stats["edges"] += 1

    return stats


# --- query building ----------------------------------------------------------

def query_for(stone):
    """Stone label plus any curated keywords — the same vocabulary suggest_links
    matches on, so the two tools stay consistent."""
    parts = [label_of(stone)]
    parts += stone.get("keywords") or []
    return " ".join(parts)


def parse_seeds(path):
    seeds = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            sid, query = line.split(":", 1)
            seeds.append((sid.strip(), query.strip()))
    return seeds


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all-stones", action="store_true",
                    help="Search for every stepping stone, query = label + keywords")
    ap.add_argument("--stone", help="Single stone id to search for")
    ap.add_argument("--query", help="Query to use with --stone (default: its label)")
    ap.add_argument("--seeds", help="File of `stone_id: query` lines")
    ap.add_argument("--limit", type=int, default=5, help="Papers per stone (default 5)")
    ap.add_argument("--min-citations", type=int, default=10,
                    help="Ignore papers below this citation count (default 10)")
    ap.add_argument("--mailto", help="Your email — uses OpenAlex's faster polite pool")
    ap.add_argument("--apply", action="store_true",
                    help="Write the accepted lines from the review file to data.json")
    ap.add_argument("--accept", help="Review file to apply (default suggested_prior_art.txt)")
    args = ap.parse_args()

    data = load_data()
    print(f"Loaded data.json: {len(data['nodes'])} nodes, {len(data['edges'])} edges\n")

    if args.apply:
        path = args.accept or REVIEW_FILE
        if not os.path.exists(path):
            print(f"No review file at {path}. Run a search pass first.")
            sys.exit(1)
        cache = {}
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, encoding="utf-8") as f:
                cache = json.load(f)
        accepted = read_accepted(path)
        print(f"Applying {len(accepted)} accepted prior-art link(s) "
              f"from {os.path.basename(path)}")
        stats = apply_prior_art(data, accepted, cache)
        print(f"  publications added : {stats['nodes']}")
        print(f"  existing reused    : {stats['reused']}")
        print(f"  priorArt edges     : {stats['edges']}")
        print(f"  skipped            : {stats['skipped']}")
        if stats["nodes"] or stats["edges"]:
            save_data(data)
        else:
            print("Nothing to write.")
        return

    by_id = {s["id"]: s for s in stones_of(data)}
    targets = []
    if args.all_stones:
        targets = [(sid, query_for(s)) for sid, s in by_id.items()]
    elif args.stone:
        if args.stone not in by_id:
            print(f"No such stone: {args.stone}")
            print("Known stones: " + ", ".join(sorted(by_id)))
            sys.exit(1)
        targets = [(args.stone, args.query or query_for(by_id[args.stone]))]
    elif args.seeds:
        for sid, query in parse_seeds(args.seeds):
            if sid not in by_id:
                print(f"  warning: unknown stone id {sid!r} in seeds — skipping")
                continue
            targets.append((sid, query))
    else:
        ap.print_help()
        sys.exit(1)

    results = []
    for i, (sid, query) in enumerate(targets, 1):
        stone = by_id[sid]
        print(f"[{i}/{len(targets)}] {label_of(stone)}  <- {query!r}", flush=True)
        cands, skipped = find_prior_art(query, args.limit, args.min_citations,
                                        mailto=args.mailto)
        results.append((stone, query, cands, skipped))
        if cands:
            top = cands[0]
            print(f"    {len(cands)} candidate(s); top: {top['citations']} cites, "
                  f"{top['year']} — {top['title'][:60]}")
        else:
            print("    no candidates")

    write_review(results, REVIEW_FILE, CACHE_FILE)
    total = sum(len(c) for _, _, c, _ in results)
    empty = [label_of(s) for s, _, c, _ in results if not c]
    print(f"\n{total} prior-art candidate(s) across {len(targets)} stone(s)")
    if empty:
        print(f"No candidates for: {', '.join(empty)}")
    print(f"Review file: {os.path.basename(REVIEW_FILE)}")
    print("Then:  python import_prior_art.py --apply")


if __name__ == "__main__":
    main()
