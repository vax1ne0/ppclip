# Installation

Requirements: Git, Node.js 24.11 or newer, and pnpm 9.15.4.

Use an exact supported commit from the [compatibility table](../README.md#compatibility). The optional desktop also requires Docker; agent harnesses retain Paperclip's own platform build requirements.

Clone official Paperclip and ppclip side by side in the same folder:

```
my-folder/
  paperclip/   official Paperclip; ppclip changes it in place
  ppclip/      this repo
```

```bash
# 1. Clone both, and put Paperclip on a supported version (see the compatibility table in ../README.md)
git clone https://github.com/paperclipai/paperclip
git clone https://github.com/vax1ne0/ppclip
git -C paperclip checkout 669d329f2

# 2. Apply ppclip and install Paperclip's dependencies
node ppclip/install.mjs install --with-deps
```

From the Paperclip checkout, build and launch an isolated instance:

```bash
cd paperclip
pnpm build
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime
```

Open http://127.0.0.1:3410 after startup. The launcher records its options in the runtime folder so the updater can reuse them.

Keep ppclip next to Paperclip rather than inside it: a folder inside the Paperclip checkout would be deleted by `git clean` or a fresh clone, and Paperclip's own git would see it as a change.

The installer finds Paperclip by itself: the current folder if it is a Paperclip checkout, otherwise the Paperclip folder next to ppclip. If there are several, it lists them and asks for `--target <folder>`. Leave out `--with-deps` to run `pnpm install --frozen-lockfile` yourself.

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
# or start Paperclip and the supervisor together:
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime --with-computer
```

Then:
1. Open the agent, then **Configuration**, then the **Computer use** card. Press **Turn on computer use** if asked, check the supervisor line says "connected", and switch on **Give this agent a computer**. Company Settings has the same controls for every agent.
2. Press **Watch live** (or open **Live runs**), then **Start computer** on that agent's card. The card shows **Using its computer** while the agent works, and **Needs you** when it asks for help.
3. Just ask the agent in plain words, for example "open example.com with your computer and tell me the page title". Claude and Codex local agents get the computer and browser tools automatically; there is no separate "web use" switch, the browser is part of the computer.

See [docs/computer-use.md](computer-use.md) for Windows notes, the security model and testing.

To start an isolated instance with its own data folder:

```bash
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime   # ports 3410 / 13410 / 55440; change with --port and --pg-port
```
