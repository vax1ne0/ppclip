# Computer use: research notes

**Historical design research, not an implementation checklist.** Project comparisons below record the original October 2026 investigation and have not been revalidated by this cleanup. See [implementation status](../implementation-status.md) for shipped features. ppclip currently implements Docker and fake providers; it does not ship an E2B provider, agent-browser integration, CUA dependency, or OpenSandbox dependency.

Research done in October 2026 before building ppclip computer use. Repositories were cloned and their source read; nothing was built or run. GitHub API metadata (stars, archived flags) could not be read from the research environment, so star counts are as shown on GitHub pages or marked unverified.

## Research summary

### How this was verified

- Every repo below was shallow-cloned and its **source** was read (nothing was built or run).
- GitHub's API is blocked in this cloud session. So **star counts and the `archived` flag are not API-verified**. Stars come from the rendered GitHub page where it could be fetched, otherwise "unverified".
- **License** comes from the repo's LICENSE file. **Last commit** comes from `git log` on the default branch.
- All listed repos exist and are public. None was renamed or private. One extra repo found by search (`SebastianBaltes/claude-code-computer-use-mcp`) returns 404.

### Core comparison

| Project | Stars | License | Last commit | Maintained | Streaming | Takeover / freeze |
|---|---|---|---|---|---|---|
| elie222/rakazo (reference) | unverified | Apache-2.0, no NOTICE file | 2026-10-17 | Very active, large test suite + CI | Xvfb + fluxbox + Chromium, x11vnc → one websockify gateway (TokenFile plugin), noVNC | Fenced execution lease (bot) + TTL user-control lease (15 min) in DB; separate view-only and control x11vnc; `request_takeover` tool → run parked as `waiting_takeover`, continued on release |
| connbot/desktop-bridge | unverified | Apache-2.0 | 2026-10-05 | New (2 weeks), pytest + Docker e2e CI | Two loopback x11vnc (input / `-viewonly`) spliced over an authenticated WebSocket | Best state machine found: `ready/agent/human/private/paused/stopped`; one lock around every write; epoch bump invalidates observations and kicks viewers; private takeover also blocks screenshots; revoke clears tokens |
| BryantVanOrden/OpenAgentFleet | unverified | MIT | 2026-09-25 | Active, 103 Go test files, CI | Two noVNC endpoints (interactive / view-only) behind a JWT reverse proxy, never published | Concurrent click-in takeover (no agent freeze); container pause via cgroup freezer; `ask_human` escalation; Set-of-Mark from AT-SPI |
| bytebot-ai/bytebot | ~11k (web, unverified) | Apache-2.0 | **2025-09-11** | **Unmaintained** (13 months idle; reportedly archived Mar 2026, not verified) | x11vnc + noVNC, **no auth**, privileged container | `control: USER/ASSISTANT` flag, AbortController stops the loop, human input recorded into the transcript |
| jdrolls/sandbar | unverified | MIT | 2026-09-26 | Solo, 3 months old, tests but no CI | Selkies (linuxserver Webtop), basic auth | Not built yet (roadmap); X-level window-ownership guard before agent input |
| the-agents-work/taw-computer | unverified | MIT | 2026-05-16 | **Likely unmaintained** (4 commits, one weekend, no tests) | noVNC, **no auth** | None. Useful only for its DOM Set-of-Mark badges (cap 150 refs, refs invalid after navigation) |
| Roadmvn/linux-computer-use | unverified | MIT | 2026-08-12 | **Unclear** (11 commits over 2 days, no tests) | none of its own | Lease file: present = human; checked per tool call; agent can create it, only a human can delete it. Good fail-closed guardrails (password fields, irreversible verbs) |

### Infrastructure

| Project | Stars (page) | License | Last commit | Notes |
|---|---|---|---|---|
| trycua/cua | ~30k | MIT (+FSL-1.1-MIT for Spaces/viewer) | 2026-10-16 | Mid-rewrite to Rust; old Python packages deprecated. Best ideas: short-lived **viewer tickets** in the URL fragment with view-only vs interactive policy, loopback-only ports, shm = half of memory, runtime detection of the Chromium sandbox, gVisor when available |
| e2b-dev/desktop | ~1.5k | Apache-2.0 | 2026-10-13 | Cloud only (Firecracker). Its "auth key" is just a VNC password in the URL query, which we should not copy |
| e2b-dev/open-computer-use | ~2.4k | Apache-2.0 | 2026-07-09 | Demo agent, low maintenance |
| agent-sandbox/agent-sandbox | ~221 | Apache-2.0 | 2026-10-15 | Kubernetes control plane with an E2B-compatible API. **No desktop or VNC implemented**, despite the README |
| alibaba/OpenSandbox | ~15.9k | Apache-2.0 | 2026-10-17 | Mature. Desktop only as an example. Strongest **egress** design (deny-by-default sidecar, credential vault) |
| browser-use/browser-harness | ~18k | MIT | 2026-10-14 | Not a sandbox: drives the user's own Chrome over CDP |

### Other projects found

From Picrew/awesome-agent-harness (exists, ~1.9k stars) and direct search:

- **m1k1o/neko** (~22.5k, Apache-2.0, active): the cleanest "who holds control" model. One atomic host, request / release / admin take, ghost cursor for non-hosts, keys reset on release.
- **anthropics/anthropic-quickstarts computer-use-demo** (~18k, MIT, active): reference desktop image recipe and coordinate scaling.
- **steel-dev/steel-browser** (~7.8k, Apache-2.0): persistent `userDataDir` profiles.
- **microsoft/agent-governance-toolkit** (~6.4k, MIT): Docker hardening defaults, and logging blocked commands as structured events.
- **Licenses to keep at arm's length** (ideas only, never code): linuxserver/docker-webtop (GPL-3.0), KasmVNC (GPL-2.0), notte (SSPL), lightpanda (AGPL), OmniParser (licensing unclear).

### Findings that shape the design

1. **Server-enforced view-only is a must.** noVNC's `view_only` flag is client-side only. Use a separate read-only VNC listener, as rakazo, desktop-bridge and OpenAgentFleet do.
2. **Freeze the agent at the tool boundary.** Every mutating tool goes through one per-agent lock that checks state. Takeover waits for the in-flight action, then bumps an epoch so old screenshots are stale. This is desktop-bridge's approach and the only one that truly freezes the agent.
3. **The agent may request takeover but can never release it** (linux-computer-use, rakazo).
4. **Stream auth needs short-lived, scoped tickets re-checked on connect** (rakazo, cua), not passwords in URLs (E2B).
5. **No surveyed project really defends against prompt injection.** The best available is fencing page content as untrusted, plus fail-closed behavioural rules. We have to build our own guardrails.
6. **Paperclip already has the hook we need.** `heartbeat.ts` builds a per-run MCP server list that reaches claude_local and codex_local agents. One pushed entry delivers our tools.

### Recommendation

- **Build our own small supervisor** that follows rakazo's architecture: a separate process owns the Docker socket, Paperclip talks to it over HTTP with a bearer token, and a provider split covers docker / remote / fake.
- **Borrow desktop-bridge's control state machine** and its private takeover mode.
- **Borrow cua's viewer tickets.**
- **Original image proposal:** Ubuntu 24.04 with Xvfb, a light window manager, Chromium, and two x11vnc listeners behind websockify/noVNC. The shipped image uses Debian bookworm instead.
- **Don't depend on cua or OpenSandbox.** cua is mid-rewrite and OpenSandbox is heavy. Both are far larger than we need.
- **Proposed remote-provider candidate:** E2B. No E2B provider has been implemented in ppclip.

---
