#!/usr/bin/env node
// Dependency-free package checks; run before exporting or publishing ppclip.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const { modules } = readJson(path.join(root, "modules.json"));
const seen = new Set();
const counts = {};
const sourcePaths = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { errors.push(`Unexpected symlink: ${full}`); return []; }
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const posix = value => value.split(path.sep).join("/");
const artifact = value => /(^|\/)(__pycache__|node_modules)(\/|$)|\.(py[cod]|log|tmp)$/.test(value);
for (const module of modules) {
  const dir = path.join(root, "modules", module.id);
  if (!fs.existsSync(path.join(dir, "README.md"))) errors.push(`Missing README: ${module.id}`);
  const files = ["server", "ui", "scripts"].flatMap(sub => walk(path.join(dir, sub)));
  counts[module.id] = files.length;
  for (const file of files) {
    const relative = posix(path.relative(dir, file));
    sourcePaths.push({ file, relative });
    if (artifact(relative)) errors.push(`Generated artifact in module: ${relative}`);
    if (seen.has(relative)) errors.push(`Duplicate module destination: ${relative}`);
    seen.add(relative);
    const owner = modules.find(candidate => candidate.paths.some(prefix => relative.startsWith(prefix)));
    if (owner?.id !== module.id) errors.push(`Wrong module owner: ${module.id}/${relative}`);
  }
}
const hookDirs = fs.readdirSync(path.join(root, "hooks"));
for (const version of hookDirs) {
  const dir = path.join(root, "hooks", version);
  const manifest = readJson(path.join(dir, "manifest.json"));
  const bytes = fs.readFileSync(path.join(dir, "hooks.patch"));
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.hooksSha256) errors.push(`Patch hash mismatch: ${version}`);
  const patched = [...bytes.toString("utf8").matchAll(/^diff --git a\/(.+) b\/\1$/gm)].map(match => match[1]).sort();
  if (JSON.stringify(patched) !== JSON.stringify([...manifest.officialFilesModified].sort())) errors.push(`Hook path manifest mismatch: ${version}`);
  if (JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(manifest.modules).sort())) errors.push(`Module counts out of date: ${version}`);
}
const tracked = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
if (tracked.status !== 0) errors.push("Cannot list package files with Git");
for (const relative of (tracked.stdout ?? "").split("\0").filter(Boolean)) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) continue; // staged/deleted files are checked on their next export
  if (artifact(relative)) errors.push(`Generated artifact in package: ${relative}`);
  if (relative.endsWith(".mjs")) {
    const syntax = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (syntax.status !== 0) errors.push(`JavaScript syntax: ${relative}\n${syntax.stderr}`);
  }
  if (!relative.endsWith(".md")) continue;
  const markdown = fs.readFileSync(file, "utf8").replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").replace(/^~~~[^\n]*\n[\s\S]*?^~~~/gm, "");
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const link = match[1].replace(/^<|>$/g, "");
    if (/^(?:[a-z][\w+.-]*:|#)/i.test(link)) continue;
    const destination = path.resolve(path.dirname(file), decodeURIComponent(link.split("#")[0]));
    if (!fs.existsSync(destination)) errors.push(`Broken local link in ${relative}: ${link}`);
  }
}
const targetIndex = process.argv.indexOf("--target");
if (targetIndex !== -1) {
  if (!process.argv[targetIndex + 1]) throw new Error("--target needs a Paperclip checkout");
  const target = path.resolve(process.argv[targetIndex + 1]);
  for (const { file, relative } of sourcePaths) {
    const destination = path.join(target, relative);
    const normalize = bytes => bytes.includes(0) ? bytes : Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
    if (!fs.existsSync(destination) || !normalize(fs.readFileSync(file)).equals(normalize(fs.readFileSync(destination)))) errors.push(`Checkout module differs: ${relative}`);
  }
}
console.log(JSON.stringify({ modules: modules.length, files: sourcePaths.length, hookSets: hookDirs.length, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
