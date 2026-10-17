/**
 * ppclip computer use: the provider boundary used by the computer supervisor.
 * Providers: "docker" (default, local containers), "fake" (in-memory, tests).
 * A remote provider (E2B or similar) can implement the same interface.
 */

export type ComputerSpec = {
  agentId: string;
  companyId: string;
  shell: boolean;
  allowedHosts: string[];
};

export type ComputerInfo = {
  agentId: string;
  running: boolean;
  paused: boolean;
  /** True when a saved browser profile was found (logins survive). */
  profileKept: boolean;
};

export type ProviderInfo = {
  kind: "docker" | "fake" | "remote";
  isolation: string;
  caveats: string[];
  liveView: boolean;
};

export type Observation = {
  frameId: string;
  width: number;
  height: number;
  /** PNG, base64. */
  png: string;
  url: string | null;
  title: string | null;
};

export type ComputerAction =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; x: number; y: number; toX: number; toY: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "wait"; ms: number };

export type ActOptions = {
  /** Agent explicitly confirmed an irreversible-looking click. */
  confirm: boolean;
  /** Regex source; clicks whose target label matches need `confirm`. */
  irreversiblePattern: string;
  allowedHosts: string[];
};

type RefusalCode = "sensitive_field" | "needs_confirm" | "blocked_url" | "stale_ref" | "not_running" | "invalid";

export type ActResult =
  | { ok: true; done: number }
  | { ok: false; code: RefusalCode; message: string; done: number };

export type PageElement = {
  ref: number;
  tag: string;
  role: string | null;
  name: string;
  inputType: string | null;
  sensitive: boolean;
  irreversible: boolean;
};

export type PageSnapshot = {
  url: string | null;
  title: string | null;
  text: string;
  elements: PageElement[];
  /** Screenshot with numbered element badges (Set-of-Mark), when requested. PNG, base64. */
  marksPng?: string;
};

export type PageAction =
  | { type: "click"; ref: number }
  | { type: "type"; ref: number; text: string; submit?: boolean }
  | { type: "navigate"; url: string }
  | { type: "back" };

export type StreamUpstream = { host: string; port: number; token: string };

export interface ComputerProvider {
  describe(): ProviderInfo;
  ensure(spec: ComputerSpec): Promise<ComputerInfo>;
  inspect(agentId: string): Promise<ComputerInfo | null>;
  stop(agentId: string): Promise<void>;
  destroy(agentId: string, opts: { purgeProfile: boolean }): Promise<void>;
  observe(agentId: string): Promise<Observation>;
  act(agentId: string, actions: ComputerAction[], opts: ActOptions): Promise<ActResult>;
  page(agentId: string, opts: { marks: boolean }): Promise<PageSnapshot>;
  pageAct(agentId: string, action: PageAction, opts: ActOptions): Promise<ActResult>;
  /** Starts (true) or kills (false) the interactive stream listener. View-only is always available. */
  setControl(agentId: string, interactive: boolean): Promise<void>;
  freeze(agentId: string): Promise<void>;
  thaw(agentId: string): Promise<void>;
  shell(agentId: string, command: string, timeoutMs: number): Promise<{ exitCode: number; output: string }>;
  /** Where the noVNC/websockify gateway for this computer is, plus the sandbox-side token for the mode. */
  streamUpstream(agentId: string, mode: "view" | "control"): Promise<StreamUpstream | null>;
}

export class ProviderError extends Error {
  constructor(readonly code: RefusalCode | "unavailable" | "limit", message: string, readonly status = 409) {
    super(message);
  }
}

const KEY_RE = /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/;

/** Validates and clamps an untrusted action list. Throws ProviderError("invalid"). */
export function parseActions(input: unknown, screen = { width: 1280, height: 800 }, max = 16): ComputerAction[] {
  if (!Array.isArray(input) || input.length === 0) throw new ProviderError("invalid", "actions must be a non-empty list", 400);
  if (input.length > max) throw new ProviderError("invalid", `at most ${max} actions per call`, 400);
  const coord = (v: unknown, limit: number) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ProviderError("invalid", "coordinates must be numbers", 400);
    return Math.min(limit - 1, Math.max(0, Math.round(v)));
  };
  return input.map((raw): ComputerAction => {
    const a = (raw ?? {}) as Record<string, unknown>;
    switch (a.type) {
      case "click": {
        const button = a.button === "right" || a.button === "middle" ? a.button : "left";
        return { type: "click", x: coord(a.x, screen.width), y: coord(a.y, screen.height), button, double: a.double === true };
      }
      case "move":
        return { type: "move", x: coord(a.x, screen.width), y: coord(a.y, screen.height) };
      case "drag":
        return { type: "drag", x: coord(a.x, screen.width), y: coord(a.y, screen.height), toX: coord(a.toX, screen.width), toY: coord(a.toY, screen.height) };
      case "type":
        if (typeof a.text !== "string" || a.text.length === 0 || a.text.length > 2000) throw new ProviderError("invalid", "type.text must be 1-2000 characters", 400);
        return { type: "type", text: a.text };
      case "key":
        if (typeof a.key !== "string" || !KEY_RE.test(a.key) || a.key.length > 40) throw new ProviderError("invalid", "key must look like Return, ctrl+l or shift+Tab", 400);
        return { type: "key", key: a.key };
      case "scroll": {
        const direction = ["up", "down", "left", "right"].includes(a.direction as string) ? (a.direction as "up") : "down";
        const amount = typeof a.amount === "number" ? Math.min(20, Math.max(1, Math.round(a.amount))) : 3;
        return { type: "scroll", x: coord(a.x, screen.width), y: coord(a.y, screen.height), direction, amount };
      }
      case "wait": {
        const ms = typeof a.ms === "number" ? Math.min(5000, Math.max(50, Math.round(a.ms))) : 500;
        return { type: "wait", ms };
      }
      default:
        throw new ProviderError("invalid", `unknown action type ${String(a.type)}`, 400);
    }
  });
}
