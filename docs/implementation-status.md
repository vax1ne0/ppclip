# Implementation status

This is a code inventory, not a claim that every scenario has passed a fresh end-to-end test. Current guides describe shipped behavior; historical comparisons live in [research](research/computer-use.md).

| Area | Implementation | Status |
|---|---|---|
| Settings and updates | `modules/core` plus integration hooks | Implemented, including module switches, completed-stage check progress and stable-only upstream update tracking. |
| Team canvas and routing | `modules/team` | Implemented. |
| Mascots, attention, roster and chat navigation | `modules/agents` plus shared/UI hooks | Implemented; some integrations necessarily modify upstream files. |
| Live runs and task activity | `modules/live-runs`, `modules/task-chat` | Implemented. |
| Provider usage, switching and model approvals | `modules/providers` | Implemented; the company policy and opt-in switches still govern execution. |
| Run controls and Windows fixes | `modules/run-controls`, `modules/fixes` | Implemented. |
| Computer desktop, browser tools, live view and takeover | `modules/computer-use` | Docker implementation and in-memory test provider exist. Real desktop verification uses the optional Docker smoke tool. |
| E2B / remote desktop provider | Provider interface has an extension seam | Not implemented. |
| agent-browser, external Playwright harness, CUA or OpenSandbox integration | Discussed as possible tools / research references | Not installed or implemented by this package. The current browser tools use the desktop's own Chromium integration. |
| Flexible revision checks | `install.mjs compatibility` | Implemented as a read-only applicability probe; untested revisions are not automatically supported. |
| Native Paperclip plugin migration / all-future-version support | Architectural direction | Not implemented; no guarantee of compatibility with future upstream internals. |
| Stable Paperclip installation | `hooks/v2026.1012.0` with shared modules | Ported to stable v2026.1012.0. Separate hooks preserve the existing canary base. |
| Existing canary → older stable data migration | Requires separate database compatibility verification | Not implemented. Stable support is for a separate installation; the running canary and its data are retained. |

The former local handoff referred to Paperclip v2026.1012.0 and a removed `tools/build-patch.mjs`; it was obsolete and has been moved outside the package. Installation and export instructions now live in the maintained guides. Research recommendations do not become shipped features merely by appearing in a document.

The package adds two npm dependencies through its hooks: `react-colorful` for team/mascot color pickers and optional `@lydell/node-pty` for Windows ConPTY sign-in. Both have live imports. Paperclip's other dependencies belong to upstream; removing them based only on ppclip imports would break the host application. Docker packages are separately declared in the computer image's Dockerfile.

Compatibility adapters for persisted metadata, old agent URLs and installed overlay records remain where they serve current data or uninstall/recovery. They are not safely removable solely because their names contain “legacy”. Use the package checks in [development](development.md) and targeted tests when changing those boundaries.
