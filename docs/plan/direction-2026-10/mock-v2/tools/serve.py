"""Static server for the prototypes that disables caching, so edits to shared/ show on reload.

Usage: python serve.py [port] [directory]   (defaults: 8795, the reader-app folder)
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8795
root = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent)
ThreadingHTTPServer(("127.0.0.1", port), partial(NoCache, directory=root)).serve_forever()
