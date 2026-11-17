"""Process-scoped mitmproxy addon. Emits metadata only, never headers or bodies."""
import json
import asyncio
import re
import sys
import time
from urllib.parse import urlsplit
from mitmproxy import ctx


def emit(value):
    sys.stdout.write("POKEMON_TRACE " + json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def safe_path(path):
    # URL path segments may themselves contain credentials. Hide long identifiers,
    # emails, encoded values, and the value following authentication path names.
    safe_words = {"api", "v1", "v2", "v3", "v4", "list", "search", "query", "mail", "inbox", "messages", "items", "folders", "users", "me", "rpc", "graphql", "browse", "player", "next", "ping", "health", "status", "sync", "events", "batch", "send", "update", "delete", "create", "read", "get", "post", "outlook", "service.svc", "owa", "youtubei", "config", "static", "assets", ""}
    parts, protected = [], False
    for segment in path.split("/")[:32]:
        sensitive = protected or segment.lower() not in safe_words
        parts.append("[protected]" if sensitive else segment)
        protected = bool(re.search(r"token|secret|password|session|auth|key", segment, re.I))
    return "/".join(parts)[:500]


class Recorder:
    def __init__(self):
        self.count = 0

    async def running(self):
        emit({"kind": "ready", "mode": "local"})
        async def control():
            await asyncio.to_thread(sys.stdin.readline)
            ctx.master.shutdown()
        self.control = asyncio.create_task(control())

    def response(self, flow):
        self.capture(flow, flow.response.status_code)

    def error(self, flow):
        self.capture(flow, 0)

    def capture(self, flow, status):
        if self.count >= 500 or not flow.request:
            return
        address = urlsplit(flow.request.pretty_url)
        if address.scheme not in ("http", "https"):
            return
        self.count += 1
        emit({"kind": "request", "at": int(time.time() * 1000),
              "method": flow.request.method[:12],
              "endpoint": address.scheme + "://" + (address.hostname or "") +
              (":" + str(address.port) if address.port else "") + safe_path(address.path),
              "status": status, "duration_ms": max(0, int((time.time() - flow.request.timestamp_start) * 1000)),
              "body_bytes": len(flow.request.raw_content or b""),
              "failed": status == 0})


addons = [Recorder()]
