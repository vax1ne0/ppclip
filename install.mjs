#!/usr/bin/env node
// ppclip overlay installer: turns an official Paperclip checkout into ppclip,
// and back again.
//
//   node install.mjs install   [--target <paperclip folder>] [--with-deps] [--version <name>] [--force-version]
//   node install.mjs update    [--target <paperclip folder>] [--with-deps] [--force]
//   node install.mjs uninstall [--target <paperclip folder>] [--force]
//   node install.mjs status    [--target <paperclip folder>]
//
// Without --target the Paperclip checkout is found automatically: the current folder if it is
// one, otherwise a folder next to this ppclip repo that is one (the recommended layout).
// --with-deps also runs pnpm install --frozen-lockfile in the checkout.
//
// update moves the checkout to the newest official commit this package has hooks for and
// reinstalls ppclip on it (or just reinstalls, after pulling a newer ppclip). On any failure it
// puts the previous commit back and reinstalls ppclip there.
//
// ppclip has two parts:
//   - modules/<module>/  the files ppclip adds, at their Paperclip paths (the same for every version);
//   - hooks/<version>/   hooks.patch with ppclip's small marked edits to official files, for one
//                        exact official Paperclip commit, plus manifest.json.
// The target must be a clean git checkout of a supported commit. It is changed in place and
// nothing is committed. A record in .ppclip-overlay.json lets the overlay be removed exactly.
//
// The hook patch is applied to a temporary git index built from the checkout's own commit and
// written out through git, so it works with any line-ending setting (core.autocrlf on Windows).
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
let target; // the Paperclip checkout, set by findTarget()
const RECORD = ".ppclip-overlay.json";
const MODULE_DIRS = ["server", "ui", "scripts"];
const OWNED_DIRS = ["ui/src/ppclip", "server/src/ppclip", "scripts/ppclip"];

/** A refusal or failure with a message for the user; caught at the bottom of this file. */
class Refusal extends Error {}
function fail(message) {
  throw new Refusal(message);
}
function gitAt(dir, args, env = {}) {
  const result = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env },
  });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}
function git(args, env = {}) {
  return gitAt(target, args, env);
}

// ------------------------------------------------------------------ finding the checkout

/** True when dir is the top folder of a git checkout that has Paperclip's server in it. */
function isPaperclipCheckout(dir) {
  if (!fs.existsSync(path.join(dir, "server", "src", "services", "heartbeat.ts"))) return false;
  const top = gitAt(dir, ["rev-parse", "--show-toplevel"]);
  return top.ok && path.resolve(top.out) === path.resolve(dir);
}
function findTarget() {
  const given = arg("--target");
  if (given) return path.resolve(given);
  const top = gitAt(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (top.ok && isPaperclipCheckout(top.out)) return path.resolve(top.out);
  const parent = path.dirname(overlayRoot);
  const found = fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .filter((dir) => dir !== overlayRoot && isPaperclipCheckout(dir));
  if (found.length === 1) {
    console.log(`Using the Paperclip checkout next to ppclip: ${found[0]}`);
    return found[0];
  }
  if (found.length > 1) fail(`Found several Paperclip checkouts next to ppclip:\n  ${found.join("\n  ")}\nChoose one with --target <folder>.`);
  fail(`No Paperclip checkout found in the current folder or next to ppclip (in ${parent}).\nClone official Paperclip next to ppclip:\n  git clone https://github.com/paperclipai/paperclip "${path.join(parent, "paperclip")}"\nor pass --target <paperclip folder>.`);
}

// ------------------------------------------------------------------ package contents

function versions() {
  const dir = path.join(overlayRoot, "hooks");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((v) => fs.existsSync(path.join(dir, v, "manifest.json"))).sort() : [];
}
function loadVersion(version) {
  const dir = path.join(overlayRoot, "hooks", version);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const patchFile = path.join(dir, "hooks.patch");
  const sha = createHash("sha256").update(fs.readFileSync(patchFile)).digest("hex");
  if (sha !== manifest.hooksSha256) fail(`hooks/${version}/hooks.patch does not match its manifest (corrupted download?).`);
  return { manifest, patchFile };
}
/** Every module file as { module, path (Paperclip-relative, "/"), source (absolute) }. */
function moduleFiles() {
  const { modules } = JSON.parse(fs.readFileSync(path.join(overlayRoot, "modules.json"), "utf8"));
  const files = [];
  for (const m of modules) {
    const base = path.join(overlayRoot, "modules", m.id);
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push({ module: m.id, path: path.relative(base, full).split(path.sep).join("/"), source: full });
      }
    };
    for (const sub of MODULE_DIRS) walk(path.join(base, sub));
  }
  return files;
}
/** Content hash that ignores CRLF vs LF, so a checkout's line-ending setting never looks like an edit. */
function contentHash(file) {
  const bytes = fs.readFileSync(file);
  const text = bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
  return createHash("sha256").update(text).digest("hex");
}

// ------------------------------------------------------------------ target checkout

function readRecord() {
  const file = path.join(target, RECORD);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
function requireCheckout() {
  if (!git(["rev-parse", "--is-inside-work-tree"]).ok) fail(`${target} is not a git checkout. Clone official Paperclip first:\n  git clone https://github.com/paperclipai/paperclip`);
  if (!fs.existsSync(path.join(target, "server", "src", "services", "heartbeat.ts"))) fail(`${target} does not look like a Paperclip checkout.`);
}
function detectVersion() {
  const head = git(["rev-parse", "HEAD"]).out;
  const tree = git(["rev-parse", "HEAD^{tree}"]).out;
  return versions().find((v) => {
    const { manifest } = loadVersion(v);
    return manifest.paperclipCommit === head || manifest.paperclipTree === tree;
  });
}
function dirtyFiles() {
  return git(["status", "--porcelain"]).out.split("\n").filter(Boolean).filter((line) => !line.endsWith(RECORD));
}
/** A throwaway git index holding HEAD with the hook patch applied. */
function patchedIndex(patchFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-overlay-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  const read = git(["read-tree", "HEAD"], env);
  if (!read.ok) fail(`Could not read the checkout: ${read.err}`);
  const empty = fs.statSync(patchFile).size === 0;
  const applied = empty ? { ok: true, err: "" } : git(["apply", "--cached", "--whitespace=nowarn", patchFile], env);
  return { env, applied, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
/** Hooked official files whose working copy differs from the patched index, and module files edited or missing. */
function editedSinceInstall(record, manifest, index) {
  const hooked = manifest.officialFilesModified.length
    ? git(["diff", "--name-only", "--", ...manifest.officialFilesModified], index.env).out.split("\n").filter(Boolean)
    : [];
  const files = Object.entries(record.files).filter(([file, hash]) => {
    const full = path.join(target, file);
    return !fs.existsSync(full) || contentHash(full) !== hash;
  }).map(([file]) => file);
  return [...hooked, ...files];
}

// ------------------------------------------------------------------ commands

function install() {
  requireCheckout();
  const existing = readRecord();
  if (existing) fail(`ppclip is already installed here for Paperclip ${existing.paperclipVersion} (since ${existing.installedAt}). Run "update" to reinstall or move to a newer Paperclip, or "uninstall" first.`);
  const dirty = dirtyFiles();
  if (dirty.length) fail(`The checkout has uncommitted changes. Commit, stash or discard them first:\n  ${dirty.slice(0, 10).join("\n  ")}`);
  const available = versions();
  if (!available.length) fail("This package has no hooks/<version> folder.");
  const detected = detectVersion();
  const version = arg("--version") ?? detected;
  if (!version) {
    const head = git(["rev-parse", "--short", "HEAD"]).out;
    const supported = available.map((v) => `${v} (commit ${loadVersion(v).manifest.paperclipCommit.slice(0, 9)})`);
    fail(`This checkout (commit ${head}) is not a Paperclip version this package supports.\nSupported: ${supported.join(", ")}\nRun "update" to move it to the newest supported version, or check one out, e.g.: git -C "${target}" checkout ${loadVersion(available.at(-1)).manifest.paperclipCommit}\nOr pass --version <name> --force-version to try anyway.`);
  }
  if (!available.includes(version)) fail(`Unknown version ${version}. Supported: ${available.join(", ")}`);
  if (detected !== version && !flag("--force-version")) fail(`The checkout is not exactly ${version}. Check out commit ${loadVersion(version).manifest.paperclipCommit}, or pass --force-version to try anyway.`);
  const { manifest, patchFile } = loadVersion(version);
  const files = moduleFiles();
  const clashes = files.filter((f) => fs.existsSync(path.join(target, f.path)));
  if (clashes.length) fail(`These files already exist in the checkout:\n  ${clashes.slice(0, 10).map((f) => f.path).join("\n  ")}`);

  const index = patchedIndex(patchFile);
  try {
    if (!index.applied.ok) fail(`ppclip's hook patch does not apply to this checkout:\n${index.applied.err}\nNothing was changed.`);
    if (manifest.officialFilesModified.length) {
      const out = git(["checkout-index", "-f", "--", ...manifest.officialFilesModified], index.env);
      if (!out.ok) fail(`Writing hooked official files failed:\n${out.err}`);
    }
  } finally {
    index.cleanup();
  }
  const record = {};
  for (const file of files) {
    const out = path.join(target, file.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file.source, out);
    record[file.path] = contentHash(out);
  }
  fs.writeFileSync(path.join(target, RECORD), JSON.stringify({
    paperclipVersion: version,
    hooksSha256: manifest.hooksSha256,
    installedAt: new Date().toISOString(),
    files: record,
  }, null, 2) + "\n");
  const modules = new Set(files.map((f) => f.module));
  console.log(`\n✓ ppclip installed on Paperclip ${version}.`);
  console.log(`  ${files.length} files in ${modules.size} modules added, ${manifest.officialFilesModified.length} official files hooked.`);
  return version;
}

/** Checks that ppclip can be removed exactly (and wasn't edited, unless force); returns its manifest and the edited files. */
function checkRemovable(record, force) {
  if (!record.files) fail("This checkout was installed by an older ppclip package. Use that package to uninstall it.");
  if (!versions().includes(record.paperclipVersion)) fail(`This package has no hooks for ${record.paperclipVersion}; use the package that installed it.`);
  const { manifest, patchFile } = loadVersion(record.paperclipVersion);
  if (manifest.hooksSha256 !== record.hooksSha256) fail("ppclip was installed from a different build of these hooks; use the matching package to uninstall.");
  const index = patchedIndex(patchFile);
  let edited;
  try {
    if (!index.applied.ok) fail(`The checkout's commit changed since install, so the hooks can't be matched:\n${index.applied.err}`);
    edited = editedSinceInstall(record, manifest, index);
    if (edited.length && !force) fail(`These ppclip files were edited after installing:\n  ${edited.join("\n  ")}\nNothing was changed. Restore them, or pass --force to discard those edits.`);
  } finally {
    index.cleanup();
  }
  return { manifest, edited };
}
function removeEmptyOwnedDirs() {
  for (const dir of OWNED_DIRS) {
    const full = path.join(target, dir);
    if (!fs.existsSync(full)) continue;
    const leftovers = fs.readdirSync(full, { recursive: true }).filter((entry) => !fs.statSync(path.join(full, entry)).isDirectory());
    if (!leftovers.length) fs.rmSync(full, { recursive: true });
  }
}

function uninstall(force = flag("--force")) {
  requireCheckout();
  const record = readRecord();
  if (!record) fail("No ppclip record found here; nothing to uninstall.");
  const { manifest } = checkRemovable(record, force);
  if (manifest.officialFilesModified.length) {
    const out = git(["checkout", "HEAD", "--", ...manifest.officialFilesModified]);
    if (!out.ok) fail(`Restoring official files failed:\n${out.err}`);
  }
  for (const file of Object.keys(record.files)) fs.rmSync(path.join(target, file), { force: true });
  fs.rmSync(path.join(target, RECORD));
  removeEmptyOwnedDirs();
  return record.paperclipVersion;
}

/** True when the installed copy is exactly what this package would install now. */
function installedCopyIsCurrent(record) {
  const { manifest } = loadVersion(record.paperclipVersion);
  if (record.hooksSha256 !== manifest.hooksSha256) return false;
  const files = moduleFiles();
  return files.length === Object.keys(record.files).length && files.every((f) => record.files[f.path] === contentHash(f.source));
}
/** Changed or untracked files in the checkout that aren't ppclip's own. */
function strayChanges(record, manifest) {
  const owned = new Set([RECORD, ...Object.keys(record?.files ?? {}), ...(manifest?.officialFilesModified ?? [])]);
  const changed = git(["diff", "--name-only", "HEAD"]).out.split("\n");
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).out.split("\n");
  return [...changed, ...untracked].filter((file) => file && !owned.has(file));
}

function update() {
  requireCheckout();
  const force = flag("--force");
  const record = readRecord();
  const { manifest, edited } = record ? checkRemovable(record, force) : {};
  const stray = strayChanges(record, manifest);
  if (stray.length) fail(`The checkout has changes that aren't ppclip's. Commit, stash or discard them first:\n  ${stray.slice(0, 10).join("\n  ")}`);

  console.log("Fetching official Paperclip ...");
  const fetched = git(["fetch", "--tags", "--quiet"]);
  if (!fetched.ok) fail(`git fetch failed, so nothing was changed:\n${fetched.err}`);
  const known = versions()
    .map((version) => ({ version, commit: loadVersion(version).manifest.paperclipCommit }))
    .filter((v) => git(["cat-file", "-e", `${v.commit}^{commit}`]).ok)
    .map((v) => ({ ...v, time: Number(git(["show", "-s", "--format=%ct", v.commit]).out) }))
    .sort((a, b) => a.time - b.time);
  if (!known.length) fail(`None of the Paperclip versions this ppclip supports (${versions().join(", ")}) are in this checkout's history, even after fetching. Is its origin official Paperclip?`);
  const newest = known.at(-1);
  const head = git(["rev-parse", "HEAD"]).out;
  const current = detectVersion();

  if (current === newest.version) {
    if (!record) {
      console.log(`\nPaperclip is already on ${newest.version}, the newest version this ppclip supports. ppclip isn't installed; run "install".\n`);
      return;
    }
    if (!edited.length && installedCopyIsCurrent(record)) {
      console.log(`\n✓ Already up to date: Paperclip ${newest.version} with this ppclip. Nothing changed.\n`);
      return;
    }
  } else if (!current && gitAt(target, ["merge-base", "--is-ancestor", newest.commit, head]).ok) {
    fail(`This Paperclip (commit ${head.slice(0, 9)}) is newer than anything this ppclip supports (newest: ${newest.version}).\nppclip hasn't been ported to it yet. Nothing was changed.\nPull ppclip for newer support (git -C "${overlayRoot}" pull), or go back with: git -C "${target}" checkout ${newest.commit.slice(0, 9)}`);
  }

  const previous = { head, branch: git(["symbolic-ref", "--quiet", "--short", "HEAD"]).out || null, version: current, installed: Boolean(record) };
  const from = current ?? head.slice(0, 9);
  try {
    if (record) uninstall(true); // edits were already checked above
    if (newest.commit !== head) {
      const out = git(["checkout", "--quiet", newest.commit]);
      if (!out.ok) fail(`git checkout ${newest.commit.slice(0, 9)} failed:\n${out.err}`);
    }
    install();
  } catch (error) {
    console.error(`\n✗ ${error.message}\n\nUpdate failed. Putting the checkout back as it was ...`);
    restore(previous);
    fail(`Update failed. The checkout is back at ${from}${previous.installed ? " with ppclip installed" : ""}, as before.`);
  }
  console.log(newest.commit === head
    ? `\n✓ ppclip reinstalled on Paperclip ${newest.version} with this package's current files.`
    : `\n✓ Updated Paperclip from ${from} to ${newest.version} (detached at ${newest.commit.slice(0, 9)}).`);
  nextSteps(true);
}
/** Undo a failed update: drop whatever was installed, check the old commit out again, reinstall. */
function restore(previous) {
  const ref = previous.branch ?? previous.head;
  try {
    const record = readRecord();
    const ours = new Set([...Object.keys(record?.files ?? {}), ...moduleFiles().map((f) => f.path)]);
    for (const file of ours) fs.rmSync(path.join(target, file), { force: true });
    fs.rmSync(path.join(target, RECORD), { force: true });
    removeEmptyOwnedDirs();
    const out = git(["checkout", "--quiet", "--force", ref]);
    if (!out.ok) throw new Error(`git checkout ${ref} failed: ${out.err}`);
    if (previous.installed) install();
  } catch (error) {
    fail(`Putting the checkout back failed too: ${error.message}\nTo restore it by hand:\n  git -C "${target}" checkout --force ${ref}\n  node "${path.join(overlayRoot, "install.mjs")}" install --target "${target}"`);
  }
}

function nextSteps(updated = false) {
  if (flag("--with-deps")) {
    console.log(`\nRunning pnpm install --frozen-lockfile in ${target} ...\n`);
    const result = spawnSync("pnpm install --frozen-lockfile", { cwd: target, stdio: "inherit", shell: true });
    if (result.status !== 0) fail(`pnpm install failed (${result.error?.message ?? `exit code ${result.status}`}). ppclip itself is installed; fix the problem and run pnpm install --frozen-lockfile in "${target}".`);
    console.log(`\n✓ Dependencies installed.\n\nNext: build and start Paperclip as usual${updated ? " (Paperclip migrates its database when it starts; back up your data folder first)" : ""}, or:\n  node scripts/ppclip/start-local.mjs --data <data folder>\n`);
    return;
  }
  console.log(`\nNext:\n  cd "${target}"\n  pnpm install --frozen-lockfile\n  (build and start as usual, or: node scripts/ppclip/start-local.mjs --data <data folder>)\n`);
}

function status() {
  requireCheckout();
  const record = readRecord();
  const detected = detectVersion();
  console.log(`Target:     ${target}`);
  console.log(`Checkout:   ${git(["describe", "--tags", "--always"]).out}${detected ? ` (supported: ${detected})` : ""}`);
  console.log(`ppclip:     ${record ? `installed for ${record.paperclipVersion} on ${record.installedAt}` : "not installed"}`);
  console.log(`Supported:  ${versions().join(", ") || "none"}`);
  if (record?.files && versions().includes(record.paperclipVersion)) {
    const { manifest, patchFile } = loadVersion(record.paperclipVersion);
    const index = patchedIndex(patchFile);
    try {
      const edited = index.applied.ok ? editedSinceInstall(record, manifest, index) : null;
      console.log(`Integrity:  ${edited === null ? "checkout commit changed since install" : edited.length ? `${edited.length} ppclip file(s) edited since install` : "ppclip files unchanged since install"}`);
    } finally {
      index.cleanup();
    }
    if (!installedCopyIsCurrent(record)) console.log(`Package:    this ppclip has newer files than the installed copy; run "update" to reinstall`);
  }
}

const commands = {
  install: () => { install(); nextSteps(); },
  update,
  uninstall: () => {
    const version = uninstall();
    console.log(`\n✓ ppclip removed. The checkout is back to official Paperclip ${version}.\n  Run pnpm install --frozen-lockfile again before starting it.\n`);
  },
  status,
};
if (!commands[command]) {
  console.log("Usage: node install.mjs <install|update|uninstall|status> [--target <paperclip folder>] [--with-deps] [--force]");
  process.exit(command ? 1 : 0);
}
try {
  target = findTarget();
  commands[command]();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`\n✗ ${error.message}\n`);
  process.exit(1);
}
