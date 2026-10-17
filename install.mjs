#!/usr/bin/env node
// ppclip overlay installer: turns an official Paperclip checkout into ppclip,
// and back again.
//
//   node install.mjs install   [--target <paperclip folder>] [--version <name>] [--force-version]
//   node install.mjs uninstall [--target <paperclip folder>] [--force]
//   node install.mjs status    [--target <paperclip folder>]
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
const target = path.resolve(arg("--target", process.cwd()));
const RECORD = ".ppclip-overlay.json";
const MODULE_DIRS = ["server", "ui", "scripts"];
const OWNED_DIRS = ["ui/src/ppclip", "server/src/ppclip", "scripts/ppclip"];

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
  if (existing) fail(`ppclip is already installed here for Paperclip ${existing.paperclipVersion} (since ${existing.installedAt}). Run "uninstall" first.`);
  const dirty = dirtyFiles();
  if (dirty.length) fail(`The checkout has uncommitted changes. Commit, stash or discard them first:\n  ${dirty.slice(0, 10).join("\n  ")}`);
  const available = versions();
  if (!available.length) fail("This package has no hooks/<version> folder.");
  const detected = detectVersion();
  const version = arg("--version") ?? detected;
  if (!version) {
    const head = git(["rev-parse", "--short", "HEAD"]).out;
    const supported = available.map((v) => `${v} (commit ${loadVersion(v).manifest.paperclipCommit.slice(0, 9)})`);
    fail(`This checkout (commit ${head}) is not a Paperclip version this package supports.\nSupported: ${supported.join(", ")}\nCheck one out, e.g.: git -C "${target}" checkout ${loadVersion(available.at(-1)).manifest.paperclipCommit}\nOr pass --version <name> --force-version to try anyway.`);
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
  console.log(`\nNext:\n  cd "${target}"\n  pnpm install --frozen-lockfile\n  (build and start as usual, or: node scripts/ppclip/start-local.mjs --data <new data folder>)\n`);
}

function uninstall() {
  requireCheckout();
  const record = readRecord();
  if (!record) fail("No ppclip record found here; nothing to uninstall.");
  if (!record.files) fail("This checkout was installed by an older ppclip package. Use that package to uninstall it.");
  if (!versions().includes(record.paperclipVersion)) fail(`This package has no hooks for ${record.paperclipVersion}; use the package that installed it.`);
  const { manifest, patchFile } = loadVersion(record.paperclipVersion);
  if (manifest.hooksSha256 !== record.hooksSha256) fail("ppclip was installed from a different build of these hooks; use the matching package to uninstall.");

  const index = patchedIndex(patchFile);
  try {
    if (!index.applied.ok) fail(`The checkout's commit changed since install, so the hooks can't be matched:\n${index.applied.err}`);
    const edited = editedSinceInstall(record, manifest, index);
    if (edited.length && !flag("--force")) fail(`These ppclip files were edited after installing:\n  ${edited.join("\n  ")}\nNothing was changed. Restore them, or pass --force to discard those edits.`);
  } finally {
    index.cleanup();
  }
  if (manifest.officialFilesModified.length) {
    const out = git(["checkout", "HEAD", "--", ...manifest.officialFilesModified]);
    if (!out.ok) fail(`Restoring official files failed:\n${out.err}`);
  }
  for (const file of Object.keys(record.files)) fs.rmSync(path.join(target, file), { force: true });
  fs.rmSync(path.join(target, RECORD));
  for (const dir of OWNED_DIRS) {
    const full = path.join(target, dir);
    if (!fs.existsSync(full)) continue;
    const leftovers = fs.readdirSync(full, { recursive: true }).filter((entry) => !fs.statSync(path.join(full, entry)).isDirectory());
    if (!leftovers.length) fs.rmSync(full, { recursive: true });
  }
  console.log(`\n✓ ppclip removed. The checkout is back to official Paperclip ${record.paperclipVersion}.\n  Run pnpm install --frozen-lockfile again before starting it.\n`);
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
  }
}

if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "status") status();
else {
  console.log("Usage: node install.mjs <install|uninstall|status> [--target <paperclip folder>] [--version <name>]");
  process.exit(command ? 1 : 0);
}
