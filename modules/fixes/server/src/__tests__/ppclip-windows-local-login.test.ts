import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readWindowsCredentialFile, windowsLocalLoginCommand } from "../ppclip/windows-local-login.ts";

describe("windowsLocalLoginCommand", () => {
  const home = String.raw`C:\Users\Jamal\.paperclip\instances\default\ai-local-logins\abc`;

  it("builds PowerShell commands for each provider", () => {
    expect(windowsLocalLoginCommand("openai", home)).toBe(
      String.raw`$env:CODEX_HOME = 'C:\Users\Jamal\.paperclip\instances\default\ai-local-logins\abc'; New-Item -ItemType Directory -Force -Path $env:CODEX_HOME | Out-Null; codex -c 'cli_auth_credentials_store="file"' login --device-auth`,
    );
    expect(windowsLocalLoginCommand("anthropic", home)).toMatch(/^\$env:CLAUDE_CONFIG_DIR = '.*'; New-Item .*; claude auth login$/);
    expect(windowsLocalLoginCommand("xai", home)).toMatch(/\$env:GROK_HOME = .*; grok login --device-auth$/);
  });

  it("escapes single quotes in the login folder", () => {
    expect(windowsLocalLoginCommand("anthropic", String.raw`C:\Users\O'Neil\x`)).toContain(String.raw`'C:\Users\O''Neil\x'`);
  });

  it("uses no POSIX shell syntax", () => {
    for (const provider of ["openai", "anthropic", "xai"]) {
      const command = windowsLocalLoginCommand(provider, home);
      expect(command).not.toMatch(/\bexport\b|mkdir -p|\$[A-Z_]+[^:]|&&/);
    }
  });
});

describe("readWindowsCredentialFile", () => {
  let dir = "";
  beforeAll(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "ppclip-cred-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads a small credential file", async () => {
    const file = path.join(dir, ".credentials.json");
    await writeFile(file, JSON.stringify({ claudeAiOauth: { accessToken: "token" } }));
    expect(JSON.parse(await readWindowsCredentialFile(file)).claudeAiOauth.accessToken).toBe("token");
  });

  it("rejects directories and oversized files", async () => {
    await expect(readWindowsCredentialFile(dir)).rejects.toThrow();
    const big = path.join(dir, "big.json");
    await writeFile(big, "x".repeat(64 * 1024 + 1));
    await expect(readWindowsCredentialFile(big)).rejects.toThrow("Invalid credential file");
  });
});
