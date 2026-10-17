// ppclip: update the ppclip package and restart Paperclip, in one step.
//
//   node scripts/ppclip/update.mjs [--data <folder>] [--package <ppclip folder>] [--check] [--force]
//
// Run it from anywhere; paths are found from this checkout. It:
//   1. checks the ppclip repo (next to this Paperclip checkout) for new commits;
//   2. asks the running Paperclip to update itself (the Settings → ppclip button does the same),
//      or, when Paperclip isn't running, updates directly;
//   3. stops Paperclip and the computer supervisor, pulls ppclip, runs install.mjs update
//      (which may also move Paperclip to the newest supported version), installs dependencies,
//      restarts Paperclip with the same start-local options, and rebuilds the computer-use
//      image in the background when its files changed.
// --check only reports. --force updates even when no new commits were found.
// Progress: <data>/ppclip-update.json and <data>/ppclip-update.log.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);
const home = path.resolve(arg('--data', process.env.PAPERCLIP_HOME ?? path.join(app, '..', '.ppclip-runtime')));
const statusFile = path.join(home, 'ppclip-update.json');
const logFile = path.join(home, 'ppclip-update.log');
const launcherFile = path.join(home, 'launcher.json');

/** The ppclip repo: --package, PPCLIP_PACKAGE_DIR, or the folder next to this checkout that holds install.mjs and modules.json. */
export function findPackage(appDir = app, given = arg('--package', process.env.PPCLIP_PACKAGE_DIR)) {
  if (given) return path.resolve(given);
  const parent = path.dirname(appDir);
  const found = fs.readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parent, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'install.mjs')) && fs.existsSync(path.join(dir, 'modules.json')));
  if (found.length === 1) return found[0];
  throw new Error(found.length ? `Several ppclip folders next to Paperclip; choose one with --package:\n  ${found.join('\n  ')}` : `No ppclip folder found next to ${appDir}. Pass --package <ppclip folder>.`);
}

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

/** New commits on the ppclip repo's upstream branch (fetches first). */
export function checkPackage(pkg) {
  const fetched = git(pkg, ['fetch', '--quiet']);
  const head = git(pkg, ['rev-parse', '--short', 'HEAD']).out;
  const dirty = git(pkg, ['status', '--porcelain', '--untracked-files=no']).out;
  const log = git(pkg, ['log', '--format=%h %s', 'HEAD..@{u}']);
  return {
    head,
    fetchError: fetched.ok ? null : fetched.err || 'git fetch failed',
    dirty: dirty ? dirty.split('\n') : [],
    commits: log.ok && log.out ? log.out.split('\n') : [],
  };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
// With --run (started by the server) stdout already goes to the log file, so write each line once.
const log = (line) => { const text = `[${new Date().toISOString()}] ${line}`; if (!flag('--run')) console.log(text); fs.mkdirSync(home, { recursive: true }); fs.appendFileSync(logFile, `${text}\n`); };
const setStatus = (patch) => { const next = { ...(readJson(statusFile) ?? {}), ...patch, updatedAt: new Date().toISOString() }; fs.writeFileSync(statusFile, JSON.stringify(next, null, 2)); return next; };

function healthy(url) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/api/health`, { timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** PIDs listening on the given TCP ports, from `netstat -ano` output (Windows). */
export function parseNetstatListeners(text, ports) {
  const wanted = new Set(ports.map(String));
  const pids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !/^TCP/i.test(cols[0]) || !/LISTEN/i.test(cols[3])) continue;
    const port = cols[1].split(':').pop();
    const pid = Number(cols[4]);
    if (wanted.has(port) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/**
 * Stops the old Paperclip. On Windows a process tree includes this updater
 * (the server started it), so never kill a tree there: stop only the launcher
 * process and whatever still listens on Paperclip's ports.
 */
function stopPaperclip(launcher) {
  if (process.platform !== 'win32') {
    for (const pid of [launcher?.pid, launcher?.computerSupervisorPid]) {
      if (!alive(pid)) continue;
      try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
    }
    return;
  }
  const port = launcher?.url ? Number(new URL(launcher.url).port) : 3410;
  const config = readJson(launcher?.configPath ?? '');
  const ports = [port, port + 10000, config?.database?.embeddedPostgresPort ?? 55440, 7091];
  const listening = parseNetstatListeners(spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout ?? '', ports);
  const pids = [...new Set([launcher?.pid, launcher?.computerSupervisorPid, ...listening])].filter((pid) => pid && pid !== process.pid && alive(pid));
  for (const pid of pids) spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
  if (pids.length) log(`Stopped processes ${pids.join(', ')}.`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  log(`$ ${[cmd, ...args].join(' ')}`);
  const out = fs.openSync(logFile, 'a');
  const r = spawnSync(cmd, args, { cwd: app, stdio: ['ignore', out, out], windowsHide: true, ...opts });
  fs.closeSync(out);
  return r.status === 0;
}

/** pnpm from PATH, else the copy corepack ships with this Node (works with a portable Node folder). */
function pnpmCommand() {
  if (spawnSync('pnpm', ['--version'], { shell: true, stdio: 'ignore' }).status === 0) return { cmd: 'pnpm', args: [], shell: true };
  const nodeDir = path.dirname(process.execPath);
  for (const candidate of [path.join(nodeDir, 'node_modules', 'corepack', 'dist', 'corepack.js'), path.join(nodeDir, '..', 'lib', 'node_modules', 'corepack', 'dist', 'corepack.js')]) {
    if (fs.existsSync(candidate)) return { cmd: process.execPath, args: [candidate, 'pnpm'], shell: false };
  }
  return null;
}

function relaunchArgs(launcher) {
  if (Array.isArray(launcher?.args)) return launcher.args;
  return ['--data', home, ...(launcher?.computerSupervisorPid ? ['--with-computer'] : [])];
}

/** The update itself. Paperclip must be stopped or stopping. */
async function performUpdate() {
  const pkg = findPackage();
  const launcher = readJson(launcherFile);
  setStatus({ state: 'running', step: 'Waiting for Paperclip to stop', startedAt: new Date().toISOString(), finishedAt: null, error: null });
  log(`Updating ppclip from ${pkg} for ${app} (data ${home})`);

  // 1. Paperclip shuts itself down gracefully when the update starts from the server (its
  //    database stops too); give it up to a minute, then stop what is left.
  for (let i = 0; i < 90 && launcher?.url && (await healthy(launcher.url)); i++) await sleep(1000);
  for (let i = 0; i < 60 && alive(launcher?.pid); i++) await sleep(1000);
  if (alive(launcher?.pid)) log('Paperclip did not stop by itself within a minute; stopping it.');
  stopPaperclip(launcher);
  await sleep(3000);

  // 2. Pull ppclip.
  setStatus({ step: 'Downloading the new ppclip' });
  const from = git(pkg, ['rev-parse', 'HEAD']).out;
  let failure = null;
  if (!run('git', ['-C', pkg, 'pull', '--ff-only'])) failure = 'git pull failed (see the update log).';
  const to = git(pkg, ['rev-parse', 'HEAD']).out;

  // 3. Reinstall ppclip (install.mjs rolls back by itself when something fails).
  if (!failure) {
    setStatus({ step: 'Installing ppclip', from, to });
    if (!run(process.execPath, [path.join(pkg, 'install.mjs'), 'update', '--target', app, ...(flag('--force') ? ['--force'] : [])])) failure = 'install.mjs update failed; the previous version was kept (see the update log).';
  }

  // 4. Dependencies, even after a failure: the checkout must be runnable either way.
  setStatus({ step: 'Installing dependencies' });
  const pnpm = pnpmCommand();
  if (!pnpm) failure ??= 'pnpm was not found. Install pnpm 9.15.4 or run corepack enable, then run this again.';
  else if (!run(pnpm.cmd, [...pnpm.args, 'install', '--frozen-lockfile'], { shell: pnpm.shell, env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } })) failure ??= 'pnpm install failed (see the update log).';

  // 5. Restart Paperclip the way it was started.
  setStatus({ step: 'Starting Paperclip' });
  const restartArgs = relaunchArgs(launcher);
  const started = run(process.execPath, [path.join(app, 'scripts', 'ppclip', 'start-local.mjs'), ...restartArgs]);
  const url = readJson(launcherFile)?.url ?? launcher?.url;
  let up = false;
  for (let i = 0; started && url && i < 180 && !(up = await healthy(url)); i++) await sleep(1000);
  if (!up) failure ??= 'Paperclip did not come back; see server.stderr.log in the data folder.';

  const commits = from && to && from !== to ? git(pkg, ['log', '--format=%h %s', `${from}..${to}`]).out.split('\n').filter(Boolean) : [];
  setStatus({ state: failure ? 'failed' : 'done', step: failure ? 'Failed' : 'Done', error: failure, finishedAt: new Date().toISOString(), from, to, commits });
  log(failure ? `Update failed: ${failure}` : `Updated ppclip ${from.slice(0, 7)} → ${to.slice(0, 7)}.`);

  // 6. The computer-use image, in the background of this process, only when its files changed.
  const imageChanged = from && to && from !== to && git(pkg, ['diff', '--name-only', from, to, '--', 'modules/computer-use/scripts/ppclip/computer-image']).out;
  if (!failure && imageChanged && spawnSync('docker', ['image', 'inspect', process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1'], { stdio: 'ignore' }).status === 0) {
    setStatus({ image: 'rebuilding' });
    const built = run('docker', ['build', '-t', process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1', path.join(app, 'scripts', 'ppclip', 'computer-image')]);
    setStatus({ image: built ? 'rebuilt' : 'rebuild failed (see the update log)' });
  }
  return !failure;
}

async function main() {
  if (flag('--run')) { process.exitCode = (await performUpdate()) ? 0 : 1; return; }
  const pkg = findPackage();
  const check = checkPackage(pkg);
  console.log(`ppclip at ${pkg} (${check.head})`);
  if (check.fetchError) console.log(`Could not check for updates: ${check.fetchError}`);
  if (check.dirty.length) { console.log(`The ppclip folder has local changes; commit or discard them first:\n  ${check.dirty.join('\n  ')}`); process.exitCode = 1; return; }
  console.log(check.commits.length ? `${check.commits.length} update(s):\n  ${check.commits.join('\n  ')}` : 'ppclip is up to date.');
  if (flag('--check') || (!check.commits.length && !flag('--force'))) return;

  const launcher = readJson(launcherFile);
  if (launcher?.url && (await healthy(launcher.url))) {
    // Let the running Paperclip shut down cleanly and start the updater itself (same as the Settings → ppclip button).
    const res = await fetch(`${launcher.url}/api/ppclip/update`, { method: 'POST', headers: { 'content-type': 'application/json', origin: launcher.url }, body: JSON.stringify({ force: flag('--force') }) }).catch((e) => ({ ok: false, statusText: e.message, json: async () => ({}) }));
    if (!res.ok) { const body = await res.json().catch(() => ({})); console.log(`Paperclip refused the update: ${body.error ?? res.statusText}`); process.exitCode = 1; return; }
    console.log('Paperclip is updating and will restart. Progress:');
    let last = '';
    for (let i = 0; i < 900; i++) {
      await sleep(2000);
      const s = readJson(statusFile);
      if (s?.step && s.step !== last) { last = s.step; console.log(`  ${s.step}`); }
      if (s?.state === 'done' || s?.state === 'failed') { console.log(s.state === 'done' ? `Done. Open ${launcher.url} (refresh the page).` : `Failed: ${s.error}\nLog: ${logFile}`); process.exitCode = s.state === 'done' ? 0 : 1; return; }
    }
    return;
  }
  if (!launcher) console.log(`Paperclip isn't running from ${home}; updating, then starting it with: start-local.mjs --data "${home}"`);
  process.exitCode = (await performUpdate()) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
}
