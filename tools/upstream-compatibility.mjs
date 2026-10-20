#!/usr/bin/env node
// Read-only candidate report. An applicable patch never promotes a supported revision.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
const i = process.argv.indexOf('--target');
if (i < 0 || !process.argv[i + 1]) throw new Error('--target <disposable upstream checkout> is required');
const target = path.resolve(process.argv[i + 1]);
const response = await fetch('https://api.github.com/repos/paperclipai/paperclip/releases/latest', {
  headers: { 'User-Agent': 'ppclip-compatibility', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Could not find the stable release (${response.status})`);
const release = await response.json();
if (release.prerelease || release.draft || !/^v[0-9][0-9A-Za-z.-]*$/.test(release.tag_name)) throw new Error('Unexpected stable release metadata');
execFileSync('git', ['-C', target, 'fetch', '--depth=1', 'origin', `refs/tags/${release.tag_name}:refs/tags/${release.tag_name}`], { stdio: ['ignore', 'ignore', 'inherit'] });
const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../install.mjs'), 'compatibility', '--target', target, '--ref', release.tag_name, '--json'], { encoding: 'utf8' });
if (![0, 2].includes(result.status)) throw new Error(result.stderr || 'Compatibility probe failed');
console.log(JSON.stringify({ release: release.tag_name, releaseUrl: release.html_url, automaticSupportPromotion: false, probe: JSON.parse(result.stdout) }, null, 2));
