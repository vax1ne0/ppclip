# Computer use

A sandboxed Linux desktop and Chromium per agent in Docker, with live view, takeover and agent tools over MCP.

**Settings → ppclip switch:** Computer use

Setup, security model and testing: [docs/computer-use.md](../../docs/computer-use.md).

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/computer-use/`, `server/src/__tests__/ppclip-computer-use`, `ui/src/ppclip/computer-use/`, `scripts/ppclip/computer-image/`, `scripts/ppclip/computer-supervisor.mjs`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
