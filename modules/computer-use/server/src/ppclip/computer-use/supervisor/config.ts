import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** The supervisor's default loopback port (scripts/ppclip/computer-supervisor.mjs keeps its own copy). */
export const DEFAULT_SUPERVISOR_PORT = 7091;

/** Shared between the supervisor and Paperclip: where the bearer token lives. */
export function defaultTokenFile() {
  return process.env.PPCLIP_COMPUTER_SUPERVISOR_TOKEN_FILE ?? path.join(os.homedir(), ".paperclip", "ppclip-computer-supervisor.token");
}

export function defaultSupervisorUrl() {
  return process.env.PPCLIP_COMPUTER_SUPERVISOR_URL ?? `http://127.0.0.1:${DEFAULT_SUPERVISOR_PORT}`;
}

/** Reads the token, creating it (mode 0600) on first start. */
export function ensureToken(file: string) {
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = randomBytes(32).toString("hex");
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/** Reads the token if the supervisor has created it; never creates one. */
export function readToken(file = defaultTokenFile()) {
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The supervisor's own default, used when it was started without --token-file. */
export function homeTokenFile() {
  return path.join(os.homedir(), ".paperclip", "ppclip-computer-supervisor.token");
}

/**
 * The configured token file first, then the supervisor's default. A supervisor
 * started by hand without --token-file still works with a Paperclip started by
 * start-local (which points at a token file in its data folder).
 */
export function readAnyToken(): { token: string | null; looked: string[] } {
  const looked = [...new Set([defaultTokenFile(), homeTokenFile()])];
  for (const file of looked) {
    const token = readToken(file);
    if (token) return { token, looked };
  }
  return { token: null, looked };
}
