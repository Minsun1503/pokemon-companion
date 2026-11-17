"""Verify real HTTP interception through mitmproxy, without changing system proxy or trust."""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"message":"API interception works"}')

    def log_message(self, *_args):
        pass


root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="pokemon-api-smoke-") as scratch_name:
    scratch = Path(scratch_name)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        proxy_port = reservation.getsockname()[1]
    output = scratch / "capture.json"
    environment = dict(os.environ, POKEMON_CAPTURE_ENABLED="on", POKEMON_CAPTURE_HOST="127.0.0.1", POKEMON_CAPTURE_PROCESS_ID=str(os.getpid()), POKEMON_API_CAPTURE_FILE=str(output))
    command = [sys.executable, "-c", "from mitmproxy.tools.main import mitmdump; mitmdump()",
               "--listen-host", "127.0.0.1", "--listen-port", str(proxy_port), "--set", f"confdir={scratch / 'mitm-conf'}",
               "-s", str(root / "scripts/api-capture.py")]
    process = subprocess.Popen(command, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError(process.communicate()[0].decode(errors="replace"))
            try:
                with socket.create_connection(("127.0.0.1", proxy_port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("mitmproxy did not start")
        connection = http.client.HTTPConnection("127.0.0.1", proxy_port, timeout=10)
        connection.request("GET", f"http://127.0.0.1:{server.server_port}/api?private=excluded")
        response = connection.getresponse()
        assert response.status == 200
        assert json.loads(response.read()) == {"message": "API interception works"}
        connection.close()
        for _ in range(100):
            if output.exists():
                break
            time.sleep(0.05)
        import importlib.util
        spec = importlib.util.spec_from_file_location("capture_addon", root / "scripts/api-capture.py")
        addon = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(addon)
        encrypted = base64.b64decode(json.loads(output.read_text())["data"])
        key = addon.protect_key(Path(str(output) + ".key").read_bytes(), decrypt=True)
        capture = json.loads(AESGCM(key).decrypt(encrypted[:12], encrypted[12:], b"pokemon-api-capture-v1"))
        assert capture["process_id"] == os.getpid()
        assert capture["events"][0]["body"] == '{"message":"API interception works"}'
        assert "?" not in capture["events"][0]["url"]
        assert "private" not in json.dumps(capture)
        report = {"verified": True, "transport": "HTTP through app-specific loopback proxy", "system_proxy_changed": False,
                  "trust_store_changed": False, "capture": capture}
        (root / "benchmarks/results/api-capture-smoke-2026-11-15.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
    finally:
        process.terminate()
        process.communicate(timeout=10)
        server.shutdown()
        server.server_close()
