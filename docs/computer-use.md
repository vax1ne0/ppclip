# Computer use

Computer use gives a Paperclip agent its own sandboxed Linux desktop with a Chromium browser:
- You can watch it work live from the agent's card on the Live runs page.
- You can take control, for example to sign in, and then hand control back.
- Live views request fresh tickets when opened, renew on focus/reconnect, and retry dropped connections up to three times per minute. **Reconnect** retries immediately without changing control.
- The computer bar stays above the agent chat while the conversation scrolls. Expanded screens have their own bounded scroll area.
- The desktop has a bottom taskbar. If you minimize Chromium, click its taskbar button to restore the same window and tabs. Closing Chromium is handled by the browser supervisor, which relaunches it.
- The browser profile is kept between sessions, so logins survive.

It is **off by default**. The quickest path:

1. **Start the supervisor** once per session: `node scripts/ppclip/start-local.mjs --with-computer` starts Paperclip and the supervisor together. Or run `node scripts/ppclip/computer-supervisor.mjs` next to your own Paperclip. Build the sandbox image once first (see [Running it](#running-it)).
2. **Turn it on for the agent:** open the agent, go to **Harness / Runtime**, then the **Computer use** card. Press **Turn on computer use** if the company switch is still off, then switch on **Give this agent a computer**. The card also shows whether the supervisor is connected, and holds the shell, allowed-sites and delete-profile controls.
3. **Watch it:** press **Watch live** on that card, or open **Live runs**. On the agent's card, press **Start computer**.
4. **Ask the agent in plain words,** for example "open example.com with your computer and tell me the page title". Claude Code and Codex local agents get the computer tools automatically.

**Where to see a computer.** Each agent has its own computer; none are shared.
- **Big screen:** open the agent, then **Computer → Live screen** in its left-hand menu, or go to `/agents/<agent>/computer`. The screen fills the page and has **Full screen**, take control and the other controls.
- **Team page:** agents with a computer get a **Computer** button that opens the big screen, and a state chip while it runs.
- **Agent chats:** a slim bar above the chat shows the computer's state. **Show screen** opens it in place, and **Big screen** jumps to the big screen.
- **Live runs:** every agent's card shows its screen side by side with the others. **Big screen** on a card opens that agent's.
- **Computer use card in Harness / Runtime:** it has **Open big screen** and **Watch live**.

While the agent works, its Live runs card shows **Using its computer** next to its status. When it asks for help, the card shows **Needs you** with its reason; press **Take control**. Company Settings has the same switch and every agent's controls in one list.

The computer tools reach Claude Code (`claude_local`) and Codex (`codex_local`) agents only. Other adapters show "Available for Claude Code and Codex agents only" on the card.

## How it fits together

```
Browser (Live runs card)          Paperclip server                    Computer supervisor           Sandbox (one per agent)
  live view (sandboxed iframe) ─►  ticketed view proxy        ─────►  127.0.0.1:7091, bearer  ─────► websockify ─► x11vnc (view / control)
  Take control / Release …    ─►  board routes (agents:create) ───►  Docker Engine API              control daemon (xdotool, Chromium pipe)
Agent run (Claude/Codex local) ─►  MCP endpoint (run JWT)      ─────►                                egress filter ─► internet
                                   state machine, guardrails, audit
```

- **The supervisor** (`node scripts/ppclip/computer-supervisor.mjs`) is the only process that talks to Docker. It listens on 127.0.0.1 and requires a token. That token is created on first start in `~/.paperclip/ppclip-computer-supervisor.token`, and Paperclip reads the same file.
- **Agents never talk to the supervisor.** Paperclip adds a "Computer" tool server to the runs of agents that have a computer. Every tool call passes Paperclip's state check, guardrails and audit log first.
- **The live view** is noVNC from the sandbox. It is served through Paperclip with a short-lived ticket, inside an iframe sandboxed away from Paperclip's own pages.

## Tools the agent gets

| Tool | What it does |
|---|---|
| `computer_status` | Who controls the computer, and the current epoch |
| `computer_screenshot` | Screenshot of the desktop. It starts the computer if it is stopped, and omits the image when nothing changed |
| `computer_act` | Up to 16 mouse and keyboard actions in screen pixels. It must cite the current epoch |
| `browser_navigate` | Opens a public http(s) address |
| `browser_page` | Page text and numbered interactive elements. With `marks: true` it adds a screenshot with numbered badges (Set-of-Mark). All of it comes back marked as untrusted |
| `browser_click_element` / `browser_type_element` | Acts on an element by its number. Numbers expire when the page changes |
| `computer_request_takeover` | Asks a person to take over, for sign-ins, 2FA, CAPTCHAs or payments |
| `computer_shell` | Only when enabled for the agent. Runs inside the sandbox as a separate unprivileged user |

## Takeover states

| From | To | Trigger | Who |
|---|---|---|---|
| off, stopped | starting, then agent | Start, or the agent's first tool call | operator, agent |
| agent | waiting for you | `computer_request_takeover` | agent |
| agent, waiting, paused | you're in control | Take control | operator |
| agent, waiting, paused, in control | private control | Take control privately | operator |
| in control, private | agent | Release to agent | **operator only** |
| agent, waiting, in control, private | paused | Pause (the container is frozen) | operator |
| paused | agent | Resume | operator |
| in control, private | paused | Control lease runs out (30 minutes) | system |
| agent | stopped | No agent activity for 15 minutes | system |
| any except revoked | stopped | Stop | operator, system |
| any | revoked | Revoke access | operator |
| revoked | stopped | Restore access | operator |

How the agent is frozen while you have control:
1. **One queue per agent.** Every agent tool call and every operator action goes through that agent's queue. Take control waits for any action already running, then changes the state.
2. **Actions are refused in any state other than "agent driving".** The agent's clicks, typing, navigation and shell all fail. Inside the sandbox, the control daemon also locks itself and ends any process the agent's shell started.
3. **Every change of control bumps an epoch.** Actions must cite the epoch of the agent's latest screenshot or page read. After you release, the agent has to look again before acting.
4. **Private control also refuses screenshots and page reads,** so the agent can't see what you type.
5. **No agent tool can take or release control.**

## Security

- **Your machine stays out of reach.** Agent commands never run on the host. There is no "host desktop" provider.
- **Container hardening:**
  - The container runs with every capability dropped except the three needed to switch users at start.
  - `no-new-privileges` is set.
  - Memory, CPU, process and shared-memory limits apply.
  - Each agent has its own Docker network, and gVisor (`runsc`) is used automatically when installed.
- **Inside the sandbox:**
  - The desktop, browser and control daemon run as `agent`. Shell commands run as a different user, `sandbox`.
  - The `sandbox` user can't reach the X display (cookie), the VNC sockets (private folder), the browser's debugging channel (a pipe, not a port) or the control token.
- **Ports:**
  - The supervisor and both published sandbox ports listen on 127.0.0.1 only and require tokens.
  - The stream gateway has no default target, so it only connects valid tokens.
  - The view-only stream comes from a separate VNC server started with `-viewonly`. It does not rely on the viewer's setting.
- **Live view:**
  - Tickets last 10 minutes, are tied to the person who asked for them, and are re-checked every second.
  - A control ticket dies when that person's control ends, and a revoke ends every ticket.
  - The iframe runs with `sandbox="allow-scripts"` and no same-origin access, so noVNC code can't touch Paperclip's session.
- **Network:**
  - The browser sends all traffic through a filter. The filter refuses private, loopback, link-local, CGNAT and cloud-metadata addresses, and it checks the resolved address, which stops DNS rebinding.
  - You can limit each agent to a list of sites.
  - Paperclip also refuses `file:`, `chrome:`, `javascript:` and similar addresses before they reach the sandbox.
- **Prompt injection:**
  - Page text, titles and element names are wrapped as untrusted data, with a note telling the model to ignore instructions inside them.
  - The agent can't type into password or one-time-code fields. Clicks on pay, delete, send, publish and similar need `confirm: true`.
  - Three identical actions on an unchanged screen are refused.
- **Audit:**
  - Every agent action, every refusal and every change of control is in Paperclip's activity log as `ppclip.computer_use.*`.
  - Typed text is stored only as a length. URLs are reduced to their origin, and screenshots are not stored.
- **Pause or revoke at any time:**
  - Pause, Stop and Revoke are on the Live card.
  - Turning the company switch off stops every computer and ends every stream and takeover.

**Known limits:**
- A container shares your computer's kernel. Chromium runs with `--no-sandbox` inside it, because the container is the boundary.
- No guardrail fully prevents prompt injection. Keep computers for agents and sites you trust, and use site lists.
- With shell enabled, the agent's shell commands can reach the internet directly. The browser filter doesn't cover them. On Linux you can add host firewall rules for the `ppclip-computer-net-*` bridges.
- Password-field detection doesn't see inside cross-origin iframes. The "needs confirm" check works from button labels, which a hostile page can disguise.
- The sandbox's own token sits in a Docker label. Anyone with Docker access already controls the machine.

## Running it

### Linux

```bash
# Docker Engine installed, your user in the "docker" group
node scripts/ppclip/computer-supervisor.mjs build-image
node scripts/ppclip/computer-supervisor.mjs            # add --max-running 3 --memory-mb 2048 --cpus 2 to tune
```

Optional: install gVisor (`runsc`) and register it with Docker. The supervisor picks it up automatically.

### With the local launcher

`node scripts/ppclip/start-local.mjs --data <folder> --with-computer` also starts the supervisor in the background:
- It writes the log to `<folder>/computer-supervisor.log`, and the shared token to `<folder>/ppclip-computer-supervisor.token`.
- It records the supervisor's process id in `<folder>/launcher.json`.
- If Docker isn't reachable, it says so and starts Paperclip without the supervisor.
- If port 7091 is already in use, it assumes a supervisor is running and doesn't start another.
- It warns if the sandbox image hasn't been built yet.

### Windows (Docker Desktop with WSL2)

1. Install Docker Desktop and choose the WSL2 backend. Start Docker Desktop and wait until it says it is running.
2. Optionally give WSL2 enough memory in `%UserProfile%\.wslconfig`: `[wsl2]` then `memory=8GB`.
3. In PowerShell, in your Paperclip folder:
   ```powershell
   node scripts/ppclip/computer-supervisor.mjs build-image
   node scripts/ppclip/computer-supervisor.mjs
   ```
   The supervisor reaches Docker through `\\.\pipe\docker_engine`. Profiles live in Docker volumes inside WSL2, not on `C:`, which keeps them fast.
4. gVisor isn't available on Docker Desktop, so containers use the default runtime.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `PPCLIP_COMPUTER_SUPERVISOR_URL` | `http://127.0.0.1:7091` | Where Paperclip finds the supervisor |
| `PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE` | `~/.paperclip/ppclip-computer-supervisor.token` | Shared token file, used by both |
| `PPCLIP_COMPUTER_IMAGE` | `ppclip-computer:1` | Sandbox image name |

## Testing it

For a real end-to-end check, run from the **ppclip package** folder:

```bash
node tools/computer-lifecycle-smoke.mjs --target ../paperclip-official --isolated
```

The app and Docker supervisor must already be running. Isolated mode creates and removes its own test company. Alternatively, pass `--company <company-UUID>` for a company with computer use enabled and direct agent creation permitted. The smoke test creates its own disposable agent with scheduled runs disabled. It checks live view, takeover, real mouse and keyboard input, release, pause/resume, recovery from an external Docker pause, and profile persistence across stop/start. It then removes only its own agent, computer and profile. It invokes no model. For an authenticated local instance, supply its access token through `PPCLIP_SMOKE_TOKEN`.

On startup and every 30 seconds, recovery compares saved live computer state with Docker. Missing or stopped containers become stopped; unhealthy desktops and inconsistent paused states become paused. Valid human leases are restored after supervisor restarts, expired leases pause, and recovery never resumes paused work. Unavailable Docker leaves saved intent intact for a later retry. Recovery is suspended on warm standby servers.

The automated tests use the in-memory fake provider and never need Docker or a model.

```bash
cd server && npx vitest run src/__tests__/ppclip-computer-use-state.test.ts src/__tests__/ppclip-computer-use-supervisor.test.ts src/__tests__/ppclip-computer-use.test.ts
cd ui && npx vitest run src/ppclip/computer-use src/ppclip/live
```

To try the UI without Docker, run `node scripts/ppclip/computer-supervisor.mjs --provider fake`. Start, takeover, pause and revoke all work, but there is no live picture.

To test the real Docker provider:
1. Build the image and start the supervisor as above.
2. Start Paperclip, or use `start-local.mjs --with-computer` for steps 1 and 2 together. Open a Claude Code or Codex agent, then **Harness / Runtime**, then **Computer use**. Press **Turn on computer use**, check the supervisor line says "connected", and switch on **Give this agent a computer**.
3. Press **Open on Live runs**. On the agent's card, press **Start computer**. The desktop appears view-only within a minute, and the agent card's button changes to **Watch live**.
4. Press **Take control**. Click into the screen, type into the browser's address bar and open a site. Then **Release to agent**.
5. Ask the agent (Claude or Codex local adapter) to "open example.com with your computer and tell me the page title". The card shows it working, and the Activity page shows `ppclip.computer_use.tool` rows.
6. Ask it to sign in somewhere. It should call `computer_request_takeover`, and the card shows **Needs you**. Take control privately, sign in, release. Stop and start the computer, and the login is still there.
7. Check the guardrails. Ask it to open `http://169.254.169.254/` or `file:///etc/passwd` (both refused), or to type into a password field (refused).
8. Check what's exposed. `docker ps` shows only `127.0.0.1:` port bindings for a running, unpaused desktop. `docker inspect ppclip-computer-<agent id>` shows `CapDrop: ALL` and `CapAdd` limited to `SETUID`, `SETGID` and `KILL`. Paused containers can temporarily omit published ports on Docker Desktop; resume waits for the desktop to become reachable again.
