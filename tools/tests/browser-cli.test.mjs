import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const target = path.resolve(process.env.PPCLIP_TEST_TARGET ?? path.join(import.meta.dirname, '../../../paperclip-official'));
// Needs an installed overlay: the SDK from server/ and the packaged CLI.
const available = fs.existsSync(path.join(target, 'server/package.json')) && fs.existsSync(path.join(target, 'scripts/ppclip/browser.mjs'));

test('browser CLI uses authenticated MCP and preserves tool errors', { skip: !available }, async () => {
  const require = createRequire(path.join(target, 'server/package.json'));
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-live-run') { res.writeHead(403); res.end('Live run required'); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const mcp = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(CallToolRequestSchema, async request => {
      calls.push(request.params);
      return { content: [{ type: 'text', text: 'fixture response' }], ...(request.params.name === 'browser_click_element' ? { isError: true } : {}) };
    });
    res.on('close', () => { void transport.close(); void mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PAPERCLIP_API_URL: `http://127.0.0.1:${server.address().port}`, PAPERCLIP_API_KEY: 'fixture-live-run' };
  const cli = path.join(target, 'scripts/ppclip/browser.mjs');
  const run = promisify(execFile);
  try {
    const page = await run(process.execPath, [cli, 'page'], { env, windowsHide: true, timeout: 15_000 });
    assert.equal(page.stdout.trim(), 'fixture response');
    assert.equal(calls[0].name, 'browser_page');
    const json = await run(process.execPath, [cli, 'page', '--json'], { env, windowsHide: true, timeout: 15_000 });
    assert.equal(JSON.parse(json.stdout).content[0].text, 'fixture response');
    await assert.rejects(run(process.execPath, [cli, 'click', '3', '--epoch', '7'], { env, windowsHide: true, timeout: 15_000 }), error => error.code === 1);
    assert.deepEqual(calls[2].arguments, { ref: 3, epoch: 7, confirm: false });
    await assert.rejects(run(process.execPath, [cli, 'page'], { env: { ...env, PAPERCLIP_API_KEY: 'expired' }, windowsHide: true, timeout: 15_000 }));
    assert.equal(calls.length, 3);
    await assert.rejects(run(process.execPath, [cli, 'type', '1', '--epoch', '2'], { env: { ...env, PAPERCLIP_API_KEY: '' }, windowsHide: true, timeout: 2000 }), error => error.code === 1 && /active Paperclip/.test(error.stderr));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
