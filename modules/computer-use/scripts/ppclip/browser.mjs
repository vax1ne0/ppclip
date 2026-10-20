#!/usr/bin/env node
// Browser CLI over the same live-run MCP boundary as the agent's Computer tools.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
const [command, ...args] = process.argv.slice(2);
const flags = args.filter(arg => arg.startsWith('--'));
const value = args[0]?.startsWith('--') ? undefined : args[0];
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const token = process.env.PAPERCLIP_API_KEY;
const base = process.env.PAPERCLIP_API_URL;
const supported = ['status', 'page', 'navigate', 'click', 'type', 'desktop', 'desktop-click', 'desktop-type'];
if (!token || !base || !supported.includes(command)) {
  console.error('Run inside an active Paperclip agent environment. Commands: status | page | navigate <url> | click <ref> --epoch <n> [--confirm] | type <ref> --epoch <n> [--submit] (text from stdin) | desktop | desktop-click <ref> --epoch <n> | desktop-type <ref> --epoch <n> (text from stdin). Add --json for the full result.');
  process.exit(1);
}
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS for a remote Paperclip server');
const epoch = Number(option('--epoch'));
if ((command === 'navigate' && !value) || (['click', 'type', 'desktop-click', 'desktop-type'].includes(command) && (!Number.isSafeInteger(Number(value)) || Number(value) < 1 || !Number.isSafeInteger(epoch) || epoch < 0))) {
  console.error('Supply a valid element reference and --epoch from a fresh observation, or a URL for navigate.');
  process.exit(1);
}
const app = path.resolve(import.meta.dirname, '../..');
const require = createRequire(path.join(app, 'server/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const commands = {
  status: ['computer_status', {}], page: ['browser_page', {}],
  navigate: ['browser_navigate', { url: value }],
  click: ['browser_click_element', { ref: Number(value), epoch, confirm: flags.includes('--confirm') }],
  type: ['browser_type_element', { ref: Number(value), epoch, text: command === 'type' ? fs.readFileSync(0, 'utf8') : undefined, submit: flags.includes('--submit') }],
  desktop: ['desktop_page', {}],
  'desktop-click': ['desktop_click_element', { ref: Number(value), epoch, confirm: flags.includes('--confirm') }],
  'desktop-type': ['desktop_type_element', { ref: Number(value), epoch, text: command === 'desktop-type' ? fs.readFileSync(0, 'utf8') : undefined }],
};
const client = new Client({ name: 'ppclip-browser-cli', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/api/ppclip/computer-use/mcp', base), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const [name, args] = commands[command];
  const result = await client.callTool({ name, arguments: args });
  console.log(flags.includes('--json') ? JSON.stringify(result) : result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(`Browser command failed: ${error.message}`);
  process.exitCode = 1;
} finally { await client.close(); }
