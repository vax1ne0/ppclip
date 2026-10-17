# Core

Settings → ppclip module switches, shared server route access, the local launcher, and small shared helpers.

**Settings → ppclip switch:** — (always on; it hosts the switches)

The launcher starts an isolated local instance: `node scripts/ppclip/start-local.mjs --data <folder>`.

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/features.ts`, `server/src/ppclip/features-routes.ts`, `server/src/ppclip/route-access.ts`, `server/src/__tests__/ppclip-features.test.ts`, `ui/src/ppclip/features/`, `ui/src/ppclip/agent-model.ts`, `scripts/ppclip/start-local.mjs`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
