import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { checkVersions, installedVersions, type UpdateVersions } from "./versions.js";

const run = promisify(execFile);

/**
 * ppclip self-update (Settings → ppclip → Update). The work is done by
 * scripts/ppclip/update.mjs in a separate process that outlives this server:
 * the server starts it, then shuts itself down cleanly, and the script pulls
 * ppclip, reinstalls it, installs dependencies and restarts Paperclip with the
 * same start-local options.
 */

export type UpdateJob = {
  state?: "starting" | "running" | "done" | "failed";
  step?: string;
  error?: string | null;
  from?: string;
  to?: string;
  commits?: string[];
  image?: string;
  startedAt?: string;
  finishedAt?: string | null;
  updatedAt?: string;
};

export type UpdateStatus = {
  versions?: UpdateVersions;
  localChanges?: string[];
  installation?: { installedAt: string; paperclipVersion: string } | null;
  packageDir: string | null;
  current: { commit: string; subject: string; date: string } | null;
  /** New commits on the ppclip repo's upstream branch, newest first (from the last check). */
  available: string[];
  checkedAt: string | null;
  checkError: string | null;
  /** Why the button can't be used, if it can't. */
  blocked: string | null;
  runningRuns: number;
  job: UpdateJob | null;
  logTail: string[];
};

export type UpdatePaths = { app: string; home: string | null; packageDir: string | null };

export type CheckProgress = {
  id: number;
  state: "idle" | "checking" | "complete" | "failed";
  completed: number;
  total: number;
  label: string;
};

/** The Paperclip checkout this server runs from (…/server/src/ppclip/update → four levels up). */
export function appRoot(from = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "scripts", "ppclip")) && fs.existsSync(path.join(dir, "server"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(from, "..", "..", "..", "..");
}

/** The ppclip repo: PPCLIP_PACKAGE_DIR, or the one folder next to the checkout with install.mjs and modules.json. */
export function findPackageDir(app: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.PPCLIP_PACKAGE_DIR) return path.resolve(env.PPCLIP_PACKAGE_DIR);
  const parent = path.dirname(app);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return null;
  }
  const found = entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parent, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, "install.mjs")) && fs.existsSync(path.join(dir, "modules.json")));
  return found.length === 1 ? found[0]! : null;
}

export function defaultUpdatePaths(): UpdatePaths {
  const app = appRoot();
  return { app, home: process.env.PAPERCLIP_HOME ?? null, packageDir: findPackageDir(app) };
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

async function git(dir: string, args: string[], timeout = 60_000) {
  const { stdout } = await run("git", ["-C", dir, ...args], { timeout, windowsHide: true });
  return stdout.trim();
}

export type UpdateDeps = {
  paths?: UpdatePaths;
  countRunningRuns?: () => Promise<number>;
  /** Starts the detached updater. Tests replace it. */
  spawnUpdater?: (paths: UpdatePaths & { home: string; packageDir: string }, force: boolean) => void | Promise<void>;
  /** Ends this server cleanly. Tests replace it. */
  shutdown?: () => void;
};

export function updateService(deps: UpdateDeps = {}) {
  const paths = deps.paths ?? defaultUpdatePaths();
  type Check = { available: string[]; checkedAt: string; error: string | null; versions?: UpdateVersions; packageHead?: string };
  const checkFile = paths.home ? path.join(paths.home, "ppclip-update-check.json") : null;
  let lastCheck = checkFile ? readJson<Check>(checkFile) : null;
  let checking: Promise<void> | null = null;
  let starting = false;
  let progress: CheckProgress = { id: 0, state: "idle", completed: 0, total: 4, label: "Ready" };
  const advance = (completed: number, label: string) => { progress = { ...progress, completed, label }; };

  const statusFile = () => (paths.home ? path.join(paths.home, "ppclip-update.json") : null);

  function job(): UpdateJob | null {
    const file = statusFile();
    return file ? readJson<UpdateJob>(file) : null;
  }

  function logTail(lines = 30) {
    if (!paths.home) return [];
    try {
      const fd = fs.openSync(path.join(paths.home, "ppclip-update.log"), "r");
      try {
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        return buffer.toString("utf8").trimEnd().split("\n").slice(-lines);
      } finally { fs.closeSync(fd); }
    } catch {
      return [];
    }
  }

  async function blocked(ignoreStarting = false): Promise<string | null> {
    if (!paths.packageDir) return "The ppclip folder wasn't found next to Paperclip. Set PPCLIP_PACKAGE_DIR, or update from a terminal.";
    if (!paths.home || !fs.existsSync(path.join(paths.home, "launcher.json"))) {
      return "Paperclip wasn't started with scripts/ppclip/start-local.mjs, so it can't restart itself. Update from a terminal instead.";
    }
    const current = job();
    if ((!ignoreStarting && starting) || current?.state === "starting" || current?.state === "running") return "An update is already running.";
    try {
      const dirty = await git(paths.packageDir, ["status", "--porcelain", "--untracked-files=no"]);
      if (dirty) return "Updates are paused because the ppclip package has local changes. Review and commit or stash your work before updating.";
    } catch {
      return "The ppclip folder isn't a git checkout.";
    }
    return null;
  }

  return {
    paths,
    /** Memory-only: frequent progress reads do no Git, filesystem or network work. */
    checkProgress: () => ({ ...progress }),

    async status(): Promise<UpdateStatus> {
      let current: UpdateStatus["current"] = null;
      if (paths.packageDir) {
        try {
          const [commit, subject, date] = (await git(paths.packageDir, ["log", "-1", "--format=%h%x1f%s%x1f%cI"])).split("\x1f");
          current = { commit: commit!, subject: subject ?? "", date: date ?? "" };
        } catch {
          current = null;
        }
      }
      const installed = readJson<{ installedAt: string; paperclipVersion: string }>(path.join(paths.app, ".ppclip-overlay.json"));
      const localVersions = await installedVersions(paths, git);
      const stale = Boolean((lastCheck?.packageHead && lastCheck.packageHead !== current?.commit)
        || (lastCheck?.versions && lastCheck.versions.paperclip.releaseChannel !== "stable")
        || (lastCheck?.versions && lastCheck.versions.paperclip.current !== localVersions.paperclip.current));
      const versions = !stale && lastCheck?.versions ? {
        paperclip: { ...lastCheck.versions.paperclip, current: localVersions.paperclip.current },
        ppclip: { ...lastCheck.versions.ppclip, current: localVersions.ppclip.current },
      } : localVersions;
      return {
        versions,
        localChanges: paths.packageDir ? (await git(paths.packageDir, ["status", "--porcelain", "--untracked-files=normal"]).catch(() => "")).split("\n").filter(Boolean) : [],
        installation: installed ? { installedAt: installed.installedAt, paperclipVersion: installed.paperclipVersion } : null,
        packageDir: paths.packageDir,
        current,
        available: stale ? [] : lastCheck?.available ?? [],
        checkedAt: stale ? null : lastCheck?.checkedAt ?? null,
        checkError: stale ? null : lastCheck?.error ?? null,
        blocked: await blocked(),
        runningRuns: deps.countRunningRuns ? await deps.countRunningRuns() : 0,
        job: job(),
        logTail: logTail(),
      };
    },

    /** Fetches the ppclip repo and lists the commits that an update would bring. */
    async check() {
      if (!checking) checking = (async () => {
        progress = { id: progress.id + 1, state: "checking", completed: 0, total: 4, label: "Checking ppclip…" };
        try {
          if (!paths.packageDir) throw new Error("The ppclip folder wasn't found.");
          await git(paths.packageDir, ["fetch", "--quiet"], 120_000);
          const out = await git(paths.packageDir, ["log", "--format=%h %s", "HEAD..@{u}"]);
          advance(1, "Checking Paperclip…");
          const versions = await checkVersions(paths, git, undefined, () => advance(2, "Checking compatibility…"));
          advance(3, "Finishing check…");
          versions.ppclip.updateAvailable = Boolean(out);
          lastCheck = { available: out ? out.split("\n") : [], checkedAt: new Date().toISOString(), error: null, versions,
            packageHead: await git(paths.packageDir, ["rev-parse", "--short", "HEAD"]) };
        } catch (err) {
          progress = { ...progress, state: "failed", label: "Couldn’t check for updates" };
          lastCheck = { available: [], checkedAt: new Date().toISOString(), error: err instanceof Error ? err.message.split("\n")[0]! : "git fetch failed" };
        }
        if (checkFile) {
          try { fs.writeFileSync(checkFile, JSON.stringify(lastCheck)); } catch { /* Read-only data folder: checks still work. */ }
        }
        if (progress.state === "checking") progress = { ...progress, state: "complete", completed: 4, label: "Check complete" };
      })().finally(() => { checking = null; });
      await checking;
      return this.status();
    },

    /** Starts the updater, then shuts this server down so it can be replaced. */
    async start(opts: { force?: boolean } = {}) {
      if (starting) throw new UpdateBlockedError("An update is already running.");
      starting = true;
      try {
        const reason = await blocked(true);
        if (reason) throw new UpdateBlockedError(reason);
        const ready = { ...paths, home: paths.home!, packageDir: paths.packageDir! };
        fs.writeFileSync(path.join(ready.home, "ppclip-update.json"), JSON.stringify({
          state: "starting", step: "Starting updater", startedAt: new Date().toISOString(), finishedAt: null, error: null,
        }, null, 2));
        try {
          await (deps.spawnUpdater ?? spawnDetachedUpdater)(ready, opts.force === true);
        } catch (err) {
          fs.writeFileSync(path.join(ready.home, "ppclip-update.json"), JSON.stringify({
            state: "failed", step: "Could not start updater", error: err instanceof Error ? err.message : String(err), finishedAt: new Date().toISOString(),
          }, null, 2));
          throw err;
        }
      } catch (err) {
        starting = false;
        throw err;
      }
      // Give the response time to reach the browser, then stop cleanly (embedded Postgres included).
      setTimeout(() => (deps.shutdown ?? gracefulShutdown)(), 1500).unref?.();
      return { started: true };
    },
  };
}

export class UpdateBlockedError extends Error {}

async function spawnDetachedUpdater(paths: UpdatePaths & { home: string; packageDir: string }, force: boolean) {
  const log = fs.openSync(path.join(paths.home, "ppclip-update.log"), "a");
  try {
  const child = spawn(process.execPath, [
    path.join(paths.app, "scripts", "ppclip", "update.mjs"), "--run", "--data", paths.home, "--package", paths.packageDir, ...(force ? ["--force"] : []),
  ], { cwd: paths.app, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve());
  });
  child.unref();
  } finally { fs.closeSync(log); }
}

/** The server's own SIGTERM handler, called in-process so it also works on Windows. */
function gracefulShutdown() {
  process.emit("SIGTERM" as NodeJS.Signals);
}
