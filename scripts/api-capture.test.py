"""Synthetic capture privacy tests. No account, proxy setting or trust store changes."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

spec = importlib.util.spec_from_file_location("pokemon_capture", Path(__file__).with_name("api-capture.py"))
capture_module = importlib.util.module_from_spec(spec)
with patch.dict(os.environ, {"POKEMON_CAPTURE_ENABLED": "off"}):
    spec.loader.exec_module(capture_module)


class CapturePrivacyTests(unittest.TestCase):
    def test_off_by_default(self):
        self.assertEqual(capture_module.addons, [])

    def test_redaction_encryption_wrong_key_and_ttl(self):
        with tempfile.TemporaryDirectory(prefix="pokemon-capture-test-") as directory:
            output = Path(directory) / "capture.enc"
            with patch.dict(os.environ, {"POKEMON_CAPTURE_HOST": "example.test", "POKEMON_CAPTURE_PROCESS_ID": "42", "POKEMON_API_CAPTURE_FILE": str(output)}):
                capture = capture_module.AppCapture()
            body = json.dumps({"nested": {"access_token": "OPAQUE_PRIVATE_TOKEN", "password": "PRIVATE_PASSWORD"}, "message": "hello", "value": "Bearer TOKEN_IN_UNKNOWN_KEY"}).encode()
            flow = types.SimpleNamespace(request=types.SimpleNamespace(host="example.test", pretty_url="https://user:pass@example.test/api?token=URL_TOKEN#private"), response=types.SimpleNamespace(raw_content=body, content=body, headers={"content-type": "application/json"}, status_code=200))
            capture.response(flow)
            stored = output.read_text()
            for secret in ["OPAQUE_PRIVATE_TOKEN", "PRIVATE_PASSWORD", "TOKEN_IN_UNKNOWN_KEY", "URL_TOKEN", "hello"]:
                self.assertNotIn(secret, stored)
            envelope = json.loads(stored)
            encrypted = base64.b64decode(envelope["data"])
            data = AESGCM(capture.key).decrypt(encrypted[:12], encrypted[12:], b"pokemon-api-capture-v1")
            payload = json.loads(data)
            self.assertEqual(payload["events"][0]["url"], "https://example.test/api")
            self.assertEqual(payload["provenance"], "operator-asserted, not process-attributed")
            redacted = json.loads(payload["events"][0]["body"])
            self.assertEqual(redacted["message"], "hello")
            for secret in ["OPAQUE_PRIVATE_TOKEN", "PRIVATE_PASSWORD", "TOKEN_IN_UNKNOWN_KEY", "URL_TOKEN"]:
                self.assertNotIn(secret, data.decode())
            with self.assertRaises(Exception):
                AESGCM(os.urandom(32)).decrypt(encrypted[:12], encrypted[12:], b"pokemon-api-capture-v1")
            capture.purge_expired(envelope["expires_at"])
            self.assertFalse(output.exists())
            self.assertEqual(capture.events, [])

    def test_ignores_unscoped_host_and_non_json(self):
        with tempfile.TemporaryDirectory(prefix="pokemon-capture-test-") as directory:
            output = Path(directory) / "capture.enc"
            with patch.dict(os.environ, {"POKEMON_CAPTURE_HOST": "example.test", "POKEMON_CAPTURE_PROCESS_ID": "42", "POKEMON_API_CAPTURE_FILE": str(output)}):
                capture = capture_module.AppCapture()
            flow = types.SimpleNamespace(request=types.SimpleNamespace(host="elsewhere.test"), response=None)
            capture.response(flow)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
