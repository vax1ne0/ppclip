import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { waitForReady } from '../../modules/core/scripts/ppclip/launcher-ready.mjs';

function child() {
  return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
}

test('waits through starting responses until the app is healthy', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: ++requests < 3 ? 'starting' : 'ok' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await waitForReady(`http://127.0.0.1:${server.address().port}`, child(), { intervalMs: 1 });
    assert.equal(requests, 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('reports early process exit and removes its listener', async () => {
  const process = child();
  process.exitCode = 1;
  await assert.rejects(waitForReady('http://127.0.0.1:1', process), /exited before becoming ready/);
  assert.equal(process.listenerCount('error'), 0);
});

test('bounds connection failures instead of reporting success', async () => {
  await assert.rejects(waitForReady('http://127.0.0.1:1', child(), {
    timeoutMs: 20, intervalMs: 1,
  }), /Startup timed out/);
});

test('reports spawn failures', async () => {
  const process = child();
  const waiting = waitForReady('http://127.0.0.1:1', process, { intervalMs: 1 });
  process.emit('error', new Error('spawn failed'));
  await assert.rejects(waiting, /spawn failed/);
});
