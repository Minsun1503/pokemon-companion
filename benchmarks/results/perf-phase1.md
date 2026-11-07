# Phase 1: desktop latency baseline

November 7, 2026. Twenty samples per scenario per UI mode; all 520 samples verified. No optimization was applied. See [raw samples](perf-baseline.json) and [minimums and image sizes](perf-baseline.md). Setup, focus settling, and independent fixture checks are excluded. Timing spans overlap; do not sum nested spans.

| Scenario | UI on median / p95 ms | UI off median / p95 ms |
|---|---:|---:|
| Cold startup | 1828.9 / 2069.1 | 1605.1 / 1813.8 |
| Window discovery | 56.7 / 79.0 | 34.3 / 42.5 |
| UI narrow | 64.5 / 79.4 | 52.1 / 61.1 |
| UI wide | 77.3 / 99.2 | 68.4 / 75.3 |
| Set + verify, atomic | 92.4 / 106.3 | 68.4 / 90.9 |
| Set + verify, batch | 86.3 / 110.4 | 66.1 / 74.6 |
| Type 5 characters | 93.9 / 103.6 | 79.1 / 87.9 |
| Type 50 characters | 793.6 / 804.1 | 781.6 / 784.9 |
| Type 500 characters | 7812.3 / 7829.2 | 7790.0 / 7797.0 |
| Key chord | 48.0 / 52.7 | 31.2 / 39.5 |
| Left click | 135.7 / 145.7 | 105.8 / 118.4 |
| Screenshot | 741.8 / 889.4 | 613.6 / 824.9 |
| Pokémon say | 5.1 / 8.3 | 0.6 / 1.3 |

## Five main contributors

1. **Per-character keyboard waits.** The 500-character action median is 7795.2 ms with UI on and 7788.9 ms with UI off: over 99% of elapsed time. The installed nut.js implementation awaits `sleep(autoDelayMs)` for each character. At the configured 10 ms, the observed average is about 15.6 ms per character. Phase C can reduce this wait without expanding clipboard use.
2. **Cold process and worker startup.** UI-off cold elapsed is 1605.1 ms; first worker round-trip is 673.5 ms. The remaining approximately 930 ms includes connection, imports, and startup. The worker currently runs `Add-Type` on C# once per worker startup, not per call. It already persists. Phase B can precompile and overlap worker warmup; changing SDK/import architecture is outside the requested stages.
3. **Two screenshot PNG encodes.** UI-on median Jimp encoding is 135.0 ms and Sharp encoding is 268.4 ms; UI-off is 149.8 + 271.6 ms. Resize adds 115.3–127.3 ms. Phase D can feed raw pixels into the existing Sharp PNG encoder. PNG format and existing quality settings can stay unchanged.
4. **UIA property reads and traversal.** Narrow tree walk is 48.9 ms (UI on) / 48.6 ms (off); wide is 61.7 / 64.2 ms. These account for about 94–95% of worker round-trip. The worker repeatedly reads current properties and patterns and still walks after reaching the output limit. Phase B can cache inspection properties and bound traversal; live action safety checks must remain current.
5. **Companion updates and capture removal.** Before/after updates total about 11–13 ms for UI reads and 22–24 ms for paired field operations. Screenshot hide is 135.0 ms, including the deliberate 120 ms compositor wait. Phase A can make cosmetic rendering asynchronous while synchronously acknowledging interaction locking. Capture removal still needs to be awaited when the overlay is visible.

No new design decision is required for these planned fixes, so Phase 2 proceeds. No dependencies were added.

Typing uses `1234 ` repeated to reach 5, 50, or 500 characters. Earlier letter-based diagnostic samples were transformed under the active Vietnamese input method; they are preserved separately in [partial observations](perf-input-method-observations.json), and are not counted in this baseline. The benchmark does not change keyboard settings. Unicode/Vietnamese clipboard input remains separately covered by the existing smoke test.
