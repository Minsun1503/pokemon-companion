import importlib.util
import json
import io
import contextlib
import types
from pathlib import Path
spec = importlib.util.spec_from_file_location("record_desktop", Path(__file__).with_name("record-desktop.py"))
addon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(addon)
flow = types.SimpleNamespace(request=types.SimpleNamespace(pretty_url="https://fixture.test/api/secret_cookie?token=QUERY_SECRET", method="POST", timestamp_start=0, raw_content=b"password=BODY_SECRET", headers={"Authorization": "Bearer HEADER_SECRET"}), response=types.SimpleNamespace(status_code=200))
output = io.StringIO()
with contextlib.redirect_stdout(output):
    recorder = addon.Recorder()
    recorder.response(flow)
    recorder.error(flow)
assert all(secret not in output.getvalue() for secret in ["secret_cookie", "QUERY_SECRET", "BODY_SECRET", "HEADER_SECRET"])
rows = [json.loads(line[len("POKEMON_TRACE "):]) for line in output.getvalue().splitlines()]
assert len(rows) == 2 and rows[0]["status"] == 200 and rows[1]["failed"]
print(json.dumps({"passed": True, "metadata_only": True, "failed_requests": True}))
