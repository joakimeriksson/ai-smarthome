#!/usr/bin/env python3
"""Dump a tone's VA view as JSON, for the offline renderer.

    python3 webui/compare/dump_va.py User2.svz 2 > /tmp/patch.json
    python3 webui/compare/dump_va.py User2.svz --list

Kept separate from the HTTP server so the compare loop needs no server running.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from zencore import Schema, ToneFile  # noqa: E402
from zencore.va import va_patch  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file")
    ap.add_argument("tone", nargs="?", type=int, default=0)
    ap.add_argument("--list", action="store_true", help="list tones and exit")
    args = ap.parse_args(argv)

    schema = Schema.load()
    tf = ToneFile.open(args.file, schema)

    if args.list:
        for i, t in enumerate(tf.tones):
            p = va_patch(t)
            va = sum(1 for q in p["partials"] if q["on"] and q["synthesised"])
            print(f"{i}: {t.name:20} playable={p['playable']!s:5} va_partials={va}")
        return 0

    json.dump(va_patch(tf.tones[args.tone]), sys.stdout, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
