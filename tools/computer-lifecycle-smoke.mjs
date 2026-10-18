import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Exercises the installed app and Docker sandbox, with no model invocation.
// Only the agent, container and profile created by this invocation are removed.
const args = process.argv.slice(2);
function option(name, fallback) { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; }
const base = option('--base-url', 'http://127.0.0.1:3410');
let company = option('--company');
const isolated = args.includes('--isolated');
const target = resolve(option('--target', '../paperclip-official'));
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Use a local app URL.');
assert(isolated || /^[0-9a-f-]{36}$/i.test(company ?? ''), 'Supply --isolated or --company <company UUID>.');
const { WebSocket } = createRequire(resolve(target, 'server/package.json'))('ws');
const exec = promisify(execFile);
const headers = { 'content-type': 'application/json', ...(process.env.PPCLIP_SMOKE_TOKEN ? { authorization: `Bearer ${process.env.PPCLIP_SMOKE_TOKEN}` } : {}) };
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
let prefix, agent, ws, ownedCompany, failure;
const name = `ppclip-computer-smoke-${randomUUID()}`;
const marker = `ppclip-smoke-${randomUUID()}`;
const checks = [];
function passed(label) { checks.push(label); console.log(`PASS ${label}`); }
function connect(src) {
  return new Promise((resolveConnection, reject) => {
    const path = new URL(src, base).searchParams.get('path');
    assert(path, 'Viewer must include a WebSocket path.');
    const url = new URL(`/${path}`, base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, ['binary']);
    let buffer = Buffer.alloc(0), stage = 0;
    const timer = setTimeout(() => { socket.terminate(); reject(new Error('VNC handshake timed out')); }, 15_000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('close', () => { if (stage !== 4) { clearTimeout(timer); reject(new Error('VNC closed during handshake')); } });
    socket.on('message', chunk => {
      try {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        if (stage === 0 && buffer.length >= 12) { assert.equal(buffer.subarray(0, 4).toString(), 'RFB '); buffer = buffer.subarray(12); socket.send(Buffer.from('RFB 003.008\n')); stage = 1; }
        if (stage === 1 && buffer.length && buffer.length >= buffer[0] + 1) {
          const count = buffer[0]; assert(buffer.subarray(1, count + 1).includes(1), 'VNC security type');
          buffer = buffer.subarray(count + 1); socket.send(Buffer.from([1])); stage = 2;
        }
        if (stage === 2 && buffer.length >= 4) { assert.equal(buffer.readUInt32BE(0), 0); buffer = buffer.subarray(4); socket.send(Buffer.from([1])); stage = 3; }
        if (stage === 3 && buffer.length >= 24 && buffer.length >= 24 + buffer.readUInt32BE(20)) {
          stage = 4; clearTimeout(timer); resolveConnection(socket);
        }
        if (stage === 4) buffer = Buffer.alloc(0);
      } catch (error) { clearTimeout(timer); socket.terminate(); reject(error); }
    });
  });
}
function key(code, down) { const b = Buffer.alloc(8); b[0] = 4; b[1] = Number(down); b.writeUInt32BE(code, 4); ws.send(b); }
function press(code) { key(code, true); key(code, false); }
function pointer(x, y, mask = 0) { const b = Buffer.alloc(6); b[0] = 5; b[1] = mask; b.writeUInt16BE(x, 2); b.writeUInt16BE(y, 4); ws.send(b); }
async function docker(...command) { return (await exec('docker', ['exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', `ppclip-computer-${agent.id}`, ...command], { timeout: 15_000 })).stdout.trim(); }
try {
  if (isolated) {
    ownedCompany = await request('/companies', 'POST', { name }, 201);
    company = ownedCompany.id;
    await request(`/companies/${company}`, 'PATCH', { requireBoardApprovalForNewAgents: false });
    await request(`/companies/${company}/ppclip/computer-use`, 'PUT', { enabled: true });
  }
  prefix = `/companies/${company}/ppclip/computer-use`;
  const overview = await request(prefix);
  assert(overview.enabled && overview.supervisor.ok, 'Enable computer use and start its supervisor first.');
  agent = await request(`/companies/${company}/agents`, 'POST', { name, role: 'engineer', adapterType: 'process', adapterConfig: { command: 'node', args: ['--version'] }, runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0 } } }, 201);
  assert(agent.id && agent.name === name, 'Disposable agent ownership could not be confirmed.');
  const computer = `${prefix}/agents/${agent.id}`;
  const state = async () => (await request(prefix)).agents.find(row => row.agentId === agent.id).state;
  await request(computer, 'PATCH', { enabled: true });
  await request(`${computer}/start`, 'POST', {}); assert.equal(await state(), 'agent'); passed('start');
  const view = await request(`${computer}/viewer`, 'POST', { mode: 'view' });
  const document = await fetch(new URL(view.src, base)); assert(document.ok); assert((await document.text()).includes('new RFB'));
  ws = await connect(view.src); ws.terminate(); passed('live view handshake');
  await request(`${computer}/take-control`, 'POST', {}); assert.equal(await state(), 'human');
  const control = await request(`${computer}/viewer`, 'POST', { mode: 'control' }); ws = await connect(control.src);
  pointer(420, 62); pointer(420, 62, 1); pointer(420, 62);
  await delay(150);
  assert.match(await docker('xdotool', 'getmouselocation', '--shell'), /X=420\s+Y=62/); passed('mouse input');
  key(0xffe3, true); press(108); key(0xffe3, false);
  const url = `data:text/html,<title>${marker}</title><h1>Computer input verified</h1>`;
  for (const char of url) press(char.charCodeAt(0)); press(0xff0d);
  let title = '';
  for (let i = 0; i < 30; i++) { await delay(300); title = await docker('xdotool', 'getactivewindow', 'getwindowname'); if (title.includes(marker)) break; }
  assert(title.includes(marker), `Keyboard input did not reach Chromium: ${title}`); passed('keyboard input');
  await docker('sh', '-c', 'printf %s "$1" > /home/agent/.ppclip-smoke-marker', 'smoke', marker);
  ws.terminate(); ws = null;
  await request(`${computer}/release`, 'POST', {}); assert.equal(await state(), 'agent');
  assert.equal((await fetch(new URL(control.src, base))).status, 403); passed('release revokes old control ticket');
  await request(`${computer}/pause`, 'POST', {}); assert.equal(await state(), 'paused');
  await request(`${computer}/viewer`, 'POST', { mode: 'view' }, 409); passed('pause blocks viewer');
  await request(`${computer}/resume`, 'POST', {}); assert.equal(await state(), 'agent');
  const resumed = await request(`${computer}/viewer`, 'POST', { mode: 'view' }); ws = await connect(resumed.src); ws.terminate(); ws = null; passed('resume reconnects');
  await exec('docker', ['pause', `ppclip-computer-${agent.id}`], { timeout: 15_000 });
  for (let i = 0; i < 80 && await state() !== 'paused'; i++) await delay(500);
  assert.equal(await state(), 'paused');
  await request(`${computer}/viewer`, 'POST', { mode: 'view' }, 409);
  await request(`${computer}/resume`, 'POST', {}); passed('recovery detects an externally paused desktop');
  await request(`${computer}/stop`, 'POST', {}); assert.equal(await state(), 'stopped');
  await request(`${computer}/start`, 'POST', {}); assert.equal(await docker('cat', '/home/agent/.ppclip-smoke-marker'), marker); passed('stop/start retains profile');
} catch (error) {
  failure = error;
  console.error(error);
} finally {
  ws?.terminate();
  if (agent?.id) {
    const owned = await request(`/agents/${agent.id}`);
    assert.equal(owned.name, name, 'Refusing cleanup: agent ownership changed.');
    await request(`${prefix}/agents/${agent.id}/stop`, 'POST', {});
    await request(`${prefix}/agents/${agent.id}/delete`, 'POST', { purgeProfile: true });
    if (!ownedCompany) {
      await request(`/agents/${agent.id}/terminate`, 'POST', {});
      for (let i = 0; i < 60; i++) {
        const current = await request(`/agents/${agent.id}`);
        if (current.lifecycleState === 'terminated') break;
        await delay(500);
      }
      await request(`/agents/${agent.id}`, 'DELETE');
    }
    passed('disposable agent and profile removed');
  }
  if (ownedCompany) {
    const owned = await request(`/companies/${company}`);
    assert.equal(owned.name, name, 'Refusing cleanup: company ownership changed.');
    await request(`/companies/${company}`, 'DELETE');
    passed('disposable company removed');
  }
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, checks }));
