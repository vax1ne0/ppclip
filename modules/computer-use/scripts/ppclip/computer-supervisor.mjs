// ppclip: computer-use supervisor launcher. It is the only process that talks
// to Docker; Paperclip talks to it over http://127.0.0.1:7091 with a bearer token.
//
//   node scripts/ppclip/computer-supervisor.mjs build-image            # build the sandbox image (once, ~1 GB)
//   node scripts/ppclip/computer-supervisor.mjs [start] [--provider docker|fake] [--port 7091]
//        [--memory-mb 2048] [--cpus 2] [--max-running 3] [--token-file <path>]
//
// The token file defaults to ~/.paperclip/ppclip-computer-supervisor.token and is
// created on first start. Paperclip reads the same file (or set
// PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE / PPCLIP_COMPUTER_SUPERVISOR_URL for both).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
const rest = process.argv.slice(command === process.argv[2] ? 3 : 2);
const image = process.env.PPCLIP_COMPUTER_IMAGE ?? 'ppclip-computer:1';

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
  child.on('exit', (code) => process.exit(code ?? 1));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
}

if (command === 'build-image') {
  run('docker', ['build', '-t', image, ...(rest.includes('--with-cua') ? ['--build-arg', 'PPCLIP_WITH_CUA=1'] : []), path.join(app, 'scripts', 'ppclip', 'computer-image')]);
} else if (command === 'start') {
  const require = createRequire(path.join(app, 'server', 'package.json'));
  const tsxCli = require.resolve('tsx/cli');
  run(process.execPath, [tsxCli, path.join(app, 'server', 'src', 'ppclip', 'computer-use', 'supervisor', 'main.ts'), ...rest], { cwd: path.join(app, 'server') });
} else {
  console.error('Usage: node scripts/ppclip/computer-supervisor.mjs [start|build-image] [options]');
  process.exit(1);
}
