import { and, eq, sql } from "drizzle-orm";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { publishLiveEvent } from "../services/live-events.js";
import { ppclipFeature } from "./features.js";

/** An agent row must stay "running" this long without live work before it is repaired. */
const STALE_RUNNING_AGENT_GRACE_MS = 30_000;

/**
 * ppclip FIX-1: an agent can be left "running" when the server stops between
 * finishing a run and updating the agent. Reset such agents once no queued or
 * running run remains: to "error" when their latest run failed or timed out,
 * otherwise to "idle". Live events keep open boards in sync.
 */
export async function repairStaleRunningAgents(db: Db, now = new Date()) {
  if (!ppclipFeature("staleRunningRepair")) return [];
  const cutoff = new Date(now.getTime() - STALE_RUNNING_AGENT_GRACE_MS);
  const repaired = await db
    .update(agents)
    .set({
      status: sql`case when (select r.status from ${heartbeatRuns} r
        where r.agent_id = ${agents.id} order by r.created_at desc limit 1)
        in ('failed', 'timed_out') then 'error' else 'idle' end`,
      updatedAt: now,
    })
    .where(and(
      eq(agents.status, "running"),
      sql`${agents.updatedAt} < ${cutoff.toISOString()}::timestamptz`,
      sql`not exists (select 1 from ${heartbeatRuns} r where r.agent_id = ${agents.id}
        and r.status in ('running', 'queued'))`,
    ))
    .returning({ id: agents.id, companyId: agents.companyId, status: agents.status });
  for (const agent of repaired) {
    publishLiveEvent({
      companyId: agent.companyId,
      type: "agent.status",
      payload: { agentId: agent.id, status: agent.status, reason: "no_live_runs_reconciliation" },
    });
  }
  return repaired;
}
