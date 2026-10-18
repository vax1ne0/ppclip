# Updates and removal

Run these from the folder that holds both checkouts (or add `--target <paperclip folder>`):

```bash
node ppclip/install.mjs status      # installed? files edited since install? newer ppclip files?
node ppclip/install.mjs uninstall   # back to plain official Paperclip
```

`uninstall` refuses if you edited ppclip's files after installing, and lists them. Pass `--force` to discard those edits.

**The easy way: one click or one command.** If you start Paperclip with `scripts/ppclip/start-local.mjs`:
- **In the app:** go to **Settings → ppclip → Updates**, press **Check for updates**, then **Update and restart**.
- **From a terminal:** run this from the folder that holds both checkouts:
  ```bash
  node paperclip/scripts/ppclip/update.mjs            # add --check to only look
  ```

Either way:
- **Steps:** it stops Paperclip and the computer supervisor cleanly, then pulls ppclip and runs `install.mjs update`. Next it installs dependencies, using `pnpm`, or the copy that ships with Node if pnpm isn't on your PATH. Finally it starts Paperclip again with the same start-local options.
- **Duration:** Paperclip is down for about a minute, longer when dependencies change, and the page reloads itself.
- **Computer image:** if the computer-use image changed, it is rebuilt in the background afterwards.
- **Progress:** the compact Updates section shows clear status, a loading bar and plain-language installation steps. Reopening it resumes tracking a running update. The page reloads after success and shows a brief recovery message on failure. Technical records stay in `ppclip-update.log` and `ppclip-update.json` in the data folder.
- **Check progress:** the check bar advances through four completed stages: ppclip, Paperclip, compatibility and finishing. Its value comes from the server, not a timer or a time estimate. A lightweight memory-only endpoint is polled while a check runs; those progress reads do no Git, filesystem or remote work. Failed checks stop at their last completed stage. Installing an update retains its separate restart feedback.
- **Versions:** expand the collapsed-by-default **Versions** dropdown for two compact rows showing the installed Paperclip and ppclip versions. **Check for updates** checks Paperclip release tags and the fetched ppclip compatibility records. Stable installations check stable tags; canary installations also check prereleases. A newer unsupported Paperclip shows **Waiting for ppclip support**, while an unverifiable release shows a check failure rather than claiming support is missing. Updates install only versions supported by the ppclip installer; ppclip can update independently while a newer Paperclip waits.
- **ppclip build numbers:** a tagged release is shown as its version; commits after that release use a build suffix, such as `0.2.0+45`. Untagged checkouts use a dated build label. These identify the package checkout without putting commit hashes in the UI. Remote results are cached between explicit checks and across restarts; ordinary status polling reads only local metadata. Moving the package checkout invalidates its previous check result.
- **User-facing details:** the Updates section omits commit identifiers, file lists, command output and log locations. If a new version is blocked, it explains that automatic updates are unavailable and asks the user to contact whoever set up the installation. The updater still refuses to overwrite tracked local edits. Maintainers can inspect local Git changes and updater records outside the settings UI.
- **Checks and recovery:** the last check survives server restarts in `ppclip-update-check.json`. A failed check does not report “up to date.” If the server stays offline, inspect `ppclip-update.log` and `server.stderr.log`, then relaunch with the same data folder and options. A failed updater launch keeps the existing server running.
- **Who can update:** only an instance admin, and the update is written to each company's activity log.
- **When it refuses:** it won't start if the ppclip folder has local changes. A running agent's work is interrupted, and the button warns you first.

**By hand**, pull ppclip and let it move Paperclip:

```bash
git -C ppclip pull
node ppclip/install.mjs update --with-deps
```

`update`:
- refuses if you edited ppclip's files (`--force` discards the edits) or if the checkout has other uncommitted changes;
- fetches official Paperclip and checks out the newest version ppclip supports (detached at that commit or tag), then reinstalls ppclip on it. If Paperclip is already there, it only reinstalls when the ppclip files changed, and otherwise says so and does nothing;
- leaves everything as it is if your Paperclip is newer than any version ppclip supports (ppclip hasn't been ported to it yet);
- puts the previous commit back and reinstalls ppclip there if anything fails, so the checkout is never left half-updated.

Without `--with-deps`, run `pnpm install --frozen-lockfile` in the Paperclip folder afterwards. Then build and start as usual. The database is migrated by Paperclip itself when it starts, so back up your data folder first, as with any Paperclip update.
