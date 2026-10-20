#!/usr/bin/env node
// Reproducible checks against every recorded supported Paperclip revision.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const manifests = fs.readdirSync(path.join(root, 'hooks')).map(version => ({ version, ...JSON.parse(fs.readFileSync(path.join(root, 'hooks', version, 'manifest.json'))) }));
if (process.argv.includes('--matrix')) {
  console.log(JSON.stringify({ include: manifests.map(m => ({ version: m.version, ref: m.paperclipCommit })) }));
  process.exit(0);
}
const i = process.argv.indexOf('--target');
if (i < 0 || !process.argv[i + 1]) throw new Error('Use --matrix or --target <installed checkout>');
const target = path.resolve(process.argv[i + 1]);
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const modules = JSON.parse(fs.readFileSync(path.join(root, 'modules.json'))).modules;
for (const area of ['server', 'ui']) {
  run([path.join(target, 'node_modules/typescript/bin/tsc'), '--noEmit'], path.join(target, area));
  const tests = [];
  for (const module of modules) {
    const folder = path.join(root, 'modules', module.id, area);
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && /\.test\.tsx?$/.test(entry.name)) tests.push(path.relative(path.join(root, 'modules', module.id, area), path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    }
  }
  if (tests.length) run([path.join(target, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--pool=threads', '--maxWorkers=1', '--hookTimeout=120000'], path.join(target, area));
}
