/**
 * ppclip TEAM-1: work relationships between agents, derived from open tasks.
 *
 * Only relationships where work is expected to come back are drawn:
 *   waiting: `from` has a blocked task that is held up by `to`'s open task
 *            (official `blockedBy` relations, including their terminal blockers,
 *            plus open subtasks of a blocked parent, marked as inferred).
 *   loop:    work is bouncing between the pair: a review is in progress on a task
 *            one created for the other, or each has open work created by the other.
 * A one-way handoff whose creator is not waiting on it draws nothing.
 */
export type AgentLinkKind = "waiting" | "loop";
export interface AgentLink { from: string; to: string; kind: AgentLinkKind; tasks: string[] }

type Ref = {
  id: string;
  identifier?: string | null;
  title?: string | null;
  status: string;
  assigneeAgentId?: string | null;
  terminalBlockers?: Ref[];
};
export type LinkIssue = Ref & {
  parentId?: string | null;
  createdByAgentId?: string | null;
  blockedBy?: Ref[];
};

const OPEN = new Set(["todo", "in_progress", "in_review", "blocked"]);
const isOpen = (issue: Ref) => OPEN.has(issue.status);
const label = (issue: Ref) => `${issue.identifier ?? issue.id.slice(0, 8)}${issue.title ? ` · ${issue.title}` : ""}`;

export function buildAgentLinks(issues: LinkIssue[]): AgentLink[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const links = new Map<string, AgentLink>();
  const handoffs = new Map<string, AgentLink>();
  const add = (from: string, to: string, kind: AgentLinkKind | "handoff", task: string) => {
    if (from === to) return;
    const store = kind === "handoff" ? handoffs : links;
    const key = `${kind === "handoff" ? "loop" : kind}:${from}:${to}`;
    const link = store.get(key) ?? { from, to, kind: kind === "handoff" ? "loop" : kind, tasks: [] };
    if (!link.tasks.includes(task)) link.tasks.push(task);
    store.set(key, link);
  };

  for (const issue of issues) {
    const owner = issue.assigneeAgentId;
    if (!owner || !isOpen(issue)) continue;
    if (issue.status === "blocked") {
      const blockers: Ref[] = [];
      for (const relation of issue.blockedBy ?? []) {
        // Prefer the freshest copy of the blocker when the list includes it.
        blockers.push(byId.get(relation.id) ?? relation);
        for (const terminal of relation.terminalBlockers ?? []) blockers.push(byId.get(terminal.id) ?? terminal);
      }
      for (const blocker of blockers) {
        if (blocker.id !== issue.id && isOpen(blocker) && blocker.assigneeAgentId) {
          add(owner, blocker.assigneeAgentId, "waiting", label(blocker));
        }
      }
      // Parentage alone is evidence, not a recorded prerequisite. Keep that distinction visible.
      for (const child of issues.filter((candidate) => candidate.parentId === issue.id)) {
        if (!blockers.some((blocker) => blocker.id === child.id) && isOpen(child) && child.assigneeAgentId) {
          add(owner, child.assigneeAgentId, "waiting", `${label(child)} (open subtask; inferred)`);
        }
      }
    } else if (issue.createdByAgentId) {
      // A review in progress comes back to the creator; other handoffs only count if they run both ways.
      add(issue.createdByAgentId, owner, issue.status === "in_review" ? "loop" : "handoff", label(issue));
    }
  }

  const out = [...links.values()];
  const has = (kind: AgentLinkKind, from: string, to: string) =>
    links.has(`${kind}:${from}:${to}`) || links.has(`${kind}:${to}:${from}`);
  const done = new Set<string>();
  for (const [key, link] of handoffs) {
    if (done.has(key)) continue;
    const reverseKey = `loop:${link.to}:${link.from}`;
    // The way back may be a one-way handoff or a review already drawn as a loop.
    const reverse = handoffs.get(reverseKey) ?? links.get(reverseKey);
    if (!reverse) continue;
    done.add(key);
    done.add(reverseKey);
    if (has("waiting", link.from, link.to)) continue;
    const existing = out.find((candidate) => candidate.kind === "loop"
      && ((candidate.from === link.from && candidate.to === link.to) || (candidate.from === link.to && candidate.to === link.from)));
    const tasks = [...link.tasks, ...reverse.tasks];
    if (existing) existing.tasks.push(...tasks.filter((task) => !existing.tasks.includes(task)));
    else out.push({ from: link.from, to: link.to, kind: "loop", tasks });
  }
  return out;
}
