import type { Agent } from "@paperclipai/shared";
import type { LiveRunForIssue } from "@/api/heartbeats";
import { attentionStatusFor, type AgentAttention, type AttentionStatus } from "../attention/agent-attention";

/**
 * ppclip DASH-2: one "station" per agent on the Live page.
 *
 *   running   the agent has a running run
 *   queued    its newest active run is still queued
 *   attention a person or a teammate is holding it up (waiting for you,
 *             pending on agent, pending approval)
 *   trouble   error / paused / blocked task, or its latest run failed
 *   idle      everyone else, most recently active first
 */
type StationPhase = "running" | "queued" | "attention" | "trouble" | "idle";

export type Station = {
  agent: Agent;
  /** The run the card shows: an active run beats a newer finished one. */
  run: LiveRunForIssue | null;
  phase: StationPhase;
  /** NAV-2 derived status, when it applies. */
  attentionStatus: AttentionStatus | null;
};

const FAILED = new Set(["failed", "timed_out"]);
const PHASE_RANK: Record<StationPhase, number> = { running: 0, queued: 1, attention: 2, trouble: 3, idle: 4 };

const time = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0);
const lastActivity = (run: LiveRunForIssue) => Math.max(time(run.finishedAt), time(run.startedAt), time(run.createdAt));

/** The run to show for each agent: running beats queued beats finished; otherwise newest wins. */
export function latestRunByAgent(runs: readonly LiveRunForIssue[]): Map<string, LiveRunForIssue> {
  const weight = (run: LiveRunForIssue) => (run.status === "running" ? 2 : run.status === "queued" ? 1 : 0);
  const result = new Map<string, LiveRunForIssue>();
  for (const run of runs) {
    const previous = result.get(run.agentId);
    if (
      !previous
      || weight(run) > weight(previous)
      || (weight(run) === weight(previous) && time(run.createdAt) > time(previous.createdAt))
    ) {
      result.set(run.agentId, run);
    }
  }
  return result;
}

export function stationPhase(
  agent: Pick<Agent, "status">,
  run: Pick<LiveRunForIssue, "status"> | null,
  attentionStatus: AttentionStatus | null,
): StationPhase {
  if (run?.status === "running") return "running";
  if (run?.status === "queued") return "queued";
  if (agent.status === "running") return "running";
  if (attentionStatus === "waiting_for_you" || attentionStatus === "pending_on_agent" || agent.status === "pending_approval") {
    return "attention";
  }
  if (agent.status === "error" || agent.status === "paused" || attentionStatus === "blocked_task") return "trouble";
  if (run && FAILED.has(run.status)) return "trouble";
  return "idle";
}

/**
 * One station per non-terminated agent, ordered running → queued → waiting /
 * pending → error / paused → idle. Inside a group the most recent activity
 * comes first; agents with no recent run keep the roster order at the end.
 */
export function buildStations(
  agents: readonly Agent[],
  runs: readonly LiveRunForIssue[],
  attention: ReadonlyMap<string, AgentAttention>,
): Station[] {
  const runByAgent = latestRunByAgent(runs);
  return agents
    .filter((agent) => agent.status !== "terminated")
    .map((agent, index) => {
      const run = runByAgent.get(agent.id) ?? null;
      const attentionStatus = attentionStatusFor(agent, attention.get(agent.id));
      return { station: { agent, run, phase: stationPhase(agent, run, attentionStatus), attentionStatus }, index };
    })
    .sort((a, b) => {
      const byPhase = PHASE_RANK[a.station.phase] - PHASE_RANK[b.station.phase];
      if (byPhase !== 0) return byPhase;
      const aTime = a.station.run ? lastActivity(a.station.run) : 0;
      const bTime = b.station.run ? lastActivity(b.station.run) : 0;
      return bTime - aTime || a.index - b.index;
    })
    .map(({ station }) => station);
}

type StationCounts = Record<StationPhase, number>;

export function countStations(stations: readonly Station[]): StationCounts {
  const counts: StationCounts = { running: 0, queued: 0, attention: 0, trouble: 0, idle: 0 };
  for (const station of stations) counts[station.phase] += 1;
  return counts;
}

/** "2 working · 1 queued · 1 waiting · 1 needs a look · 5 idle", leaving out empty groups. */
export function stationSummary(counts: StationCounts): string {
  const parts = [
    counts.running ? `${counts.running} working` : null,
    counts.queued ? `${counts.queued} queued` : null,
    counts.attention ? `${counts.attention} waiting` : null,
    counts.trouble ? `${counts.trouble} need${counts.trouble === 1 ? "s" : ""} a look` : null,
    counts.idle ? `${counts.idle} idle` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No agents yet";
}
