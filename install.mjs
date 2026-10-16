#!/usr/bin/env node
// ppclip overlay installer: turns an official Paperclip checkout into ppclip,
// and back again.
//
//   node install.mjs install   [--target <paperclip folder>] [--version <tag>] [--force-version]
//   node install.mjs uninstall [--target <paperclip folder>]
//   node install.mjs status    [--target <paperclip folder>]
//
// The target must be a git checkout of official Paperclip at a version this
// overlay supports (see versions/). It is changed in place: files are added and
// edited, nothing is committed. A record is kept in .ppclip-overlay.json so the
// overlay can be removed exactly.
//
// The patch is applied to a temporary git index built from the checkout's own
// commit, then written out through git. That way it works the same whatever
// line-ending conversion (core.autocrlf, common on Windows) the checkout uses.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const overlayRoot = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);
const target = path.resolve(arg("--target", process.cwd()));
const RECORD = ".ppclip-overlay.json";

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
function git(args, env = {}) {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env },
  });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}
function versions() {
  const dir = path.join(overlayRoot, "versions");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, "manifest.json"))).sort() : [];
}
function load(version) {
  const dir = path.join(overlayRoot, "versions", version);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const patchFile = path.join(dir, "ppclip.patch");
  const sha = createHash("sha256").update(fs.readFileSync(patchFile)).digest("hex");
  if (sha !== manifest.patchSha256) fail(`versions/${version}/ppclip.patch does not match its manifest (corrupted download?).`);
  return { manifest, patchFile };
}
function readRecord() {
  const file = path.join(target, RECORD);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
function requireCheckout() {
  if (!git(["rev-parse", "--is-inside-work-tree"]).ok) fail(`${target} is not a git checkout. Clone official Paperclip first:\n  git clone https://github.com/paperclipai/paperclip && cd paperclip && git checkout <version tag>`);
  if (!fs.existsSync(path.join(target, "server", "src", "services", "heartbeat.ts"))) fail(`${target} does not look like a Paperclip checkout.`);
}
function detectVersion() {
  const head = git(["rev-parse", "HEAD"]).out;
  const tree = git(["rev-parse", "HEAD^{tree}"]).out;
  return versions().find((v) => {
    const { manifest } = load(v);
    return manifest.paperclipCommit === head || manifest.paperclipTree === tree;
  });
}
function dirtyFiles() {
  return git(["status", "--porcelain"]).out.split("\n").filter(Boolean).filter((line) => !line.endsWith(RECORD));
}

/** A throwaway git index holding HEAD with the patch applied (forward). */
function patchedIndex(patchFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-overlay-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  const read = git(["read-tree", "HEAD"], env);
  if (!read.ok) fail(`Could not read the checkout: ${read.err}`);
  const applied = git(["apply", "--cached", "--whitespace=nowarn", patchFile], env);
  return { env, applied, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
/** Paths whose working copy differs from the patched index (git's own eol rules apply). */
function editedSinceInstall(env, paths) {
  const changed = git(["diff", "--name-only", "--", ...paths], env).out.split("\n").filter(Boolean);
  const missing = paths.filter((p) => !fs.existsSync(path.join(target, p)));
  return [...new Set([...changed, ...missing])];
}

function install() {
  requireCheckout();
  const existing = readRecord();
  if (existing) fail(`ppclip ${existing.paperclipVersion} overlay is already installed here (since ${existing.installedAt}). Run "uninstall" first.`);
  const dirty = dirtyFiles();
  if (dirty.length) fail(`The checkout has uncommitted changes. Commit, stash or discard them first:\n  ${dirty.slice(0, 10).join("\n  ")}`);
  const available = versions();
  if (!available.length) fail("This overlay has no versions/ folder with a patch.");
  const detected = detectVersion();
  const version = arg("--version") ?? detected;
  if (!version) {
    const head = git(["describe", "--tags", "--always"]).out;
    fail(`This checkout (${head}) is not a Paperclip version this overlay supports.\nSupported: ${available.join(", ")}\nCheck one out, e.g.: git -C "${target}" checkout ${available.at(-1)}\nOr pass --version <tag> --force-version to try anyway.`);
  }
  if (!available.includes(version)) fail(`Unknown version ${version}. Supported: ${available.join(", ")}`);
  if (detected !== version && !flag("--force-version")) fail(`The checkout is not exactly ${version}. Check out that tag, or pass --force-version to try anyway.`);
  const { manifest, patchFile } = load(version);

  const index = patchedIndex(patchFile);
  try {
    if (!index.applied.ok) fail(`The ppclip patch does not apply to this checkout:\n${index.applied.err}\nNothing was changed.`);
    const written = manifest.changes.filter((c) => c.status !== "D").map((c) => c.path);
    const out = git(["checkout-index", "-f", "--", ...written], index.env);
    if (!out.ok) fail(`Writing ppclip files failed:\n${out.err}`);
    for (const c of manifest.changes.filter((c) => c.status === "D")) fs.rmSync(path.join(target, c.path), { force: true });
  } finally {
    index.cleanup();
  }
  fs.writeFileSync(path.join(target, RECORD), JSON.stringify({
    paperclipVersion: version,
    patchSha256: manifest.patchSha256,
    ppclipSourceCommit: manifest.ppclipSourceCommit,
    installedAt: new Date().toISOString(),
  }, null, 2) + "\n");
  console.log(`\n✓ ppclip overlay installed on Paperclip ${version}.`);
  console.log(`  ${manifest.files.added} files added, ${manifest.files.modified} official files edited.`);
  console.log(`\nNext:\n  cd "${target}"\n  pnpm install --frozen-lockfile\n  (build and start as usual, or: node scripts/ppclip/start-local.mjs --data <new data folder>)\n`);
}

function uninstall() {
  requireCheckout();
  const record = readRecord();
  if (!record) fail("No ppclip overlay record found here; nothing to uninstall.");
  if (!versions().includes(record.paperclipVersion)) fail(`This overlay package has no patch for ${record.paperclipVersion}; use the overlay version that installed it.`);
  const { manifest, patchFile } = load(record.paperclipVersion);
  if (manifest.patchSha256 !== record.patchSha256) fail("The installed overlay was a different build of this patch; use the matching overlay release to uninstall.");

  const index = patchedIndex(patchFile);
  try {
    if (!index.applied.ok) fail(`The checkout's commit changed since install, so the overlay can't be matched:\n${index.applied.err}`);
    const kept = manifest.changes.filter((c) => c.status !== "D").map((c) => c.path);
    const edited = editedSinceInstall(index.env, kept);
    if (edited.length && !flag("--force")) fail(`These ppclip files were edited after installing:\n  ${edited.join("\n  ")}\nNothing was changed. Restore them, or pass --force to discard those edits.`);
  } finally {
    index.cleanup();
  }
  const restore = manifest.changes.filter((c) => c.status !== "A").map((c) => c.path);
  if (restore.length) {
    const out = git(["checkout", "HEAD", "--", ...restore]);
    if (!out.ok) fail(`Restoring official files failed:\n${out.err}`);
  }
  for (const c of manifest.changes.filter((c) => c.status === "A")) fs.rmSync(path.join(target, c.path), { force: true });
  fs.rmSync(path.join(target, RECORD));
  for (const dir of ["ui/src/ppclip", "server/src/ppclip", "scripts/ppclip"]) {
    const full = path.join(target, dir);
    if (!fs.existsSync(full)) continue;
    const leftovers = fs.readdirSync(full, { recursive: true }).filter((entry) => !fs.statSync(path.join(full, entry)).isDirectory());
    if (!leftovers.length) fs.rmSync(full, { recursive: true });
  }
  console.log(`\n✓ ppclip overlay removed. The checkout is back to official Paperclip ${record.paperclipVersion}.\n  Run pnpm install --frozen-lockfile again before starting it.\n`);
}

function status() {
  requireCheckout();
  const record = readRecord();
  const detected = detectVersion();
  console.log(`Target:     ${target}`);
  console.log(`Checkout:   ${git(["describe", "--tags", "--always"]).out}${detected ? ` (official ${detected})` : ""}`);
  console.log(`Overlay:    ${record ? `ppclip on ${record.paperclipVersion}, installed ${record.installedAt}` : "not installed"}`);
  console.log(`Supported:  ${versions().join(", ") || "none"}`);
  if (record && versions().includes(record.paperclipVersion)) {
    const { manifest, patchFile } = load(record.paperclipVersion);
    const index = patchedIndex(patchFile);
    try {
      const edited = index.applied.ok ? editedSinceInstall(index.env, manifest.changes.filter((c) => c.status !== "D").map((c) => c.path)) : null;
      console.log(`Integrity:  ${edited === null ? "checkout commit changed since install" : edited.length ? `${edited.length} ppclip file(s) edited since install` : "ppclip files unchanged since install"}`);
    } finally {
      index.cleanup();
    }
  }
}

if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "status") status();
else {
  console.log("Usage: node install.mjs <install|uninstall|status> [--target <paperclip folder>] [--version <tag>]");
  process.exit(command ? 1 : 0);
}
