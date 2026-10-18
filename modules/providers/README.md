# Providers

Top-bar usage bars, dashboard subscription usage, the Providers panel, approved model lists and automatic provider switching.

Usage lookup throttling is separate from the subscription’s inference allowance. A `rate_limited` lookup does not imply a quota reset. Checks share a server cache, retain the last successful observation (including 100% usage), and back off for 15 minutes after a provider rate limit. The cache is in memory and clears when the server restarts; without a successful reading, usage remains unknown rather than assuming a balance.

**Settings → ppclip switches:** Providers → Usage bars and subscription usage; Providers → Provider switching; Providers → Approved models

**Approved models** is on by default. Its instance-wide switch hides the panel and bypasses its runtime restrictions when off. Saved company-specific lists are retained. See [model approvals](../../docs/model-approvals.md) for scope, storage, exceptions and verification commands.

Files here sit at the same paths they get inside Paperclip (`server/src/ppclip/providers/`, `server/src/__tests__/ppclip-provider-routing`, `ui/src/ppclip/providers/`). Edits to official files that wire this module in live in `hooks/<version>/hooks.patch`, marked `// ppclip:`.
