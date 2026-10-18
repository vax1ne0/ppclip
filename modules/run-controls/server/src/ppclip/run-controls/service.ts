import { and, desc, eq, gte, inArray, lt, ne, notInArray, sql } from "drizzle-orm";
import { activityLog, agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { conflict, notFound } from "../../errors.js";
import { logActivity, publishActivity, type ActivityPublication } from "../../services/activity-log.js";
import { publishLiveEvent } from "../../services/live-events.js";
import {
  activeRunCredit,
  applyRunControl,
  clearRunControls,
  isDrainAfterArmed,
  needsRunControlClear,
  readDrainAfter,
  readRunControl,
  runsStartedSince,
  utcDay,
  utcDayStart,
  withDrainAfter,
} from "./state.js";

type AgentRow = typeof agents.$inferSelect;
type Tx = Pick<Db, "select" | "update" | "insert" | "execute">;

/** Reads the cap exactly as official's scheduler does (official parseHeartbeatPolicy in services/heartbeat/queue.ts). */
export type DailyRunCapReader = (agent: AgentRow) => number | null;
export type RunControlActor = { actorType: "user" | "agent" | "system"; actorId: string };
type ResumeWakeup = (agentId: string, issueId: string, actor: RunControlActor) => Promise<{ accepted: boolean; message?: string }>;

const RUN_CONTROLS_ENABLED_ACTION = "ppclip.run_controls.enabled";
const RUN_CONTROLS_DISABLED_ACTION = "ppclip.run_controls.disabled";
const SWITCH_ACTIONS = [RUN_CONTROLS_ENABLED_ACTION, RUN_CONTROLS_DISABLED_ACTION];
const NOT_STARTED_STATUSES = ["queued", "scheduled_retry"];
const LIVE_STATUSES = ["queued", "running"];

/**
 * The per-company master switch is stored as its own audit trail: the latest
 * `ppclip.run_controls.enabled|disabled` activity row for the company wins.
 * No row means OFF (the default). This needs no migration and no extra settings
 * column, survives upstream changes to company/instance settings, and is only
 * deleted together with the company.
 */
async function isRunControlsEnabled(db: Pick<Db, "select">, companyId: string) {
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
  return row?.action === RUN_CONTROLS_ENABLED_ACTION;
}

/**
 * Lock order for every run-control write, including the drain-after claim hook:
 * 1. a transaction-scoped advisory lock for the company (ppclip-only, so it never
 *    meets official's company-row locks such as the issue counter or cost totals);
 * 2. every agent row of the company, `FOR UPDATE`, ordered by id.
 * Run-control writes never lock issue, wakeup or run rows while holding these.
 */
export async function lockRunControlTeam(tx: Tx, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.run_controls:${companyId}`}, 0))`);
  return tx.select().from(agents).where(eq(agents.companyId, companyId)).orderBy(agents.id).for("update");
}

function controlled(team: AgentRow[]) {
  return team.filter((agent) => agent.status !== "terminated");
}

async function startedRunsToday(db: Pick<Db, "select">, companyId: string, now: Date) {
  const start = utcDayStart(now);
  const end = new Date(start.getTime() + 86_400_000);
  return db
    .select({ agentId: heartbeatRuns.agentId, startedAt: heartbeatRuns.startedAt })
    .from(heartbeatRuns)
    .where(and(
      eq(heartbeatRuns.companyId, companyId),
      gte(heartbeatRuns.startedAt, start),
      lt(heartbeatRuns.startedAt, end),
      notInArray(heartbeatRuns.status, NOT_STARTED_STATUSES),
    ));
}

async function liveRunCounts(db: Pick<Db, "select">, companyId: string) {
  const rows = await db
    .select({ agentId: heartbeatRuns.agentId, count: sql<number>`count(*)::integer` })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, LIVE_STATUSES)))
    .groupBy(heartbeatRuns.agentId);
  return new Map(rows.map((row) => [row.agentId, Number(row.count)]));
}

export type AgentRunAllowance = {
  agentId: string;
  /** The agent's normal cap (null = unlimited); today's credit is not included. */
  cap: number | null;
  usedToday: number;
  /** Runs made while Unlimited was on that do not count today. */
  credit: number;
  /** Runs left today, credit included (null = no cap). */
  left: number | null;
  unlimited: boolean;
  draining: boolean;
  drainState: "draining" | "drained" | null;
  liveRuns: number;
  drainAfterArmed: boolean;
};

export type TeamRunControlState = {
  unlimited: "on" | "off" | "mixed";
  drain: "off" | "draining" | "drained" | "mixed";
  hasLiveWork: boolean;
  drainAfterAgentId: string | null;
};

export type RunControlsOverview = {
  enabled: boolean;
  day: string;
  resetsAt: string;
  team: TeamRunControlState | null;
  agents: AgentRunAllowance[];
};

/** Today's allowance per agent: started runs in the UTC day vs official's cap plus today's credit. */
export function computeAllowance(
  agent: AgentRow,
  readCap: DailyRunCapReader,
  runs: { agentId: string; startedAt: Date | string | null }[],
  live: Map<string, number>,
  now: Date,
): AgentRunAllowance {
  const day = utcDay(now);
  const rc = readRunControl(agent.metadata);
  const unlimited = Boolean(rc.unlimited);
  const draining = Boolean(rc.draining);
  const configuredCap = readCap(agent);
  const cap = unlimited && !draining ? null : configuredCap;
  const credit = draining ? 0 : activeRunCredit(agent.metadata, day);
  const usedToday = runs.filter((run) => run.agentId === agent.id).length;
  const left = cap === null ? null : Math.max(0, cap + credit - usedToday);
  const liveRuns = live.get(agent.id) ?? 0;
  return {
    agentId: agent.id,
    cap,
    usedToday,
    credit,
    left,
    unlimited,
    draining,
    drainState: draining ? (liveRuns > 0 ? "draining" : "drained") : null,
    liveRuns,
    drainAfterArmed: isDrainAfterArmed(agent.metadata),
  };
}

export function summarizeTeam(rows: AgentRunAllowance[]): TeamRunControlState {
  const unlimitedCount = rows.filter((row) => row.unlimited).length;
  const drainingRows = rows.filter((row) => row.draining);
  const hasLiveWork = rows.some((row) => row.liveRuns > 0);
  let drain: TeamRunControlState["drain"] = "off";
  if (rows.length > 0 && drainingRows.length === rows.length) {
    drain = drainingRows.some((row) => row.liveRuns > 0) ? "draining" : "drained";
  } else if (drainingRows.length > 0) {
    drain = "mixed";
  }
  return {
    unlimited: rows.length > 0 && unlimitedCount === rows.length ? "on" : unlimitedCount > 0 ? "mixed" : "off",
    drain,
    hasLiveWork,
    drainAfterAgentId: rows.find((row) => row.drainAfterArmed)?.agentId ?? null,
  };
}

export function runControlsService(db: Db, deps: { readCap: DailyRunCapReader; wakeForResume?: ResumeWakeup }) {
  const { readCap } = deps;

  async function inTeamTransaction<T>(
    companyId: string,
    fn: (tx: Tx, team: AgentRow[], publications: ActivityPublication[]) => Promise<T>,
  ) {
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      const team = await lockRunControlTeam(tx as unknown as Tx, companyId);
      return fn(tx as unknown as Tx, team, publications);
    });
    // Activity events go out only after the state they describe is committed.
    for (const publication of publications) publishActivity(publication);
    return { result };
  }

  async function writeAgent(tx: Tx, agent: AgentRow, patch: { metadata: Record<string, unknown>; runtimeConfig?: Record<string, unknown> }, now: Date) {
    await tx.update(agents).set({ ...patch, updatedAt: now }).where(eq(agents.id, agent.id));
  }

  function publishAgentChanges(companyId: string, team: AgentRow[], agentIds: string[], reason: string) {
    for (const agentId of agentIds) {
      const agent = team.find((row) => row.id === agentId);
      publishLiveEvent({ companyId, type: "agent.status", payload: { agentId, status: agent?.status ?? null, reason } });
    }
  }

  async function requireEnabled(tx: Tx, companyId: string) {
    if (!(await isRunControlsEnabled(tx, companyId))) {
      throw conflict("Run controls are turned off for this company. Turn them on in Company Settings first.", {
        code: "ppclip_run_controls_disabled",
      });
    }
  }

  function log(tx: Tx, companyId: string, actor: RunControlActor, action: string, details: Record<string, unknown>, publications: ActivityPublication[], entity?: { type: string; id: string }) {
    return logActivity(tx as unknown as Db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action,
      entityType: entity?.type ?? "company",
      entityId: entity?.id ?? companyId,
      details,
    }, publications);
  }

  return {
    isEnabled: (companyId: string) => isRunControlsEnabled(db, companyId),

    overview: async (companyId: string, now = new Date()): Promise<RunControlsOverview> => {
      const day = utcDay(now);
      const resetsAt = new Date(utcDayStart(now).getTime() + 86_400_000).toISOString();
      if (!(await isRunControlsEnabled(db, companyId))) return { enabled: false, day, resetsAt, team: null, agents: [] };
      const [team, runs, live] = await Promise.all([
        db.select().from(agents).where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"))),
        startedRunsToday(db, companyId, now),
        liveRunCounts(db, companyId),
      ]);
      const rows = team.map((agent) => computeAllowance(agent, readCap, runs, live, now));
      return { enabled: true, day, resetsAt, team: summarizeTeam(rows), agents: rows };
    },

    /** Turning the switch off clears every daily cap and all run-control state. */
    setEnabled: async (companyId: string, enabled: boolean, actor: RunControlActor) => {
      const { result } = await inTeamTransaction(companyId, async (tx, team, publications) => {
        const current = await isRunControlsEnabled(tx, companyId);
        if (current === enabled) return { changed: false, clearedAgentIds: [] as string[], team };
        const cleared: string[] = [];
        if (!enabled) {
          const now = new Date();
          for (const agent of team) {
            if (!needsRunControlClear(agent)) continue;
            await writeAgent(tx, agent, clearRunControls(agent), now);
            cleared.push(agent.id);
          }
        }
        await log(tx, companyId, actor, enabled ? RUN_CONTROLS_ENABLED_ACTION : RUN_CONTROLS_DISABLED_ACTION,
          { enabled, clearedAgentIds: cleared }, publications);
        return { changed: true, clearedAgentIds: cleared, team };
      });
      publishAgentChanges(companyId, result.team, result.clearedAgentIds, "run_controls_disabled");
      return { enabled, changed: result.changed, clearedAgentIds: result.clearedAgentIds };
    },

    setUnlimited: async (companyId: string, on: boolean, actor: RunControlActor) => {
      const { result } = await inTeamTransaction(companyId, async (tx, team, publications) => {
        await requireEnabled(tx, companyId);
        const now = new Date();
        const runs = on ? [] : await startedRunsToday(tx, companyId, now);
        const changed: string[] = [];
        const credited: Record<string, number> = {};
        for (const agent of controlled(team)) {
          const rc = readRunControl(agent.metadata);
          if (Boolean(rc.unlimited) === on) continue;
          const creditRuns = on ? 0 : runsStartedSince(runs, agent.id, rc.unlimitedSince, now);
          if (creditRuns > 0) credited[agent.id] = creditRuns;
          await writeAgent(tx, agent, applyRunControl(agent, { unlimited: on, draining: Boolean(rc.draining) }, {
            currentCap: readCap(agent), now, actor: actor.actorId, creditRuns,
          }), now);
          changed.push(agent.id);
        }
        await log(tx, companyId, actor, on ? "ppclip.run_controls.unlimited_on" : "ppclip.run_controls.unlimited_off",
          { agentIds: changed, ...(on ? {} : { creditedRuns: credited }) }, publications);
        return { changed, team };
      });
      publishAgentChanges(companyId, result.team, result.changed, on ? "run_controls_unlimited_on" : "run_controls_unlimited_off");
      return { agentIds: result.changed };
    },

    /** Drain: running work finishes; caps go to 0 and wake-on-demand off, so nothing new starts. */
    drain: async (companyId: string, actor: RunControlActor) => {
      const { result } = await inTeamTransaction(companyId, async (tx, team, publications) => {
        await requireEnabled(tx, companyId);
        const now = new Date();
        const changed: string[] = [];
        for (const agent of controlled(team)) {
          const rc = readRunControl(agent.metadata);
          const armed = isDrainAfterArmed(agent.metadata);
          if (rc.draining && !armed) continue;
          const patch = rc.draining
            ? { metadata: { ...(agent.metadata ?? {}) } as Record<string, unknown> }
            : applyRunControl(agent, { unlimited: Boolean(rc.unlimited), draining: true }, {
                currentCap: readCap(agent), now, actor: actor.actorId,
              });
          if (armed) patch.metadata = withDrainAfter(patch.metadata, { ...readDrainAfter(agent.metadata)!, state: "cancelled", cancelledAt: now.toISOString() });
          await writeAgent(tx, agent, patch, now);
          changed.push(agent.id);
        }
        await log(tx, companyId, actor, "ppclip.run_controls.drained", { agentIds: changed }, publications);
        return { changed, team };
      });
      publishAgentChanges(companyId, result.team, result.changed, "run_controls_drain");
      return { agentIds: result.changed };
    },

    /**
     * Resume: restore each drained agent's own cap and wake setting, cancel an armed
     * drain-after, then wake one eligible assigned task per agent (in progress first,
     * unblocked, agent not paused/errored and without live work).
     */
    resume: async (companyId: string, actor: RunControlActor) => {
      const { result } = await inTeamTransaction(companyId, async (tx, team) => {
        await requireEnabled(tx, companyId);
        const now = new Date();
        const changed: string[] = [];
        for (const agent of controlled(team)) {
          const rc = readRunControl(agent.metadata);
          const armed = isDrainAfterArmed(agent.metadata);
          if (!rc.draining && !armed) continue;
          const patch = rc.draining
            ? applyRunControl(agent, { unlimited: Boolean(rc.unlimited), draining: false }, {
                currentCap: readCap(agent), now, actor: actor.actorId,
              })
            : { metadata: { ...(agent.metadata ?? {}) } as Record<string, unknown> };
          if (armed) patch.metadata = withDrainAfter(patch.metadata, { ...readDrainAfter(agent.metadata)!, state: "cancelled", cancelledAt: now.toISOString() });
          await writeAgent(tx, agent, patch, now);
          changed.push(agent.id);
        }
        return { changed, team };
      });
      publishAgentChanges(companyId, result.team, result.changed, "run_controls_resume");

      const wakes = { accepted: 0, skipped: [] as string[] };
      const eligibleAgents = controlled(result.team)
        .filter((agent) => !["paused", "error", "pending_approval"].includes(agent.status))
        .map((agent) => agent.id);
      const live = await liveRunCounts(db, companyId);
      const idleAgents = eligibleAgents.filter((agentId) => !live.get(agentId));
      if (deps.wakeForResume && idleAgents.length > 0) {
        for (const assignment of await selectResumeAssignments(db, companyId, idleAgents)) {
          try {
            const outcome = await deps.wakeForResume(assignment.agentId, assignment.issueId, actor);
            if (outcome.accepted) wakes.accepted += 1;
            else wakes.skipped.push(outcome.message ?? "A wake request was skipped.");
          } catch (error) {
            wakes.skipped.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        action: "ppclip.run_controls.resumed", entityType: "company", entityId: companyId,
        details: { agentIds: result.changed, wakesAccepted: wakes.accepted, wakesSkipped: wakes.skipped.length },
      });
      return { agentIds: result.changed, wakes };
    },

    /** RUN-2: arm or cancel "drain the whole team when this agent's next run starts". */
    setDrainAfter: async (companyId: string, agentId: string, armed: boolean, actor: RunControlActor) => {
      const { result } = await inTeamTransaction(companyId, async (tx, team, publications) => {
        const agent = team.find((row) => row.id === agentId);
        if (!agent || agent.status === "terminated") throw notFound("Agent not found");
        const current = readDrainAfter(agent.metadata);
        const now = new Date();
        if (!armed) {
          if (current?.state !== "armed") return { agent, changed: false };
          await writeAgent(tx, agent, { metadata: withDrainAfter(agent.metadata, { ...current, state: "cancelled", cancelledAt: now.toISOString() }) }, now);
          await log(tx, companyId, actor, "ppclip.run_controls.drain_after_cancelled", { agentId }, publications, { type: "agent", id: agentId });
          return { agent, changed: true };
        }
        await requireEnabled(tx, companyId);
        if (current?.state === "armed") return { agent, changed: false };
        await assertDrainAfterEligible(tx, companyId, agent, team, readCap);
        await writeAgent(tx, agent, {
          metadata: withDrainAfter(agent.metadata, { state: "armed", armedAt: now.toISOString(), armedBy: actor.actorId }),
        }, now);
        await log(tx, companyId, actor, "ppclip.run_controls.drain_after_armed", { agentId }, publications, { type: "agent", id: agentId });
        return { agent, changed: true };
      });
      if (result.changed) publishAgentChanges(companyId, [result.agent], [agentId], "drain_after_changed");
      return { agentId, armed, changed: result.changed };
    },
  };
}

/**
 * Arming needs an agent that is waiting only on another agent: idle, allowed to
 * run, with no live run, a blocked task whose open blocker belongs to someone
 * else, and no pending approval or human-only question. One plan per company.
 */
async function assertDrainAfterEligible(tx: Tx, companyId: string, agent: AgentRow, team: AgentRow[], readCap: DailyRunCapReader) {
  const rc = readRunControl(agent.metadata);
  const heartbeat = (agent.runtimeConfig as Record<string, unknown> | null)?.heartbeat as Record<string, unknown> | undefined;
  if (!["idle", "active"].includes(agent.status) || rc.draining || readCap(agent) === 0 || heartbeat?.wakeOnDemand === false) {
    throw conflict("Choose an idle agent while the team is allowed to run.", { code: "ppclip_drain_after_ineligible" });
  }
  if (team.some((other) => other.id !== agent.id && isDrainAfterArmed(other.metadata))) {
    throw conflict("Another drain-after is armed. Cancel it first.", { code: "ppclip_drain_after_already_armed" });
  }
  const live = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, "running"))).limit(1);
  if (live.length > 0) {
    throw conflict("This agent has already started. Use Drain to finish current runs.", { code: "ppclip_drain_after_running" });
  }
  const pending = await tx.execute(sql`
    select 1 from issues i
    join issue_relations r on r.related_issue_id = i.id and r.type = 'blocks'
    join issues b on b.id = r.issue_id
    where i.company_id = ${companyId} and r.company_id = ${companyId} and b.company_id = ${companyId}
      and i.assignee_agent_id = ${agent.id} and i.status = 'blocked'
      and b.status not in ('done', 'cancelled')
      and b.assignee_agent_id is not null and b.assignee_agent_id <> ${agent.id}
      and not exists (
        select 1 from approvals a
        where a.company_id = ${companyId} and a.requested_by_agent_id = ${agent.id} and a.status = 'pending')
      and not exists (
        select 1 from issue_thread_interactions h join issues hi on hi.id = h.issue_id
        where h.company_id = ${companyId} and hi.company_id = ${companyId}
          and hi.status in ('todo', 'in_progress', 'in_review', 'blocked') and h.status = 'pending'
          and h.kind in ('request_confirmation', 'request_checkbox_confirmation', 'request_item_verdicts', 'ask_user_questions')
          and h.effective_resolver_policy in ('human_only', 'board_only')
          and coalesce(h.created_by_agent_id, hi.assignee_agent_id) = ${agent.id})
    limit 1`);
  if (rowsOf(pending).length === 0) {
    throw conflict("This agent is not waiting only on another agent, or it needs a human decision. Refresh and try again.", {
      code: "ppclip_drain_after_not_pending",
    });
  }
}

function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** One open, unblocked todo/in-progress task per agent; in-progress first, then most recently updated. */
async function selectResumeAssignments(db: Pick<Db, "execute">, companyId: string, agentIds: string[]) {
  if (agentIds.length === 0) return [];
  const result = await db.execute(sql`
    select distinct on (i.assignee_agent_id) i.id as issue_id, i.assignee_agent_id as agent_id
    from issues i
    where i.company_id = ${companyId}
      and i.assignee_agent_id in (${sql.join(agentIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and i.status in ('todo', 'in_progress') and i.hidden_at is null
      and not exists (
        select 1 from issue_relations r join issues b on b.id = r.issue_id
        where r.company_id = ${companyId} and r.related_issue_id = i.id and r.type = 'blocks'
          and b.status not in ('done', 'cancelled'))
    order by i.assignee_agent_id, (i.status = 'in_progress') desc, i.updated_at desc`);
  return rowsOf(result).map((row) => {
    const record = row as { issue_id: string; agent_id: string };
    return { issueId: record.issue_id, agentId: record.agent_id };
  });
}
