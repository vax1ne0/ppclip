import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { activityLog, agents, type Db } from "@paperclipai/db";
import { conflict, forbidden, notFound } from "../../errors.js";
import { logActivity, publishActivity, type ActivityPublication } from "../../services/activity-log.js";
import { publishLiveEvent } from "../../services/live-events.js";
import {
  applyTransition,
  ComputerTransitionError,
  isLive,
  normalizeAllowedHosts,
  readComputerUse,
  withComputerUse,
  type ComputerActorKind,
  type ComputerEvent,
  type ComputerUseMeta,
} from "./state.js";
import { SupervisorError, type SupervisorClient, type SupervisorHealth } from "./supervisor-client.js";

const COMPUTER_USE_ENABLED_ACTION = "ppclip.computer_use.enabled";
const COMPUTER_USE_DISABLED_ACTION = "ppclip.computer_use.disabled";
const SWITCH_ACTIONS = [COMPUTER_USE_ENABLED_ACTION, COMPUTER_USE_DISABLED_ACTION];

type ComputerUseActor =
  | { kind: "operator"; userId: string }
  | { kind: "agent"; agentId: string; runId: string | null }
  | { kind: "system" };

type AgentRow = typeof agents.$inferSelect;
type Tx = Pick<Db, "select" | "update" | "insert" | "execute">;

/**
 * The per-company switch is its own audit trail, like run controls: the latest
 * `ppclip.computer_use.enabled|disabled` activity row wins, and no row means OFF.
 */
export async function isComputerUseEnabled(db: Pick<Db, "select">, companyId: string) {
  const [row] = await db
    .select({ action: activityLog.action })
    .from(activityLog)
    .where(and(
      eq(activityLog.companyId, companyId),
      eq(activityLog.entityType, "company"),
      eq(activityLog.entityId, companyId),
      inArray(activityLog.action, SWITCH_ACTIONS),
    ))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(1);
  return row?.action === COMPUTER_USE_ENABLED_ACTION;
}

export type AgentComputer = {
  agentId: string;
  name: string;
  enabled: boolean;
  state: ComputerUseMeta["state"];
  epoch: number;
  lease: ComputerUseMeta["lease"];
  request: ComputerUseMeta["request"];
  shell: boolean;
  allowedHosts: string[];
  lastActivityAt: string | null;
};

export type ComputerUseOverview = {
  enabled: boolean;
  supervisor: SupervisorHealth;
  agents: AgentComputer[];
};

type ViewerTicket = {
  companyId: string;
  agentId: string;
  userId: string;
  mode: "view" | "control";
  /** Control tickets are bound to the lease that granted them. */
  leaseGrantedAt: string | null;
  expiresAt: number;
};

export type OperatorAction = "start" | "stop" | "take_control" | "take_control_private" | "release" | "pause" | "resume" | "revoke" | "restore";

type ComputerUseServiceOptions = {
  supervisor: SupervisorClient;
  now?: () => Date;
  /** How long a person keeps control before the computer pauses (default 30 min). */
  leaseMs?: number;
  /** Idle time after which a computer driven by the agent is stopped (default 15 min). */
  idleMs?: number;
  ticketTtlMs?: number;
};

/** Serialises everything that touches one agent's computer: tool calls and control changes. */
class AgentLocks {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(agentId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tail = next.catch(() => undefined);
    this.tails.set(agentId, tail);
    void tail.then(() => { if (this.tails.get(agentId) === tail) this.tails.delete(agentId); });
    return next;
  }
}

function actorId(actor: ComputerUseActor) {
  return actor.kind === "operator" ? actor.userId : actor.kind === "agent" ? actor.agentId : "system";
}

function actorKind(actor: ComputerUseActor): ComputerActorKind {
  return actor.kind;
}

function activityActor(actor: ComputerUseActor) {
  if (actor.kind === "operator") return { actorType: "user" as const, actorId: actor.userId };
  if (actor.kind === "agent") return { actorType: "agent" as const, actorId: actor.agentId, agentId: actor.agentId, runId: actor.runId ?? undefined };
  return { actorType: "system" as const, actorId: "ppclip-computer-use" };
}

const OPERATOR_EVENT: Record<OperatorAction, ComputerEvent> = {
  start: "start",
  stop: "stop",
  take_control: "take_control",
  take_control_private: "take_control_private",
  release: "release",
  pause: "pause",
  resume: "resume",
  revoke: "revoke",
  restore: "restore",
};

export function computerUseService(db: Db, opts: ComputerUseServiceOptions) {
  const supervisor = opts.supervisor;
  const now = opts.now ?? (() => new Date());
  const leaseMs = opts.leaseMs ?? 30 * 60_000;
  const idleMs = opts.idleMs ?? 15 * 60_000;
  const ticketTtlMs = opts.ticketTtlMs ?? 10 * 60_000;
  const locks = new AgentLocks();
  const tickets = new Map<string, ViewerTicket>();

  async function loadAgent(companyId: string, agentId: string, executor: Pick<Db, "select"> = db) {
    const [agent] = await executor.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));
    if (!agent || agent.status === "terminated") throw notFound("Agent not found");
    return agent;
  }

  function publishChange(companyId: string, agentId: string, meta: ComputerUseMeta) {
    publishLiveEvent({ companyId, type: "agent.status", payload: { agentId, reason: "ppclip_computer_use", computerState: meta.state } });
  }

  /** Writes the agent's computer-use record and its audit row in one transaction. */
  async function writeMeta(
    companyId: string,
    agentId: string,
    actor: ComputerUseActor,
    mutate: (meta: ComputerUseMeta, agent: AgentRow) => ComputerUseMeta,
    audit: { action: string; details?: Record<string, unknown> },
  ) {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      const [agent] = await (tx as unknown as Tx).select().from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).for("update");
      if (!agent || agent.status === "terminated") throw notFound("Agent not found");
      const before = readComputerUse(agent.metadata);
      const after = mutate(before, agent);
      await (tx as unknown as Tx).update(agents)
        .set({ metadata: withComputerUse(agent.metadata, after), updatedAt: now() })
        .where(eq(agents.id, agentId));
      await logActivity(tx as unknown as Db, {
        companyId,
        ...activityActor(actor),
        action: audit.action,
        entityType: "agent",
        entityId: agentId,
        details: { from: before.state, to: after.state, epoch: after.epoch, ...audit.details },
      }, publications);
      return { before, after };
    });
    for (const publication of publications) publishActivity(publication);
    publishChange(companyId, agentId, result.after);
    return result;
  }

  async function transition(
    companyId: string,
    agentId: string,
    event: ComputerEvent,
    actor: ComputerUseActor,
    extra: { lease?: ComputerUseMeta["lease"]; request?: ComputerUseMeta["request"]; details?: Record<string, unknown> } = {},
  ) {
    try {
      return await writeMeta(companyId, agentId, actor, (meta) => applyTransition(meta, event, actorKind(actor), {
        now: now(), actorId: actorId(actor), lease: extra.lease, request: extra.request,
      }), { action: `ppclip.computer_use.${event}`, details: extra.details });
    } catch (err) {
      if (err instanceof ComputerTransitionError) throw err.code === "not_allowed" ? forbidden(err.message) : conflict(err.message);
      throw err;
    }
  }

  function dropTickets(agentId: string, mode?: "control") {
    for (const [key, ticket] of tickets) {
      if (ticket.agentId === agentId && (!mode || ticket.mode === mode)) tickets.delete(key);
    }
  }

  async function bestEffort(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof SupervisorError)) throw err;
    }
  }

  /** Starts (or resumes) the sandbox for an agent and moves it to `agent`. Caller holds the agent lock. */
  async function startLocked(companyId: string, agentId: string, actor: ComputerUseActor) {
    const agent = await loadAgent(companyId, agentId);
    const meta = readComputerUse(agent.metadata);
    if (!meta.enabled) throw forbidden("Computer use is not turned on for this agent.");
    await transition(companyId, agentId, "start", actor);
    try {
      await supervisor.ensure(agentId, { companyId, shell: meta.shell, allowedHosts: meta.allowedHosts });
    } catch (err) {
      await transition(companyId, agentId, "fail", { kind: "system" }, { details: { error: err instanceof Error ? err.message : "start failed" } });
      throw conflict(err instanceof Error ? `The computer could not start: ${err.message}` : "The computer could not start.");
    }
    return transition(companyId, agentId, "ready", { kind: "system" });
  }

  let recovering: Promise<{ checked: number; changed: number; unavailable: number }> | null = null;
  async function recoverComputers() {
    const result = { checked: 0, changed: 0, unavailable: 0 };
    if (!(await supervisor.health()).ok) return { ...result, unavailable: 1 };
    const rows = await db.select({ id: agents.id, companyId: agents.companyId }).from(agents)
      .where(and(ne(agents.status, "terminated"), sql`${agents.metadata}->'computerUse'->>'state' in ('starting','agent','waiting_for_human','human','human_private','paused')`));
    for (const row of rows) {
      try {
        await locks.run(row.id, async () => {
          const meta = readComputerUse((await loadAgent(row.companyId, row.id)).metadata);
          if (!isLive(meta.state)) return;
          result.checked++;
          const computer = await supervisor.inspect(row.id);
          if (!computer?.running || !meta.enabled || !(await isComputerUseEnabled(db, row.companyId))) {
            dropTickets(row.id);
            // Keep the saved state eligible for the next recovery pass if
            // Docker cannot stop the container. Never report success first.
            if (computer?.running) await supervisor.stop(row.id);
            await transition(row.companyId, row.id, "stop", { kind: "system" }, { details: { reason: computer?.running ? "access_disabled_recovery" : "container_not_running_recovery" } });
            result.changed++;
            return;
          }
          const human = meta.state === "human" || meta.state === "human_private";
          const validLease = human && meta.lease && Date.parse(meta.lease.expiresAt) > now().getTime();
          const needsPause = meta.state === "starting" || computer.healthy === false
            || (human && !validLease) || (computer.paused && meta.state !== "paused");
          if (needsPause && meta.state !== "paused") {
            dropTickets(row.id);
            await transition(row.companyId, row.id, human && !validLease ? "lease_expired" : "recovery_pause", { kind: "system" }, { details: { reason: computer.healthy === false ? "desktop_unhealthy_recovery" : "state_mismatch_recovery" } });
            if (!computer.paused) {
              await supervisor.setControl(row.id, false);
              await supervisor.freeze(row.id);
            }
            result.changed++;
          } else if (meta.state === "paused") {
            if (!computer.paused) {
              await supervisor.setControl(row.id, false);
              await supervisor.freeze(row.id);
              result.changed++;
            }
          } else if (validLease) {
            // Re-establish the existing lease after a supervisor/container restart.
            await supervisor.setControl(row.id, true);
          } else {
            await supervisor.setControl(row.id, false);
          }
        });
      } catch {
        // Preserve intent when Docker is unavailable; retry on the next bounded pass.
        result.unavailable++;
      }
    }
    return result;
  }
  function reconcile() {
    if (recovering) return recovering;
    const work = recoverComputers();
    recovering = work;
    void work.finally(() => { if (recovering === work) recovering = null; }).catch(() => undefined);
    return work;
  }

  return {
    supervisor,
    reconcile,
    isEnabled: (companyId: string) => isComputerUseEnabled(db, companyId),
    withAgentLock: <T>(agentId: string, fn: () => Promise<T>) => locks.run(agentId, fn),

    async overview(companyId: string): Promise<ComputerUseOverview> {
      const [enabled, rows] = await Promise.all([
        isComputerUseEnabled(db, companyId),
        db.select().from(agents).where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"))).orderBy(agents.name),
      ]);
      const health: SupervisorHealth = enabled ? await supervisor.health() : { ok: false, error: "Computer use is off." };
      return {
        enabled,
        supervisor: health,
        agents: rows.map((agent) => {
          const meta = readComputerUse(agent.metadata);
          return {
            agentId: agent.id, name: agent.name, enabled: meta.enabled, state: meta.state, epoch: meta.epoch,
            lease: meta.lease, request: meta.request, shell: meta.shell, allowedHosts: meta.allowedHosts, lastActivityAt: meta.lastActivityAt,
          };
        }),
      };
    },

    async setEnabled(companyId: string, enabled: boolean, actor: ComputerUseActor & { kind: "operator" }) {
      const current = await isComputerUseEnabled(db, companyId);
      if (current === enabled) return { enabled, changed: false, stoppedAgentIds: [] as string[] };
      await logActivity(db, {
        companyId, ...activityActor(actor),
        action: enabled ? COMPUTER_USE_ENABLED_ACTION : COMPUTER_USE_DISABLED_ACTION,
        entityType: "company", entityId: companyId, details: {},
      });
      const stoppedAgentIds: string[] = [];
      if (!enabled) {
        // Turning the feature off ends every session at once: control, streams and sandboxes.
        const rows = await db.select().from(agents).where(eq(agents.companyId, companyId));
        for (const agent of rows) {
          const meta = readComputerUse(agent.metadata);
          if (!isLive(meta.state)) continue;
          await locks.run(agent.id, async () => {
            dropTickets(agent.id);
            await bestEffort(() => supervisor.setControl(agent.id, false));
            await bestEffort(() => supervisor.stop(agent.id));
            await transition(companyId, agent.id, "stop", { kind: "system" }, { details: { reason: "feature_disabled" } });
          });
          stoppedAgentIds.push(agent.id);
        }
      }
      return { enabled, changed: true, stoppedAgentIds };
    },

    async updateAgent(
      companyId: string,
      agentId: string,
      patch: { enabled?: boolean; shell?: boolean; allowedHosts?: string[] },
      actor: ComputerUseActor & { kind: "operator" },
    ) {
      if (!(await isComputerUseEnabled(db, companyId))) throw conflict("Turn on computer use in Company Settings first.");
      return locks.run(agentId, async () => {
        const { after } = await writeMeta(companyId, agentId, actor, (meta) => ({
          ...meta,
          enabled: patch.enabled ?? meta.enabled,
          shell: patch.shell ?? meta.shell,
          allowedHosts: patch.allowedHosts ? normalizeAllowedHosts(patch.allowedHosts) : meta.allowedHosts,
          updatedAt: now().toISOString(),
          updatedBy: actor.userId,
        }), { action: "ppclip.computer_use.settings", details: { enabled: patch.enabled, shell: patch.shell, allowedHosts: patch.allowedHosts?.length } });
        if (patch.enabled === false && isLive(after.state)) {
          dropTickets(agentId);
          await bestEffort(() => supervisor.setControl(agentId, false));
          await bestEffort(() => supervisor.stop(agentId));
          await transition(companyId, agentId, "stop", { kind: "system" }, { details: { reason: "agent_disabled" } });
        }
        return readComputerUse((await loadAgent(companyId, agentId)).metadata);
      });
    },

    /** Operator control actions. Every one waits for any in-flight agent action first. */
    async operate(companyId: string, agentId: string, action: OperatorAction, actor: ComputerUseActor & { kind: "operator" }) {
      // Join the agent's queue first, so an operator's click is ordered before any later agent call.
      return locks.run(agentId, async () => {
        if (!(await isComputerUseEnabled(db, companyId))) throw conflict("Turn on computer use in Company Settings first.");
        const event = OPERATOR_EVENT[action];
        switch (event) {
          case "start":
            await startLocked(companyId, agentId, actor);
            break;
          case "take_control":
          case "take_control_private": {
            const grantedAt = now();
            const lease = { holderUserId: actor.userId, private: event === "take_control_private", grantedAt: grantedAt.toISOString(), expiresAt: new Date(grantedAt.getTime() + leaseMs).toISOString() };
            const { before } = await transition(companyId, agentId, event, actor, { lease });
            dropTickets(agentId, "control");
            if (before.state === "paused") await supervisor.thaw(agentId);
            // The agent is already refused (state changed above); now open the interactive stream.
            await supervisor.setControl(agentId, true);
            break;
          }
          case "release":
            dropTickets(agentId, "control");
            await bestEffort(() => supervisor.setControl(agentId, false));
            await transition(companyId, agentId, "release", actor);
            break;
          case "pause":
            dropTickets(agentId, "control");
            await transition(companyId, agentId, "pause", actor);
            await bestEffort(() => supervisor.setControl(agentId, false));
            await supervisor.freeze(agentId);
            break;
          case "resume":
            await supervisor.thaw(agentId);
            await transition(companyId, agentId, "resume", actor);
            break;
          case "stop":
            dropTickets(agentId);
            await transition(companyId, agentId, "stop", actor);
            await bestEffort(() => supervisor.setControl(agentId, false));
            await bestEffort(() => supervisor.stop(agentId));
            break;
          case "revoke":
            dropTickets(agentId);
            await transition(companyId, agentId, "revoke", actor);
            await bestEffort(() => supervisor.setControl(agentId, false));
            await bestEffort(() => supervisor.stop(agentId));
            break;
          case "restore":
            await transition(companyId, agentId, "restore", actor);
            break;
          default:
            throw conflict("Unknown action");
        }
        return readComputerUse((await loadAgent(companyId, agentId)).metadata);
      });
    },

    async deleteComputer(companyId: string, agentId: string, purgeProfile: boolean, actor: ComputerUseActor & { kind: "operator" }) {
      return locks.run(agentId, async () => {
        const meta = readComputerUse((await loadAgent(companyId, agentId)).metadata);
        if (isLive(meta.state)) throw conflict("Stop the computer first.");
        dropTickets(agentId);
        await supervisor.destroy(agentId, purgeProfile);
        await logActivity(db, {
          companyId, ...activityActor(actor), action: "ppclip.computer_use.deleted",
          entityType: "agent", entityId: agentId, details: { purgeProfile },
        });
        return { ok: true };
      });
    },

    /** Agent-side start, used when a tool is called and the computer is not running. Caller holds the lock. */
    startForAgentLocked: (companyId: string, agentId: string, runId: string | null) =>
      startLocked(companyId, agentId, { kind: "agent", agentId, runId }),

    /** Agent asks for a person. Caller holds the lock. */
    requestTakeoverLocked: (companyId: string, agentId: string, runId: string | null, reason: string) =>
      transition(companyId, agentId, "request_takeover", { kind: "agent", agentId, runId }, {
        request: { reason: reason.slice(0, 300), at: now().toISOString(), runId },
        details: { reason: reason.slice(0, 300) },
      }),

    /** Records that the agent used its computer (throttled to one write a minute). */
    async touch(companyId: string, agentId: string) {
      const agent = await loadAgent(companyId, agentId);
      const meta = readComputerUse(agent.metadata);
      if (meta.lastActivityAt && now().getTime() - Date.parse(meta.lastActivityAt) < 60_000) return;
      await db.update(agents)
        .set({ metadata: sql`jsonb_set(coalesce(${agents.metadata}, '{}'::jsonb), '{computerUse,lastActivityAt}', to_jsonb(${now().toISOString()}::text), true)` })
        .where(and(eq(agents.id, agentId), sql`${agents.metadata} ? 'computerUse'`));
    },

    async logTool(companyId: string, agentId: string, runId: string | null, details: Record<string, unknown>) {
      await logActivity(db, {
        companyId, ...activityActor({ kind: "agent", agentId, runId }),
        action: "ppclip.computer_use.tool", entityType: "agent", entityId: agentId, details,
      });
    },

    readMeta: async (companyId: string, agentId: string) => readComputerUse((await loadAgent(companyId, agentId)).metadata),

    /** A short-lived capability for the live view. View tickets work while the computer is live; control tickets need the caller's lease. */
    async issueTicket(companyId: string, agentId: string, userId: string, mode: "view" | "control") {
      // State changes are published before the supervisor finishes opening the
      // interactive stream. A viewer must wait for that operation to settle.
      return locks.run(agentId, async () => {
        if (!(await isComputerUseEnabled(db, companyId))) throw conflict("Computer use is off.");
        const meta = readComputerUse((await loadAgent(companyId, agentId)).metadata);
        if (!meta.enabled || !isLive(meta.state)) throw conflict("The computer is not running.");
        if (meta.state === "paused") throw conflict("The computer is paused. Resume it or take control to open the live view.");
        if (mode === "control") {
          if ((meta.state !== "human" && meta.state !== "human_private") || !meta.lease
            || meta.lease.holderUserId !== userId || Date.parse(meta.lease.expiresAt) <= now().getTime()) throw forbidden("Take control first.");
          // A supervisor restart loses its in-memory stream token. Restore it
          // only after checking the caller's current lease; repeated calls are idempotent.
          await supervisor.setControl(agentId, true);
        }
        for (const [key, ticket] of tickets) if (ticket.expiresAt < Date.now()) tickets.delete(key);
        const ticket = randomBytes(24).toString("base64url");
        tickets.set(ticket, { companyId, agentId, userId, mode, leaseGrantedAt: mode === "control" ? meta.lease!.grantedAt : null, expiresAt: Date.now() + ticketTtlMs });
        return ticket;
      });
    },

    /** Re-checks a ticket against current state. Used on every stream request and every second while streaming. */
    async resolveTicket(ticket: string): Promise<ViewerTicket | null> {
      const entry = tickets.get(ticket);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        tickets.delete(ticket);
        return null;
      }
      const [row] = await db.select({ metadata: agents.metadata, status: agents.status }).from(agents)
        .where(and(eq(agents.id, entry.agentId), eq(agents.companyId, entry.companyId)));
      if (!row || row.status === "terminated") return null;
      const meta = readComputerUse(row.metadata);
      const valid = meta.enabled && isLive(meta.state) && meta.state !== "paused" && (entry.mode === "view"
        || ((meta.state === "human" || meta.state === "human_private") && meta.lease?.holderUserId === entry.userId
          && meta.lease.grantedAt === entry.leaseGrantedAt && Date.parse(meta.lease.expiresAt) > now().getTime()));
      if (!valid) {
        tickets.delete(ticket);
        return null;
      }
      return entry;
    },

    /** Lease expiry (person → paused) and idle stop (agent idle → stopped). Run every 30 s. */
    async sweep() {
      await reconcile();
      const rows = await db.select().from(agents)
        .where(sql`${agents.metadata}->'computerUse'->>'state' in ('human','human_private','agent','starting')`);
      const t = now().getTime();
      for (const agent of rows) {
        const meta = readComputerUse(agent.metadata);
        const companyId = agent.companyId;
        try {
          if ((meta.state === "human" || meta.state === "human_private") && meta.lease && Date.parse(meta.lease.expiresAt) <= t) {
            await locks.run(agent.id, async () => {
              dropTickets(agent.id, "control");
              await bestEffort(() => supervisor.setControl(agent.id, false));
              await transition(companyId, agent.id, "lease_expired", { kind: "system" });
              await bestEffort(() => supervisor.freeze(agent.id));
            });
          } else if (meta.state === "agent" && t - Math.max(Date.parse(meta.lastActivityAt ?? "") || 0, Date.parse(meta.updatedAt ?? "") || 0) > idleMs) {
            await locks.run(agent.id, async () => {
              dropTickets(agent.id);
              await transition(companyId, agent.id, "stop", { kind: "system" }, { details: { reason: "idle" } });
              await bestEffort(() => supervisor.stop(agent.id));
            });
          } else if (meta.state === "starting" && t - Date.parse(meta.updatedAt ?? new Date(0).toISOString()) > 5 * 60_000) {
            await locks.run(agent.id, () => transition(companyId, agent.id, "fail", { kind: "system" }, { details: { reason: "start_timeout" } }));
          }
        } catch {
          // A concurrent change won; the next sweep re-evaluates.
        }
      }
    },
  };
}

export type ComputerUseService = ReturnType<typeof computerUseService>;

const instances = new WeakMap<Db, ComputerUseService>();

/** One service per database handle, shared by routes, the MCP endpoint and the stream proxy. */
export function sharedComputerUseService(db: Db, factory: () => ComputerUseService) {
  let service = instances.get(db);
  if (!service) {
    service = factory();
    instances.set(db, service);
  }
  return service;
}
