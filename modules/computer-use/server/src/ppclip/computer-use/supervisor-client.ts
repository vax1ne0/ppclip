import type { ActOptions, ActResult, ComputerAction, ComputerInfo, Observation, PageAction, PageSnapshot, ProviderInfo } from "./supervisor/provider.js";
import { defaultSupervisorUrl, readAnyToken } from "./supervisor/config.js";

export class SupervisorError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export type SupervisorHealth = { ok: true; provider: ProviderInfo } | { ok: false; error: string };

/** What Paperclip needs from the computer supervisor. */
export interface SupervisorClient {
  health(): Promise<SupervisorHealth>;
  ensure(agentId: string, spec: { companyId: string; shell: boolean; allowedHosts: string[] }): Promise<ComputerInfo>;
  inspect(agentId: string): Promise<ComputerInfo | null>;
  stop(agentId: string): Promise<void>;
  destroy(agentId: string, purgeProfile: boolean): Promise<void>;
  freeze(agentId: string): Promise<void>;
  thaw(agentId: string): Promise<void>;
  observe(agentId: string): Promise<Observation>;
  act(agentId: string, actions: ComputerAction[], opts: ActOptions): Promise<ActResult>;
  page(agentId: string, opts: { marks: boolean }): Promise<PageSnapshot>;
  pageAct(agentId: string, action: PageAction, opts: ActOptions): Promise<ActResult>;
  desktop?(agentId: string, opts: ActOptions): Promise<PageSnapshot>;
  desktopAct?(agentId: string, action: PageAction, opts: ActOptions): Promise<ActResult>;
  setControl(agentId: string, interactive: boolean): Promise<void>;
  shell(agentId: string, command: string, timeoutMs: number): Promise<{ exitCode: number; output: string }>;
  /** GET a noVNC file through the supervisor. */
  streamFile(agentId: string, mode: "view" | "control", file: string, search: string): Promise<Response>;
  /** Where to open the websockify WebSocket, with the auth header to send. */
  streamSocket(agentId: string, mode: "view" | "control"): { url: string; headers: Record<string, string> } | null;
}

/** HTTP client. The token is read from the supervisor's token file on each call (it may appear after Paperclip starts). */
export function httpSupervisorClient(opts: { url?: string; token?: () => string | null } = {}): SupervisorClient {
  const base = (opts.url ?? defaultSupervisorUrl()).replace(/\/+$/, "");
  const token = opts.token ?? (() => process.env.PPCLIP_COMPUTER_SUPERVISOR_TOKEN ?? readAnyToken().token);

  function auth() {
    const value = token();
    if (!value) {
      throw new SupervisorError("unavailable", `The computer supervisor isn't running (no token found at ${readAnyToken().looked.join(" or ")}). Start it with: node scripts/ppclip/computer-supervisor.mjs, or start Paperclip with start-local.mjs --with-computer.`, 503);
    }
    return { authorization: `Bearer ${value}` };
  }

  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { ...auth(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof SupervisorError) throw err;
      throw new SupervisorError("unavailable", `The computer supervisor is not reachable at ${base}. Is it running?`, 503);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) throw new SupervisorError(json.code ?? "error", json.error ?? `supervisor error ${res.status}`, res.status);
    return json;
  }

  const path = (agentId: string, rest = "") => `/computers/${encodeURIComponent(agentId)}${rest}`;

  return {
    async health() {
      try {
        const res = await call<{ ok: true; provider: ProviderInfo }>("GET", "/health", undefined, 3000);
        return { ok: true, provider: res.provider };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "unreachable" };
      }
    },
    ensure: (agentId, spec) => call("POST", path(agentId, "/ensure"), spec, 120_000),
    inspect: async (agentId) => (await call<{ computer: ComputerInfo | null }>("GET", path(agentId))).computer,
    stop: async (agentId) => { await call("POST", path(agentId, "/stop")); },
    destroy: async (agentId, purgeProfile) => { await call("DELETE", path(agentId, purgeProfile ? "?purgeProfile=1" : "")); },
    freeze: async (agentId) => { await call("POST", path(agentId, "/freeze")); },
    thaw: async (agentId) => { await call("POST", path(agentId, "/thaw")); },
    observe: (agentId) => call("POST", path(agentId, "/observe")),
    act: (agentId, actions, o) => call("POST", path(agentId, "/act"), { actions, ...o }),
    page: (agentId, o) => call("POST", path(agentId, "/page"), o),
    pageAct: (agentId, action, o) => call("POST", path(agentId, "/page/act"), { action, ...o }),
    desktop: (agentId, o) => call("POST", path(agentId, "/desktop"), o),
    desktopAct: (agentId, action, o) => call("POST", path(agentId, "/desktop/act"), { action, ...o }),
    setControl: async (agentId, interactive) => { await call("POST", path(agentId, "/control"), { interactive }); },
    shell: (agentId, command, timeoutMs) => call("POST", path(agentId, "/shell"), { command, timeoutMs }, timeoutMs + 10_000),
    async streamFile(agentId, mode, file, search) {
      return fetch(`${base}${path(agentId, `/stream/${mode}/${file}`)}${search}`, { headers: auth(), signal: AbortSignal.timeout(15_000) });
    },
    streamSocket(agentId, mode) {
      const value = token();
      if (!value) return null;
      return { url: `${base.replace(/^http/, "ws")}${path(agentId, `/stream/${mode}/websockify`)}`, headers: { authorization: `Bearer ${value}` } };
    },
  };
}
