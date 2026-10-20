import { DEFAULT_SUPERVISOR_PORT, defaultTokenFile, ensureToken } from "./config.js";
import { DockerComputerProvider } from "./docker-provider.js";
import { FakeComputerProvider } from "./fake-provider.js";
import type { ComputerProvider } from "./provider.js";
import { createSupervisorServer } from "./server.js";

/** Entry point; started by scripts/ppclip/computer-supervisor.mjs. */
const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : fallback;
};

async function main() {
  const kind = arg("--provider", process.env.PPCLIP_COMPUTER_PROVIDER ?? "docker");
  const desktopDriver = arg("--desktop-driver", "atspi");
  if (desktopDriver !== "atspi" && desktopDriver !== "cua") throw new Error("Desktop driver must be atspi or cua");
  let provider: ComputerProvider;
  if (kind === "fake") provider = new FakeComputerProvider();
  else if (kind === "docker") {
    provider = new DockerComputerProvider({
      memoryMb: Number(arg("--memory-mb", "2048")),
      cpus: Number(arg("--cpus", "2")),
      maxRunning: Number(arg("--max-running", "3")),
      desktopDriver,
    });
  } else throw new Error(`Unknown provider ${kind}. Use docker or fake.`);
  const tokenFile = arg("--token-file", defaultTokenFile())!;
  const supervisor = createSupervisorServer({
    provider,
    token: ensureToken(tokenFile),
    host: arg("--host", "127.0.0.1"),
    port: Number(arg("--port", String(DEFAULT_SUPERVISOR_PORT))),
    allowRemote: process.argv.includes("--allow-remote"),
  });
  const port = await supervisor.listen();
  console.log(`ppclip computer supervisor (${kind}) on http://${arg("--host", "127.0.0.1")}:${port}`);
  console.log(`token file: ${tokenFile}`);
  const shutdown = () => { void supervisor.close().then(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && /supervisor[\\/]main\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
