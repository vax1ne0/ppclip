import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

test("compatibility probes are read-only and distinguish verified, applicable and conflicting revisions", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-installer-test-"));
  try {
    const target = path.join(temp, "paperclip"), pkg = path.join(temp, "ppclip");
    fs.mkdirSync(path.join(target, "server/src/services"), { recursive: true });
    fs.mkdirSync(path.join(pkg, "hooks/test"), { recursive: true });
    fs.mkdirSync(path.join(pkg, "modules/test/ui/src/ppclip"), { recursive: true });
    fs.copyFileSync(fileURLToPath(new URL("../../install.mjs", import.meta.url)), path.join(pkg, "install.mjs"));
    fs.writeFileSync(path.join(pkg, "modules.json"), JSON.stringify({ modules: [{ id: "test" }] }));
    fs.writeFileSync(path.join(pkg, "modules/test/ui/src/ppclip/test.ts"), "export const test = true;\n");
    const git = (...args) => {
      const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git("init", "-q"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    const heartbeat = path.join(target, "server/src/services/heartbeat.ts");
    fs.writeFileSync(heartbeat, "export const official = true;\n");
    git("add", "."); git("commit", "-qm", "base");
    const commit = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
    fs.writeFileSync(heartbeat, "export const official = true; // ppclip: fixture\n");
    const patch = spawnSync("git", ["-C", target, "diff", "--binary", "--full-index"], { encoding: "utf8" }).stdout;
    fs.writeFileSync(path.join(pkg, "hooks/test/hooks.patch"), patch);
    fs.writeFileSync(path.join(pkg, "hooks/test/manifest.json"), JSON.stringify({ paperclipCommit: commit, paperclipTree: tree, hooksSha256: createHash("sha256").update(patch).digest("hex"), officialFilesModified: ["server/src/services/heartbeat.ts"] }));
    git("checkout", "--", ".");
    const run = (...args) => spawnSync(process.execPath, [path.join(pkg, "install.mjs"), ...args, "--target", target], { encoding: "utf8" });
    const check = () => run("compatibility", "--json");
    assert.equal(JSON.parse(check().stdout).results[0].status, "verified");
    fs.writeFileSync(path.join(target, "unrelated.txt"), "new upstream feature\n");
    git("add", "."); git("commit", "-qm", "unrelated upstream change");
    const before = git("status", "--porcelain");
    assert.equal(JSON.parse(check().stdout).results[0].status, "patch-applies-unverified");
    assert.equal(git("status", "--porcelain"), before);
    assert.equal(run("install").status, 1); // no silent bypass of supported revisions
    assert.equal(run("install", "--version", "test", "--force-version").status, 0);
    assert.equal(run("uninstall").status, 0);
    assert.equal(git("status", "--porcelain"), before);
    const collision = path.join(target, "ui/src/ppclip/test.ts");
    fs.mkdirSync(path.dirname(collision), { recursive: true });
    fs.writeFileSync(collision, "upstream now owns this destination\n");
    git("add", "."); git("commit", "-qm", "upstream module collision");
    const collisionReport = JSON.parse(check().stdout).results[0];
    assert.equal(collisionReport.status, "blocked");
    assert.equal(collisionReport.patchApplies, true);
    assert.deepEqual(collisionReport.collisions, ["ui/src/ppclip/test.ts"]);
    git("rm", "--", "ui/src/ppclip/test.ts"); git("commit", "-qm", "remove fixture collision");
    fs.writeFileSync(heartbeat, "export const renamedUpstream = true;\n");
    git("add", "."); git("commit", "-qm", "conflicting upstream change");
    const blocked = check();
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).results[0].status, "blocked");
    const head = git("rev-parse", "HEAD");
    assert.equal(JSON.parse(run("compatibility", "--ref", commit, "--json").stdout).results[0].status, "verified");
    assert.equal(git("rev-parse", "HEAD"), head);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
