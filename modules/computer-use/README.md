# Computer use

Start and resume wait for both the control daemon and live-screen HTTP service. Screen-file reads retry transport resets and temporary server failures up to three times, with a 3-second timeout per attempt; control actions are never retried. Failed iframe documents send the existing bounded reconnect signal instead of showing raw JSON. These readiness probes run only during startup/resume, not on recurring overview polls.

Experimental agent chats use a single bordered computer panel with a compact status header, consistent screen controls and a computer badge beside enabled agents in the conversation sidebar. Expanding the screen does not start or claim the computer. Stopped and starting screens show centered feedback; running chat screens keep the control actions above the viewer and use a bounded height so the conversation remains usable. Expansion is remembered separately per agent. Private control, release, pause and revoke retain their existing API and confirmation behavior.

Enabled agents have a small monitor badge next to their names in the sidebar, team canvas, dashboard identities and agent pages. A shared neutral, outlined badge centers the monitor in compact sidebar, regular name-row and larger heading sizes. Its tooltip uses the site’s popover theme. It represents capability, not connection status. The badge follows the company/module and agent enable switches, including enabled computers that are stopped. All badges share one company overview subscription; they do not probe or start individual computers.

A sandboxed Linux desktop and Chromium per agent in Docker, with live view, takeover and agent tools over MCP.

The Live screen page keeps a centered stopped-desktop placeholder with one explicit Start action and inline pending/error feedback. Starting computers show a waiting state until the stream is ready; stopped computers never request a viewer ticket.

The live viewer uses the app's theme, a compact connection-status dot, and a keyboard-accessible Ctrl+Alt+Del button. The button is enabled only for a connected control stream.

Paused computers show a placeholder rather than opening a stream. Resume or Take control waits for the desktop to become ready before reconnecting; pausing invalidates existing live-view tickets.

**Settings → ppclip switch:** Computer use

**How to use it:**
1. Start the supervisor: `node scripts/ppclip/start-local.mjs --with-computer` starts it with Paperclip, or run `node scripts/ppclip/computer-supervisor.mjs`. Build the image once first with `node scripts/ppclip/computer-supervisor.mjs build-image`.
2. Open the agent, then **Configuration**, then the **Computer use** card. Turn on computer use if asked, then **Give this agent a computer**. This works for Claude Code and Codex agents only.
3. Press **Watch live** (or open **Live runs**), then **Start computer** on the agent's card.
4. Watch it on the big screen (agent → **Computer → Live screen**, or the **Computer** button on the Team page or above an agent chat), or on its Live runs card.
5. Ask the agent in plain words. Its Live runs card shows **Using its computer**, and **Needs you** when it asks for help.

Setup, security model and testing: [docs/computer-use.md](../../docs/computer-use.md).

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/computer-use/`, `server/src/__tests__/ppclip-computer-use`, `ui/src/ppclip/computer-use/`, `scripts/ppclip/computer-image/`, `scripts/ppclip/computer-supervisor.mjs`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
