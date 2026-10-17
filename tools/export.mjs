#!/usr/bin/env node
// Maintainer tool: export ppclip from a working Paperclip checkout into this repo.
//
//   node tools/export.mjs --source <paperclip checkout> [--name <version folder>]
//
// The source must be an official Paperclip commit (HEAD) with ppclip installed
// and edited on top, uncommitted (what `install.mjs install` produces).
//   - Files ppclip adds are written to modules/<module>/<same path>, sorted by modules.json.
//   - Edits to official files become hooks/<name>/hooks.patch, with a manifest.
// --name defaults to the official tag at HEAD, or master-<short commit>.
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
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RECORD = ".ppclip-overlay.json";
const MODULE_DIRS = ["server", "ui", "scripts"];

const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const lines = (out) => out.split("\n").map((l) => l.trim()).filter(Boolean);

const head = git("rev-parse", "HEAD").trim();
const tree = git("rev-parse", "HEAD^{tree}").trim();
const tag = (() => {
  try {
    return execFileSync("git", ["-C", source, "describe", "--exact-match", "--tags", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null; // not at a tag
  }
})();
const name = arg("--name", tag && /^v\d/.test(tag) ? tag : `master-${head.slice(0, 9)}`);

// Edits to official files (tracked at HEAD) become the hook patch.
const modified = lines(git("diff", "HEAD", "--name-only", "--diff-filter=M"));
const unexpected = lines(git("diff", "HEAD", "--name-only", "--diff-filter=DRT"));
if (unexpected.length) throw new Error(`Deleting or renaming official files is not supported:\n  ${unexpected.join("\n  ")}`);
const patch = modified.length ? git("diff", "HEAD", "--binary", "--full-index", "--", ...modified) : "";

// Files ppclip adds are sorted into module folders.
const { modules } = JSON.parse(fs.readFileSync(path.join(root, "modules.json"), "utf8"));
const added = lines(git("ls-files", "--others", "--exclude-standard")).filter((f) => f !== RECORD);
const byModule = new Map(modules.map((m) => [m.id, []]));
const unassigned = [];
for (const file of added) {
  const owner = modules.find((m) => m.paths.some((p) => file.startsWith(p)));
  if (owner) byModule.get(owner.id).push(file);
  else unassigned.push(file);
}
if (unassigned.length) throw new Error(`These files match no module in modules.json:\n  ${unassigned.join("\n  ")}`);

// Replace each module's files (its README stays), normalising line endings to LF.
for (const m of modules) {
  const dir = path.join(root, "modules", m.id);
  for (const sub of MODULE_DIRS) fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  for (const file of byModule.get(m.id)) {
    const out = path.join(dir, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const bytes = fs.readFileSync(path.join(source, file));
    const text = bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"));
    fs.writeFileSync(out, text);
  }
}

const hooksDir = path.join(root, "hooks", name);
fs.mkdirSync(hooksDir, { recursive: true });
fs.writeFileSync(path.join(hooksDir, "hooks.patch"), patch);
const manifest = {
  paperclipVersion: name,
  paperclipCommit: head,
  paperclipTree: tree,
  hooksSha256: createHash("sha256").update(patch).digest("hex"),
  generatedAt: new Date().toISOString(),
  officialFilesModified: modified,
  modules: Object.fromEntries(modules.map((m) => [m.id, byModule.get(m.id).length])),
};
fs.writeFileSync(path.join(hooksDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Exported ppclip for Paperclip ${name}: ${added.length} module files in ${modules.length} modules, ${modified.length} official files hooked.`);
