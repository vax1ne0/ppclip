import { describe, expect, it } from "vitest";
import {
  attentionStatusFor,
  deriveAgentAttention,
  orderByUrgency,
  splitPendingConfirmations,
  urgencyRank,
  waitingAgentId,
  type BlockedTaskInput,
} from "./agent-attention";
import { feedItem } from "./test-fixtures";

const blocked = (id: string, owner: string, blockers: BlockedTaskInput["blockedBy"] = []): BlockedTaskInput => ({
  id, identifier: id.toUpperCase(), title: `Task ${id}`, status: "blocked", assigneeAgentId: owner, blockedBy: blockers,
});
const blocker = (id: string, owner: string | null, status = "in_progress") => ({
  id, identifier: id.toUpperCase(), title: `Task ${id}`, status, assigneeAgentId: owner,
});

describe("waitingAgentId", () => {
  it("treats human-only interactions (and legacy board_only) as waiting for a person", () => {
    expect(waitingAgentId(feedItem({ policy: "human_only" }))).toBe("agent-a");
    expect(waitingAgentId(feedItem({ policy: "board_only" }))).toBe("agent-a");
  });
  it("ignores cards a teammate could answer", () => {
    expect(waitingAgentId(feedItem({ policy: "anyone" }))).toBeNull();
    expect(waitingAgentId(feedItem({ policy: "not_creator" }))).toBeNull();
    expect(waitingAgentId(feedItem({ policy: null }))).toBeNull();
  });
  it("counts a pending approval against the agent that requested it", () => {
    const item = feedItem({ sourceKind: "approval" });
    item.subject.metadata = { requestedByAgentId: "agent-b" };
    expect(waitingAgentId(item)).toBe("agent-b");
  });
  it("ignores other feed sources", () => {
    expect(waitingAgentId(feedItem({ sourceKind: "failed_run" }))).toBeNull();
  });
});

describe("deriveAgentAttention", () => {
  it("splits blocked tasks into pending on another agent vs blocked for other reasons", () => {
    const result = deriveAgentAttention([], [
      blocked("t1", "agent-a", [blocker("b1", "agent-b")]),
      blocked("t2", "agent-c", [blocker("b2", "agent-c")]), // own task: not waiting on another agent
      blocked("t3", "agent-d", [blocker("b3", "agent-b", "done")]), // finished blocker
      blocked("t4", "agent-e", [{ ...blocker("b4", null), terminalBlockers: [blocker("b5", "agent-b")] }]),
    ]);
    expect(result.get("agent-a")?.dependencies.map((d) => [d.blocker.id, d.blockerAgentId])).toEqual([["b1", "agent-b"]]);
    expect(result.get("agent-c")?.blockedTasks.map((t) => t.id)).toEqual(["t2"]);
    expect(result.get("agent-d")?.blockedTasks.map((t) => t.id)).toEqual(["t3"]);
    expect(result.get("agent-e")?.dependencies.map((d) => d.blocker.id)).toEqual(["b5"]);
  });

  it("collects waiting items with their task", () => {
    const result = deriveAgentAttention([feedItem({})], []);
    expect(result.get("agent-a")?.waiting).toEqual([
      expect.objectContaining({ kind: "interaction", title: "Ship it?", task: { id: "issue-1", identifier: "PAP-1", title: "Launch" } }),
    ]);
  });
});

describe("attentionStatusFor", () => {
  const attention = deriveAgentAttention([feedItem({})], [
    blocked("t1", "agent-a", [blocker("b1", "agent-b")]),
    blocked("t2", "agent-b"),
    blocked("t3", "agent-c", [blocker("b3", "agent-b")]),
  ]);
  it("ranks waiting for you over pending on agent over blocked task", () => {
    expect(attentionStatusFor({ status: "idle" }, attention.get("agent-a"))).toBe("waiting_for_you");
    expect(attentionStatusFor({ status: "idle" }, attention.get("agent-c"))).toBe("pending_on_agent");
    expect(attentionStatusFor({ status: "active" }, attention.get("agent-b"))).toBe("blocked_task");
    expect(attentionStatusFor({ status: "idle" }, undefined)).toBeNull();
  });
  it("keeps official running, error and paused states", () => {
    for (const status of ["running", "error", "paused", "pending_approval"] as const) {
      expect(attentionStatusFor({ status }, attention.get("agent-a"))).toBeNull();
    }
  });
});

describe("urgency ordering", () => {
  const attention = deriveAgentAttention([feedItem({ createdBy: "wait" })], [
    blocked("t1", "pend", [blocker("b1", "other")]),
    blocked("t2", "block"),
  ]);
  const agents = [
    { id: "idle", status: "idle", pauseReason: null },
    { id: "block", status: "idle", pauseReason: null },
    { id: "err", status: "error", pauseReason: null },
    { id: "pend", status: "idle", pauseReason: null },
    { id: "budget", status: "paused", pauseReason: "budget" },
    { id: "live", status: "idle", pauseReason: null },
    { id: "wait", status: "idle", pauseReason: null },
    { id: "run", status: "running", pauseReason: null },
    { id: "paused", status: "paused", pauseReason: "manual" },
  ];
  const live = new Map([["live", 1]]);
  const rank = (agent: (typeof agents)[number]) => urgencyRank(agent as never, live.get(agent.id) ?? 0, attention.get(agent.id));

  it("puts running before waiting/pending before blocked/error before idle, stable within groups", () => {
    expect(orderByUrgency(agents, rank).map((a) => a.id)).toEqual([
      "live", "run", // running
      "pend", "wait", // waiting / pending, in the caller's order
      "block", "err", "budget", // blocked / error / budget-paused
      "idle", "paused", // idle and everything else
    ]);
  });

  it("does not reorder an all-idle list", () => {
    const idle = [{ id: "c" }, { id: "a" }, { id: "b" }];
    expect(orderByUrgency(idle, () => 3).map((a) => a.id)).toEqual(["c", "a", "b"]);
  });
});

describe("splitPendingConfirmations", () => {
  it("lists only confirmation/question cards, human-only first group, newest first", () => {
    const older = feedItem({ policy: "human_only", activityAt: "2026-10-01T00:00:00.000Z" });
    const newer = feedItem({ policy: "human_only", activityAt: "2026-10-02T00:00:00.000Z", kind: "ask_user_questions" });
    const shared = feedItem({ policy: "anyone", kind: "request_checkbox_confirmation" });
    const notCard = feedItem({ kind: "suggest_tasks" });
    const approval = feedItem({ sourceKind: "approval" });
    const groups = splitPendingConfirmations([older, shared, newer, notCard, approval]);
    expect(groups.humanOnly).toEqual([newer, older]);
    expect(groups.shared).toEqual([shared]);
  });
});
