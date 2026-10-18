# Development

Run module tests from an installed Paperclip checkout, where the workspace dependencies and aliases are available. Export commands below run from this ppclip package. See the root [repository layout](../README.md#repository-layout) for how source and version-specific hooks fit together.

Turn **Approved models** on or off independently under **Settings → ppclip → Providers**. It defaults to on. Turning it off hides its panel and bypasses approval enforcement for subsequent runs throughout the instance; saved lists are retained and take effect again when enabled. No restart is needed when using the switch.

See [the model approvals guide](model-approvals.md) for permissions, exceptions, storage and test commands.

**Model approvals:** Providers → Approved models controls which exact model IDs each harness may run. Both execution paths, task overrides, retries and automatic provider switches enforce this on the server. Empty/default/auto selections cannot start a model-based run. The first startup preserves explicit choices on existing approved agents; later configuration changes do not approve new models. Agents without a selected model remain unconfigured. Removing all approvals blocks new model-based runs; changes apply to subsequent dispatches, not work already running. Non-model process and external bot runtimes retain their own configuration.

The computer lifecycle smoke test and startup recovery behavior are documented under [Testing it](computer-use.md#testing-it).

The code in `modules/` is the source; edit it there or in a working Paperclip checkout and export it back.

Before publishing, run these dependency-free checks from the package:

```bash
node tools/check.mjs
node --test tools/tests/installer.test.mjs
node install.mjs compatibility --target ../paperclip --ref HEAD
```

`tools/check.mjs` checks module ownership, duplicate destinations, generated artifacts, hook hashes and path lists, module counts, local Markdown links and JavaScript syntax. Add `--target ../paperclip` to compare module source with the installed checkout. It does not replace UI/server typechecks and behavioral tests. Keep temporary handoffs and runtime logs outside this repository. Research belongs in `docs/research/`; maintained guides describe shipped behavior. See [implementation status](implementation-status.md).

**Working on ppclip:**
1. Install ppclip on a clean official checkout of a supported commit (`install.mjs install`).
2. Edit, build and test in that checkout as usual. New files must match a rule in `modules.json`.
3. Write the changes back into this repo:
   ```bash
   node tools/export.mjs --source <paperclip checkout>
   ```
   This rewrites `modules/` (module READMEs are kept) and `hooks/<version>/`. The version name is the official tag at the checkout's commit, or `master-<short commit>`; pass `--name` to choose.

**Supporting a new official release:** check out the new tag, apply the current `hooks/<version>/hooks.patch` with `git apply -3`, resolve any conflicts in the marked hook lines, copy the module files in, test, then export with `--name <tag>`. Remove hook folders for versions you no longer support, and tag the ppclip release.
