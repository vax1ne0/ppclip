# Computer-use integrations: focused source review

Source review: 2026-10-18. The review below records the original investigation; the implementation follow-up documents subsequent work. Expected performance benefits remain engineering judgments unless measured. This supplements the [earlier investigation](computer-use.md).

## Implementation follow-up — 2026-10-19

- Added sandbox-wide egress enforcement, Chromium sandbox detection, offline profile archives, supported-revision CI and real Docker smoke checks.
- Applied Rakazo's recovery distinction and browser-window restoration pattern in ppclip's own provider; retained its existing authorization and private CDP pipe.
- Added bounded native AT-SPI observation inspired by OpenAgentFleet. Demonstration recording remains deferred pending explicit privacy/retention design.
- Built and ran pinned CUA Driver 0.35.4 in a disposable desktop. Native GTK entry/button observation and guarded input passed. The optional driver only observes; ppclip retains input authorization. Spaces/perception are excluded.
- Added a compact browser CLI over ppclip's MCP endpoint instead of importing browser-harness's independent Chrome attachment path. Authentication/error propagation are covered; comparative task/token benchmarks remain outstanding.
- Ran the pinned Neko Firefox fixture on loopback, observed live desktop frames, claimed controls and navigated its browser through streamed input. Removed the fixture afterward. No matched latency/CPU benchmark or production authentication/lease adapter is claimed. The default viewer remains noVNC.
- Steel Browser and E2B Desktop are excluded from this implementation scope.

Maintained behavior and limits: [computer use](../computer-use.md), [backups](../backups.md), [implementation status](../implementation-status.md). The following sections are historical review findings, not a list of additional shipped features.

Local validation: both recorded Paperclip revisions passed server/UI typechecks, 152 server tests and 258 UI tests each. Package/installer/CLI/launcher regressions passed, as did eight offline image-helper tests. Real Docker checks covered network bypass refusal, shared shell filtering, minimized-browser restoration, GTK controls and native-input/takeover serialization with both AT-SPI and CUA. Profile checks covered roundtrip, ownership, active-profile/online-supervisor refusal and overwrite refusal. The isolated stable app passed all 11 lifecycle checks without invoking a model. Stable overlay install/uninstall left its disposable checkout clean. GitHub Actions execution remains unverified until this workflow is pushed and run.

## Recommendation

Keep ppclip's supervisor, agent authorization, control epochs, private takeover, and audit boundary. Improve individual layers behind that boundary:

1. Use Rakazo's recovery and provider-contract patterns to harden the existing Docker implementation.
2. Prototype the MIT CUA Driver for semantic desktop observation and input inside an agent sandbox; compare its Linux behavior with OpenAgentFleet's smaller AT-SPI bridge.
3. Evaluate a browser CLI against ppclip's existing browser tools on the same tasks. Browser-harness is a candidate, but needs a controlled adapter to the existing browser.
4. Benchmark Neko as an optional viewer transport before deciding whether to replace noVNC.
5. Add E2B only when a remote-computer option is wanted; evaluate Steel separately for browser-only agents.
6. Consider demonstration recording after semantic observation and privacy behavior are reliable.

These projects are complementary in places, but combining all their default agent runtimes would duplicate Paperclip's orchestration.

## Current ppclip boundary

The installed implementation already provides Docker/fake providers, persistent browser profiles, desktop/taskbar recovery, structured browser page/element tools, MCP delivery to Claude/Codex, observation epochs, private takeover, and short-lived viewer tickets. Browser CDP uses a private pipe; shell runs as a different user. A browser CLI is not yet integrated.

`ComputerProvider` in `modules/computer-use/server/src/ppclip/computer-use/supervisor/provider.ts` has lifecycle, observation, browser, action, shell, and takeover methods. However, its stream contract is specifically a host/port/token noVNC upstream. Supporting WebRTC or hosted streams needs a richer, discriminated viewer contract, not merely another provider class. Capability reporting should distinguish semantic desktop access, browser access, streaming transport, profile persistence, suspension, and remote execution.

## 1. Rakazo: recovery patterns and provider architecture

**Decision: use as an architecture reference; do not embed its whole application.**

The adapter contract distinguishes a fresh replacement from reconnecting an existing computer and exposes graphical, snapshot, takeover, and persistent-home capabilities. Its factory selects Docker or remote providers with explicit configuration. These are useful references for adding remote computers without forcing identical capabilities onto every backend.

The supervisor separates failures that prove a command never reached the computer from failures where actions may already have happened. Only the former permits an action fallback. The focus-or-launch helper identifies browser windows by both application class and browser profile, helping avoid opening a duplicate or raising the wrong profile.

For ppclip: distinguish recovery from replacement in state/results; add explicit provider capabilities; strengthen browser-window recovery tests; keep action retries conservative. Much of the overall desktop design is already present, so adopting Rakazo wholesale offers less than targeted improvements.

Sources: [adapter contract](https://github.com/elie222/rakazo/blob/fa491b34c76dcbad238582778cb2ffcd44b2367a/packages/adapter-kit/src/types.ts), [supervisor control/failure handling](https://github.com/elie222/rakazo/blob/fa491b34c76dcbad238582778cb2ffcd44b2367a/infra/sandboxes/supervisor/src/supervisor-logic.ts), [window recovery](https://github.com/elie222/rakazo/blob/fa491b34c76dcbad238582778cb2ffcd44b2367a/infra/sandboxes/computer/rakazo-focus-or-launch).

## 3. OpenAgentFleet: semantic desktop tools and demonstrations

**Decision: useful small reference implementation; prototype accessibility before recording.**

Its AT-SPI bridge returns a bounded tree of roles, labels, bounds, and states. Accessibility queries run in child processes with hard timeouts because a wedged accessibility service previously blocked its daemon. This failure isolation matters as much as locating controls by name.

ppclip already has semantic browser elements; the new benefit would be native desktop applications, menus, dialogs, and file pickers. Add bounded desktop observation and epoch-scoped references, preserve screenshot fallback, and verify behavior when an application exposes little accessibility data. Adding Python AT-SPI/D-Bus dependencies would require a sandbox image change.

The recorder captures input, accessibility information, and selected frames. Its compiler produces human-readable skill instructions. The project's own guide reports unreliable step-by-step replay, so this is a demonstration-to-draft feature, not proven self-running automation. Also, the compiler's `scrub` removes invalid/control characters; it is not a general secret-redaction guarantee. A ppclip implementation would need explicit recording controls, private-takeover exclusion, retention/deletion, and review before saving or reusing a skill.

Sources: [AT-SPI bridge](https://github.com/BryantVanOrden/OpenAgentFleet/blob/961d7a0666cd1798202c77436c50e66d3fdf1879/sandbox/agentd/a11y.py), [recording and replay limitations](https://github.com/BryantVanOrden/OpenAgentFleet/blob/961d7a0666cd1798202c77436c50e66d3fdf1879/docs/SKILLS_AND_REFINEMENT.md), [compiler](https://github.com/BryantVanOrden/OpenAgentFleet/blob/961d7a0666cd1798202c77436c50e66d3fdf1879/backend/internal/recorder/compile.go).

## 4. Neko: optional WebRTC live viewer

**Decision: promising viewer experiment; performance must be measured.**

Neko uses Pion WebRTC for video, audio, and data, with client transport code and server sessions/control ownership. It could improve perceived motion, scrolling, and human input compared with our current VNC path, but this review does not establish lower latency on the user's machine.

It introduces a Go/media runtime and ICE networking. Docker Desktop, NAT, and remote deployments need explicit connectivity testing; some deployments need TURN. Our current HTTP/WebSocket proxy does not relay WebRTC media automatically. Neko's own ownership and session model must remain subordinate to ppclip's human leases, private mode, epoch changes, and revocation.

Prototype behind a transport flag while retaining noVNC. Measure input-to-visible-response latency, stream startup/reconnection, CPU/memory, and simultaneous viewers. Test disconnect during human takeover and reject input immediately after release/revoke. Neko does not supply the agent's reasoning or automatically improve browser element selection.

Sources: [WebRTC networking](https://github.com/m1k1o/neko/blob/020def0305cfb9fabd36371d2a112f6ee52c6533/webpage/docs/configuration/webrtc.md), [session/control contract](https://github.com/m1k1o/neko/blob/020def0305cfb9fabd36371d2a112f6ee52c6533/server/pkg/types/session.go), [client transport](https://github.com/m1k1o/neko/blob/020def0305cfb9fabd36371d2a112f6ee52c6533/client/core/src/transport/webrtc.ts).

## 5. Browser-harness: optional browser CLI

**Decision: worth a controlled comparison; not a direct plug-in for the current sandbox.**

It offers CLI and MCP entry points over a persistent Python/CDP daemon, with browser navigation, tab management, reading, downloads/uploads, and reusable helper code. The default workflow attaches to the user's real Chrome, but the daemon also supports explicit CDP URL/WebSocket configuration. Thus it can target a remote browser; personal Chrome is not a fundamental requirement.

ppclip currently exposes a private Chromium pipe rather than a CDP WebSocket. Integration needs a restricted internal bridge or a ppclip-aware command backend. Raw CDP/JavaScript and arbitrary helper execution cannot bypass takeover, private observation restrictions, site rules, confirmation rules, or audit. A CLI that calls the existing ppclip gateway may be a smaller first implementation than embedding this entire package.

The package has opt-out telemetry and optional recordings; a bundled evaluation should disable both by default. Its published token comparison is vendor-run and uses one coding-agent configuration and shared cloud browsers. It is evidence worth testing, not proof that ppclip will be faster or cheaper. Compare against our existing page/element tools with the same model, browser, tasks, and output limits.

Sources: [CLI architecture and benchmark method](https://github.com/browser-use/browser-harness/blob/c6a941287424f32e2d20c7b7b892c8493f46808d/README.md), [MCP tools](https://github.com/browser-use/browser-harness/blob/c6a941287424f32e2d20c7b7b892c8493f46808d/docs/MCP.md), [explicit CDP configuration](https://github.com/browser-use/browser-harness/blob/c6a941287424f32e2d20c7b7b892c8493f46808d/src/browser_harness/daemon.py), [telemetry switches](https://github.com/browser-use/browser-harness/blob/c6a941287424f32e2d20c7b7b892c8493f46808d/src/browser_harness/telemetry.py).

## Additional candidates

| Project | Best ppclip use | Integration implications |
|---|---|---|
| Steel Browser | Optional browser-only service: session context, page extraction, downloads, debugging | Does not provide a complete desktop. The inspected self-hosted service maintains one active session; do not assume it includes the hosted fleet scheduler. Keep profiles isolated per agent and add deployment/orchestration explicitly. |
| E2B Desktop | Optional hosted remote computer for users who want to avoid local desktop-container setup | API key, service costs, remote data location, sandbox expiry/reconnection and profile recovery need explicit handling. Our provider contract is a useful starting point, but hosted streaming and control enforcement need integration work. |
| CUA Driver | Semantic native desktop access and an eventual cross-platform driver behind ppclip | Current Rust driver includes Linux AT-SPI/X11/Wayland, Windows UIA, and macOS support, with CLI/MCP and application bindings. Start inside the Linux sandbox rather than granting agents host-desktop access. Validate target application support and bounded permissions. |

Steel's [README](https://github.com/steel-dev/steel-browser/blob/d8a4a7e9fb1d49db833b41acf04e894b9ebb2b37/README.md) describes the self-hosted browser API; its [session service](https://github.com/steel-dev/steel-browser/blob/d8a4a7e9fb1d49db833b41acf04e894b9ebb2b37/api/src/services/session.service.ts) is the basis for the single-active-session observation.

E2B's [desktop repository](https://github.com/e2b-dev/desktop/blob/f53061e9c0ce1cd343116dc89d89cb3168f9398e/README.md) now holds templates/examples; it points SDK development to [E2B/packages/desktop-js](https://github.com/e2b-dev/E2B/tree/main/packages/desktop-js) and `desktop-python`. Its viewer's view-only option should not be treated as sufficient server-side takeover enforcement without checking the current SDK/stream implementation. This review inspected the template and documented SDK surface, not a running hosted sandbox.

CUA's [driver documentation](https://github.com/trycua/cua/blob/8f9a41d1fc5ca2a53232cba241a9f2912a761644/libs/cua-driver/README.md) and [platform crate map](https://github.com/trycua/cua/blob/8f9a41d1fc5ca2a53232cba241a9f2912a761644/libs/cua-driver/rust/README.md) support the driver recommendation. Package boundaries matter: the default driver is MIT; the optional visual-perception extension contains an AGPL-only detector; Spaces has a separate FSL license. Do not describe the entire repository as uniformly MIT or bundle every component together.

## Prototype acceptance criteria

Use the same browser profile, viewport, model, and tasks for comparisons. Include browser restoration after minimize/close, reconnect after stream interruption, a native file dialog, a missing/wedged accessibility service, stale element references, private takeover during an in-flight tool call, and restart with a saved profile.

Record task completion, incorrect/duplicate actions, model input/output tokens, wall time, input latency, startup time, memory, and CPU. Preserve guardrail behavior as an acceptance requirement rather than trading it away for a faster demo. Demonstrations should produce reviewable drafts; remote providers should clearly report whether an existing computer was recovered or replaced.

## Inspected revisions and repository licenses

| Repository | Commit | Reported root license |
|---|---|---|
| elie222/rakazo | `fa491b34c76dcbad238582778cb2ffcd44b2367a` | Apache-2.0 |
| BryantVanOrden/OpenAgentFleet | `961d7a0666cd1798202c77436c50e66d3fdf1879` | MIT |
| m1k1o/neko | `020def0305cfb9fabd36371d2a112f6ee52c6533` | Apache-2.0 |
| browser-use/browser-harness | `c6a941287424f32e2d20c7b7b892c8493f46808d` | MIT |
| steel-dev/steel-browser | `d8a4a7e9fb1d49db833b41acf04e894b9ebb2b37` | Apache-2.0 |
| e2b-dev/desktop | `f53061e9c0ce1cd343116dc89d89cb3168f9398e` | Apache-2.0 |
| trycua/cua | `8f9a41d1fc5ca2a53232cba241a9f2912a761644` | MIT, with separately licensed subprojects noted above |
