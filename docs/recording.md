# Pokémon Record button

Click the companion, then **Record**. Choose **Browser tab** or **Desktop app**, refresh targets, select one, and name the action you will demonstrate. Click **Record**, approve the capture scope in the Pokémon dialog, perform the action, then click **Stop**. **Mark step** timestamps the next named action. **Save readable trace** exports sanitized JSON.

Run `npm run record:demo` to open a separate Pokémon and a practice browser. Its profile and encrypted recordings live in `%LOCALAPPDATA%/pokemon-companion/recording-demo`. Closing that companion closes its recorder and browser. Shared MCP sessions are unaffected. Normal MCP companions use the same button after rebuilding and reconnecting the server.

| Mode | Captured evidence | Reuse |
| --- | --- | --- |
| Browser tab | Same-origin fetch/XHR requests and nearby main-frame clicks in browser sessions owned by this MCP process | Operation IDs refer to the existing encrypted session API catalog. Inspect, review its effect, and explicitly execute through the `api` MCP tool. |
| Desktop app | HTTP(S) request metadata from the verified window process and its current children through mitmproxy local capture | Readable diagnostic trace with named step markers. Headers, cookies, request/response bodies, and query values are omitted; this trace is not an executable replay template. |

The target is selected explicitly; clicking Pokémon changes the foreground application. Desktop scope includes other windows/tabs sharing that process family. Newly created child processes require stopping and starting Record again. Native process identity is checked while capturing; closing/changing the selected window stops capture. Pausing Pokémon stops desktop capture and suspends browser observation. Stop and status remain available while paused.

## Optional desktop setup

Install mitmproxy in the checkout's optional environment:

```powershell
py -3 -m venv .venv-api
.venv-api/Scripts/python.exe -m pip install mitmproxy==12.3.1
```

Or set `POKEMON_MITMDUMP` to an installed mitmdump executable and `POKEMON_CAPTURE_PYTHON` to its Python environment. Select **Desktop app → Prepare HTTPS certificate** to generate and open this recorder's CA without changing trust or proxy settings. Review and install trust yourself only where needed by the selected app. Windows local capture may request administrator approval. Certificates pinned by the app, unsupported protocols, and Windows loopback traffic can remain invisible. The button does not capture every kind of application protocol.

The desktop test uses a disposable process and a read-only request to example.com because Windows local redirectors may exclude localhost. It verifies capture, credential omission, Stop, and orderly proxy shutdown. No certificate trust is installed by tests.

## Limits and saved data

The latest demonstration trace is encrypted with AES-GCM and a current-user DPAPI key on Windows. A subsequent recording replaces that trace. Browser operation templates remain in the separate session API catalog. Desktop capture accepts at most 500 response/error observations and retains a bounded recent trace (at most 100 entries); step markers and bridge output are bounded too. Truncation is shown in the panel. Requests that are still in flight when Stop is clicked may be absent.

Click/marker proximity is timing evidence, not proof that an action caused a request. Background traffic can appear. Desktop URL paths retain a small set of common route words and hide other segments, and all query values are omitted. HTTP(S) errors with an available request appear with status zero. Recording never executes a saved request automatically. Desktop workflow replay needs a separately reviewed adapter; browser replay still requires a valid login session and the existing review/approval checks.

`npm run test:recording` checks the trusted UI bridge, recorder lifecycle, redaction, and an actual browser button demonstration. `npm run test:recording:desktop` checks real Windows process-scoped outbound HTTP capture. `POKEMON_RECORDING_DIR` selects a separate encrypted trace/certificate directory.
