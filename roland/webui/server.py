"""A thin HTTP layer over zencore - the API the browser editor and VA synth use.

Deliberately outside the `zencore` package: the library must not import
anything web-related, and this must not re-implement any format knowledge. All
it does is call ToneFile / Schema / va_patch and serialise the result.

Stdlib only, no framework.

    python3 webui/server.py User2.svz
    python3 webui/server.py User2.svz --port 8080

Endpoints:

    GET   /api/file              chunks, tone names, product, version
    GET   /api/tone/<i>          every parameter, grouped (Schema.to_dict shape)
    GET   /api/tone/<i>/va       the virtual-analog view, for the synth
    GET   /api/schema/<group>    parameter definitions incl. enum labels
    PATCH /api/tone/<i>          {"group":..,"id":..,"value":..} -> set one param
    POST  /api/save              {"path": ".."} -> write the file back

Round-trip is the acceptance test, exactly as for the library: load a file,
save it without edits, and the bytes must be unchanged.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from zencore import Schema, ToneFile  # noqa: E402
from zencore.va import va_patch  # noqa: E402

STATIC = Path(__file__).resolve().parent / "static"


class State:
    """The one loaded file. Single-user local tool - no sessions, no locking."""

    def __init__(self, path: Path):
        self.schema = Schema.load()
        self.path = Path(path)
        self.file = ToneFile.open(self.path, self.schema)
        self.original = self.path.read_bytes()

    def tone(self, index: int):
        if not 0 <= index < len(self.file.tones):
            raise IndexError(f"no tone {index}; file has {len(self.file.tones)}")
        return self.file.tones[index]

    def unchanged(self) -> bool:
        """True while the in-memory file still rebuilds to the original bytes."""
        return self.file.dumps() == self.original


state: State | None = None


class Handler(BaseHTTPRequestHandler):
    # The page loads a module graph plus one fetch per tone, all at once. On
    # HTTP/1.0 with a single-threaded server the browser stalls and gives up,
    # while curl - one request at a time - looks perfectly healthy.
    protocol_version = "HTTP/1.1"

    # -- plumbing ---------------------------------------------------------

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, exc, status=400):
        self._send({"error": str(exc), "type": type(exc).__name__}, status)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    def log_message(self, fmt, *args):
        pass  # quiet

    # -- routes -----------------------------------------------------------

    def do_GET(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        try:
            if parts == ["api", "file"]:
                return self._send({
                    "path": str(state.path),
                    "product": state.file.svz.product.decode("ascii", "replace"),
                    "version": ".".join(str(b) for b in state.file.svz.version),
                    "chunks": [{"id": c.id, "records": len(c.records),
                                "recordSize": c.record_size} for c in state.file.svz.chunks],
                    "tones": [{"index": i, "name": t.name}
                              for i, t in enumerate(state.file.tones)],
                    "unchanged": state.unchanged(),
                })
            if len(parts) == 3 and parts[:2] == ["api", "tone"]:
                return self._send(state.tone(int(parts[2])).to_dict())
            if len(parts) == 4 and parts[:2] == ["api", "tone"] and parts[3] == "va":
                return self._send(va_patch(state.tone(int(parts[2]))))
            if len(parts) == 3 and parts[:2] == ["api", "schema"]:
                group = parts[2]
                params = state.schema.groups.get(group)
                if params is None:
                    return self._fail(KeyError(f"no group {group!r}"), 404)
                return self._send([
                    {"id": p.id, "desc": p.get("desc"), "pos": p.pos, "size": p.size,
                     "min": p.get("min"), "max": p.get("max"), "init": p.get("init"),
                     "values": p.values}
                    for p in params if p.id])
            if parts == ["api", "schema"]:
                return self._send(sorted(state.schema.groups))
            return self._static(parts)
        except Exception as exc:  # noqa: BLE001 - report, never 500 silently
            self._fail(exc, 404 if isinstance(exc, (IndexError, KeyError)) else 400)

    def _static(self, parts):
        rel = "/".join(parts) or "index.html"
        target = (STATIC / rel).resolve()
        if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
            return self._send({"error": "not found", "path": rel}, 404)
        body = target.read_bytes()
        kind = {"html": "text/html", "js": "text/javascript",
                "css": "text/css", "json": "application/json"}.get(
                    target.suffix.lstrip("."), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_PATCH(self):
        parts = [p for p in self.path.split("/") if p]
        try:
            if len(parts) != 3 or parts[:2] != ["api", "tone"]:
                return self._fail(ValueError("PATCH /api/tone/<i>"), 404)
            tone = state.tone(int(parts[2]))
            body = self._body()
            if "name" in body:
                tone.name = body["name"]
            else:
                tone.set(body["group"], body["id"], body["value"])
            return self._send({"ok": True, "unchanged": state.unchanged()})
        except Exception as exc:  # noqa: BLE001
            self._fail(exc)

    def do_POST(self):
        try:
            if self.path.rstrip("/") != "/api/save":
                return self._fail(ValueError("POST /api/save"), 404)
            target = Path(self._body().get("path") or state.path)
            state.file.save(target)
            return self._send({"ok": True, "path": str(target),
                               "bytes": target.stat().st_size})
        except Exception as exc:  # noqa: BLE001
            self._fail(exc)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", help=".svz to load")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args(argv)

    global state
    state = State(args.file)
    print(f"{args.file}: {len(state.file.tones)} tones, "
          f"round-trip clean: {state.unchanged()}")
    print(f"http://{args.host}:{args.port}/")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
