import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkVersions, installedVersions, latestPaperclipTag } from "../ppclip/update/versions.js";

const run = promisify(execFile);
const git = async (dir: string, args: string[], timeout = 5000) => (await run("git", ["-C", dir, ...args], {
  timeout, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
})).stdout.trim();
let root: string | undefined;
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = undefined; });

async function fixture(supported: boolean) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-version-test-"));
  const app = path.join(root, "app"), packageDir = path.join(root, "package"), remote = path.join(root, "paperclip.git");
  for (const dir of [app, packageDir]) { fs.mkdirSync(dir); await git(dir, ["init", "-q", "-b", "main"]); }
  fs.writeFileSync(path.join(app, "app.txt"), "first");
  await git(app, ["add", "."]); await git(app, ["commit", "-qm", "first"]); await git(app, ["tag", "v1.0.0"]);
  fs.appendFileSync(path.join(app, "app.txt"), "next");
  await git(app, ["commit", "-qam", "next"]); await git(app, ["tag", "-a", "v1.1.0", "-m", "release"]);
  const newest = await git(app, ["rev-parse", "HEAD"]);
  await git(root, ["clone", "-q", "--bare", app, remote]);
  await git(app, ["remote", "add", "origin", remote]); await git(app, ["checkout", "-q", "v1.0.0"]);
  fs.mkdirSync(path.join(packageDir, "hooks", "supported"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "hooks", "supported", "manifest.json"), JSON.stringify({ paperclipCommit: supported ? newest : await git(app, ["rev-parse", "HEAD"]) }));
  await git(packageDir, ["add", "."]); await git(packageDir, ["commit", "-qm", "support"]); await git(packageDir, ["tag", "v0.2.0"]);
  const packageRemote = path.join(root, "ppclip.git");
  await git(root, ["clone", "-q", "--bare", packageDir, packageRemote]);
  await git(packageDir, ["remote", "add", "origin", packageRemote]); await git(packageDir, ["fetch", "-q", "origin"]);
  await git(packageDir, ["branch", "--set-upstream-to=origin/main"]);
  return { app, packageDir, home: null };
}

describe("update version compatibility", () => {
  it("uses semantic ordering and peeled tag commits, respecting the installed channel", () => {
    const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
    const tags = `${a}\trefs/tags/v1.9.0\n${a}\trefs/tags/v1.10.0\n${b}\trefs/tags/v1.10.0^{}\n${c}\trefs/tags/canary/v1.11.0-canary.12`;
    expect(latestPaperclipTag(tags, false)).toEqual(["1.10.0", b]);
    expect(latestPaperclipTag(tags, true)).toEqual(["1.11.0-canary.12", c]);
  });

  it("verifies supported releases against the fetched ppclip manifests using real Git", async () => {
    const paths = await fixture(true);
    const result = await checkVersions(paths, git);
    expect(result.paperclip).toMatchObject({ current: "1.0.0", latest: "1.1.0", updateAvailable: true, compatibility: "supported" });
    expect(result.ppclip).toMatchObject({ current: "0.2.0", latest: "0.2.0" });
  });

  it("reports a newer Paperclip release waiting for support without changing the checkout", async () => {
    const paths = await fixture(false);
    const before = await git(paths.app, ["rev-parse", "HEAD"]);
    expect((await checkVersions(paths, git)).paperclip.compatibility).toBe("waiting");
    expect(await git(paths.app, ["rev-parse", "HEAD"])).toBe(before);
  });

  it("recognizes identical-tree compatibility and does not confuse lookup failure with missing support", async () => {
    const paths = await fixture(false);
    const tree = await git(paths.app, ["show", "-s", "--format=%T", "v1.1.0^{commit}"]);
    const withManifest = async (dir: string, args: string[], timeout?: number) => args[0] === "show" && args[1]?.endsWith("manifest.json")
      ? JSON.stringify({ paperclipTree: tree }) : git(dir, args, timeout);
    expect((await checkVersions(paths, withManifest)).paperclip.compatibility).toBe("supported");
    const unavailableTree = async (dir: string, args: string[], timeout?: number) => {
      if (args.includes("--format=%T")) throw new Error("Object not local");
      return withManifest(dir, args, timeout);
    };
    expect((await checkVersions(paths, unavailableTree, async () => { throw new Error("Offline"); })).paperclip)
      .toMatchObject({ latest: "1.1.0", compatibility: "unknown", checkFailed: true });
  });

  it("distinguishes ppclip release builds when the upstream branch is newer", async () => {
    const paths = await fixture(true);
    await git(paths.packageDir, ["commit", "--allow-empty", "-qm", "new build"]);
    await git(paths.packageDir, ["push", "-q", "origin", "main"]);
    await git(paths.packageDir, ["reset", "--hard", "v0.2.0"]);
    expect((await checkVersions(paths, git)).ppclip).toMatchObject({ current: "0.2.0", latest: "0.2.0+1" });
  });

  it("does no remote work during recurring installed-version reads", async () => {
    const paths = await fixture(true);
    const observed = vi.fn(git);
    await installedVersions(paths, observed);
    expect(observed.mock.calls.every(([, args]) => !args.includes("fetch") && !args.includes("ls-remote"))).toBe(true);
  });

  it("keeps an unavailable remote distinct from an unsupported release", async () => {
    const paths = await fixture(true);
    await git(paths.app, ["remote", "set-url", "origin", path.join(root!, "missing.git")]);
    const result = await checkVersions(paths, git);
    expect(result.paperclip).toMatchObject({ current: "1.0.0", latest: null, compatibility: "unknown", checkFailed: true });
    expect(result.ppclip.latest).toBe("0.2.0");
  });
});
