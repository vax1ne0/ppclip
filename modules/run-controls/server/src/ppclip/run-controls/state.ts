import { parseObject as asRecord } from "@paperclipai/adapter-utils/server-utils";
/**
 * ppclip RUN-1 / RUN-2: pure helpers for team run controls.
 *
 * State lives in existing agent JSON columns (no migration):
 * - `runtimeConfig.heartbeat.maxDailyRuns` / `wakeOnDemand`: the values official's
 *   scheduler already enforces. Run controls only rewrite them.
 * - `metadata.runControl`: what Unlimited/Drain changed, so Resume and turning
 *   Unlimited off can restore the agent's own settings, plus today's run credit.
 * - `metadata.drainAfter`: the RUN-2 "drain after next run" plan.
 *
 * Both metadata keys are owned by the board-only run-control endpoints; ordinary
 * agent PATCHes and hires cannot change them (see preserveRunControlMetadata).
 */

/** Official's cap key and the legacy aliases it still reads (official parseHeartbeatPolicy in services/heartbeat/queue.ts). */
const DAILY_RUN_CAP_KEYS = ["maxDailyRuns", "dailyRunLimit", "dailyRunCap", "maxRunsPerDay"] as const;
const RUN_CONTROL_METADATA_KEY = "runControl";
const DRAIN_AFTER_METADATA_KEY = "drainAfter";
const PROTECTED_METADATA_KEYS = [RUN_CONTROL_METADATA_KEY, DRAIN_AFTER_METADATA_KEY] as const;

/** Runs made while Unlimited was on, credited back to that UTC day's allowance. */
type RunCredit = { day: string; runs: number };
/** The agent's own settings, saved while Unlimited or Drain overrides them. `null` = key was absent. */
type SavedHeartbeat = { maxDailyRuns: number | null; wakeOnDemand: boolean | null };
type RunControlState = {
  unlimited?: boolean;
  unlimitedSince?: string;
  draining?: boolean;
  drainingSince?: string;
  saved?: SavedHeartbeat;
  credit?: RunCredit;
  triggeredByRunId?: string;
  updatedAt?: string;
  updatedBy?: string;
};
type DrainAfterState = {
  state: "armed" | "triggered" | "cancelled";
  armedAt?: string;
  armedBy?: string;
  runId?: string;
  triggeredAt?: string;
  cancelledAt?: string;
};

type JsonRecord = Record<string, unknown>;
type AgentConfigLike = { metadata: unknown; runtimeConfig: unknown };


export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function readRunControl(metadata: unknown): RunControlState {
  return asRecord(asRecord(metadata)[RUN_CONTROL_METADATA_KEY]) as RunControlState;
}

export function readDrainAfter(metadata: unknown): DrainAfterState | null {
  const value = asRecord(asRecord(metadata)[DRAIN_AFTER_METADATA_KEY]);
  return typeof value.state === "string" ? (value as DrainAfterState) : null;
}

export function isDrainAfterArmed(metadata: unknown) {
  return readDrainAfter(metadata)?.state === "armed";
}

/** Today's credit only: a credit from an earlier UTC day has expired. */
export function activeRunCredit(metadata: unknown, day: string): number {
  const credit = readRunControl(metadata).credit;
  if (!credit || credit.day !== day) return 0;
  const runs = typeof credit.runs === "number" && Number.isFinite(credit.runs) ? Math.floor(credit.runs) : 0;
  return Math.max(0, runs);
}

/** Any daily cap key (official or legacy alias) is present. */
function hasDailyRunCap(runtimeConfig: unknown) {
  const heartbeat = asRecord(asRecord(runtimeConfig).heartbeat);
  return DAILY_RUN_CAP_KEYS.some((key) => Object.prototype.hasOwnProperty.call(heartbeat, key));
}

type RunRow = { agentId: string; startedAt: Date | string | null };

/** Runs an agent started today (UTC) at or after `since`; the caller passes started runs only. */
export function runsStartedSince(runs: RunRow[], agentId: string, since: string | null | undefined, now = new Date()) {
  if (!since) return 0;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return 0;
  const from = Math.max(utcDayStart(now).getTime(), sinceMs);
  return runs.filter((run) => {
    if (run.agentId !== agentId || !run.startedAt) return false;
    const at = new Date(run.startedAt).getTime();
    return at >= from && at <= now.getTime();
  }).length;
}

type RunControlTarget = { unlimited: boolean; draining: boolean };
type RunControlContext = {
  /** The agent's current cap as official's scheduler reads it (null = no cap). */
  currentCap: number | null;
  now: Date;
  actor: string;
  /** Runs to add to today's credit (runs made while Unlimited was on). */
  creditRuns?: number;
  triggeredByRunId?: string;
};

function restoreKey(heartbeat: JsonRecord, key: string, value: unknown) {
  if (value === null || value === undefined) delete heartbeat[key];
  else heartbeat[key] = value;
}

/**
 * Move an agent to the target Unlimited/Drain state. Unlimited and Drain are
 * independent; the agent's own cap and wake setting are saved on the first
 * override and restored when neither is on.
 */
export function applyRunControl(agent: AgentConfigLike, target: RunControlTarget, ctx: RunControlContext) {
  const metadata = { ...asRecord(agent.metadata) };
  const runtimeConfig = { ...asRecord(agent.runtimeConfig) };
  const heartbeat = { ...asRecord(runtimeConfig.heartbeat) };
  const current = readRunControl(metadata);
  const wasActive = Boolean(current.unlimited || current.draining);
  const willBeActive = target.unlimited || target.draining;
  const saved: SavedHeartbeat = wasActive && current.saved
    ? current.saved
    : {
        maxDailyRuns: ctx.currentCap,
        wakeOnDemand: typeof heartbeat.wakeOnDemand === "boolean" ? heartbeat.wakeOnDemand : null,
      };
  const day = utcDay(ctx.now);
  const creditRuns = activeRunCredit(metadata, day) + Math.max(0, Math.floor(ctx.creditRuns ?? 0));
  const nowIso = ctx.now.toISOString();

  for (const key of DAILY_RUN_CAP_KEYS) delete heartbeat[key];
  if (target.draining) {
    heartbeat.maxDailyRuns = 0;
    heartbeat.wakeOnDemand = false;
  } else {
    if (!target.unlimited) restoreKey(heartbeat, "maxDailyRuns", saved.maxDailyRuns);
    restoreKey(heartbeat, "wakeOnDemand", saved.wakeOnDemand);
  }
  runtimeConfig.heartbeat = heartbeat;

  const credit = creditRuns > 0 ? { credit: { day, runs: creditRuns } } : {};
  if (willBeActive) {
    const next: RunControlState = {
      ...(target.unlimited
        ? { unlimited: true, unlimitedSince: current.unlimited && current.unlimitedSince ? current.unlimitedSince : nowIso }
        : {}),
      ...(target.draining
        ? { draining: true, drainingSince: current.draining && current.drainingSince ? current.drainingSince : nowIso }
        : {}),
      saved,
      ...credit,
      ...(target.draining && (ctx.triggeredByRunId ?? current.triggeredByRunId)
        ? { triggeredByRunId: ctx.triggeredByRunId ?? current.triggeredByRunId }
        : {}),
      updatedAt: nowIso,
      updatedBy: ctx.actor,
    };
    metadata[RUN_CONTROL_METADATA_KEY] = next;
  } else if (creditRuns > 0) {
    // Limits are back; only today's credit remains and it expires on its own at the next UTC day.
    metadata[RUN_CONTROL_METADATA_KEY] = { ...credit, updatedAt: nowIso, updatedBy: ctx.actor };
  } else {
    delete metadata[RUN_CONTROL_METADATA_KEY];
  }
  return { metadata, runtimeConfig };
}

/**
 * Master switch off: remove every daily cap (official key and aliases), drop all
 * run-control and drain-after state, and put wakeOnDemand back to the agent's
 * saved value when run controls had overridden it.
 */
export function clearRunControls(agent: AgentConfigLike) {
  const metadata = { ...asRecord(agent.metadata) };
  const runtimeConfig = { ...asRecord(agent.runtimeConfig) };
  const heartbeat = { ...asRecord(runtimeConfig.heartbeat) };
  const current = readRunControl(metadata);
  for (const key of DAILY_RUN_CAP_KEYS) delete heartbeat[key];
  if ((current.unlimited || current.draining) && current.saved) {
    restoreKey(heartbeat, "wakeOnDemand", current.saved.wakeOnDemand);
  }
  runtimeConfig.heartbeat = heartbeat;
  delete metadata[RUN_CONTROL_METADATA_KEY];
  delete metadata[DRAIN_AFTER_METADATA_KEY];
  return { metadata, runtimeConfig };
}

export function needsRunControlClear(agent: AgentConfigLike) {
  const metadata = asRecord(agent.metadata);
  return hasDailyRunCap(agent.runtimeConfig)
    || Object.prototype.hasOwnProperty.call(metadata, RUN_CONTROL_METADATA_KEY)
    || Object.prototype.hasOwnProperty.call(metadata, DRAIN_AFTER_METADATA_KEY);
}

export function withDrainAfter(metadata: unknown, next: DrainAfterState | null) {
  const result = { ...asRecord(metadata) };
  if (next) result[DRAIN_AFTER_METADATA_KEY] = next;
  else delete result[DRAIN_AFTER_METADATA_KEY];
  return result;
}

/**
 * Ordinary agent updates keep the stored run-control and drain-after state, whatever
 * the patch says: only the board run-control endpoints may change them.
 */
export function preserveRunControlMetadata(existing: unknown, next: unknown): JsonRecord | null {
  const stored = asRecord(existing);
  const kept = PROTECTED_METADATA_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(stored, key));
  if (next === null && kept.length === 0) return null;
  const result = { ...asRecord(next) };
  for (const key of PROTECTED_METADATA_KEYS) delete result[key];
  for (const key of kept) result[key] = stored[key];
  return result;
}

/** New agents (hires, duplicates) never inherit run-control or drain-after state. */
export function stripRunControlMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const record = metadata as JsonRecord;
  if (!PROTECTED_METADATA_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key))) return metadata;
  const result = { ...record };
  for (const key of PROTECTED_METADATA_KEYS) delete result[key];
  return result as T;
}
