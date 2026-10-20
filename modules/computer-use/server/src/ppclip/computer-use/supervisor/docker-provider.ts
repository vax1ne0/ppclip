import { randomBytes } from "node:crypto";
import { DockerApi, DockerApiError } from "./docker-api.js";
import { readScreenFile } from "./screen-http.js";
import {
  ProviderError,
  type ActOptions,
  type ActResult,
  type ComputerAction,
  type ComputerInfo,
  type ComputerProvider,
  type ComputerSpec,
  type Observation,
  type PageAction,
  type PageSnapshot,
  type ProviderInfo,
  type StreamUpstream,
} from "./provider.js";

const DEFAULT_IMAGE = "ppclip-computer:1";
const LABEL = "ppclip.computer";

type DockerProviderOptions = {
  image?: string;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  maxRunning?: number;
  docker?: DockerApi;
  desktopDriver?: "atspi" | "cua";
};

type Endpoint = { host: string; controlPort: number; streamPort: number; token: string };

function safeId(agentId: string) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(agentId)) throw new ProviderError("invalid", "invalid agent id", 400);
  return agentId.toLowerCase();
}

/**
 * Docker provider: one hardened container per agent, one bridge network per
 * agent, and one named volume per agent for the home folder (browser profile).
 * Ports are published to 127.0.0.1 only. gVisor (runsc) is used when installed.
 */
export class DockerComputerProvider implements ComputerProvider {
  private readonly docker: DockerApi;
  private readonly image: string;
  private readonly memoryBytes: number;
  private readonly nanoCpus: number;
  private readonly pidsLimit: number;
  private readonly maxRunning: number;
  private runtime: string | null | undefined;
  private readonly desktopDriver: "atspi" | "cua";
  /** websockify tokens set in each sandbox (lost on restart; re-issued on demand). */
  private readonly streamTokens = new Map<string, { view?: string; control?: string }>();
  private readonly streamGenerations = new Map<string, string>();

  constructor(opts: DockerProviderOptions = {}) {
    this.docker = opts.docker ?? new DockerApi();
    this.image = opts.image ?? process.env.PPCLIP_COMPUTER_IMAGE ?? DEFAULT_IMAGE;
    this.memoryBytes = (opts.memoryMb ?? 2048) * 1024 * 1024;
    this.nanoCpus = Math.round((opts.cpus ?? 2) * 1e9);
    this.pidsLimit = opts.pidsLimit ?? 1024;
    this.maxRunning = opts.maxRunning ?? 3;
    this.desktopDriver = opts.desktopDriver ?? "atspi";
  }

  describe(): ProviderInfo {
    return {
      kind: "docker",
      isolation: this.runtime === "runsc" ? "Docker container with gVisor (runsc)" : "Docker container (shares the host kernel)",
      caveats: [
        "A container is not a virtual machine: it shares the host kernel. gVisor narrows this when installed (Linux only).",
        "Chromium probes sandbox support at startup; the container remains the outer security boundary.",
        "Shell, when enabled for an agent, runs inside the container only, as an unprivileged user.",
      ],
      liveView: true,
    };
  }

  async health() {
    await this.docker.request("GET", "/version", undefined, 3000);
  }

  private names(agentId: string) {
    const id = safeId(agentId);
    return { container: `ppclip-computer-${id}`, network: `ppclip-computer-net-${id}`, volume: `ppclip-computer-home-${id}` };
  }

  private async detectRuntime() {
    if (this.runtime !== undefined) return this.runtime;
    const info = await this.docker.request<{ Runtimes?: Record<string, unknown> }>("GET", "/info");
    this.runtime = info?.Runtimes && "runsc" in info.Runtimes ? "runsc" : null;
    return this.runtime;
  }

  private async inspectContainer(agentId: string) {
    const { container } = this.names(agentId);
    return this.docker.tolerate(this.docker.request<{
      State: { Running: boolean; Paused: boolean; StartedAt?: string };
      Config: { Labels: Record<string, string> };
      NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
    }>("GET", `/containers/${container}/json`), [404]);
  }

  private async endpoint(agentId: string): Promise<Endpoint> {
    const info = await this.inspectContainer(agentId);
    if (!info?.State.Running) throw new ProviderError("not_running", "The computer is not running.");
    if (info.State.Paused) throw new ProviderError("unavailable", "The computer is paused. Resume it or take control to open the live view.");
    const generation = info.State.StartedAt;
    if (generation && this.streamGenerations.get(agentId) !== generation) {
      this.streamTokens.delete(agentId);
      this.streamGenerations.set(agentId, generation);
    }
    const port = (name: string) => Number(info.NetworkSettings.Ports[name]?.find((p) => p.HostIp === "127.0.0.1")?.HostPort ?? 0);
    const controlPort = port("7070/tcp");
    const streamPort = port("6080/tcp");
    const token = info.Config.Labels["ppclip.controlToken"];
    if (!controlPort || !streamPort || !token) throw new ProviderError("unavailable", "The computer's ports are not published on 127.0.0.1.");
    return { host: "127.0.0.1", controlPort, streamPort, token };
  }

  /** Calls the in-sandbox control daemon. */
  private async daemon<T>(agentId: string, path: string, body: unknown = {}, timeoutMs = 30_000): Promise<T> {
    const ep = await this.endpoint(agentId);
    const res = await fetch(`http://${ep.host}:${ep.controlPort}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${ep.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((err: Error) => { throw new ProviderError("unavailable", `The computer did not answer (${err.message}).`); });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) throw new ProviderError((json.code as ProviderError["code"]) ?? "unavailable", json.error ?? `sandbox error ${res.status}`, res.status === 400 ? 400 : 409);
    return json;
  }

  async ensure(spec: ComputerSpec): Promise<ComputerInfo> {
    const profileLock = await this.docker.tolerate(this.docker.request("GET", `/containers/ppclip-profile-lock-${safeId(spec.agentId)}/json`), [404]);
    if (profileLock) throw new ProviderError("unavailable", "This computer's profile is being backed up or restored. Try again when the operation finishes.");
    const { container, network, volume } = this.names(spec.agentId);
    const existing = await this.inspectContainer(spec.agentId);
    const volumeBefore = await this.docker.tolerate(this.docker.request("GET", `/volumes/${volume}`), [404]);
    const wantedHosts = spec.allowedHosts.join(",");
    const image = await this.docker.tolerate(this.docker.request<{ Config?: { Labels?: Record<string, string> } }>("GET", `/images/${encodeURIComponent(this.image)}/json`), [404]);
    if (image?.Config?.Labels?.["ppclip.sandbox-policy"] !== "2") throw new ProviderError("unavailable", "Rebuild the computer image to enable the current network policy: node scripts/ppclip/computer-supervisor.mjs build-image");
    if (this.desktopDriver === "cua" && image.Config?.Labels?.["ppclip.cua-driver"] !== "1") throw new ProviderError("unavailable", "Build the optional CUA image first: node scripts/ppclip/computer-supervisor.mjs build-image --with-cua");
    const recreate = existing && (existing.Config.Labels["ppclip.networkPolicy"] !== "2" || existing.Config.Labels["ppclip.desktopDriver"] !== this.desktopDriver || existing.Config.Labels["ppclip.shell"] !== String(spec.shell) || (existing.Config.Labels["ppclip.allowedHosts"] ?? "") !== wantedHosts);
    if (existing && recreate) {
      await this.docker.tolerate(this.docker.request("DELETE", `/containers/${container}?force=true`), [404]);
    }
    if (!existing || recreate) {
      const running = await this.docker.request<unknown[]>("GET", `/containers/json?filters=${encodeURIComponent(JSON.stringify({ label: [`${LABEL}=1`] }))}`);
      if (running.length >= this.maxRunning) throw new ProviderError("limit", `At most ${this.maxRunning} computers can run at once. Stop one first.`);
      const labels = { [LABEL]: "1", "ppclip.agentId": spec.agentId, "ppclip.companyId": spec.companyId };
      await this.docker.tolerate(this.docker.request("POST", "/volumes/create", { Name: volume, Labels: labels }), [409]);
      await this.docker.tolerate(this.docker.request("POST", "/networks/create", { Name: network, Driver: "bridge", Labels: labels }), [409]);
      const runtime = await this.detectRuntime();
      const token = randomBytes(24).toString("hex");
      await this.docker.request("POST", `/containers/create?name=${container}`, {
        Image: this.image,
        // NET_ADMIN/SETPCAP are bootstrap-only; start.sh removes both before
        // starting PID 1 and the desktop/shell services.
        User: "0:0",
        Env: [
          `PPCLIP_CONTROL_TOKEN=${token}`,
          `PPCLIP_SHELL=${spec.shell ? "1" : "0"}`,
          `PPCLIP_ALLOWED_HOSTS=${wantedHosts}`,
          `PPCLIP_DESKTOP_DRIVER=${this.desktopDriver}`,
          `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        ],
        Labels: { ...labels, "ppclip.networkPolicy": "2", "ppclip.desktopDriver": this.desktopDriver, "ppclip.controlToken": token, "ppclip.shell": String(spec.shell), "ppclip.allowedHosts": wantedHosts },
        ExposedPorts: { "7070/tcp": {}, "6080/tcp": {} },
        HostConfig: {
          Mounts: [{ Type: "volume", Source: volume, Target: "/home/agent" }],
          PortBindings: { "7070/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }], "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] },
          NetworkMode: network,
          CapDrop: ["ALL"],
          CapAdd: ["SETUID", "SETGID", "KILL", "NET_ADMIN", "SETPCAP"],
          SecurityOpt: ["no-new-privileges:true"],
          Memory: this.memoryBytes,
          MemorySwap: this.memoryBytes,
          NanoCpus: this.nanoCpus,
          PidsLimit: this.pidsLimit,
          // Chromium needs more than Docker's 64 MiB default: half of memory, at most 2 GiB.
          ShmSize: Math.min(2 * 1024 ** 3, Math.max(256 * 1024 ** 2, Math.floor(this.memoryBytes / 2))),
          Init: true,
          RestartPolicy: { Name: "no" },
          ...(runtime ? { Runtime: runtime } : {}),
        },
      }).catch((err: unknown) => {
        if (err instanceof DockerApiError && err.status === 404) {
          throw new ProviderError("unavailable", `The image ${this.image} is missing. Build it with: node scripts/ppclip/computer-supervisor.mjs build-image`);
        }
        throw err;
      });
    }
    const after = await this.inspectContainer(spec.agentId);
    if (after?.State.Paused) await this.docker.request("POST", `/containers/${container}/unpause`);
    if (!after?.State.Running) await this.docker.request("POST", `/containers/${container}/start`);
    this.streamTokens.delete(spec.agentId);
    await this.waitHealthy(spec.agentId);
    const recovery = recreate ? "recreated" : !existing ? "created" : after?.State.Paused ? "resumed" : !after?.State.Running ? "started" : "reconnected";
    return { agentId: spec.agentId, running: true, paused: false, profileKept: Boolean(volumeBefore), recovery };
  }

  private async waitHealthy(agentId: string) {
    const deadline = Date.now() + 45_000;
    let last = "";
    while (Date.now() < deadline) {
      try {
        await this.daemon(agentId, "/health", {}, 3000);
        // The control daemon can be healthy before websockify is listening.
        // Probe only during start/resume, not on recurring overview requests.
        const ep = await this.endpoint(agentId);
        const screen = await readScreenFile(() => `http://${ep.host}:${ep.streamPort}/vnc_lite.html`, 1);
        if (screen.status !== 200) throw new ProviderError("unavailable", "The live screen is still starting.");
        return;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
        await new Promise((r) => setTimeout(r, 750));
      }
    }
    throw new ProviderError("unavailable", `The computer did not become ready: ${last}`);
  }

  async inspect(agentId: string): Promise<ComputerInfo | null> {
    const info = await this.inspectContainer(agentId);
    const volume = await this.docker.tolerate(this.docker.request("GET", `/volumes/${this.names(agentId).volume}`), [404]);
    if (!info) return volume ? { agentId, running: false, paused: false, profileKept: true } : null;
    const healthy = info.State.Running && !info.State.Paused
      ? await this.daemon(agentId, "/health", {}, 3000).then(() => true, () => false) : undefined;
    return { agentId, running: info.State.Running, paused: info.State.Paused, profileKept: Boolean(volume), healthy };
  }

  async stop(agentId: string) {
    const { container } = this.names(agentId);
    const info = await this.inspectContainer(agentId);
    if (info?.State.Paused) await this.docker.tolerate(this.docker.request("POST", `/containers/${container}/unpause`), [404, 409]);
    await this.docker.tolerate(this.docker.request("POST", `/containers/${container}/stop?t=5`), [304, 404]);
    this.streamTokens.delete(agentId);
    this.streamGenerations.delete(agentId);
  }

  async destroy(agentId: string, opts: { purgeProfile: boolean }) {
    const { container, network, volume } = this.names(agentId);
    await this.docker.tolerate(this.docker.request("DELETE", `/containers/${container}?force=true`), [404]);
    await this.docker.tolerate(this.docker.request("DELETE", `/networks/${network}`), [404]);
    if (opts.purgeProfile) await this.docker.tolerate(this.docker.request("DELETE", `/volumes/${volume}`), [404]);
    this.streamTokens.delete(agentId);
    this.streamGenerations.delete(agentId);
  }

  observe(agentId: string) {
    return this.daemon<Observation>(agentId, "/observe");
  }

  act(agentId: string, actions: ComputerAction[], opts: ActOptions) {
    return this.daemon<ActResult>(agentId, "/act", { actions, confirm: opts.confirm, irreversiblePattern: opts.irreversiblePattern }, 60_000);
  }

  page(agentId: string, opts: { marks: boolean }) {
    return this.daemon<PageSnapshot>(agentId, "/page", opts);
  }

  pageAct(agentId: string, action: PageAction, opts: ActOptions) {
    return this.daemon<ActResult>(agentId, "/page/act", { action, confirm: opts.confirm, irreversiblePattern: opts.irreversiblePattern }, 60_000);
  }

  desktop(agentId: string, opts: ActOptions) {
    return this.daemon<PageSnapshot>(agentId, "/desktop", opts, 8000);
  }

  desktopAct(agentId: string, action: PageAction, opts: ActOptions) {
    // Native observation plus up to 2000 characters of paced input can exceed 15s.
    return this.daemon<ActResult>(agentId, "/desktop/act", { action, ...opts }, 45_000);
  }

  async setControl(agentId: string, interactive: boolean) {
    if (interactive) {
      await this.endpoint(agentId); // A container restart invalidates cached control tokens.
      if (this.streamTokens.get(agentId)?.control) return;
      const token = randomBytes(18).toString("hex");
      await this.daemon(agentId, "/stream/control", { token });
      this.streamTokens.set(agentId, { ...this.streamTokens.get(agentId), control: token });
    } else {
      // Revocation: the sandbox deletes the token and kills the interactive listener.
      await this.daemon(agentId, "/stream/control", { token: null }).catch((err) => {
        if (!(err instanceof ProviderError && err.code === "not_running")) throw err;
      });
      this.streamTokens.set(agentId, { view: this.streamTokens.get(agentId)?.view });
    }
  }

  async freeze(agentId: string) {
    await this.docker.request("POST", `/containers/${this.names(agentId).container}/pause`);
  }

  async thaw(agentId: string) {
    await this.docker.tolerate(this.docker.request("POST", `/containers/${this.names(agentId).container}/unpause`), [409]);
    // Docker Desktop can republish dynamic ports after acknowledging unpause.
    await this.waitHealthy(agentId);
  }

  shell(agentId: string, command: string, timeoutMs: number) {
    return this.daemon<{ exitCode: number; output: string }>(agentId, "/shell", { command, timeoutMs }, timeoutMs + 5000);
  }

  async streamUpstream(agentId: string, mode: "view" | "control"): Promise<StreamUpstream | null> {
    const ep = await this.endpoint(agentId);
    const tokens = this.streamTokens.get(agentId) ?? {};
    if (mode === "control") return tokens.control ? { host: ep.host, port: ep.streamPort, token: tokens.control } : null;
    if (!tokens.view) {
      const token = randomBytes(18).toString("hex");
      await this.daemon(agentId, "/stream/view", { token });
      tokens.view = token;
      this.streamTokens.set(agentId, { ...this.streamTokens.get(agentId), view: token });
    }
    return { host: ep.host, port: ep.streamPort, token: tokens.view };
  }
}
