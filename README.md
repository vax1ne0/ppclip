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
- **Settings → ppclip** (below Adapters): switch each module above on or off for the whole install. Everything is on by default; turning a module off brings back official Paperclip's own behaviour and keeps your data. Only an instance admin can change them, and every change is written to each company's activity log. Stored in `ppclip-features.json` in the instance folder (no database change).

## How this repository is laid out

- `modules/<module>/`: ppclip's own code, one folder per feature (core, team, live-runs, providers, run-controls, computer-use, agents, task-chat, fixes). Each has a short README, and its files sit at the same paths they get inside Paperclip. Modules are the same for every Paperclip version.
- `hooks/<paperclip version>/hooks.patch`: ppclip's small edits to official Paperclip files (each marked `// ppclip:`) that wire the modules in. This is the only part that is specific to one Paperclip version, so `manifest.json` next to it names the exact official commit.
- `modules.json`: which module each file belongs to. `install.mjs` installs, checks and removes ppclip; `tools/export.mjs` writes changes back into this repo.

## Supported Paperclip versions

| Paperclip | Official commit | Hooks |
|---|---|---|
| master, 2026-10-16 (after v2026.1017.0-canary.2) | `669d329f2` | `hooks/master-669d329f2/` |

ppclip installs only on an exact supported commit. From now on ppclip follows official stable releases (`v2026.MMDD.N` tags) and each ppclip release is tagged, so a ppclip tag tells you which Paperclip versions it supports.

## Install

Requirements: Git, Node.js 24.11 or newer, and pnpm 9.15.4.

```bash
# 1. An official Paperclip checkout at a supported commit (see the table above)
git clone https://github.com/paperclipai/paperclip
cd paperclip
git checkout 669d329f2

# 2. Get ppclip next to it and apply it (--target defaults to the current folder)
git clone https://github.com/vax1ne0/ppclip ../ppclip
node ../ppclip/install.mjs install --target .

# 3. Install dependencies, then build and start Paperclip as usual
pnpm install --frozen-lockfile
```

The installer:
- refuses to run if the checkout has uncommitted changes or isn't a supported version;
- copies the module files and applies the hook patch through git, so it works with Windows line endings (`core.autocrlf`);
- commits nothing;
- keeps a record in `.ppclip-overlay.json` (including a hash of every file, so `status` and `uninstall` can spot your edits).

On Windows, see Paperclip's own build notes. The usual traps are pnpm scripts needing Git Bash as the script shell, and building `packages/paperclip-runner` by hand.

### Computer use (optional)

Computer use needs Docker (Docker Desktop with WSL2 on Windows, Docker Engine on Linux). The supervisor is the only process that talks to Docker, and it listens on 127.0.0.1 only.

```bash
node scripts/ppclip/computer-supervisor.mjs build-image   # once: builds the sandbox image (about 1 GB)
node scripts/ppclip/computer-supervisor.mjs               # keep running next to Paperclip
```

Then:
1. In **Company Settings**, turn on **Computer use** (the supervisor line should say "connected"), and switch it on for each agent that should have a computer.
2. On **Live runs**, press **Start computer** on that agent's card.
3. Just ask the agent in plain words, for example "open example.com with your computer and tell me the page title". Claude and Codex local agents get the computer and browser tools automatically; there is no separate "web use" switch, the browser is part of the computer.

See [docs/computer-use.md](docs/computer-use.md) for Windows notes, the security model and testing.

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
2. Pull this repo, and check out the official commit or tag it lists as supported.
3. Run `install` again.

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

The code in `modules/` is the source; edit it there or in a working Paperclip checkout and export it back.

**Working on ppclip:**
1. Install ppclip on a clean official checkout of a supported commit (`install.mjs install`).
2. Edit, build and test in that checkout as usual. New files must match a rule in `modules.json`.
3. Write the changes back into this repo:
   ```bash
   node tools/export.mjs --source <paperclip checkout>
   ```
   This rewrites `modules/` (module READMEs are kept) and `hooks/<version>/`. The version name is the official tag at the checkout's commit, or `master-<short commit>`; pass `--name` to choose.

**Supporting a new official release:** check out the new tag, apply the current `hooks/<version>/hooks.patch` with `git apply -3`, resolve any conflicts in the marked hook lines, copy the module files in, test, then export with `--name <tag>`. Remove hook folders for versions you no longer support, and tag the ppclip release.

## License

Paperclip is MIT-licensed, and ppclip's additions are distributed under the same terms. See [LICENSE](LICENSE).

### Acknowledgements

Computer use reimplements ideas from these projects (research notes: [docs/computer-use-research.md](docs/computer-use-research.md)). No code was copied, so no third-party license notices are bundled.
- [elie222/rakazo](https://github.com/elie222/rakazo) (Apache-2.0): supervisor and provider split, separate view-only and control streams, takeover leases.
- [connbot/desktop-bridge](https://github.com/connbot/desktop-bridge) (Apache-2.0): the control state machine, private takeover and epochs.
- [trycua/cua](https://github.com/trycua/cua) (MIT): short-lived viewer tickets and container hardening defaults.
- [Roadmvn/linux-computer-use](https://github.com/Roadmvn/linux-computer-use) (MIT): only a person can release control, and fail-closed guardrails.
- [the-agents-work/taw-computer](https://github.com/the-agents-work/taw-computer) (MIT): numbered element badges (Set-of-Mark).
- [anthropics/anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) (MIT): the desktop image recipe.
- The sandbox image installs Debian packages, including noVNC (MPL-2.0), websockify (LGPL-3.0), x11vnc (GPL-2.0) and Chromium, under their own licenses when you build it. None of them are redistributed in this repository.
