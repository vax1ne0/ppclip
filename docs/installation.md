# Installation

Start with the README's [existing-installation](../README.md#add-to-existing-paperclip) or [fresh-installation](../README.md#install-paperclip--ppclip) steps. [Back up existing data first](backups.md).

ppclip installs over a clean official Git source checkout on a [supported revision](../README.md#compatibility). It does not modify an npm-installed package or a running Docker image. Keep these separate:

```text
workspace/
  paperclip/          Official source with ppclip installed
  ppclip/             This package
  .ppclip-runtime/    Data for a NEW launcher-based instance
```

Existing installations should keep their existing data location and startup configuration.

## Windows (PowerShell)

Install Git, Node.js 24.11+, pnpm 9.15.4, and Paperclip's build prerequisites. Source builds normally need Rust for the native runner, or a compatible prebuilt runner configured as `PAPERCLIP_RUNNER_BINARY`. For computer use, start Docker Desktop with Linux containers and its WSL2 backend.

**WSL2 is the simpler build environment:** enable Docker Desktop integration for your WSL distribution and use the README's Bash commands inside WSL. For an existing native Windows instance, keep using its Windows setup and paths; moving an installation into WSL is a separate migration.

### New installation in PowerShell

Upstream build scripts use Unix commands. Set Git Bash as the script shell **before installation/building** (adjust the path if needed):

```powershell
$env:npm_config_script_shell = 'C:\Program Files\Git\bin\bash.exe'
```

This applies to that terminal session. Upstream Rust/runner prerequisites still apply; see [Paperclip development](https://github.com/paperclipai/paperclip#development). For portable Node, put its directory on this terminal's PATH so `node` and pnpm use the same runtime.

From a new workspace folder:

```powershell
$stable = (Invoke-RestMethod 'https://api.github.com/repos/paperclipai/paperclip/releases/latest').tag_name
git -c core.autocrlf=false clone --branch $stable https://github.com/paperclipai/paperclip paperclip
git clone https://github.com/vax1ne0/ppclip
node ppclip/install.mjs install --target ./paperclip --with-deps
cd paperclip
pnpm build
node scripts/ppclip/computer-supervisor.mjs build-image
node scripts/ppclip/start-local.mjs --data ../.ppclip-runtime --with-computer
```

Run commands one at a time and stop on failure. The installer refuses an unsupported stable release. Wait for **ppclip is ready**, then open http://127.0.0.1:3410. Cold startup can take several minutes; the launcher reports progress while waiting. If startup fails, it shows the log locations. Do not start another copy while it is still starting.

The clone command keeps upstream source files in LF format without changing your global Git settings, which avoids line-ending mismatches in generated build contracts.

### Existing installation in PowerShell

After backing up and stopping the app, the README's existing-install commands also work in PowerShell. Change `--target ./paperclip` to the actual checkout path. Restart with the original command and environment; do not point the new-instance launcher at an arbitrary existing data folder.

## Existing-instance computer connection

Build the image from the patched Paperclip checkout:

```bash
node scripts/ppclip/computer-supervisor.mjs build-image
```

Run the supervisor beside your normal Paperclip service:

```bash
node scripts/ppclip/computer-supervisor.mjs
```

By default, both use `~/.paperclip/ppclip-computer-supervisor.token` and `http://127.0.0.1:7091`. The supervisor creates the token. For another service user, a custom token location, or a custom runtime directory, set **both processes** to the same absolute token path:

```bash
export PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE=/absolute/path/to/data/ppclip-computer-supervisor.token
```

PowerShell equivalent:

```powershell
$env:PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE = 'C:\path\to\data\ppclip-computer-supervisor.token'
```

Persist that variable in your service configuration if applicable, then restart Paperclip and the supervisor. Both must run where they can reach the same loopback address. Docker/remote-host deployments need explicit networking configuration; the default instructions target a local source installation.

For an existing ppclip launcher installation, keep its recorded `--data`, `--port`, and `--pg-port` values and add `--with-computer`. Do not start a second copy while the first is running.

Finish with [Enable computer use](../README.md#enable-computer-use). Supported agents are Claude Code and Codex local agents; [the computer guide](computer-use.md) covers controls, profiles, and security limits.

## Installer and startup notes

- `--target` selects the Paperclip checkout explicitly. Without it, the installer searches the current folder and neighboring checkouts.
- `--with-deps` runs `pnpm install --frozen-lockfile`. It does not build or start Paperclip.
- The installer applies source hooks and records them in `.ppclip-overlay.json`; it commits nothing and preserves runtime data. Local source changes must be saved separately before installation.
- The new-instance launcher uses app port **3410**, auxiliary port **13410**, and PostgreSQL port **55440**. Change with `--port` and `--pg-port`; keep the same values on later starts.
- If installation reports unsupported Paperclip, use the [compatibility guide](compatibility.md). Do not force hooks or downgrade a newer database to bypass the check.
