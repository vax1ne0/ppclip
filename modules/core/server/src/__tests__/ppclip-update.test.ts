import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPackageDir, updateService, UpdateBlockedError } from "../ppclip/update/service.ts";

const UPDATER = path.resolve(__dirname, "../../../scripts/ppclip/update.mjs");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

let root: string;

/** root/{origin.git, ppclip, paperclip, .ppclip-runtime}: a ppclip clone one commit behind its origin. */
function layout() {
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "work", "seed"); // not next to Paperclip, so it isn't mistaken for a second ppclip
  fs.mkdirSync(seed, { recursive: true });
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(seed, "init", "-q", "-b", "main");
  // A stand-in installer: records how it was called.
  fs.writeFileSync(path.join(seed, "install.mjs"), "import fs from 'node:fs'; fs.writeFileSync(process.env.FAKE_LOG_DIR + '/install-args.json', JSON.stringify(process.argv.slice(2)));\n");
  fs.writeFileSync(path.join(seed, "modules.json"), "{}\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const pkg = path.join(root, "ppclip");
  git(root, "clone", "-q", origin, pkg);
  fs.writeFileSync(path.join(seed, "NEW.md"), "new\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "Add a new feature");
  git(seed, "push", "-q", "origin", "main");
  const app = path.join(root, "paperclip");
  fs.mkdirSync(path.join(app, "scripts", "ppclip"), { recursive: true });
  fs.mkdirSync(path.join(app, "server"));
  const home = path.join(root, ".ppclip-runtime");
  fs.mkdirSync(home);
  return { pkg, app, home };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-update-")));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ppclip update service", () => {
  it("finds the one ppclip folder next to Paperclip", () => {
    const { app, pkg } = layout();
    expect(findPackageDir(app, {})).toBe(pkg);
    expect(findPackageDir(app, { PPCLIP_PACKAGE_DIR: "/somewhere" })).toBe("/somewhere");
    fs.mkdirSync(path.join(root, "ppclip-2"));
    fs.writeFileSync(path.join(root, "ppclip-2", "install.mjs"), "");
    fs.writeFileSync(path.join(root, "ppclip-2", "modules.json"), "");
    expect(findPackageDir(app, {})).toBeNull();
  });

  it("lists new commits and refuses to start without a restartable launcher or with local edits", async () => {
    const { app, pkg, home } = layout();
    const spawnUpdater = vi.fn();
    const shutdown = vi.fn();
    const service = updateService({ paths: { app, home, packageDir: pkg }, spawnUpdater, shutdown, countRunningRuns: async () => 2 });
    const checked = await service.check();
    expect(checked.available).toEqual([expect.stringMatching(/^[0-9a-f]+ Add a new feature$/)]);
    expect(checked.current?.subject).toBe("first");
    expect(checked.runningRuns).toBe(2);
    expect(checked.blocked).toMatch(/start-local/);
    await expect(service.start()).rejects.toBeInstanceOf(UpdateBlockedError);

    fs.writeFileSync(path.join(home, "launcher.json"), JSON.stringify({ pid: 1, url: "http://127.0.0.1:1" }));
    fs.appendFileSync(path.join(pkg, "modules.json"), "edited\n");
    expect((await service.status()).blocked).toMatch(/local changes/);
    git(pkg, "checkout", "--", "modules.json");
    expect((await service.status()).blocked).toBeNull();
  });

  it("starts the detached updater and then shuts the server down", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { app, pkg, home } = layout();
      fs.writeFileSync(path.join(home, "launcher.json"), JSON.stringify({ pid: 1, url: "http://127.0.0.1:1" }));
      const spawnUpdater = vi.fn();
      const shutdown = vi.fn();
      const service = updateService({ paths: { app, home, packageDir: pkg }, spawnUpdater, shutdown });
      await service.start({ force: true });
      expect(spawnUpdater).toHaveBeenCalledWith({ app, home, packageDir: pkg }, true);
      expect(JSON.parse(fs.readFileSync(path.join(home, "ppclip-update.json"), "utf8"))).toMatchObject({ state: "starting" });
      expect(shutdown).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1600);
      expect(shutdown).toHaveBeenCalledOnce();
      // A second click is refused while the first update runs.
      expect((await service.status()).blocked).toMatch(/already running/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("scripts/ppclip/update.mjs", () => {
  it("finds the processes listening on Paperclip's ports from Windows netstat output", async () => {
    const { parseNetstatListeners } = await import("../../../scripts/ppclip/update.mjs");
    const netstat = [
      "Active Connections",
      "",
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    127.0.0.1:3410         0.0.0.0:0              LISTENING       36172",
      "  TCP    127.0.0.1:13410        0.0.0.0:0              LISTENING       36172",
      "  TCP    127.0.0.1:55440        0.0.0.0:0              LISTENING       40100",
      "  TCP    127.0.0.1:3410         127.0.0.1:51234        ESTABLISHED     36172",
      "  TCP    0.0.0.0:7091           0.0.0.0:0              LISTENING       5000",
      "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       999",
      "  TCP    [::1]:55440            [::]:0                 LISTENING       40100",
    ].join("\r\n");
    expect(parseNetstatListeners(netstat, [3410, 13410, 55440, 7091]).sort()).toEqual([36172, 40100, 5000].sort());
    expect(parseNetstatListeners(netstat, [9999])).toEqual([]);
  });

  it("pulls ppclip, reinstalls it, installs dependencies and restarts Paperclip the same way", async () => {
    const { app, pkg, home } = layout();
    const logs = path.join(root, "logs");
    fs.mkdirSync(logs);
    const port = await new Promise<number>((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    });
    // Stand-in start-local: starts a health endpoint and writes launcher.json like the real one.
    fs.writeFileSync(path.join(app, "scripts", "ppclip", "start-local.mjs"), `
import fs from 'node:fs'; import { spawn } from 'node:child_process';
fs.writeFileSync(process.env.FAKE_LOG_DIR + '/start-args.json', JSON.stringify(process.argv.slice(2)));
const child = spawn(process.execPath, ['-e', "require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1')"], { detached: true, stdio: 'ignore' });
child.unref();
fs.writeFileSync(${JSON.stringify(path.join(home, "launcher.json"))}, JSON.stringify({ pid: child.pid, url: 'http://127.0.0.1:${port}', args: process.argv.slice(2) }));
`);
    fs.copyFileSync(UPDATER, path.join(app, "scripts", "ppclip", "update.mjs"));
    // Stand-in pnpm on PATH.
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\necho "$@" >> ${logs}/pnpm-args.txt\n`, { mode: 0o755 });
    // Paperclip was started with --with-computer; it isn't running now.
    fs.writeFileSync(path.join(home, "launcher.json"), JSON.stringify({ pid: 0, url: `http://127.0.0.1:${port}`, args: ["--data", home, "--with-computer"] }));

    const result = spawnSync(process.execPath, [path.join(app, "scripts", "ppclip", "update.mjs"), "--run", "--data", home, "--package", pkg], {
      cwd: root, encoding: "utf8", timeout: 60_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOG_DIR: logs },
    });
    const launcher = JSON.parse(fs.readFileSync(path.join(home, "launcher.json"), "utf8"));
    try {
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(fs.existsSync(path.join(pkg, "NEW.md"))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(logs, "install-args.json"), "utf8"))).toEqual(["update", "--target", app]);
      expect(fs.readFileSync(path.join(logs, "pnpm-args.txt"), "utf8")).toMatch(/install --frozen-lockfile/);
      expect(JSON.parse(fs.readFileSync(path.join(logs, "start-args.json"), "utf8"))).toEqual(["--data", home, "--with-computer"]);
      const status = JSON.parse(fs.readFileSync(path.join(home, "ppclip-update.json"), "utf8"));
      expect(status).toMatchObject({ state: "done", error: null, commits: [expect.stringMatching(/Add a new feature$/)] });
      expect(fs.readFileSync(path.join(home, "ppclip-update.log"), "utf8")).toMatch(/Updated ppclip/);
    } finally {
      try { process.kill(launcher.pid); } catch { /* already gone */ }
    }
  }, 90_000);

  it("--check reports without changing anything", () => {
    const { app, pkg, home } = layout();
    fs.copyFileSync(UPDATER, path.join(app, "scripts", "ppclip", "update.mjs"));
    const out = execFileSync(process.execPath, [path.join(app, "scripts", "ppclip", "update.mjs"), "--check", "--data", home, "--package", pkg], { encoding: "utf8" });
    expect(out).toMatch(/1 update\(s\):[\s\S]*Add a new feature/);
    expect(fs.existsSync(path.join(pkg, "NEW.md"))).toBe(false);
  });
});
