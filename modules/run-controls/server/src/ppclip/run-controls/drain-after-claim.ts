import { eq } from "drizzle-orm";
import { agents, heartbeatRuns, type Db } from "@paperclipai/db";
import { logActivity, publishActivity, type ActivityPublication } from "../../services/activity-log.js";
import { publishLiveEvent } from "../../services/live-events.js";
import { lockRunControlTeam, type DailyRunCapReader } from "./service.js";
import { applyRunControl, isDrainAfterArmed, readDrainAfter, readRunControl, withDrainAfter } from "./state.js";
import { ppclipFeature } from "../features.js";

/**
 * ppclip RUN-2: when an agent armed with "Drain after next run" has its run
 * claimed, the whole team drains in the same transaction as the claim.
 *
 * Lock ordering. Official's claim transaction locks the issue, then the wakeup
 * request, then the run. Run-control writes take the company advisory lock and
 * then all company agent rows ordered by id (lockRunControlTeam). To keep one
 * global order, the claim takes the run-control locks FIRST, before official's
 * issue lock, but only when the claiming agent is armed (one primary-key read
 * per claim otherwise). Official transactions that lock an agent row and then an
 * issue (e.g. wakeup enqueue) can then only make the claim wait, never deadlock
 * with it. If an agent is armed between that pre-check and the claim (a race of
 * a few milliseconds), the post-claim hook still drains the team, taking the
 * locks late; in that rare case Postgres' deadlock detector is the backstop and
 * the claim retries on the next scheduler pass.
 */

type Tx = Parameters<typeof lockRunControlTeam>[0];
type ClaimedRun = typeof heartbeatRuns.$inferSelect;

const pendingEvents = new Map<string, { companyId: string; agentIds: string[]; publications: ActivityPublication[] }>();

async function claimingAgentArmed(tx: Tx, agentId: string) {
  const [agent] = await tx.select({ metadata: agents.metadata }).from(agents).where(eq(agents.id, agentId));
  return isDrainAfterArmed(agent?.metadata);
}

/** Called at the start of the claim transaction, before official's issue lock. */
export async function ppclipDrainAfterPreLock(tx: Tx, run: Pick<ClaimedRun, "companyId" | "agentId">) {
  if (!ppclipFeature("runControls")) return;
  if (await claimingAgentArmed(tx, run.agentId)) await lockRunControlTeam(tx, run.companyId);
}

/** Called inside the claim transaction right after the run row became "running". */
export async function ppclipDrainAfterOnClaim(tx: Tx, claimed: ClaimedRun | null | undefined, readCap: DailyRunCapReader) {
  if (!ppclipFeature("runControls")) return;
  if (!claimed || claimed.status !== "running") return;
  if (!(await claimingAgentArmed(tx, claimed.agentId))) return;
  // Re-entrant when the pre-lock already ran: Postgres does not wait on locks it holds.
  const team = await lockRunControlTeam(tx, claimed.companyId);
  const self = team.find((agent) => agent.id === claimed.agentId);
  if (!self || !isDrainAfterArmed(self.metadata)) return;
  const now = new Date();
  const changed: string[] = [];
  for (const member of team) {
    if (member.status === "terminated") continue;
    const rc = readRunControl(member.metadata);
    const patch = rc.draining
      ? { metadata: { ...(member.metadata ?? {}) } as Record<string, unknown>, runtimeConfig: member.runtimeConfig }
      : applyRunControl(member, { unlimited: Boolean(rc.unlimited), draining: true }, {
          currentCap: readCap(member), now, actor: "drain-after", triggeredByRunId: claimed.id,
        });
    if (member.id === self.id) {
      patch.metadata = withDrainAfter(patch.metadata, {
        ...readDrainAfter(self.metadata)!, state: "triggered", runId: claimed.id, triggeredAt: now.toISOString(),
      });
    } else if (rc.draining) {
      continue;
    }
    await tx.update(agents).set({ ...patch, updatedAt: now }).where(eq(agents.id, member.id));
    changed.push(member.id);
  }
  const publications: ActivityPublication[] = [];
  await logActivity(tx as unknown as Db, {
    companyId: claimed.companyId,
    actorType: "system",
    actorId: "drain-after",
    agentId: self.id,
    runId: claimed.id,
    action: "ppclip.run_controls.drain_after_triggered",
    entityType: "agent",
    entityId: self.id,
    details: { runId: claimed.id, agentIds: changed },
  }, publications);
  pendingEvents.set(claimed.id, { companyId: claimed.companyId, agentIds: changed, publications });
}

/** Called after the claim transaction settled: publish only what was committed. */
export function ppclipFlushDrainAfterEvents(runId: string, claimed: ClaimedRun | null | undefined) {
  const pending = pendingEvents.get(runId);
  if (!pending) return;
  pendingEvents.delete(runId);
  if (!claimed || claimed.status !== "running") return;
  for (const publication of pending.publications) publishActivity(publication);
  for (const agentId of pending.agentIds) {
    publishLiveEvent({ companyId: pending.companyId, type: "agent.status", payload: { agentId, reason: "drain_after_triggered", runId } });
  }
}
