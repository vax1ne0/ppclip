import { spawn as spawnProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * ppclip Windows browser sign-in terminal.
 *
 * Official runs `claude setup-token` and `codex login --device-auth` inside a
 * terminal made by Python's `pty` module, which only exists on macOS and Linux.
 * On Windows this starts the same command in a ConPTY through @lydell/node-pty
 * (prebuilt, loaded only on win32) and hands the output to official's parsers.
 *
 * ConPTY repaints the screen with cursor-position codes instead of newlines, and
 * the parsers read lines, so row changes are turned back into line breaks. The
 * terminal is very wide so a long sign-in URL never wraps.
 *
 * Provider output may contain secrets: it is only passed to `onData`, never logged.
 */

export type WindowsLoginTerminal = {
  start(executable: string, args: string[], env: NodeJS.ProcessEnv, onData: (chunk: string) => void): Promise<{ exitCode: number | null }>;
  write(input: string): void;
  stop(): void;
};

const COLUMNS = 1000;
const ROWS = 50;

/** Finds `name` on PATH using PATHEXT, as cmd.exe would. Absolute paths are kept. */
export function resolveWindowsExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = (base: string) => path.extname(base) ? [base] : exts.map((ext) => base + ext.toLowerCase());
  if (path.isAbsolute(name)) return candidates(name).find((file) => fs.existsSync(file)) ?? null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  for (const dir of (env[pathKey] ?? "").split(path.delimiter).filter(Boolean)) {
    const found = candidates(path.join(dir, name)).find((file) => fs.existsSync(file));
    if (found) return found;
  }
  return null;
}

/**
 * Turns ConPTY cursor-row moves into newlines so official's line parsers can read
 * the output. It also drops OSC 8 hyperlink markers: ConPTY moves the opening
 * marker onto the line before the printed URL, and official's cleanup would then
 * fold the URL onto that line. The URL itself is still printed as plain text.
 */
export function createConptyLineRestorer() {
  let row = 1;
  return (chunk: string) => chunk.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[(\d*)(?:;(\d*))?H|\x1b\[(\d*)B/g, (match, cupRow, _cupCol, down) => {
    if (down !== undefined) {
      row += Number(down || 1);
      return "\n".repeat(Number(down || 1));
    }
    const next = Number(cupRow || 1);
    const lines = next > row ? "\n".repeat(next - row) : next < row ? "\n" : "";
    row = next;
    return lines;
  });
}

/**
 * Ends the sign-in process tree without blocking. node-pty's kill() closes the
 * ConPTY synchronously, and that blocks Node's event loop while the CLI's child
 * processes still hold the terminal, so the tree is ended first and kill() is
 * only a fallback.
 */
function endProcessTree(pty: { pid: number; kill(): void }, exited: () => boolean) {
  const taskkill = spawnProcess("taskkill", ["/PID", String(pty.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  taskkill.on("error", () => {});
  setTimeout(() => {
    if (exited()) return;
    try { pty.kill(); } catch { /* already exited */ }
  }, 3000).unref();
}

export function createWindowsLoginTerminal(): WindowsLoginTerminal {
  let pty: { pid: number; write(data: string): void; kill(): void } | null = null;
  let stopped = false;
  return {
    async start(executable, args, env, onData) {
      const { spawn } = await import("@lydell/node-pty");
      const resolved = resolveWindowsExecutable(executable, env);
      if (!resolved) throw new Error("Sign-in command not found");
      // .cmd/.bat shims need cmd.exe; real executables run directly.
      const viaShell = /\.(cmd|bat)$/i.test(resolved);
      // The system cmd.exe, as official's adapter utilities resolve it (not a ComSpec override).
      const file = viaShell ? path.join(env.SystemRoot || process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe") : resolved;
      const argv = viaShell ? ["/d", "/s", "/c", resolved, ...args] : args;
      const restore = createConptyLineRestorer();
      return new Promise((resolve) => {
        const child = spawn(file, argv, {
          name: "xterm-256color", cols: COLUMNS, rows: ROWS,
          env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
        });
        pty = child;
        child.onData((data) => onData(restore(data)));
        child.onExit(({ exitCode }) => { pty = null; resolve({ exitCode }); });
        if (stopped) endProcessTree(child, () => pty === null);
      });
    },
    write(input) { pty?.write(input); },
    stop() {
      if (stopped) return;
      stopped = true;
      if (pty) endProcessTree(pty, () => pty === null);
    },
  };
}
