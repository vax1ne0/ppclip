#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const imageIndex = process.argv.indexOf('--image');
const image = imageIndex < 0 ? process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1' : process.argv[imageIndex + 1];
if (!image) throw new Error('--image needs an image name');
const source = `profile-test-${randomUUID()}`, destination = `profile-test-${randomUUID()}`;
const volumes = [source, destination].map(id => `ppclip-computer-home-${id}`);
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ppclip-profile-smoke-'));
const archive = path.join(folder, 'profile.tar.gz');
const active = `ppclip-profile-smoke-${randomUUID()}`;
let activeCreated = false;
const cli = path.resolve(import.meta.dirname, '../modules/computer-use/scripts/ppclip/computer-profile.mjs');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const server = net.createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const run = (operation, agent) => spawnSync(process.execPath, [cli, operation, '--agent', agent, '--file', archive, '--supervisor-port', String(port)], { env: { ...process.env, PPCLIP_COMPUTER_IMAGE: image }, encoding: 'utf8', windowsHide: true, timeout: 60_000 });
try {
  for (const volume of volumes) docker('volume', 'create', volume);
  docker('run', '--rm', '--network', 'none', '--mount', `source=${volumes[0]},target=/profile`, '--entrypoint', 'python3', image, '-c', "from pathlib import Path; p=Path('/profile/chromium-profile'); p.mkdir(); (p/'Cookies').write_text('owned-smoke-data')");
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const online = run('backup', source);
  assert.equal(online.status, 1);
  assert.match(online.stderr, /Stop the computer supervisor/);
  await new Promise(resolve => server.close(resolve));
  docker('run', '-d', '--name', active, '--network', 'none', '--mount', `source=${volumes[0]},target=/profile`, '--entrypoint', 'python3', image, '-c', 'import time; time.sleep(60)');
  activeCreated = true;
  const busy = run('backup', source);
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, /Stop every computer/);
  docker('rm', '-f', active);
  activeCreated = false;
  assert(!fs.existsSync(archive));
  console.log('PASS online supervisor and active profile backups refused');
  const saved = run('backup', source);
  assert.equal(saved.status, 0, saved.stderr);
  assert(fs.statSync(archive).size > 0);
  const restored = run('restore', destination);
  assert.equal(restored.status, 0, restored.stderr);
  const value = docker('run', '--rm', '--network', 'none', '--user', '1000:1000', '--mount', `source=${volumes[1]},target=/profile,readonly`, '--entrypoint', 'python3', image, '-c', "from pathlib import Path; print(Path('/profile/chromium-profile/Cookies').read_text())");
  assert.equal(value, 'owned-smoke-data');
  const overwrite = run('restore', destination);
  assert.equal(overwrite.status, 1);
  assert.match(overwrite.stderr, /empty profile/);
  assert(fs.existsSync(archive));
  console.log('PASS real profile archive round trip, restored ownership, and overwrite refusal');
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  if (activeCreated) docker('rm', '-f', active);
  for (const agent of [source, destination]) {
    spawnSync('docker', ['rm', '-f', `ppclip-profile-lock-${agent}`], { stdio: 'ignore', windowsHide: true });
  }
  for (const volume of volumes) docker('volume', 'rm', volume);
  fs.rmSync(archive, { force: true });
  fs.rmdirSync(folder);
}
