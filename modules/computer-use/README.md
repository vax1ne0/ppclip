# Computer use

Start and resume wait for both the control daemon and live-screen HTTP service. Screen-file reads retry transport resets and temporary server failures up to three times, with a 3-second timeout per attempt; control actions are never retried. Failed iframe documents send the existing bounded reconnect signal instead of showing raw JSON. These readiness probes run only during startup/resume, not on recurring overview polls.

Experimental agent chats use one shared header for computer identity, control status, actions and screen toggle. The card floats centered over the conversation, sized to the live screen's width whether collapsed or expanded, so the chat stays visible on both sides instead of behind a full-width strip. Expanding the screen does not start or claim the computer. The primary action and Pause stay visible; secondary actions live in the keyboard-accessible More menu. Control expiry is in the status tooltip, while private control stays explicit in the header. Compact stopped, connecting, paused and error states keep the conversation usable. Screen tools float over the viewer; there is no footer bar or connected-status strip. A view-only fallback remains labeled when someone else holds control. Expansion is remembered separately per agent. Private control, release, pause and revoke retain their existing API and confirmation behavior.

Enabled agents have a small monitor badge next to their names in the sidebar, team canvas, dashboard identities and agent pages. A shared neutral, outlined badge centers the monitor in compact sidebar, regular name-row and larger heading sizes. Its tooltip uses the site’s popover theme. It represents capability, not connection status. The badge follows the company/module and agent enable switches, including enabled computers that are stopped. All badges share one company overview subscription; they do not probe or start individual computers.

A sandboxed Linux desktop and Chromium per agent in Docker, with live view, takeover and agent tools over MCP.

The desktop uses an original mountain wallpaper and a compact rounded dock with the packaged Chromium icon, current window buttons and a clock in the supervisor host's timezone. Its launcher only restores windows from the managed browser PID, including while a person holds control; it never starts an unmanaged Chromium profile. Window controls remain available for minimizing, restoring and maximizing. Wallpaper rasterization happens at image build time from the module's SVG source.

The image enforces shared browser/shell egress policy and probes Chromium sandbox support. Native desktop tools use bounded AT-SPI observations by default, with an optional pinned CUA observer. A browser CLI reuses the run-authenticated MCP boundary. Offline profile backup/restore uses a separate operator CLI. Image upgrades require rebuilding the image and restarting the supervisor; existing profile volumes are retained. See the maintained guide below for commands and limits.

The Live screen page keeps a centered stopped-desktop placeholder with one explicit Start action and inline pending/error feedback. Starting computers show a waiting state until the stream is ready; stopped computers never request a viewer ticket.

The live viewer uses the app's theme and a compact connection-status dot. The Live screen header has one title, quiet navigation links and a single state row; human-control expiry is shown as “Pauses at …”. The stock Ctrl+Alt+Del button and its click binding are removed. Control actions and connection recovery remain available below the screen.

Paused computers show a placeholder rather than opening a stream. Resume or Take control waits for the desktop to become ready before reconnecting; pausing invalidates existing live-view tickets.

**Settings → ppclip switch:** Computer use

**How to use it:**
1. Start the supervisor: `node scripts/ppclip/start-local.mjs --with-computer` starts it with Paperclip, or run `node scripts/ppclip/computer-supervisor.mjs`. Build the image once first with `node scripts/ppclip/computer-supervisor.mjs build-image`.
2. Open the agent, then **Harness / Runtime**, then the **Computer use** card. Turn on computer use if asked, then **Give this agent a computer**. This works for Claude Code and Codex agents only.
3. Press **Watch live** (or open **Live runs**), then **Start computer** on the agent's card.
4. Watch it on the big screen (agent → **Computer → Live screen**, or the **Computer** button on the Team page or above an agent chat), or on its Live runs card.
5. Ask the agent in plain words. Its Live runs card shows **Using its computer**, and **Needs you** when it asks for help.

Setup, security model and testing: [docs/computer-use.md](../../docs/computer-use.md).

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/computer-use/`, `server/src/__tests__/ppclip-computer-use`, `ui/src/ppclip/computer-use/`, `scripts/ppclip/computer-image/`, `scripts/ppclip/computer-supervisor.mjs`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
