import { parseObject as asRecord } from "@paperclipai/adapter-utils/server-utils";
/**
 * ppclip computer use: the per-agent control state machine (pure, no I/O).
 *
 * State lives in the agent's existing metadata JSON (`metadata.computerUse`),
 * so there is no migration. Only the board computer-use endpoints and the
 * computer-use service write it; ordinary agent PATCHes and hires cannot (see
 * preserveComputerUseMetadata / stripComputerUseMetadata).
 *
 *   off/stopped ──start──► starting ──ready──► agent
 *   agent ──request_takeover (agent)──► waiting_for_human
 *   agent | waiting_for_human | paused ──take_control (operator)──► human | human_private
 *   human | human_private ──release (operator only)──► agent
 *   agent | waiting_for_human | human | human_private ──pause──► paused ──resume──► agent
 *   human | human_private ──lease_expired (system)──► paused
 *   any (not revoked) ──stop──► stopped;  any ──revoke──► revoked ──restore──► stopped
 *
 * Every transition bumps `epoch`. Observations carry the epoch they were taken
 * in, and an agent action that cites an older epoch is refused, so the agent
 * must look again after any change of control.
 */

const COMPUTER_USE_METADATA_KEY = "computerUse";

const COMPUTER_STATES = [
  "off",
  "starting",
  "agent",
  "waiting_for_human",
  "human",
  "human_private",
  "paused",
  "stopped",
  "revoked",
] as const;
export type ComputerState = (typeof COMPUTER_STATES)[number];

export type ComputerEvent =
  | "start"
  | "ready"
  | "fail"
  | "request_takeover"
  | "take_control"
  | "take_control_private"
  | "release"
  | "pause"
  | "resume"
  | "lease_expired"
  | "stop"
  | "revoke"
  | "restore"
  | "recovery_pause";

export type ComputerActorKind = "operator" | "agent" | "system";

export type ControlLease = {
  holderUserId: string;
  private: boolean;
  grantedAt: string;
  expiresAt: string;
};

type TakeoverRequest = { reason: string; at: string; runId?: string | null };

export type ComputerUseMeta = {
  /** Per-agent opt-in. Off unless an operator turns it on. */
  enabled: boolean;
  state: ComputerState;
  epoch: number;
  lease: ControlLease | null;
  request: TakeoverRequest | null;
  /** Shell inside the sandbox. Off by default. Never runs on the host. */
  shell: boolean;
  /** Optional hostname allowlist for the sandbox browser (empty = any public site). */
  allowedHosts: string[];
  lastActivityAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Rule = { from: readonly ComputerState[] | "any_but_revoked" | "any"; to: ComputerState; by: readonly ComputerActorKind[] };

/** Who may trigger what. This table is the contract shown in the README. */
const TRANSITIONS: Record<ComputerEvent, Rule> = {
  start: { from: ["off", "stopped"], to: "starting", by: ["operator", "agent", "system"] },
  ready: { from: ["starting"], to: "agent", by: ["system"] },
  fail: { from: ["starting"], to: "stopped", by: ["system"] },
  request_takeover: { from: ["agent"], to: "waiting_for_human", by: ["agent"] },
  take_control: { from: ["agent", "waiting_for_human", "paused"], to: "human", by: ["operator"] },
  take_control_private: { from: ["agent", "waiting_for_human", "paused", "human"], to: "human_private", by: ["operator"] },
  release: { from: ["human", "human_private"], to: "agent", by: ["operator"] },
  pause: { from: ["agent", "waiting_for_human", "human", "human_private"], to: "paused", by: ["operator"] },
  resume: { from: ["paused"], to: "agent", by: ["operator"] },
  recovery_pause: { from: ["starting", "agent", "waiting_for_human", "human", "human_private"], to: "paused", by: ["system"] },
  lease_expired: { from: ["human", "human_private"], to: "paused", by: ["system"] },
  stop: { from: "any_but_revoked", to: "stopped", by: ["operator", "system"] },
  revoke: { from: "any", to: "revoked", by: ["operator"] },
  restore: { from: ["revoked"], to: "stopped", by: ["operator"] },
};

export class ComputerTransitionError extends Error {
  constructor(readonly code: "not_allowed" | "invalid_state", message: string) {
    super(message);
  }
}

export function canTransition(state: ComputerState, event: ComputerEvent, by: ComputerActorKind) {
  const rule = TRANSITIONS[event];
  if (!rule.by.includes(by)) return false;
  if (rule.from === "any") return true;
  if (rule.from === "any_but_revoked") return state !== "revoked";
  return rule.from.includes(state);
}

/** Applies one event. Throws ComputerTransitionError when the actor or state does not allow it. */
export function applyTransition(
  meta: ComputerUseMeta,
  event: ComputerEvent,
  by: ComputerActorKind,
  extra: { now: Date; actorId: string; lease?: ControlLease | null; request?: TakeoverRequest | null },
): ComputerUseMeta {
  const rule = TRANSITIONS[event];
  if (!rule.by.includes(by)) {
    throw new ComputerTransitionError("not_allowed", `${by === "agent" ? "An agent" : by === "system" ? "The system" : "An operator"} cannot ${eventWords(event)}.`);
  }
  if (!canTransition(meta.state, event, by)) {
    throw new ComputerTransitionError("invalid_state", `Cannot ${eventWords(event)} while the computer is ${stateWords(meta.state)}.`);
  }
  const to = rule.to;
  const holdsControl = to === "human" || to === "human_private";
  return {
    ...meta,
    state: to,
    epoch: meta.epoch + 1,
    lease: holdsControl ? (extra.lease ?? meta.lease) : null,
    request: to === "waiting_for_human" ? (extra.request ?? meta.request) : holdsControl ? meta.request : null,
    updatedAt: extra.now.toISOString(),
    updatedBy: extra.actorId,
  };
}

/** The agent may act (click, type, navigate, shell) only in `agent`. */
export function agentMayAct(state: ComputerState) {
  return state === "agent";
}

/** The agent may look at the screen unless the human asked for privacy, or it is paused or not running. */
export function agentMayObserve(state: ComputerState) {
  return state === "agent" || state === "waiting_for_human" || state === "human";
}

/** States in which a sandbox should be running. */
export function isLive(state: ComputerState) {
  return state !== "off" && state !== "stopped" && state !== "revoked";
}

export function stateWords(state: ComputerState) {
  switch (state) {
    case "off": return "off";
    case "starting": return "starting";
    case "agent": return "driven by the agent";
    case "waiting_for_human": return "waiting for a person";
    case "human": return "controlled by a person";
    case "human_private": return "controlled by a person in private mode";
    case "paused": return "paused";
    case "stopped": return "stopped";
    case "revoked": return "revoked";
  }
}

function eventWords(event: ComputerEvent) {
  switch (event) {
    case "start": return "start the computer";
    case "ready": return "mark the computer ready";
    case "fail": return "mark the computer failed";
    case "request_takeover": return "ask for a person";
    case "take_control": return "take control";
    case "take_control_private": return "take control privately";
    case "release": return "release control";
    case "pause": return "pause";
    case "resume": return "resume";
    case "lease_expired": return "expire control";
    case "stop": return "stop the computer";
    case "revoke": return "revoke access";
    case "restore": return "restore access";
    case "recovery_pause": return "pause during recovery";
  }
}

type JsonRecord = Record<string, unknown>;

export function defaultComputerUse(): ComputerUseMeta {
  return {
    enabled: false,
    state: "off",
    epoch: 0,
    lease: null,
    request: null,
    shell: false,
    allowedHosts: [],
    lastActivityAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

/** Reads `metadata.computerUse`, tolerating missing or malformed values. */
export function readComputerUse(metadata: unknown): ComputerUseMeta {
  const raw = asRecord(asRecord(metadata)[COMPUTER_USE_METADATA_KEY]);
  const base = defaultComputerUse();
  const state = COMPUTER_STATES.includes(raw.state as ComputerState) ? (raw.state as ComputerState) : base.state;
  const lease = asRecord(raw.lease);
  const request = asRecord(raw.request);
  return {
    enabled: raw.enabled === true,
    state,
    epoch: typeof raw.epoch === "number" && Number.isFinite(raw.epoch) ? Math.max(0, Math.floor(raw.epoch)) : 0,
    lease: typeof lease.holderUserId === "string" && typeof lease.expiresAt === "string"
      ? { holderUserId: lease.holderUserId, private: lease.private === true, grantedAt: String(lease.grantedAt ?? ""), expiresAt: lease.expiresAt }
      : null,
    request: typeof request.reason === "string" && typeof request.at === "string"
      ? { reason: request.reason, at: request.at, runId: typeof request.runId === "string" ? request.runId : null }
      : null,
    shell: raw.shell === true,
    allowedHosts: Array.isArray(raw.allowedHosts) ? raw.allowedHosts.filter((h): h is string => typeof h === "string").slice(0, 50) : [],
    lastActivityAt: typeof raw.lastActivityAt === "string" ? raw.lastActivityAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

export function withComputerUse(metadata: unknown, meta: ComputerUseMeta): JsonRecord {
  return { ...asRecord(metadata), [COMPUTER_USE_METADATA_KEY]: meta };
}

/** Agent PATCHes keep the stored computer-use record; callers cannot set or clear it. */
export function preserveComputerUseMetadata(existing: unknown, next: unknown): JsonRecord | null {
  const stored = asRecord(existing);
  const has = Object.prototype.hasOwnProperty.call(stored, COMPUTER_USE_METADATA_KEY);
  if (next === null && !has) return null;
  const result = { ...asRecord(next) };
  delete result[COMPUTER_USE_METADATA_KEY];
  if (has) result[COMPUTER_USE_METADATA_KEY] = stored[COMPUTER_USE_METADATA_KEY];
  return result;
}

/** New agents (hires, duplicates) never inherit a computer or its access. */
export function stripComputerUseMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const record = metadata as JsonRecord;
  if (!Object.prototype.hasOwnProperty.call(record, COMPUTER_USE_METADATA_KEY)) return metadata;
  const result = { ...record };
  delete result[COMPUTER_USE_METADATA_KEY];
  return result as T;
}

/** Normalises an operator-supplied host allowlist: lowercase hostnames, optional leading "*.". */
export function normalizeAllowedHosts(input: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const value = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) out.add(value);
  }
  return [...out].slice(0, 50);
}
