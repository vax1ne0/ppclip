# Back up your installation

Do this before installing ppclip over an existing Paperclip, updating Paperclip, or moving data. Keep the backup outside both repositories and the live data directory, preferably on another disk. It contains private data and credentials; do not commit it to Git.

## 1. Back up the database

Pause agents and let active work finish. From your existing Paperclip checkout, with its normal environment and database still running:

```bash
pnpm paperclipai db:backup --dir ../paperclip-backup/database
```

If you normally use a custom config, specify it:

```bash
pnpm paperclipai db:backup --config /path/to/config.json --dir ../paperclip-backup/database
```

Use the same `PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_CONFIG`, and/or `DATABASE_URL` as the running app. Confirm the command reports a saved file and check its printed config and connection source. For an externally hosted PostgreSQL database, also use your database provider's backup/snapshot process as appropriate.

The database holds agent definitions, roles, models, reporting relationships, tasks, conversations, policies, and other saved application state. A company/agent export is an additional portable copy, not a replacement for the database and files.

## 2. Stop the app and copy its files

Stop Paperclip, workers, and other processes that write to this instance. Copy the whole active data directory:

| Setup | Usual location |
|---|---|
| Standard Paperclip | `~/.paperclip` (`%USERPROFILE%\.paperclip` on Windows) |
| ppclip local launcher | The exact folder passed to `--data`, often `.ppclip-runtime` |
| Custom installation | The paths selected by its config, environment, or mounted Docker volumes |

Include configuration, the local encrypted secrets key (normally `instances/<instance>/secrets/master.key`), uploads/storage, workspaces, projects, and ppclip settings. A database dump cannot replace the matching encryption key. If a secrets key is supplied through an environment variable or external provider, preserve access to that source too.

If copying the raw embedded `db/` directory, stop PostgreSQL itself first. A file copy of a running database is not a reliable database backup; keep the logical dump from step 1.

Also copy anything configured **outside** the data directory:

- `.env` files, service/launcher configuration, and the original startup command.
- Agent instruction bundles, skills, and project/working directories.
- Separately configured upload storage or object-store contents.
- Provider CLI configuration/authentication homes used outside Paperclip, if you need to preserve those logins.

Record the Paperclip revision with `git rev-parse HEAD`. Preserve local source changes and any existing ppclip checkout/installation record so you can restore the same application version.

## 3. Back up computer browser profiles

Agent desktop profiles live in Docker volumes, outside the Paperclip database and data directory. Stop those computers before backing up their volumes. List them with:

```bash
docker volume ls --filter name=ppclip-computer-home-
```

Archive each profile volume using your Docker volume backup process. Preserve the instance's supervisor token/configuration too. The desktop image can be rebuilt; browser profiles and their saved logins need their own backup.

## Before restoring

Check that you have a readable database backup, the matching secrets key, configuration, and required files. Ideally test recovery in an isolated instance. Restore using the original Paperclip version first, with the same paths or corrected configuration; never run two servers against the restored data at once.

Installing stable ppclip support does not make it safe to open a newer canary database with older stable Paperclip. Uninstalling ppclip removes its source overlay; it does not undo upstream database migrations.
