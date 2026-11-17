"""Opt-in app-scoped mitmproxy capture. Never configures proxy or certificate trust."""
import asyncio
import base64
import ctypes
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SECRET_KEY = re.compile(r"password|passwd|secret|token|authorization|api.?key|cookie|session.?id|credential", re.I)
SECRET_VALUE = re.compile(r"Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b|\b(?:sk-[\w-]{12,}|gh[pousr]_\w{15,}|github_pat_\w{15,}|AKIA\w{16})\b", re.I)


def redact(value):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if SECRET_KEY.search(key) else redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return SECRET_VALUE.sub("[REDACTED]", value)
    return value


def protect_key(value, decrypt=False):
    if os.name != "nt":
        return value
    class Blob(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("data", ctypes.POINTER(ctypes.c_ubyte))]
    data = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    source, output = Blob(len(value), data), Blob()
    operation = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(Blob)]
    operation.restype = ctypes.c_int
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        ctypes.windll.kernel32.LocalFree(output.data)


class AppCapture:
    def __init__(self):
        self.events = []
        self.host = os.environ["POKEMON_CAPTURE_HOST"]
        self.process_id = int(os.environ["POKEMON_CAPTURE_PROCESS_ID"])
        self.output = Path(os.environ["POKEMON_API_CAPTURE_FILE"])
        self.expires_at = 0
        self.cleanup_task = None
        self.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        key_file = Path(str(self.output) + ".key")
        if not key_file.exists():
            key = os.urandom(32)
            with os.fdopen(os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
                handle.write(protect_key(key))
        self.key = protect_key(key_file.read_bytes(), decrypt=True)
        if len(self.key) != 32:
            raise ValueError("Invalid API capture encryption key")

    async def running(self):
        async def cleanup():
            while True:
                await asyncio.sleep(1)
                self.purge_expired(int(time.time() * 1000))
        self.cleanup_task = asyncio.create_task(cleanup())

    def done(self):
        if self.cleanup_task:
            self.cleanup_task.cancel()

    def purge_expired(self, now):
        if self.expires_at and now >= self.expires_at:
            self.output.unlink(missing_ok=True)
            self.events.clear()
            self.expires_at = 0

    def response(self, flow):
        if flow.request.host != self.host:
            return
        response = flow.response
        if not response or len(response.raw_content or b"") > 65536:
            return
        # JSON only: secret keys in arbitrary text cannot be redacted reliably.
        if "json" not in response.headers.get("content-type", ""):
            return
        content = response.content or b""
        if len(content) > 65536:
            return
        try:
            body = json.dumps(redact(json.loads(content)), separators=(",", ":"))
        except (ValueError, UnicodeError):
            return
        if len(body) > 16000:
            return
        parsed = urlsplit(flow.request.pretty_url)
        hostname = parsed.hostname or ""
        netloc = f"[{hostname}]" if ":" in hostname else hostname
        if parsed.port:
            netloc += f":{parsed.port}"
        url = urlunsplit((parsed.scheme, netloc, SECRET_VALUE.sub("[REDACTED]", parsed.path), "", ""))
        now = int(time.time() * 1000)
        self.events = [event for event in self.events if now - event["at"] < 300000]
        self.events.append({"at": now, "url": url, "status": response.status_code, "body": body})
        self.events = self.events[-200:]
        payload = {"process_id": self.process_id, "captured_at": now, "provenance": "operator-asserted, not process-attributed", "events": self.events}
        nonce = os.urandom(12)
        encrypted = nonce + AESGCM(self.key).encrypt(nonce, json.dumps(payload).encode(), b"pokemon-api-capture-v1")
        self.expires_at = now + 300000
        envelope = {"version": 1, "format": "pokemon-api-capture-aes-gcm", "expires_at": self.expires_at, "data": base64.b64encode(encrypted).decode()}
        temporary = self.output.with_name(self.output.name + ".tmp")
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as handle:
            json.dump(envelope, handle)
        temporary.replace(self.output)


addons = [AppCapture()] if os.environ.get("POKEMON_CAPTURE_ENABLED") == "on" else []
