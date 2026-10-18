# Working on ppclip

- This is an overlay package, not the upstream Paperclip repository. Feature source belongs in the module selected by `modules.json`; upstream integration edits belong in a tested hook patch and manifest. Do not commit the installed upstream checkout.
- Keep runtime data, handoff prompts, logs, Python bytecode and dependency installations out of tracked source. Historical research belongs in `docs/research/`; guides must distinguish implemented behavior from proposals.
- Remove confirmed unused code when touching an area. Preserve compatibility paths that still read saved data, redirect old URLs, or support uninstall/rollback; explain their purpose before removing them.
- Run `node tools/check.mjs` and `node --test tools/tests/installer.test.mjs` for package changes. For module or hook changes, run the relevant tests and UI/server typechecks in an installed checkout. Do not claim all upstream code is warning-free based on package checks.
- Verify compatibility in a disposable checkout. A clean patch is not runtime verification. Keep normal installs and automatic updates gated on tested revisions; never silently force an unsupported revision.
- Update affected guides and implementation status when behavior or supported features change. Keep changes focused and preserve unrelated user work.
