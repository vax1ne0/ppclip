# ppclip

ppclip is a set of additions and fixes for [Paperclip](https://github.com/paperclipai/paperclip). This overlay turns an official Paperclip checkout into ppclip, and can turn it back.

It doesn't replace Paperclip or need a separate install: you keep your own official clone, and the overlay adds ppclip's files and small marked edits (`// ppclip:`) to it.

## What you get

- **Team page** (`/team`): a canvas of your agents with reporting and work lines, Edit mode, Magic sort, and group colours.
- **Live runs** (`/dashboard/live`): one big card per agent, showing live activity, the current task and the last reply.
- **Run controls** (off by default; Company Settings): team Unlimited / Drain / Resume, daily runs left, and "Drain after next run".
- **Computer use** (off by default; Company Settings, then per agent): each chosen agent gets its own sandboxed Linux desktop and Chromium in Docker.
  - You watch it live on its Live runs card, take control (for example to sign in), take control privately so the agent can't see the screen, and release it.
  - While you have control, the agent's computer actions are refused. Only you can release control.
  - Each agent's browser profile is kept in its own Docker volume, so logins survive restarts.
  - Pause, Stop and Revoke work at any time, and every action and takeover is written to the activity log.
  - See [docs/computer-use.md](docs/computer-use.md).
- **Providers**: a top-bar usage and provider switch, a Dashboard subscription usage panel, model tiers, and optional automatic provider routing. All of these use official Connections usage.
- **Agents and sidebar**:
  - a Team link under Inbox, and agents ordered by urgency;
  - "Waiting for you", "Pending on agent" and "Blocked task" statuses, and a pending confirmations popover;
  - extra roster columns, and the agent's task shown when you hover its name.
- **Task chat**: hides activity from runs that belong to other tasks, keeps separate runs apart with a "Follow-up run" divider, puts the "Worked" row under the reply, and matches agents by ID.
- **Fixes**:
  - agents stuck on "running" are repaired;
  - live lists refresh when a run finishes;
  - a deleted comment no longer counts as an agent's reply;
  - Claude/Codex sign-in works when the server runs on Windows (on newer Paperclip, browser sign-in runs in a Windows terminal through `@lydell/node-pty` instead of Python's `pty`, which Windows lacks).
- **`scripts/ppclip/start-local.mjs`**: starts an isolated local instance with its own data folder and ports.
- **Settings → ppclip** (below Adapters; `master-669d329f2` patch): switch each module above on or off for the whole install. Everything is on by default; turning a module off brings back official Paperclip's own behaviour and keeps your data. Only an instance admin can change them, and every change is written to each company's activity log. Stored in `ppclip-features.json` in the instance folder (no database change).

## Supported Paperclip versions

| Paperclip | Patch |
|---|---|
| v2026.1012.0 | `versions/v2026.1012.0/` |
| master at `669d329f2` (2026-10-16, after v2026.1017.0-canary.2) | `versions/master-669d329f2/` |

The overlay only installs on an exact supported version. Each version folder holds `ppclip.patch` and a `manifest.json` that lists every file it adds or edits.

## Install

Requirements: Git, Node.js 24.11 or newer, and pnpm 9.15.4.

```bash
# 1. An official Paperclip checkout at a supported version
git clone https://github.com/paperclipai/paperclip
cd paperclip
git checkout v2026.1012.0

# 2. Get ppclip next to it and apply it (--target defaults to the current folder)
git clone https://github.com/vax1ne0/ppclip ../ppclip
node ../ppclip/install.mjs install --target .

# 3. Install dependencies, then build and start Paperclip as usual
pnpm install --frozen-lockfile
```

The installer:
- refuses to run if the checkout has uncommitted changes or isn't a supported version;
- writes files through git, so it works with Windows line endings (`core.autocrlf`);
- commits nothing;
- keeps a record in `.ppclip-overlay.json`.

On Windows, see Paperclip's own build notes. The usual traps are pnpm scripts needing Git Bash as the script shell, and building `packages/paperclip-runner` by hand.

### Computer use (optional)

Computer use needs Docker (Docker Desktop with WSL2 on Windows, Docker Engine on Linux). The supervisor is the only process that talks to Docker, and it listens on 127.0.0.1 only.

```bash
node scripts/ppclip/computer-supervisor.mjs build-image   # once: builds the sandbox image (about 1 GB)
node scripts/ppclip/computer-supervisor.mjs               # keep running next to Paperclip
```

Then turn on **Computer use** in Company Settings and switch it on for each agent that should have a computer. The computer tools reach Claude and Codex local agents. See [docs/computer-use.md](docs/computer-use.md) for Windows notes and testing.

To start an isolated instance with its own data folder:

```bash
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime   # ports 3410 / 13410 / 55440; change with --port and --pg-port
```

## Check, remove, update

```bash
node install.mjs status    --target <paperclip folder>   # installed? files edited since install?
node install.mjs uninstall --target <paperclip folder>   # back to plain official Paperclip
```

`uninstall` refuses if you edited ppclip's files after installing, and lists them. Pass `--force` to discard those edits.

**To move to a newer Paperclip release:**
1. Run `uninstall`.
2. Check out the new official tag.
3. Run `install` with an overlay release that supports that tag.

The database is migrated by Paperclip itself when it starts. Back up your data folder first, as with any Paperclip update.

## Data and safety

- ppclip adds no database migrations. Its settings (Run controls switch, provider routing policy) are stored as activity-log entries and in agents' existing metadata.
- Uninstalling leaves your data in place. Plain Paperclip simply ignores ppclip's entries.
- Run controls, provider routing and computer use are off by default.
- Computer use settings are stored the same way: a company switch in the activity log and `metadata.computerUse` on each agent. Agent edits and new hires can't change or inherit it.
- Computer use safety:
  - **Sandboxing:** agent commands never run on your machine. The desktop runs in a hardened container with every capability dropped and memory, CPU and process limits. Shell is off by default and, when enabled, runs inside the sandbox as a separate unprivileged user.
  - **Network:** the browser goes through a filter that blocks private, local and cloud-metadata addresses. You can also limit each agent to a list of sites.
  - **Prompt injection:** page content is handed to the agent marked as untrusted data. The agent can't type into password fields, and clicks that pay, delete, send or publish need an explicit confirm.
  - **Private ports and audit:** the supervisor and the sandbox ports listen on 127.0.0.1 only and need tokens. The live view uses short-lived tickets that stop working when control changes. Every agent action, refusal and takeover is in the activity log, without typed text or full URLs.
  - **Limits:** a container shares your computer's kernel, and no guardrail fully prevents prompt injection. Only enable it for agents and sites you trust. See [docs/computer-use.md](docs/computer-use.md) for the full list.

## For maintainers

This repository holds only the packaged overlay. The modules are developed in a separate source checkout (official Paperclip plus ppclip commits; the original full fork is kept as a git bundle, restore it with `git clone ppclip-full-fork-backup.bundle ppclip-source`). A patch is exported per official release:

```bash
node tools/build-patch.mjs --source <ppclip checkout> --base <official tag>
```

That writes `versions/<tag>/ppclip.patch` and its manifest. Private notes (`fork-inventory/`) and repository housekeeping are excluded.

## License

Paperclip is MIT-licensed, and ppclip's additions are distributed under the same terms. See [LICENSE](LICENSE).

### Acknowledgements

Computer use reimplements ideas from these projects. No code was copied, so no third-party license notices are bundled.
- [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0): supervisor and provider split, separate view-only and control streams, takeover leases.
- [connbot/desktop-bridge](https://github.com/connbot/desktop-bridge) (Apache-2.0): the control state machine, private takeover and epochs.
- [trycua/cua](https://github.com/trycua/cua) (MIT): short-lived viewer tickets and container hardening defaults.
- [Roadmvn/linux-computer-use](https://github.com/Roadmvn/linux-computer-use) (MIT): only a person can release control, and fail-closed guardrails.
- [the-agents-work/taw-computer](https://github.com/the-agents-work/taw-computer) (MIT): numbered element badges (Set-of-Mark).
- [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) (MIT): the desktop image recipe.
- The sandbox image installs Debian packages, including noVNC (MPL-2.0), websockify (LGPL-3.0), x11vnc (GPL-2.0) and Chromium, under their own licenses when you build it. None of them are redistributed in this repository.
