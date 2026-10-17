// ppclip: launch this checkout on native Windows (or any OS) as an isolated
// local instance. Adapted from the owner's upstream Windows handoff kit
// (fork-inventory/windows-kit). Usage, from the repo root:
//   node scripts/ppclip/start-local.mjs [--data <folder>] [--port 3410] [--pg-port 55440] [--with-computer]
// Data defaults to ../.ppclip-runtime next to the checkout.
// --with-computer also starts the computer-use supervisor (needs Docker), with its
// token and log in the data folder.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', '3410')), PG_PORT = Number(arg('--pg-port', '55440'));
const WITH_COMPUTER = process.argv.includes('--with-computer');
const SUPERVISOR_PORT = 7091;
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = path.resolve(arg('--data', path.join(app, '..', '.ppclip-runtime')));
if (home === app || home.startsWith(app + path.sep)) throw new Error('Choose a data folder outside the app checkout');
const instance = path.join(home, 'instances', 'ppclip');
fs.mkdirSync(instance, { recursive: true });
const configPath = path.join(instance, 'config.json');
if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({
  $meta: {version: 1, updatedAt: new Date().toISOString(), source: 'configure'},
  database: {mode: 'embedded-postgres', embeddedPostgresDataDir: path.join(instance, 'db'), embeddedPostgresPort: PG_PORT,
    backup: {enabled: false, dir: path.join(instance, 'backups')}},
  logging: {mode: 'file', logDir: path.join(instance, 'logs')},
  server: {deploymentMode: 'local_trusted', exposure: 'private', host: '127.0.0.1', port: PORT, serveUi: true},
  storage: {provider: 'local_disk', localDisk: {baseDir: path.join(instance, 'storage')}},
  secrets: {provider: 'local_encrypted', localEncrypted: {keyFilePath: path.join(instance, 'secrets', 'master.key')}},
  telemetry: {enabled: false}, updates: {checkEnabled: false},
}, null, 2));

for (const port of [PORT, PORT + 10000, PG_PORT]) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

// Only pass basic system variables; never inherit another install's config or secrets.
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (['path','systemroot','windir','comspec','pathext','temp','tmp','userprofile','appdata','localappdata','programfiles','programfiles(x86)','programdata','systemdrive'].includes(key.toLowerCase())) env[key] = value;
}
// Put this instance's Node and its bundled Codex CLI first on its own PATH only,
// so agent environment checks find `codex` and `node` without a system install.
const pnpmStore = path.join(app, 'node_modules', '.pnpm');
const codexPkg = fs.existsSync(pnpmStore) ? fs.readdirSync(pnpmStore).find(name => /^@openai\+codex@.*-win32-x64$/.test(name)) : undefined;
const codexBin = codexPkg && path.join(pnpmStore, codexPkg, 'node_modules', '@openai', 'codex', 'vendor', 'x86_64-pc-windows-msvc', 'bin');
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'Path';
const extraPath = [path.dirname(process.execPath)];
if (codexBin && fs.existsSync(path.join(codexBin, 'codex.exe'))) extraPath.push(codexBin);
else if (process.platform === 'win32') console.warn('Bundled Codex CLI not found; codex must be on the system PATH');
env[pathKey] = [...extraPath, env[pathKey]].filter(Boolean).join(path.delimiter);
const jwtPath = path.join(instance, 'secrets', 'agent-jwt.key');
fs.mkdirSync(path.dirname(jwtPath), { recursive: true });
if (!fs.existsSync(jwtPath)) fs.writeFileSync(jwtPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
Object.assign(env, {
  PAPERCLIP_AGENT_JWT_SECRET: fs.readFileSync(jwtPath, 'utf8').trim(),
  PAPERCLIP_HOME: home, PAPERCLIP_INSTANCE_ID: 'ppclip', PAPERCLIP_CONFIG: configPath,
  HOST: '127.0.0.1', PORT: String(PORT), PAPERCLIP_DEPLOYMENT_MODE: 'local_trusted',
  PAPERCLIP_UI_DEV_MIDDLEWARE: 'true', HEARTBEAT_SCHEDULER_ENABLED: 'false',
  PAPERCLIP_DB_BACKUP_ENABLED: 'false', PAPERCLIP_MIGRATION_AUTO_APPLY: 'true',
  PAPERCLIP_MIGRATION_PROMPT: 'never', PAPERCLIP_OPEN_ON_LISTEN: 'false',
  PAPERCLIP_API_URL: `http://127.0.0.1:${PORT}`, NODE_ENV: 'development',
  // Computer use: Paperclip and the supervisor share this token file in the data folder.
  PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE: path.join(home, 'ppclip-computer-supervisor.token'),
  PPCLIP_COMPUTER_SUPERVISOR_URL: `http://127.0.0.1:${SUPERVISOR_PORT}`,
});
const stdout = fs.openSync(path.join(home, 'server.stdout.log'), 'a');
const stderr = fs.openSync(path.join(home, 'server.stderr.log'), 'a');
const child = spawn(process.execPath, [path.join(app, 'server/node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
  cwd: path.join(app, 'server'), env, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr],
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.unref();
fs.writeFileSync(path.join(home, 'launcher.json'), JSON.stringify({pid: child.pid, url: `http://127.0.0.1:${PORT}`, home, configPath}, null, 2));
console.log('Started ppclip', child.pid, `http://127.0.0.1:${PORT}`, 'data:', home);

if (WITH_COMPUTER) await startComputerSupervisor();

/** Docker's local socket, or Docker Desktop's named pipe on Windows (DOCKER_HOST wins). */
function dockerSocket() {
  return process.env.DOCKER_HOST?.startsWith('unix://') ? process.env.DOCKER_HOST.slice(7)
    : process.env.DOCKER_HOST?.startsWith('npipe://') ? process.env.DOCKER_HOST.slice(8).replace(/\//g, '\\')
    : process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock';
}

function dockerGet(apiPath) {
  return new Promise((resolve) => {
    const req = http.get({ socketPath: dockerSocket(), path: apiPath, timeout: 3000 }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

async function dockerReachable() {
  return (await dockerGet('/_ping')) === 200;
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function startComputerSupervisor() {
  if (!(await dockerReachable())) {
    console.warn([
      '',
      'Computer use: Docker is not reachable, so the computer supervisor was not started.',
      process.platform === 'win32'
        ? '  Start Docker Desktop (WSL2 backend), wait until it says it is running, then run this again.'
        : '  Start Docker (for example: sudo systemctl start docker) and make sure your user can use it.',
      '  Paperclip itself is running; computers stay unavailable until the supervisor starts.',
      '',
    ].join('\n'));
    return;
  }
  if (!(await portFree(SUPERVISOR_PORT))) {
    console.warn(`Computer use: port ${SUPERVISOR_PORT} is already in use, so a supervisor is probably running already. Not starting another one.`);
    return;
  }
  const image = process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1';
  if ((await dockerGet(`/images/${encodeURIComponent(image)}/json`)) === 404) {
    console.warn(`Computer use: the sandbox image ${image} is not built yet. Build it once (about 1 GB): node scripts/ppclip/computer-supervisor.mjs build-image`);
  }
  const log = fs.openSync(path.join(home, 'computer-supervisor.log'), 'a');
  const supervisor = spawn(process.execPath, [path.join(app, 'scripts', 'ppclip', 'computer-supervisor.mjs'), '--port', String(SUPERVISOR_PORT),
    '--token-file', env.PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE], {
    cwd: app, env: { ...env, ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}), ...(process.env.PPCLIP_COMPUTER_IMAGE ? { PPCLIP_COMPUTER_IMAGE: process.env.PPCLIP_COMPUTER_IMAGE } : {}) },
    detached: true, windowsHide: true, stdio: ['ignore', log, log],
  });
  supervisor.on('error', (error) => console.error('Computer supervisor failed to start:', error.message));
  supervisor.unref();
  const launcherFile = path.join(home, 'launcher.json');
  const launcher = JSON.parse(fs.readFileSync(launcherFile, 'utf8'));
  fs.writeFileSync(launcherFile, JSON.stringify({ ...launcher, computerSupervisorPid: supervisor.pid }, null, 2));
  console.log('Started computer supervisor', supervisor.pid, `http://127.0.0.1:${SUPERVISOR_PORT}`, 'log:', path.join(home, 'computer-supervisor.log'));
}
