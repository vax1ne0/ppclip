# Compatibility

ppclip is a source overlay. Modules are separate, but integration hooks change Paperclip internals: navigation, mascot rendering, agent configuration, run dispatch and recovery. A Git patch can apply while an imported type, function signature or runtime contract has changed elsewhere. No installer can guarantee compatibility with arbitrary future upstream changes.

Stable `v2026.1012.0` and the existing `669d329f2` canary snapshot have separate hook sets and share the same module source. The stable hooks integrate with its monolithic agent and heartbeat services; the canary hooks target its extracted services. Stable keeps its upstream connection/sign-in flow. ppclip does not backport the canary's entire provider gateway or browser-login subsystem.

Use a fresh data directory for a stable installation. Stable support does not certify opening a newer canary database with older server code, and the updater will not perform that downgrade.

## Check a revision without changing files

```bash
node install.mjs compatibility --target ../paperclip --ref HEAD
node install.mjs compatibility --target ../paperclip --ref v2026.1018.0-canary.7 --json
```

The revision must already be available in the local Git repository. This command makes no network calls, does not check out a revision, and checks committed files using a temporary Git index. Local working edits are intentionally excluded.

| Result | Meaning |
|---|---|
| `verified` | Matches a recorded supported commit or source tree, hooks apply, and module paths do not collide. |
| `patch-applies-unverified` | Hooks apply and module paths are free, but runtime compatibility has not been verified. |
| `blocked` | A hook conflicts or upstream now owns a module destination. |

Exit status is 0 when at least one hook set applies, 2 when all are blocked, and 1 for invalid input or a failed check. Use `--version <hook-folder>` to test one hook set. JSON results are suitable for a compatibility CI matrix; exit 0 alone is not a support certification.

Maintainers can already experiment in a **separate disposable checkout** with `install --version <hook-folder> --force-version`. This still requires a clean checkout and an applicable patch. Run dependency installation, UI/server typechecks, relevant regression tests and live checks, then export and publish a manifest for that tested revision. Normal installs and automatic updates retain the verified-revision gate.

## Make support more flexible

The `compatibility.yml` workflow now installs both recorded revisions in separate checkouts, runs UI/server typechecks and all module regression suites, builds the Docker desktop, and tests native controls, networking, profile archives and the real computer lifecycle. Stable also exercises the optional CUA observer. A separate job fetches GitHub's latest stable release and uploads an applicability report. It does **not** promote that release or bypass the install gate. These workflow definitions still need their first successful GitHub Actions run; local checks are recorded separately.

1. Check upstream revisions automatically with this probe; promote a revision only after typechecks and behavioral tests pass. Keep the previous supported revision for rollback.
2. Move independent settings pages, dashboards, integrations and jobs onto Paperclip's versioned plugin SDK where its documented extension points cover the feature.
3. Keep a small overlay for features that still alter built-in behavior. Request upstream extension points for those seams instead of repeatedly patching the same implementation.
4. Use version ranges only when the relevant upstream contracts and release tests justify them. API capability detection can select an implementation, but it cannot prove arbitrary source changes are safe.

Paperclip documents optional plugin UI bundles, worker entry points and a manifest in its [plugin guide](https://docs.paperclip.ing/administration/plugins/). That guide currently labels plugins alpha and warns that APIs can break, so a plugin migration would still need version testing. Git documents patch checking and three-way application in [git apply](https://git-scm.com/docs/git-apply). A clean three-way merge reduces manual porting work; it does not verify behavior. Migrating the current overlay into a native plugin is a separate architectural change, not something the new probe pretends to have completed.
