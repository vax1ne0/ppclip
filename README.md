# ppclip

Team views, live activity, customizable mascots, provider controls, and agent desktops for [Paperclip](https://github.com/paperclipai/paperclip). Install over an official source checkout and choose your features in **Settings → ppclip**.

[Existing installation](#add-to-existing-paperclip) · [Fresh installation](#install-paperclip--ppclip) · [Computer use](#enable-computer-use) · [Backups](#back-up-first)

![Team canvas with agent cards, reporting lines, and chat and computer shortcuts](docs/images/team.jpg)

## Features

- **Team & live runs:** editable layouts, reporting lines, and live activity cards.
- **Agent chat & mascots:** model labels, tabs ordered by your last sent message, custom colors, and interactive previews.
- **Computer use:** a Linux desktop and Chromium per agent, live screen, and human takeover.
- **Provider & run controls:** usage limits, optional provider switching, approved models, and team pause/resume controls.
- **Settings & fixes:** independent module switches, update checks, and run-state and Windows sign-in fixes.

## Back up first

Before changing an existing installation:

1. Pause agents and save a **database backup**. It holds agents, tasks, chat history, and saved settings.
2. Stop Paperclip and its workers. Copy the **whole data folder**, including configuration, uploads, workspaces, and **`secrets/master.key`**. Usually this is `~/.paperclip`; ppclip's launcher uses the folder passed to `--data`, often `.ppclip-runtime`.
3. Save files outside that folder: custom instructions, project workspaces, `.env` files, and separately configured storage. Back up Docker profile volumes if you already use agent computers.

Keep backups outside the installation folders. A company/agent export **is not a full backup**. [Backup commands and restore checklist →](docs/backups.md)

## Requirements

**Git, Node.js 24.11+, pnpm 9.15.4**, and [Paperclip's build prerequisites](https://github.com/paperclipai/paperclip#development), including Rust or a compatible prebuilt runner. Computer use also needs **Docker** running Linux containers; on Windows, enable Docker Desktop's WSL2 integration.

Commands below use **Bash** (Linux, macOS, or WSL2), including `curl`. [PowerShell and native Windows notes →](docs/installation.md#windows-powershell)

## Add to existing Paperclip

Use an official **Git source checkout**. Docker-image and npm-only installations need a separate source setup. Back up and stop the app first. Run from the folder containing your `paperclip` checkout; replace that path if yours has another name.

```bash
git clone https://github.com/vax1ne0/ppclip
node ppclip/install.mjs compatibility --target ./paperclip --ref HEAD
node ppclip/install.mjs install --target ./paperclip --with-deps
cd paperclip
pnpm build
node scripts/ppclip/computer-supervisor.mjs build-image
```

Continue only when compatibility reports **`verified`**. The installer requires a clean, supported checkout. Preserve local code changes before installing; do not force a different version onto your data.

**Run it:** restart with your **usual Paperclip command, data directory, and environment**. In a second terminal, from the same checkout and with the same environment, run:

```bash
node scripts/ppclip/computer-supervisor.mjs
```

For a custom data directory, [configure the shared supervisor token](docs/installation.md#existing-instance-computer-connection). If you already use ppclip's local launcher, restart with your existing `--data` value and add `--with-computer` instead. Then [enable computer use](#enable-computer-use).

## Install Paperclip + ppclip

This downloads the **latest official stable release** and ppclip. If that release is not supported yet, the installer stops; check [compatibility](#compatibility) before continuing.

Run in a new workspace folder, with Docker running. Run each command after the previous one succeeds.

```bash
stable=$(curl -fsSL https://api.github.com/repos/paperclipai/paperclip/releases/latest | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).tag_name")
git clone --branch "$stable" https://github.com/paperclipai/paperclip paperclip
git clone https://github.com/vax1ne0/ppclip
node ppclip/install.mjs install --target ./paperclip --with-deps
cd paperclip
pnpm build
node scripts/ppclip/computer-supervisor.mjs build-image
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime --with-computer
```

Open **http://127.0.0.1:3410**, create your company and agents, and connect their AI accounts. Select an explicit model; manage allowed models under **Providers → Approved models**, or disable that module in **Settings → ppclip**.

**Start it again later**, from `paperclip`:

```bash
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime --with-computer
```

Keep using the same data folder. The launcher starts the app and supervisor in the background. Build the desktop image once; rebuild when an update requires it. To skip computer use, omit `build-image` and `--with-computer`.

## Enable computer use

1. Open a **Claude Code or Codex local agent → Harness / Runtime → Computer use**.
2. Turn on company computer use, enable **Give this agent a computer**, and check that the supervisor is connected.
3. Open **Live screen → Start computer**. Ask the agent to use its browser; choose **Take control** to interact yourself.

Browser profiles persist in Docker volumes. Computer use is opt-in; shell access has its own switch. [Setup, controls, and security limits →](docs/computer-use.md)

## Compatibility

| Supported Paperclip | Revision |
|---|---|
| [Stable v2026.1012.0](https://github.com/paperclipai/paperclip/releases/tag/v2026.1012.0) | `bba6a45f0` |
| Existing canary snapshot | `669d329f2` |

Updates follow stable releases. Newer releases need tested ppclip support; existing canary databases are not automatically downgraded. [Details →](docs/compatibility.md)

## Update or remove

For launcher-based installs, use **Settings → ppclip → Updates → Check for updates**. Back up before updating. [Manual updates and other startup methods →](docs/updating.md)

To remove ppclip, stop the app and run from the parent workspace:

```bash
node ppclip/install.mjs uninstall --target ./paperclip
cd paperclip
pnpm install --frozen-lockfile
pnpm build
```

Restart with your usual configuration. Removal keeps your instance data.

<details>
<summary><strong>More screenshots</strong></summary>

**Live screen**

![Agent desktop with live view and takeover controls](docs/images/computer.jpg)

**Module settings**

![Independent ppclip module switches](docs/images/modules.jpg)

**Updates**

![Compact update section with collapsed version details](docs/images/updates.jpg)

Captures show one installation; names and switch states are examples. [Capture notes](docs/images/README.md).

</details>

## Documentation

[Installation](docs/installation.md) · [Backups](docs/backups.md) · [Computer use](docs/computer-use.md) · [Updates](docs/updating.md) · [Approved models](docs/model-approvals.md) · [Development](docs/development.md) · [Implementation status](docs/implementation-status.md)

## Repository layout

`modules/` holds features, `hooks/` holds version-specific integrations, `docs/` holds guides, and `tools/` holds maintainer checks. `install.mjs` installs and removes the overlay. Keep this package, Paperclip, and runtime data in separate folders.

MIT licensed. [License](LICENSE) · [Computer-use acknowledgements](docs/research/computer-use.md). The desktop image installs third-party packages under their respective licenses.
