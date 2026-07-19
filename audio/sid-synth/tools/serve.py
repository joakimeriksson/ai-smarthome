#!/usr/bin/env python3
"""serve.py - development server for the SID tracker.

- Serves the repo root with Cache-Control: no-store (browser caching of
  stale JS has bitten this project repeatedly).
- Proxies /hvsc/<path> to a High Voltage SID Collection web mirror and
  caches downloads in hvsc-cache/ (gitignored) so repeat loads are
  instant and offline-friendly.

Usage: python3 tools/serve.py [port]     (default 8471)
"""
import http.server
import os
import sys
import urllib.request
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'hvsc-cache')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8471

# Mirror URL patterns; %s is the HVSC-relative path (e.g.
# /MUSICIANS/H/Hubbard_Rob/Commando.sid). Tried in order.
MIRRORS = [
    'https://hvsc.etv.cx/C64Music%s',
    'https://hvsc.etv.cx%s',
    'https://deepsid.chordian.net/hvsc%s',
    'https://www.hvsc.c64.org/download/C64Music%s',
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.startswith('/hvsc/'):
            return self.serve_hvsc()
        return super().do_GET()

    def serve_hvsc(self):
        rel = urllib.parse.unquote(self.path[len('/hvsc'):].split('?')[0])
        # sanitize: must be an absolute HVSC path without traversal
        if not rel.startswith('/') or '..' in rel:
            self.send_error(400, 'bad path')
            return
        cache_file = os.path.join(CACHE, rel.lstrip('/'))
        data = None
        if os.path.isfile(cache_file):
            with open(cache_file, 'rb') as f:
                data = f.read()
        else:
            for pattern in MIRRORS:
                url = pattern % urllib.parse.quote(rel)
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'sid-synth-tracker/1.0'})
                    with urllib.request.urlopen(req, timeout=25) as resp:
                        if resp.status == 200:
                            data = resp.read()
                            sys.stderr.write(f'hvsc: fetched {rel} from {url} ({len(data)} bytes)\n')
                            break
                except Exception as e:
                    sys.stderr.write(f'hvsc: {url}: {e}\n')
            if data is not None:
                os.makedirs(os.path.dirname(cache_file), exist_ok=True)
                with open(cache_file, 'wb') as f:
                    f.write(data)
        if data is None:
            self.send_error(404, 'not found on any HVSC mirror')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass  # keep quiet; hvsc fetches log explicitly


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('', PORT), Handler)
    print(f'serving {ROOT} on http://localhost:{PORT} (no-store; /hvsc/* proxied + cached)')
    server.serve_forever()
