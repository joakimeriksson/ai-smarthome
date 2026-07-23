#!/usr/bin/env python3
"""Derive the foresight<->reality bridge from publications.

Publications are the evidence layer: they carry authorship, and their titles are
the only machine-readable signal of what a researcher actually works on. This
script turns that signal into two things, neither of which is written without
review:

  --evidences   match publication titles against stepping stones, proposing
                `evidences` (publication -> stone) edges and, from those,
                `works_on` (researcher -> stone) edges.

  --topics      extract each researcher's recurring terms from their own titles
                — the raw material for authoring stones that reflect the unit,
                rather than guessing at them.

Both write a reviewable file and change nothing. `--apply` (with --evidences)
merges the accepted edges using the same atomic write + version bump + provenance
contract as import_orcid.py.

Usage:
  python suggest_links.py --topics
  python suggest_links.py --evidences
  python suggest_links.py --evidences --apply
  python suggest_links.py --evidences --apply --accept suggested_evidences.txt

Tuning: give a stone node a "keywords": ["...", "..."] array in data.json and
those phrases are matched too. That is the intended way to teach the matcher
vocabulary it cannot infer from a short label.
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE_DIR, "data.json")

# Words carrying no topical signal in an academic title.
STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "for", "in", "on", "to", "with", "by",
    "from", "at", "as", "is", "are", "be", "using", "via", "toward", "towards",
    "into", "over", "under", "we", "our", "their", "its", "it", "that", "this",
    "these", "those", "can", "you", "need", "know", "about", "what", "how",
    "why", "when", "where", "make", "most", "out", "up", "down", "new", "novel",
    "approach", "study", "case", "paper", "survey", "review", "analysis",
    "towards", "based", "aware", "driven", "scale", "large", "small", "high",
    "low", "fast", "efficient", "efficiently", "robust", "dynamic", "flexible",
    "general", "generic", "practical", "empirical", "evaluation", "framework",
    "method", "methods", "methodology", "technique", "techniques", "model",
    "models", "system", "systems", "design", "designing", "implementation",
    "performance", "results", "application", "applications", "use", "user",
    "users", "first", "second", "third", "one", "two", "three", "not", "no",
    "all", "more", "less", "than", "then", "also", "such", "between", "across",
    "within", "without", "through", "during", "after", "before", "against",
}

# Fraction of a stone's name-words a title must contain to count as a MEDIUM hit.
MIN_NAME_COVERAGE = 0.6
MIN_TERM_LEN = 4


def norm(text):
    """Lowercase, accent-fold, collapse to single-spaced words."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def stem(w):
    """Crude suffix fold, applied to BOTH sides so it only has to be consistent.

    Lets "Mesh Networking" match a title saying "mesh networks".
    """
    for suf, repl in (("ies", "y"), ("ing", ""), ("es", ""), ("s", "")):
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            return w[: -len(suf)] + repl
    return w


def words(text, stemmed=False):
    ws = [w for w in norm(text).split()
          if len(w) >= MIN_TERM_LEN and w not in STOPWORDS]
    return [stem(w) for w in ws] if stemmed else ws


def load_data():
    with open(DATA_FILE, encoding="utf-8") as f:
        return json.load(f)


def stamp_provenance(d, source):
    """`source` is a node key only — on an edge it is the source node id."""
    is_edge = "source" in d and "target" in d
    if not is_edge:
        d.setdefault("source", source)
    d["updatedBy"] = "suggest_links.py"
    d["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


def save_data(data, backup=True):
    """Atomic write + version bump, matching server.py's persistence contract."""
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


# --- graph helpers -----------------------------------------------------------

def index(data):
    by_id = {n["data"]["id"]: n["data"] for n in data["nodes"]}
    stones = [d for d in by_id.values()
              if d.get("type") == "topic" and d.get("kind", "stone") == "stone"]
    pubs = [d for d in by_id.values() if d.get("type") == "publication"]
    authors = defaultdict(list)   # pub id -> [researcher id]
    for e in data["edges"]:
        if e["data"].get("type") == "authored":
            authors[e["data"]["target"]].append(e["data"]["source"])
    return by_id, stones, pubs, authors


def label_of(d):
    return (d.get("label") or d.get("id", "")).replace("\n", " ")


def pub_text(d):
    """Prefer the untruncated description; the label is cut for display."""
    return d.get("description") or d.get("label") or ""


# --- stone vocabulary --------------------------------------------------------

def build_stone_terms(stones):
    """Per stone: (exact phrases, name terms).

    Vocabulary comes from the stone's NAME and its curated `keywords` — never
    from its description. Descriptions are prose ("Processing data closer to the
    source"), and mining them makes generic words like `data`/`source` look like
    topical evidence, which produced confident nonsense matches.
    """
    phrases, terms = {}, {}
    for s in stones:
        sid = s["id"]
        kw = s.get("keywords") or []
        ph = {norm(label_of(s))} | {norm(k) for k in kw}
        phrases[sid] = {p for p in ph if len(p) >= 6 and " " in p}
        terms[sid] = set(words(label_of(s), stemmed=True)) | {
            w for k in kw for w in words(k, stemmed=True)}
    return phrases, terms


def corpus_df(pubs):
    df = Counter()
    for p in pubs:
        df.update(set(words(pub_text(p), stemmed=True)))
    return df


def stone_anchors(terms, df):
    """Per stone, the one word a title must contain: its rarest occurring term.

    Coverage alone is not enough. "Federated Edge Learning" is 3 words, so a
    paper saying only "edge" and "learning" clears 60% coverage — which matched
    a reinforcement-learning paper with nothing federated about it. Requiring the
    stone's headline term ("federated") kills that without hand-tuned stopwords.

    Terms absent from the corpus are skipped: "mcus" never appears in any title,
    so it cannot be the anchor for RISC-V Edge MCUs.
    """
    anchors = {}
    for sid, ts in terms.items():
        present = [t for t in ts if df.get(t, 0) > 0]
        anchors[sid] = min(present, key=lambda t: df[t]) if present else None
    return anchors


def match_publication(text, phrases, terms, anchors=None):
    """Return [(stone_id, tier, evidence)] for one publication title.

    STRONG: the stone's full name (or a curated keyword phrase) appears verbatim.
    MEDIUM: most of the name's words appear, just not contiguously — e.g.
    "Federated Edge Learning" matching "...Coded Federated Learning...".
    Requiring COVERAGE, not a raw count, is what stops a 2-of-5-word overlap
    from passing as evidence.
    """
    n = " " + norm(text) + " "
    title_terms = set(words(text, stemmed=True))
    hits = []
    for sid in phrases:
        for p in sorted(phrases[sid], key=len, reverse=True):
            if f" {p} " in n:
                hits.append((sid, "STRONG", p))
                break
        else:
            total = terms[sid]
            if not total:
                continue
            found = sorted(title_terms & total)
            if len(found) < 2 or len(found) / len(total) < MIN_NAME_COVERAGE:
                continue
            # The stone's headline term must be one of them.
            if anchors is not None and anchors.get(sid) not in found:
                continue
            hits.append((sid, "MEDIUM", ", ".join(found)))
    return hits


# --- mode: evidences ---------------------------------------------------------

def suggest_evidences(data, min_pubs=2):
    by_id, stones, pubs, authors = index(data)
    phrases, stone_terms = build_stone_terms(stones)
    df = corpus_df(pubs)
    anchors = stone_anchors(stone_terms, df)

    existing_ev = {(e["data"]["source"], e["data"]["target"])
                   for e in data["edges"] if e["data"].get("type") == "evidences"}
    existing_wo = {(e["data"]["source"], e["data"]["target"])
                   for e in data["edges"] if e["data"].get("type") == "works_on"}

    ev = []                              # (pub_id, stone_id, tier, evidence)
    per_person = defaultdict(Counter)    # researcher -> Counter(stone)
    strong_person = defaultdict(set)     # researcher -> {stone with a STRONG hit}

    for p in pubs:
        for sid, tier, why in match_publication(pub_text(p), phrases, stone_terms, anchors):
            if (p["id"], sid) in existing_ev:
                continue
            ev.append((p["id"], sid, tier, why))
            for r in authors.get(p["id"], []):
                per_person[r][sid] += 1
                if tier == "STRONG":
                    strong_person[r].add(sid)

    # A person works on a stone if several of their papers evidence it, or one
    # does unambiguously. One weak hit is a coincidence, not a competence.
    wo = []
    for r, counts in per_person.items():
        for sid, c in counts.items():
            if (r, sid) in existing_wo:
                continue
            if c >= min_pubs or sid in strong_person[r]:
                wo.append((r, sid, c))

    return ev, wo, by_id


def write_evidence_file(ev, wo, by_id, path, min_pubs):
    lines = [
        "# Suggested links from publications. NOTHING has been written.",
        "# Apply the accepted lines with:",
        "#   python suggest_links.py --evidences --apply --accept " + os.path.basename(path),
        "#",
        "# STRONG = the stone's full name (or a curated keyword) appears in the title.",
        "# MEDIUM = 2+ distinctive terms from the stone appear. Check these.",
        "# Delete or comment out (#) any line you reject, then apply.",
        "#",
        f"# works_on is derived: >={min_pubs} evidencing papers, or 1 STRONG.",
        "",
        "## evidences  (publication -> stone)",
    ]
    for pub, sid, tier, why in sorted(ev, key=lambda x: (x[2] != "STRONG", x[1])):
        lines.append(f"# [{tier}] {label_of(by_id[pub])[:66]}")
        lines.append(f"#        -> {label_of(by_id[sid])}   (matched: {why})")
        lines.append(f"evidences {pub} {sid}")
    if not ev:
        lines.append("# (none)")

    lines += ["", "## works_on  (researcher -> stone), derived from the above"]
    for r, sid, c in sorted(wo, key=lambda x: -x[2]):
        lines.append(f"# {label_of(by_id[r])} -> {label_of(by_id[sid])}  ({c} paper(s))")
        lines.append(f"works_on {r} {sid}")
    if not wo:
        lines.append("# (none)")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def read_accept_file(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) == 3 and parts[0] in ("evidences", "works_on"):
                out.append(tuple(parts))
    return out


def apply_edges(data, triples):
    by_id = {n["data"]["id"] for n in data["nodes"]}
    existing = {(e["data"]["source"], e["data"]["target"], e["data"].get("type"))
                for e in data["edges"]}
    added, skipped = 0, 0
    for etype, src, tgt in triples:
        if src not in by_id or tgt not in by_id:
            print(f"  skip (unknown node): {etype} {src} -> {tgt}")
            skipped += 1
            continue
        if (src, tgt, etype) in existing:
            skipped += 1
            continue
        d = {"source": src, "target": tgt, "type": etype}
        stamp_provenance(d, "suggest_links")
        data["edges"].append({"data": d})
        existing.add((src, tgt, etype))
        added += 1
    return added, skipped


# --- mode: topics ------------------------------------------------------------

def extract_topics(data, top_n=10, min_count=2):
    """Recurring uni/bi-grams per researcher, from their own publication titles."""
    by_id, _, pubs, authors = index(data)
    pub_by_id = {p["id"]: p for p in pubs}

    per_person = defaultdict(list)
    for pid, rs in authors.items():
        if pid in pub_by_id:
            for r in rs:
                per_person[r].append(pub_text(pub_by_id[pid]))

    results = []
    for r, titles in per_person.items():
        grams = Counter()
        for t in titles:
            ws = words(t)
            grams.update(ws)
            grams.update(f"{a} {b}" for a, b in zip(ws, ws[1:]))
        # A bigram subsumes its parts; drop unigrams already covered by a kept bigram.
        top = [(g, c) for g, c in grams.most_common(top_n * 4) if c >= min_count]
        bigrams = [g for g, _ in top if " " in g]
        covered = {w for b in bigrams for w in b.split()}
        keep = [(g, c) for g, c in top if " " in g or g not in covered][:top_n]
        results.append((r, len(titles), keep))

    results.sort(key=lambda x: -x[1])
    return results, by_id


def write_topics_file(results, by_id, path):
    lines = [
        "# Topics and interests derived from each researcher's own publication titles.",
        "# Recurring terms only (a term must appear in 2+ of their papers).",
        "#",
        "# This is authoring raw material, not something to import: use it to write",
        "# stepping stones that reflect what the unit actually does, then link people",
        "# to them (person-link mode, or suggest_links.py --evidences once the stones",
        "# carry matching labels/keywords).",
        "",
    ]
    for r, n_pubs, terms in results:
        lines.append(f"## {label_of(by_id[r])}  ({n_pubs} publications)")
        if not terms:
            lines.append("   (no term recurs across their papers)")
        for g, c in terms:
            lines.append(f"   {c:3}x  {g}")
        lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--evidences", action="store_true",
                    help="Match publications to stones; propose evidences + works_on")
    ap.add_argument("--topics", action="store_true",
                    help="Extract recurring topics per researcher from their titles")
    ap.add_argument("--apply", action="store_true",
                    help="With --evidences: write the accepted edges to data.json")
    ap.add_argument("--accept", help="File of accepted lines (default: the generated one)")
    ap.add_argument("--min-pubs", type=int, default=2,
                    help="Papers evidencing a stone before works_on is proposed (default 2)")
    ap.add_argument("--top", type=int, default=10, help="Topics per researcher (default 10)")
    args = ap.parse_args()

    if not args.evidences and not args.topics:
        ap.print_help()
        sys.exit(1)

    data = load_data()
    print(f"Loaded data.json: {len(data['nodes'])} nodes, {len(data['edges'])} edges\n")

    if args.topics:
        results, by_id = extract_topics(data, top_n=args.top)
        out = os.path.join(BASE_DIR, "researcher_topics.txt")
        write_topics_file(results, by_id, out)
        print(f"Topics for {len(results)} researchers -> {os.path.basename(out)}")
        for r, n, terms in results[:8]:
            head = ", ".join(g for g, _ in terms[:5]) or "(nothing recurring)"
            print(f"  {label_of(by_id[r]):24} {n:4} pubs :: {head}")

    if args.evidences:
        ev, wo, by_id = suggest_evidences(data, min_pubs=args.min_pubs)
        out = os.path.join(BASE_DIR, "suggested_evidences.txt")

        if not args.apply:
            write_evidence_file(ev, wo, by_id, out, args.min_pubs)
            strong = sum(1 for e in ev if e[2] == "STRONG")
            print(f"\nevidences proposed: {len(ev)}  ({strong} STRONG, {len(ev)-strong} MEDIUM)")
            print(f"works_on  proposed: {len(wo)}")
            print(f"Review file: {os.path.basename(out)}")
            print("Then:  python suggest_links.py --evidences --apply")
            return

        accept_path = args.accept or out
        if not os.path.exists(accept_path):
            print(f"No accept file at {accept_path}; run without --apply first.")
            sys.exit(1)
        triples = read_accept_file(accept_path)
        print(f"Applying {len(triples)} accepted edge(s) from {os.path.basename(accept_path)}")
        added, skipped = apply_edges(data, triples)
        print(f"  added: {added}   already present/skipped: {skipped}")
        if added:
            save_data(data)
        else:
            print("Nothing to write.")


if __name__ == "__main__":
    main()
