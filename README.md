# ppclip

ppclip is a set of additions and fixes for [Paperclip](https://github.com/paperclipai/paperclip). This overlay turns an official Paperclip checkout into ppclip, and can turn it back.

It doesn't replace Paperclip or need a separate install: you keep your own official clone, and the overlay adds ppclip's files and small marked edits (`// ppclip:`) to it.

## What you get

- **Team page** (`/team`): a canvas of your agents with reporting and work lines, Edit mode, Magic sort, and group colours.
- **Live runs** (`/dashboard/live`): one big card per agent, showing live activity, the current task and the last reply.
- **Run controls** (off by default; Company Settings): team Unlimited / Drain / Resume, daily runs left, and "Drain after next run".
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
  - Claude/Codex sign-in works when the server runs on Windows.
- **`scripts/ppclip/start-local.mjs`**: starts an isolated local instance with its own data folder and ports.

## Supported Paperclip versions

| Paperclip | Patch |
|---|---|
| v2026.1012.0 | `versions/v2026.1012.0/` |

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
- Run controls and provider routing are off by default.

## For maintainers

This repository holds only the packaged overlay. The modules are developed in a separate source checkout (official Paperclip plus ppclip commits; the original full fork is kept as a git bundle, restore it with `git clone ppclip-full-fork-backup.bundle ppclip-source`). A patch is exported per official release:

```bash
node tools/build-patch.mjs --source <ppclip checkout> --base <official tag>
```

That writes `versions/<tag>/ppclip.patch` and its manifest. Private notes (`fork-inventory/`) and repository housekeeping are excluded.

## License

Paperclip is MIT-licensed, and ppclip's additions are distributed under the same terms. See [LICENSE](LICENSE).
