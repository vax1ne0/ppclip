import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConptyLineRestorer,
  createWindowsLoginTerminal,
  resolveWindowsExecutable,
} from "../ppclip/windows-browser-login.js";

describe("ppclip Windows sign-in terminal", () => {
  it("turns ConPTY row moves back into line breaks without splitting a row", () => {
    const restore = createConptyLineRestorer();
    const out = restore("\x1b[1;1HBrowser didn't open? Use the url below to sign in\x1b[3;1Hhttps://claude.ai/oauth/authorize?code=true\x1b[3;45H\x1b[5;1HPaste code here if prompted >");
    expect(out.split("\n")).toEqual([
      "Browser didn't open? Use the url below to sign in", "", "https://claude.ai/oauth/authorize?code=true", "", "Paste code here if prompted >",
    ]);
    expect(restore("\x1b[2Bnext")).toBe("\n\nnext");
  });

  it("drops ConPTY's displaced hyperlink markers so the printed URL keeps its own line", () => {
    const restore = createConptyLineRestorer();
    const out = restore("sign in (c to copy)\x1b]8;id=1;https://claude.com/x\x1b\\\n\nhttps://claude.com/x\x1b[m\x1b]8;;\x1b\\\n");
    expect(out).toBe("sign in (c to copy)\n\nhttps://claude.com/x\x1b[m\n");
  });

  it("finds commands on PATH with PATHEXT and keeps absolute paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppclip-winlogin-"));
    try {
      fs.writeFileSync(path.join(dir, "tool.cmd"), "");
      const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };
      expect(resolveWindowsExecutable("tool", env)).toBe(path.join(dir, "tool.cmd"));
      expect(resolveWindowsExecutable(path.join(dir, "tool"), env)).toBe(path.join(dir, "tool.cmd"));
      expect(resolveWindowsExecutable("missing", env)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === "win32")("runs a command in a ConPTY, streams lines and accepts input", async () => {
    const terminal = createWindowsLoginTerminal();
    let output = "";
    const script = "process.stdout.write('first\\nsecond\\n');process.stdin.once('data',d=>{process.stdout.write('got:'+String(d).trim()+'\\n');process.exit(0)})";
    const done = terminal.start(process.execPath, ["-e", script], process.env, (chunk) => {
      output += chunk;
      if (output.includes("second") && !output.includes("got:")) terminal.write("abc\r");
    });
    const { exitCode } = await done;
    expect(exitCode).toBe(0);
    const lines = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    expect(lines).toEqual(expect.arrayContaining(["first", "second", "got:abc"]));
  }, 30_000);
});
