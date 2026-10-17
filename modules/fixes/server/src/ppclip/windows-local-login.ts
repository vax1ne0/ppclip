import { open } from "node:fs/promises";

/**
 * ppclip Windows sign-in for official's local AI login (the command and credential read).
 *
 * Official shows a POSIX shell command (`export …`, `mkdir -p`) and verifies
 * Claude credentials with a confined file open that only exists on macOS and
 * Linux. On Windows the command fails in PowerShell and the Claude login can
 * never be verified. These helpers are used only when the server runs on win32.
 */

const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** PowerShell equivalent of official's sign-in command for one isolated login home. */
export function windowsLocalLoginCommand(provider: string, directory: string): string {
  const home = psQuote(directory);
  const prepare = (variable: string) =>
    `$env:${variable} = ${home}; New-Item -ItemType Directory -Force -Path $env:${variable} | Out-Null`;
  if (provider === "openai") return `${prepare("CODEX_HOME")}; codex -c 'cli_auth_credentials_store="file"' login --device-auth`;
  if (provider === "anthropic") return `${prepare("CLAUDE_CONFIG_DIR")}; claude auth login`;
  return `${prepare("GROK_HOME")}; grok login --device-auth`;
}

const MAX_CREDENTIAL_BYTES = 64 * 1024;

/**
 * Bounded credential read for Windows. Windows has no POSIX owner ids or
 * permission bits and no descriptor-confined path walk, so official's checks
 * cannot pass there. The login home is created by Paperclip under its own
 * instance folder; refuse anything that is not a small regular file.
 */
export async function readWindowsCredentialFile(filename: string): Promise<string> {
  const file = await open(filename, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_CREDENTIAL_BYTES) throw new Error("Invalid credential file");
    const bytes = Buffer.alloc(MAX_CREDENTIAL_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX_CREDENTIAL_BYTES) throw new Error("Invalid credential file");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    await file.close();
  }
}
