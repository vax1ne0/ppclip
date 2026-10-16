#!/usr/bin/env node
// Maintainer tool: export ppclip's changes as an overlay patch for one official
// Paperclip release.
//
//   node tools/build-patch.mjs --source <ppclip checkout> --base <official tag> [--ref main]
//
// Writes versions/<tag>/ppclip.patch and versions/<tag>/manifest.json.
// The ppclip checkout must contain the official tag (fetch it from upstream).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const source = path.resolve(arg("--source", "."));
const base = arg("--base");
const ref = arg("--ref", "main");
if (!base) throw new Error("Pass --base <official tag>, e.g. --base v2026.1012.0");

// Repository housekeeping and private notes are not part of the overlay.
const EXCLUDE = ["fork-inventory", "overlay", ".github/dependabot.yml"];

const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const baseCommit = git("rev-parse", `${base}^{commit}`).trim();
const baseTree = git("rev-parse", `${base}^{tree}`).trim();
const sourceCommit = git("rev-parse", `${ref}^{commit}`).trim();
const pathspec = [".", ...EXCLUDE.map((p) => `:(exclude)${p}`)];
const patch = git("diff", "--binary", "--full-index", baseCommit, sourceCommit, "--", ...pathspec);
if (!patch.trim()) throw new Error(`No changes between ${base} and ${ref}`);
const files = git("diff", "--name-status", baseCommit, sourceCommit, "--", ...pathspec)
  .trim().split("\n").map((line) => { const [status, ...rest] = line.split("\t"); return { status, path: rest.at(-1) }; });

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "versions", base);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "ppclip.patch"), patch);
const manifest = {
  paperclipVersion: base,
  paperclipCommit: baseCommit,
  paperclipTree: baseTree,
  ppclipSourceCommit: sourceCommit,
  patchSha256: createHash("sha256").update(patch).digest("hex"),
  generatedAt: new Date().toISOString(),
  files: {
    added: files.filter((f) => f.status === "A").length,
    modified: files.filter((f) => f.status === "M").length,
    deleted: files.filter((f) => f.status === "D").length,
  },
  officialFilesModified: files.filter((f) => f.status === "M").map((f) => f.path),
  changes: files,
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote versions/${base}: ${manifest.files.added} added, ${manifest.files.modified} modified, ${manifest.files.deleted} deleted`);
