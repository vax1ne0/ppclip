# Core

Settings → ppclip module switches, shared server route access, the local launcher, and small shared helpers.

**Settings → ppclip switch:** — (always on; it hosts the switches)

The launcher starts an isolated local instance: `node scripts/ppclip/start-local.mjs --data <folder>`. Add `--with-computer` to also start the computer-use supervisor.

**Updates:** Settings → ppclip → Updates has **Check for updates** and **Update and restart**. The terminal equivalent is `node scripts/ppclip/update.mjs`, with `--check` to only look. Both run `scripts/ppclip/update.mjs` in a separate process. It stops Paperclip cleanly, pulls the ppclip repo next to the checkout, runs `install.mjs update`, installs dependencies, and starts Paperclip again with the options recorded in `<data>/launcher.json`. The server routes live in `server/src/ppclip/update/` and are mounted with the module switches, so no extra hook is needed.

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/features.ts`, `server/src/ppclip/features-routes.ts`, `server/src/ppclip/route-access.ts`, `server/src/__tests__/ppclip-features.test.ts`, `ui/src/ppclip/features/`, `ui/src/ppclip/agent-model.ts`, `scripts/ppclip/start-local.mjs`, `scripts/ppclip/update.mjs`, `server/src/ppclip/update/`, `ui/src/ppclip/update/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
