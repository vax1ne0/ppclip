# Paperclip v2026.1012.0

Stable base: `bba6a45f0d364cfd962ac59b3bdf2426a8222adb`. The manifest records the exact source tree and hook checksum. Module source is shared with the supported canary base.

Stable keeps agent configuration, hiring, dispatch and recovery in its monolithic services. These hooks integrate protected metadata, run credits, drain-after claims, approved-model enforcement and computer MCP delivery in those paths. Provider routing delegates configuration writes to stable's agent service inside the routing transaction; the service retains secret normalization, revision history and session resets.

The UI hooks include ppclip's pages, mascot controls, role picker, computer badges and chat behavior. Small rendering and picker helpers are backported where the shared modules need them. Stable retains its upstream account connection and manual sign-in flow; this overlay does not add the canary's provider gateway or browser-login subsystem.

Validated on Windows with Node 24.22.0 and pnpm 9.15.4: UI/server typechecks, 424 UI tests, 145 ppclip server tests, the production UI bundle, actual installation/uninstallation, and a fresh-database API/browser smoke check. The browser check covered settings, dashboard, team and computer-page navigation; the API check covered module switches, provider/run-control/model-policy reads, agent saves, protected computer metadata and generated mascots. This port did not perform a new authenticated provider login or a live Docker desktop session.

Use a separate data directory. Supporting this release does not verify a downgrade of an existing canary database; automatic downgrades remain disabled.
