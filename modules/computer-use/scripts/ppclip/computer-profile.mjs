#!/usr/bin/env node
// Offline profile backup/restore. Docker access is operator authority, never an agent tool.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const [operation, ...args] = process.argv.slice(2);
function option(name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; }
const agent = option('--agent', '');
const file = option('--file');
if (!['backup', 'restore'].includes(operation) || !/^[a-z0-9-]{1,64}$/.test(agent) || !file) {
  console.error('Usage: node scripts/ppclip/computer-profile.mjs backup|restore --agent <id> --file <archive.tar.gz> [--supervisor-port 7091]');
  process.exit(1);
}
const archive = path.resolve(file);
const volume = `ppclip-computer-home-${agent}`;
const lock = `ppclip-profile-lock-${agent}`;
const image = process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1';
const docker = (...command) => execFileSync('docker', command, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const port = Number(option('--supervisor-port', '7091'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid supervisor port');
let created = false, outputCreated = false;
try {
  if (operation === 'restore') fs.accessSync(archive, fs.constants.R_OK);
  else if (fs.existsSync(archive)) throw new Error('Backup destination already exists; choose a new file');
  docker('volume', 'inspect', volume); // Never create a volume because of a mistyped agent id.
  docker('create', ...(operation === 'restore' ? ['--interactive'] : []), '--name', lock, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE',
    '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '64',
    '--security-opt', 'no-new-privileges:true', '--label', `ppclip.profile-lock=${agent}`,
    '--mount', `type=volume,source=${volume},target=/profile${operation === 'backup' ? ',readonly' : ''}`,
    '--entrypoint', 'python3', image, '/opt/ppclip/profile_archive.py', operation);
  created = true;
  const online = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
  if (online) throw new Error('Stop the computer supervisor before backing up or restoring profiles');
  const users = docker('ps', '--filter', `volume=${volume}`, '--format', '{{.Names}}').split('\n').filter(Boolean);
  if (users.length) throw new Error('Stop every computer using this profile before continuing');
  const child = spawn('docker', ['start', ...(operation === 'restore' ? ['-i'] : []), '-a', lock], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Profile helper exited with ${code}`))); });
  if (operation === 'backup') {
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; done(bytes > 2 * 1024 ** 3 ? new Error('Archive exceeds 2 GiB') : null, chunk); } });
    const destination = fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 });
    destination.once('open', () => { outputCreated = true; });
    child.stdin.end();
    await Promise.all([pipeline(child.stdout, limit, destination), exited]);
  } else {
    child.stdout.resume();
    await Promise.all([pipeline(fs.createReadStream(archive), child.stdin), exited]);
  }
  console.log(operation === 'backup' ? `Profile backed up to ${archive}` : 'Profile restored. You can start the supervisor and computer again.');
} catch (error) {
  if (outputCreated) fs.rmSync(archive, { force: true });
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) docker('rm', '-f', lock);
}
