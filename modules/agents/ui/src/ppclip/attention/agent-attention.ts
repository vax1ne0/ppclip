import type { Agent, AttentionItem } from "@paperclipai/shared";

/**
 * ppclip NAV-2: agent attention statuses derived from official data only.
 *
 *   waiting_for_you   the agent opened a decision only a person can answer: a
 *                     pending issue-thread interaction whose server-evaluated
 *                     resolver policy is `human_only` (legacy `board_only`), or
 *                     a pending board approval it requested. Read from the
 *                     official attention feed (the Decisions data).
 *   pending_on_agent  one of its blocked tasks waits on another agent's open
 *                     task (official `blockedBy` relations, incl. terminal blockers).
 *   blocked_task      one of its tasks is blocked for any other reason.
 *
 * Official's own states win where they say more: running, error, paused and
 * pending approval are never replaced.
 */
export type AttentionStatus = "waiting_for_you" | "pending_on_agent" | "blocked_task";

export const ATTENTION_LABELS: Record<AttentionStatus, string> = {
  waiting_for_you: "Waiting for you",
  pending_on_agent: "Pending on agent",
  blocked_task: "Blocked task",
};

export type TaskRef = { id: string; identifier: string | null; title: string };

type WaitingItem = {
  id: string;
  kind: "interaction" | "approval";
  title: string;
  href: string | null;
  task: TaskRef | null;
};

type AgentDependency = {
  /** The agent's blocked task. */
  task: TaskRef;
  /** The other agent's open task it waits on. */
  blocker: TaskRef;
  blockerAgentId: string;
};

export type AgentAttention = {
  waiting: WaitingItem[];
  dependencies: AgentDependency[];
  /** Blocked tasks that do not wait on another agent. */
  blockedTasks: TaskRef[];
};

/** Minimal blocked-task shape (official `Issue` with `includeBlockedBy`). */
export type BlockedTaskInput = {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  blockedBy?: BlockerInput[] | null;
};
type BlockerInput = {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  terminalBlockers?: BlockerInput[] | null;
};

const FINISHED = new Set(["done", "cancelled"]);
const ref = (task: { id: string; identifier?: string | null; title: string }): TaskRef => ({
  id: task.id,
  identifier: task.identifier ?? null,
  title: task.title,
});

/** Canonical resolver policy for a feed row (`board_only` is the legacy alias of `human_only`). */
function interactionResolverPolicy(item: AttentionItem): "anyone" | "not_creator" | "human_only" {
  const policy = item.resolverAudience?.effectiveResolverPolicy as string | undefined;
  if (policy === "human_only" || policy === "board_only") return "human_only";
  if (policy === "not_creator") return "not_creator";
  return "anyone";
}

function metadataString(item: AttentionItem, key: string): string | null {
  const value = item.subject.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The agent that is waiting on this feed row, when only a person can answer it. */
export function waitingAgentId(item: AttentionItem): string | null {
  if (item.sourceKind === "issue_thread_interaction") {
    if (interactionResolverPolicy(item) !== "human_only") return null;
    return item.resolverAudience?.createdByAgentId ?? metadataString(item, "createdByAgentId");
  }
  if (item.sourceKind === "approval") return metadataString(item, "requestedByAgentId");
  return null;
}

function relatedTask(item: AttentionItem): TaskRef | null {
  const issue = item.relatedIssue;
  if (!issue) return null;
  return { id: issue.id, identifier: issue.identifier, title: issue.title ?? issue.identifier ?? "Task" };
}

/** Per-agent attention from the attention feed and the company's blocked tasks. */
export function deriveAgentAttention(
  feedItems: readonly AttentionItem[],
  blockedTasks: readonly BlockedTaskInput[],
): Map<string, AgentAttention> {
  const result = new Map<string, AgentAttention>();
  const entry = (agentId: string) => {
    let value = result.get(agentId);
    if (!value) {
      value = { waiting: [], dependencies: [], blockedTasks: [] };
      result.set(agentId, value);
    }
    return value;
  };

  for (const item of feedItems) {
    const agentId = waitingAgentId(item);
    if (!agentId) continue;
    entry(agentId).waiting.push({
      id: item.id,
      kind: item.sourceKind === "approval" ? "approval" : "interaction",
      title: item.subject.title ?? "Decision",
      href: item.subject.href,
      task: relatedTask(item),
    });
  }

  for (const task of blockedTasks) {
    const owner = task.assigneeAgentId;
    if (!owner || task.status !== "blocked") continue;
    const seen = new Set<string>();
    const dependencies: AgentDependency[] = [];
    for (const relation of task.blockedBy ?? []) {
      for (const blocker of [relation, ...(relation.terminalBlockers ?? [])]) {
        if (seen.has(blocker.id) || blocker.id === task.id) continue;
        seen.add(blocker.id);
        if (FINISHED.has(blocker.status) || !blocker.assigneeAgentId || blocker.assigneeAgentId === owner) continue;
        dependencies.push({ task: ref(task), blocker: ref(blocker), blockerAgentId: blocker.assigneeAgentId });
      }
    }
    if (dependencies.length > 0) entry(owner).dependencies.push(...dependencies);
    else entry(owner).blockedTasks.push(ref(task));
  }
  return result;
}

/** Official states that already say more than a derived attention status. */
const OFFICIAL_WINS = new Set(["running", "error", "paused", "pending_approval", "terminated"]);

/** The derived status to show for an agent, or null to keep official's status. */
export function attentionStatusFor(
  agent: Pick<Agent, "status">,
  attention: AgentAttention | undefined,
): AttentionStatus | null {
  if (!attention || OFFICIAL_WINS.has(agent.status)) return null;
  if (attention.waiting.length > 0) return "waiting_for_you";
  if (attention.dependencies.length > 0) return "pending_on_agent";
  if (attention.blockedTasks.length > 0) return "blocked_task";
  return null;
}

/**
 * NAV-1 urgency bucket: 0 running/live, 1 waiting or pending, 2 blocked or
 * erroring (incl. budget-paused), 3 idle and everything else.
 */
export function urgencyRank(
  agent: Pick<Agent, "status" | "pauseReason">,
  liveRuns: number,
  attention: AgentAttention | undefined,
): number {
  if (liveRuns > 0 || agent.status === "running") return 0;
  if (agent.status === "pending_approval") return 1;
  if (agent.status === "error" || (agent.status === "paused" && agent.pauseReason === "budget")) return 2;
  if (agent.status === "paused" || agent.status === "terminated") return 3;
  if (attention?.waiting.length || attention?.dependencies.length) return 1;
  if (attention?.blockedTasks.length) return 2;
  return 3;
}

/** Stable sort by urgency: within a bucket the caller's existing order is kept. */
export function orderByUrgency<T extends { id: string }>(agents: readonly T[], rankOf: (agent: T) => number): T[] {
  return agents
    .map((agent, index) => ({ agent, index, rank: rankOf(agent) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.agent);
}

/** Confirmation / question cards listed by the Pending confirmations popover. */
const CONFIRMATION_CARD_KINDS = new Set([
  "request_confirmation",
  "request_checkbox_confirmation",
  "request_item_verdicts",
  "ask_user_questions",
]);

function isConfirmationCard(item: AttentionItem): boolean {
  if (item.sourceKind !== "issue_thread_interaction") return false;
  const kind = item.subject.metadata?.kind;
  return typeof kind === "string" && CONFIRMATION_CARD_KINDS.has(kind);
}

/** Open cards split by who can answer them, newest first within each group. */
export function splitPendingConfirmations(items: readonly AttentionItem[]) {
  const cards = items
    .filter(isConfirmationCard)
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  return {
    humanOnly: cards.filter((item) => interactionResolverPolicy(item) === "human_only"),
    shared: cards.filter((item) => interactionResolverPolicy(item) !== "human_only"),
  };
}
