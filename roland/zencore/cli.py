"""Command line front end: python3 -m zencore <command>."""

from __future__ import annotations

import argparse
import os
import sys

from .container import SvzError, build, parse, read_file
from .jsonio import build_from, export
from .schema import Schema
from .tone import Tone, ToneFile


def _schema(args) -> Schema | None:
    if getattr(args, "no_schema", False):
        return None
    try:
        return Schema.load(getattr(args, "schema", None))
    except FileNotFoundError as exc:
        print(f"warning: {exc}", file=sys.stderr)
        return None


def cmd_info(args) -> int:
    svz = read_file(args.file)
    print(
        f"{os.path.basename(args.file)}: SVZa v{svz.version[0]}.{svz.version[1]} "
        f"product={svz.product_name!r}"
    )
    for chunk in svz.chunks:
        kind = "variable" if chunk.variable else f"{chunk.record_size} B/rec"
        total = sum(len(r) for r in chunk.records)
        print(f"  {chunk.id}  {len(chunk.records):>4} rec  {kind:>12}  {total:>11} B")
        if chunk.named:
            for i, rec in enumerate(chunk.records):
                print(f"       [{i}] {Tone(rec).name}")
    return 0


def cmd_dump(args) -> int:
    schema = _schema(args)
    tf = ToneFile.open(args.file, schema)
    if not tf.tones:
        print("no PAT chunk / no tones", file=sys.stderr)
        return 1
    tone = tf.tones[args.tone]
    print(f"# {tone.name}  ({len(tone)} bytes)")
    if schema is None:
        print(tone.data.hex())
        return 0
    for group, params in schema.groups.items():
        named = [p for p in params if p.id]
        if not named:
            continue
        print(f"\n[{group}]")
        for p in named:
            val = schema.decode(tone.data, p)
            print(f"  {p.id:<18} @{p.pos:<5} {val!r:<22} {p.get('desc', '')}")
    return 0


def cmd_export(args) -> int:
    doc = export(args.file, args.output, _schema(args))
    n = sum(len(c["records"]) for c in doc["chunks"])
    print(f"wrote {os.path.join(args.output, 'svz.json')} ({n} records)")
    return 0


def cmd_build(args) -> int:
    build_from(args.input, args.output, _schema(args))
    print(f"wrote {args.output} ({os.path.getsize(args.output)} bytes)")
    return 0


def cmd_create(args) -> int:
    schema = _schema(args)
    if schema is None:
        print("create needs a schema", file=sys.stderr)
        return 2
    tf = ToneFile.create(tones=args.tones, schema=schema)
    if args.name:
        tf.tones[0].name = args.name
    tf.save(args.output)
    print(f"wrote {args.output} ({args.tones} init tones)")
    return 0


def cmd_rename(args) -> int:
    schema = _schema(args)
    tf = ToneFile.open(args.file, schema)
    old = tf.tones[args.tone].name
    tf.tones[args.tone].name = args.name
    tf.save(args.output or args.file)
    print(f"tone {args.tone}: {old!r} -> {tf.tones[args.tone].name!r}")
    return 0


def cmd_verify(args) -> int:
    rc = 0
    for path in args.files:
        with open(path, "rb") as fh:
            original = fh.read()
        try:
            rebuilt = build(parse(original))
        except SvzError as exc:
            print(f"FAIL  {os.path.basename(path)}: {exc}")
            rc = 1
            continue
        if rebuilt == original:
            print(f"OK    {os.path.basename(path)}  {len(original)} bytes byte-identical")
        else:
            rc = 1
            at = next((i for i, (a, b) in enumerate(zip(original, rebuilt)) if a != b), -1)
            print(f"FAIL  {os.path.basename(path)}  first difference at 0x{at:x}")
    return rc


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="zencore", description=__doc__)
    ap.add_argument("-s", "--schema", help="path to zcformat.json")
    ap.add_argument("--no-schema", action="store_true", help="raw bytes only")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("info", help="summarise a .svz")
    p.add_argument("file")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("dump", help="print a tone's named parameters")
    p.add_argument("file")
    p.add_argument("-t", "--tone", type=int, default=0)
    p.set_defaults(func=cmd_dump)

    p = sub.add_parser("export", help="explode a .svz to JSON")
    p.add_argument("file")
    p.add_argument("-o", "--output", required=True)
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("build", help="rebuild a .svz from a JSON directory")
    p.add_argument("input")
    p.add_argument("-o", "--output", required=True)
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("create", help="make a new .svz of init tones")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("-n", "--tones", type=int, default=1)
    p.add_argument("--name")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("rename", help="rename one tone in place")
    p.add_argument("file")
    p.add_argument("name")
    p.add_argument("-t", "--tone", type=int, default=0)
    p.add_argument("-o", "--output")
    p.set_defaults(func=cmd_rename)

    p = sub.add_parser("verify", help="check parse->build is byte-identical")
    p.add_argument("files", nargs="+")
    p.set_defaults(func=cmd_verify)
    return ap


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (SvzError, KeyError, IndexError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        raise SystemExit(0)
