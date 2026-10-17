// ppclip: launch this checkout on native Windows (or any OS) as an isolated
// local instance. Adapted from the owner's upstream Windows handoff kit
// (fork-inventory/windows-kit). Usage, from the repo root:
//   node scripts/ppclip/start-local.mjs [--data <folder>] [--port 3410] [--pg-port 55440]
// Data defaults to ../.ppclip-runtime next to the checkout.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const PORT = Number(arg('--port', '3410')), PG_PORT = Number(arg('--pg-port', '55440'));
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
