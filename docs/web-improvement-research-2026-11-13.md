# Web research: useful next improvements

Reviewed on November 13, 2026 using the Pokémon MCP browser tools and the existing Edge profile. Compared the public sources below with checkout `9834891`. The packaging correction is published, and the guidance reduction below is implemented locally. Other recommendations remain proposals; model-latency gains have not been measured.

## Immediate finding: include the local launcher in desktop downloads

The new config generator references `scripts/start-mcp.cjs`, but `scripts/package-desktop.cjs` previously copied only `scripts/config.cjs`. A generated configuration from a new desktop ZIP would therefore point to a missing file. The desktop-package smoke test also expected the previous direct-backend path.

Corrected the desktop builder to ship both files. Updated the relocated-package test to require the actual launcher, check the paired working directory/frontend, and connect through the generated configuration. Its expected tool catalog now includes the already implemented research tool.

This is a packaging regression introduced by the recent launcher change, not a finding that every existing released download is broken. Existing downloads may contain their older config generator.

Verification passed on Windows x64: `npm run package:desktop` built the actual desktop ZIP and client bundles; `npm run test:desktop-package` extracted the ZIP to another folder, started and closed its real native launcher/Electron companion, verified bundled Node, generated portable configuration, and connected the shipped MCP tools. macOS/Linux were not physically tested in this session. The local launcher regression test now compares canonical temporary-directory paths, which also accommodates symlinked temporary directories on macOS.

The correction was committed and pushed to GitHub main as [65ca05a](https://github.com/Minsun1503/pokemon-companion/commit/65ca05a44e488b8cbb9afeb95e0c2d9a17956714). GitHub main was verified to match that commit.

## 1. Reduce repeated tool instruction text

**Evidence.** [Anthropic's advanced tool-use article](https://www.anthropic.com/research/advanced-tool-use) describes the context cost of loading tool definitions and an on-demand tool-search approach. Its reported improvements concern Anthropic's own evaluations, not this project.

The repository's [shared instructions](../backend/src/learning/instructions.ts) concatenate to 6,163 characters. In this session, the MCP client exposed a 6,162-character version of that same guidance in each of eight tool descriptions: 49,296 repeated characters, excluding schemas and tool-specific text. These are character counts, not tokenizer measurements. The one-character difference is trailing whitespace.

**Change.** Compress the shared instructions, retain the essential pause, authorization, target-identity, verification, and retry rules, and move longer optional workflow examples into explicit guides/prompts. Check how each supported client exposes the result. Do not merely move guidance to initialization: [createServer already sets server instructions](../backend/src/index.ts), and this client propagates them into tool descriptions.

**Acceptance.** Measure actual serialized catalog size/token counts before and after; rerun tool-selection tasks with equal observations, all correctness checks, and client-gap timing. Test Claude and Codex separately. Report end-to-end latency and errors rather than claiming a native-worker speedup.

**Priority:** first performance experiment. Small implementation scope, with a required behavior comparison.

**Implemented locally.** Shared guidance now measures 3,406 UTF-8 bytes, down 44.7% from 6,163. The observed eight-tool expansion decreases from 49,296 to 27,240 characters. Added a reproducible benchmark and an actual MCP initialization test with a 3,500-byte budget. Tool schemas/annotations are unchanged, static checks passed, and 394 tests passed with one skipped. This establishes text reduction and implementation regression coverage; a controlled model-selection/latency comparison remains outstanding. See [measurements and reproduction steps](tool-guidance.md).

## 2. Complete mixed-DPI and multi-monitor support

**Evidence.** [Electron's screen API](https://www.electronjs.org/docs/latest/api/screen) distinguishes physical pixels from device-independent pixels, provides display-relative conversion functions, and emits display changes for bounds, work area, scale factor, and rotation.

The [companion](../frontend/src/main/companion/index.ts) already enumerates displays, listens for display changes, and converts Windows physical target points to DIP. The [desktop status tool](../backend/src/tools/desktop.ts) still explicitly limits screenshot/physical-coordinate coverage to the primary display. README also records that physical dragging between monitors has not been verified.

**Change.** Add an explicit display selection and coordinate-origin contract to screenshots/input, while preserving the current primary-display default. Return the selected display's origin and scale with a screenshot so an agent can map points correctly. Extend the existing native drag test to real monitor handoff where hardware is available.

**Acceptance.** Test monitors to the left/above the primary screen, different 100%/125%/150% scales, rotation, unplugging the selected monitor, and restoring saved placement. A point in a selected screenshot must hit the same intended control on that display. Keep synthetic geometry tests and physical hardware results clearly distinguished.

**Priority:** strongest desktop capability improvement.

## 3. Add keyboard access to opening and repositioning the pet

**Evidence.** [W3C's explanation of keyboard operability](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) recommends keyboard equivalents for pointer actions and explains that moving objects normally can be operated from a keyboard.

The repo already uses real buttons, accessible labels, status announcements, and reduced-motion handling. It currently registers a pause shortcut; pet grabbing uses pointer events, and opening the panel starts by clicking a normally non-focusable overlay.

**Change.** Provide a configurable shortcut to open/focus the pet controls, a reposition mode with arrow keys and larger Shift-arrow steps, and simple placement buttons such as screen corners. When opening Switch, focus the selected pet or first meaningful control; preserve predictable Escape and focus restoration. Avoid changing the overlay into a modal dialog unless that interaction is actually intended.

**Acceptance.** Open the controls, select a companion, reposition it, toggle movement, and close the controls without a mouse. Verify visible focus and screen-reader labels. Keep pointer dragging and native click-through behavior working.

**Priority:** practical usability improvement after the performance experiment.

## 4. Sign public desktop releases

**Evidence.** [Electron's code-signing guide](https://www.electronjs.org/docs/latest/tutorial/code-signing) explains Windows signing and the separate signing/notarization steps for macOS distribution.

The current [desktop builder](../scripts/package-desktop.cjs) uses ad-hoc macOS signing, and INSTALL.md documents unsigned Windows binaries and no Apple notarization. Checksums and bundled-runtime verification are already present; signing adds publisher authentication and improves the installation experience.

**Change.** Add an opt-in release-signing pipeline for Windows and Developer ID signing plus notarization for macOS. Use protected CI credentials and verify signatures on the packaged artifact. Keep development builds usable without signing credentials.

**Acceptance.** Verify publisher/signature metadata and macOS notarization on relocated download artifacts, then test normal installation on a clean machine. This requires suitable signing identities/accounts; code changes alone cannot provide them.

**Priority:** release-quality work with external account/credential prerequisites.

## What already exists

Guarded retries, user-pause handling, native target identity, whole-batch isolation, reduced-motion behavior, movement persistence, native readiness, and contract/fixture tests already exist. They are not proposed here as missing features. The saved local launcher now pairs backend and frontend; a single source checkout is the normal fresh-clone layout.

## Recommended order

The packaging correction is shipped and verified, and the instruction-size reduction is implemented locally. Next measure model-selection/latency effects, followed by keyboard controls and multi-monitor coverage. Plan signed releases when the required publisher identities are available.
