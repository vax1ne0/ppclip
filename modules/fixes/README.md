# Fixes

Repair of agents stuck on running, live list refresh, ignoring deleted replies, and Claude/Codex sign-in on Windows.

**Settings → ppclip switch:** Fixes → one switch per fix

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/stale-agent-status.ts`, `server/src/ppclip/windows-`, `server/src/__tests__/ppclip-stale-agent-status`, `server/src/__tests__/ppclip-windows-`, `ui/src/ppclip/live-run-refresh`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
