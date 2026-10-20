#!/usr/bin/env node
// Real isolated Docker test: no production agents, volumes, supervisor, or model calls.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const index = process.argv.indexOf('--image');
const image = index < 0 ? 'ppclip-computer:1' : process.argv[index + 1];
const driverIndex = process.argv.indexOf('--desktop-driver');
const desktopDriver = driverIndex < 0 ? 'atspi' : process.argv[driverIndex + 1];
const name = `ppclip-image-smoke-${randomUUID()}`;
const token = randomBytes(32).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let created = false;
try {
  docker('run', '-d', '--name', name, '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'KILL', '--cap-add', 'NET_ADMIN', '--cap-add', 'SETPCAP',
    '--security-opt', 'no-new-privileges:true', '--memory', '2g', '--shm-size', '1g', '-p', '127.0.0.1::7070',
    '-e', `PPCLIP_CONTROL_TOKEN=${token}`, '-e', `PPCLIP_DESKTOP_DRIVER=${desktopDriver}`, '-e', 'PPCLIP_SHELL=1', '-e', 'PPCLIP_ALLOWED_HOSTS=example.com', image);
  created = true;
  const base = `http://${docker('port', name, '7070/tcp').split('\n')[0]}`;
  async function call(route, body = {}) {
    const response = await fetch(base + route, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const value = await response.json();
    assert(response.ok, `${route}: ${JSON.stringify(value)}`);
    return value;
  }
  let health;
  for (let i = 0; i < 90; i++) {
    try { health = await call('/health'); if (health.ok && health.browser) break; } catch {}
    await delay(1000);
  }
  assert(health?.ok && health.browser, docker('logs', name));
  assert.equal(health.networkPolicy, 'proxy-v2');
  console.log(`PASS desktop/browser ready; Chromium sandbox: ${health.chromiumSandbox.reason}`);
  const caps = docker('exec', name, 'cat', '/proc/1/status').match(/^CapBnd:\s+([0-9a-f]+)$/m)[1];
  assert.equal(BigInt('0x' + caps) & ((1n << 12n) | (1n << 8n)), 0n);
  console.log('PASS bootstrap network capabilities removed from PID 1');
  const direct = docker('exec', '--user', '1001:1001', name, 'python3', '-c', "import socket; s=socket.socket(); s.settimeout(1);\ntry: s.connect(('1.1.1.1',443)); print('BYPASS')\nexcept OSError: print('BLOCKED')");
  assert.equal(direct, 'BLOCKED');
  const dns = docker('exec', '--user', '1001:1001', name, 'python3', '-c', "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(1);\ntry: s.sendto(bytes.fromhex('123401000001000000000000076578616d706c6503636f6d0000010001'),('127.0.0.11',53)); s.recv(1024); print('BYPASS')\nexcept OSError: print('BLOCKED')");
  assert.equal(dns, 'BLOCKED');
  console.log('PASS raw TCP and Docker DNS bypass blocked');
  const denied = await call('/shell', { command: 'python3 -c "import urllib.request; urllib.request.urlopen(\'http://example.org\', timeout=5)"', timeoutMs: 10_000 });
  assert.notEqual(denied.exitCode, 0);
  assert.match(denied.output, /403/);
  const allowed = await call('/shell', { command: 'python3 -c "import urllib.request; print(urllib.request.urlopen(\'https://example.com\', timeout=10).status)"', timeoutMs: 15_000 });
  assert.equal(allowed.exitCode, 0, allowed.output);
  assert.match(allowed.output, /200/);
  console.log('PASS shell uses the same allowed-site proxy as Chromium');
  const window = docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'search', '--onlyvisible', '--class', 'chromium').split('\n')[0];
  docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'windowminimize', window);
  await call('/page/act', { action: { type: 'navigate', url: 'https://example.com/' } });
  const restored = docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'search', '--onlyvisible', '--class', 'chromium').split('\n');
  assert(restored.includes(window), 'Navigation did not restore the minimized browser window');
  console.log('PASS navigation restores the same minimized Chromium window');
  const desktop = await call('/desktop');
  assert(Array.isArray(desktop.elements));
  const widget = "import gi; from pathlib import Path; gi.require_version('Gtk','3.0'); from gi.repository import Gtk; w=Gtk.Window(title='ppclip accessibility smoke'); b=Gtk.Box(orientation=Gtk.Orientation.VERTICAL); e=Gtk.Entry(); e.get_accessible().set_name('Smoke search'); e.connect('changed',lambda x:Path('/tmp/ppclip/native-smoke-text').write_text(x.get_text())); button=Gtk.Button(label='Apply smoke'); button.connect('clicked',lambda x:x.set_label('Applied smoke')); b.pack_start(e,True,True,0); b.pack_start(button,True,True,0); w.add(b); w.set_default_size(320,180); w.show_all(); Gtk.main()";
  docker('exec', '-d', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name,
    'sh', '-c', 'export DBUS_SESSION_BUS_ADDRESS="$(cat /tmp/ppclip/dbus-address)"; exec python3 -c "$1"', 'widget', widget);
  let native;
  for (let i = 0; i < 12; i++) {
    native = await call('/desktop');
    if (native.elements.some(element => element.name === 'Smoke search')) break;
    await delay(500);
  }
  assert(native.elements.some(element => element.name === 'Smoke search'), 'Native GTK entry was not exposed through AT-SPI');
  await delay(1000); // Let the window manager finish placing the new window.
  native = await call('/desktop');
  const entry = native.elements.find(element => element.name === 'Smoke search');
  await call('/desktop/act', { action: { type: 'type', ref: entry.ref, text: 'checked' } });
  native = await call('/desktop');
  const button = native.elements.find(element => element.name === 'Apply smoke');
  assert(button, 'Native GTK button was not exposed');
  await call('/desktop/act', { action: { type: 'click', ref: button.ref } });
  native = await call('/desktop');
  assert(native.elements.some(element => element.name === 'Applied smoke'));
  console.log('PASS real GTK entry and button found and controlled semantically');
  native = await call('/desktop');
  const typing = call('/desktop/act', { action: { type: 'type', ref: native.elements.find(element => element.name === 'Smoke search').ref, text: 'x'.repeat(100) } });
  await delay(250);
  await call('/stream/control', { token: 'smoke-control-token-12345678901234567890' });
  const typed = docker('exec', '--user', '1000:1000', name, 'cat', '/tmp/ppclip/native-smoke-text');
  assert(typed.endsWith('x'.repeat(100)), 'Takeover returned while native typing was still in progress');
  await typing;
  console.log('PASS takeover waits for pending native input to finish');
  const blocked = await fetch(base + '/desktop/act', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: { type: 'click', ref: 1 } }) });
  assert.equal(blocked.status, 409);
  console.log('PASS native tool actions blocked during human control');
  const browserPid = docker('exec', '--user', '1000:1000', name, 'cat', '/tmp/ppclip/browser.pid');
  docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'windowminimize', window);
  // Click the actual dock launcher once. The fixture uses the default 1280x800 display.
  docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'mousemove', '432', '754', 'click', '1');
  let dockRestored = false;
  for (let i = 0; i < 15; i++) {
    try { dockRestored = docker('exec', '--user', '1000:1000', '-e', 'DISPLAY=:1', '-e', 'XAUTHORITY=/tmp/ppclip/Xauthority', name, 'xdotool', 'search', '--onlyvisible', '--class', 'chromium').split('\n').includes(window); } catch {}
    if (dockRestored) break;
    await delay(200);
  }
  assert(dockRestored, 'Clicking the dock Chromium icon did not restore the browser');
  assert.equal(docker('exec', '--user', '1000:1000', name, 'cat', '/tmp/ppclip/browser.pid'), browserPid);
  console.log('PASS dock launcher restores the same browser during human control');
} finally {
  if (created) docker('rm', '-f', name);
}
