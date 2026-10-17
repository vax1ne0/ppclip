# Computer use

A sandboxed Linux desktop and Chromium per agent in Docker, with live view, takeover and agent tools over MCP.

**Settings → ppclip switch:** Computer use

**How to use it:**
1. Start the supervisor: `node scripts/ppclip/start-local.mjs --with-computer` starts it with Paperclip, or run `node scripts/ppclip/computer-supervisor.mjs`. Build the image once first with `node scripts/ppclip/computer-supervisor.mjs build-image`.
2. Open the agent, then **Configuration**, then the **Computer use** card. Turn on computer use if asked, then **Give this agent a computer**. This works for Claude Code and Codex agents only.
3. Press **Watch live** (or open **Live runs**), then **Start computer** on the agent's card.
4. Watch it on the big screen (agent → **Computer → Live screen**, or the **Computer** button on the Team page or above an agent chat), or on its Live runs card.
5. Ask the agent in plain words. Its Live runs card shows **Using its computer**, and **Needs you** when it asks for help.

Setup, security model and testing: [docs/computer-use.md](../../docs/computer-use.md).

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/computer-use/`, `server/src/__tests__/ppclip-computer-use`, `ui/src/ppclip/computer-use/`, `scripts/ppclip/computer-image/`, `scripts/ppclip/computer-supervisor.mjs`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
