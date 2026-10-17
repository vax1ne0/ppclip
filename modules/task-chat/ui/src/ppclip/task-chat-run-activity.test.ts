import { describe, expect, it } from "vitest";
import type {
  TaskChatItem,
  TaskChatTurnItem,
} from "@/components/task-chat/task-chat-model";
import type { SettledTurnMergeMeta } from "@/components/task-chat/transcript-adapter";
import type { IssueChatComment } from "@/lib/issue-chat-messages";
import {
  arrangeRunActivity,
  firstReplyCommentIdByRun,
  isRunForThisTask,
  placeTurnsBelowReplies,
  markFollowUpRuns,
  runsForThisTask,
  turnRunId,
} from "./task-chat-run-activity";
import { isSameRunAgent } from "./task-chat-same-agent";

describe("isRunForThisTask / runsForThisTask (CHAT-3)", () => {
  it("keeps runs started for this task and runs with no task context", () => {
    expect(isRunForThisTask({ contextIssueId: "task-b" }, "task-b")).toBe(true);
    expect(isRunForThisTask({ contextIssueId: null }, "task-b")).toBe(true);
    expect(isRunForThisTask({}, "task-b")).toBe(true);
    expect(isRunForThisTask({ contextIssueId: "" }, "task-b")).toBe(true);
  });

  it("drops runs started for a different task", () => {
    expect(isRunForThisTask({ contextIssueId: "task-a" }, "task-b")).toBe(false);
  });

  it("does not filter when the chat has no task id", () => {
    expect(isRunForThisTask({ contextIssueId: "task-a" }, null)).toBe(true);
    const runs = [{ contextIssueId: "task-a" }];
    expect(runsForThisTask(runs, undefined)).toBe(runs);
  });

  it("returns the same array when nothing is dropped and filters otherwise", () => {
    const own = [{ runId: "1", contextIssueId: "task-b" }, { runId: "2", contextIssueId: null }];
    expect(runsForThisTask(own, "task-b")).toBe(own);
    const mixed = [...own, { runId: "3", contextIssueId: "task-a" }];
    expect(runsForThisTask(mixed, "task-b")?.map((run) => run.runId)).toEqual(["1", "2"]);
    expect(runsForThisTask(undefined, "task-b")).toBeUndefined();
  });
});

function comment(
  id: string,
  createdAt: string,
  extra: Partial<IssueChatComment> = {},
): IssueChatComment {
  return {
    id,
    companyId: "company",
    issueId: "issue",
    authorType: "agent",
    authorAgentId: "agent-1",
    authorUserId: null,
    body: id,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...extra,
  } as IssueChatComment;
}

describe("firstReplyCommentIdByRun (CHAT-4 anchoring)", () => {
  it("anchors each run to its earliest reply regardless of input order", () => {
    const map = firstReplyCommentIdByRun([
      comment("late", "2025-01-01T10:00:30Z", { runId: "run-1" }),
      comment("early", "2025-01-01T10:00:10Z", { runId: "run-1" }),
      comment("other", "2025-01-01T10:00:20Z", { runId: "run-2" }),
    ]);
    expect(map.get("run-1")).toBe("early");
    expect(map.get("run-2")).toBe("other");
  });

  it("uses recovered run attribution and skips deleted and system comments", () => {
    const map = firstReplyCommentIdByRun([
      comment("deleted", "2025-01-01T10:00:01Z", { runId: "run-1", deletedAt: new Date() }),
      comment("notice", "2025-01-01T10:00:02Z", { runId: "run-1", authorType: "system" }),
      comment("stored", "2025-01-01T10:00:03Z", { createdByRunId: "run-1" }),
      comment("derived", "2025-01-01T10:00:04Z", { derivedCreatedByRunId: "run-2" }),
      comment("human", "2025-01-01T10:00:05Z", { authorType: "user", authorAgentId: null }),
    ]);
    expect(map.get("run-1")).toBe("stored");
    expect(map.get("run-2")).toBe("derived");
    expect(map.size).toBe(2);
  });

  it("leaves a steered run unanchored, like official", () => {
    const map = firstReplyCommentIdByRun([
      comment("reply", "2025-01-01T10:00:10Z", { runId: "run-1" }),
      comment("steer", "2025-01-01T10:00:05Z", {
        authorType: "user",
        authorAgentId: null,
        steeredIntoRunId: "run-1",
        conversationAnchorAt: "2025-01-01T10:00:06Z",
      }),
    ]);
    expect(map.has("run-1")).toBe(false);
  });
});

describe("isSameRunAgent (CHAT-4)", () => {
  it("prefers ids, falls back to non-empty names", () => {
    expect(isSameRunAgent({ agentKey: "a", agentName: "CEO" }, { agent: { id: "b" }, authorName: "CEO" })).toBe(false);
    expect(isSameRunAgent({ agentKey: "a" }, { agent: { id: "a" } })).toBe(true);
    expect(isSameRunAgent({ agentKey: "", agentName: "CEO" }, { authorName: "CEO" })).toBe(true);
    expect(isSameRunAgent({ agentKey: "", agentName: "CEO" }, { authorName: "QA" })).toBe(false);
    expect(isSameRunAgent({ agentKey: "a" }, { authorName: "CEO" })).toBe(false);
    expect(isSameRunAgent({ agentKey: "" }, {})).toBe(false);
    expect(isSameRunAgent(undefined, { agent: { id: "a" } })).toBe(false);
  });
});

const summary = { toolCount: 1, added: 0, removed: 0 };
function turn(id: string, extra: Partial<TaskChatTurnItem> = {}): TaskChatTurnItem {
  return { id, kind: "turn", settled: true, items: [], summary, ...extra };
}
function reply(id: string, agentId = "agent-1"): TaskChatItem {
  return { id, kind: "message", author: "agent", authorName: "CEO", agent: { id: agentId }, text: id };
}
function human(id: string): TaskChatItem {
  return { id, kind: "message", author: "human", text: id };
}
function meta(agentKey: string): SettledTurnMergeMeta {
  return { agentKey, agentName: "CEO", parts: [] };
}
const ids = (items: readonly TaskChatItem[]) => items.map((item) => item.id);

describe("turnRunId", () => {
  it("strips the turn suffix and segment index", () => {
    expect(turnRunId("run-1:turn")).toBe("run-1");
    expect(turnRunId("run-1:turn:2")).toBe("run-1");
  });
});

describe("placeTurnsBelowReplies", () => {
  const runs = new Map([["c1", "run-1"], ["c1b", "run-1"]]);

  it("moves an anchored turn directly below its run's last reply", () => {
    const out = placeTurnsBelowReplies(
      [human("ask"), turn("run-1:turn"), reply("c1"), reply("c1b"), human("next")],
      new Map([["run-1:turn", "c1"]]),
      runs,
    );
    expect(ids(out)).toEqual(["ask", "c1", "c1b", "run-1:turn", "next"]);
  });

  it("leaves a turn in place when its reply is not in the thread", () => {
    const out = placeTurnsBelowReplies(
      [human("ask"), turn("run-1:turn")],
      new Map([["run-1:turn", "missing"]]),
      runs,
    );
    expect(ids(out)).toEqual(["ask", "run-1:turn"]);
  });
});

describe("markFollowUpRuns", () => {
  const metaById = new Map([
    ["run-1:turn", meta("agent-1")],
    ["run-2:turn", meta("agent-1")],
    ["run-3:turn", meta("agent-2")],
  ]);
  const runByComment = new Map([
    ["c1", "run-1"],
    ["c2", "run-2"],
    ["c3", "run-3"],
  ]);

  it("divides consecutive separate runs of the same agent", () => {
    const out = markFollowUpRuns(
      [human("ask"), turn("run-1:turn"), reply("c1"), turn("run-2:turn"), reply("c2")],
      metaById,
      runByComment,
    );
    expect(ids(out)).toEqual(["ask", "run-1:turn", "c1", "run-2:ppclip-follow-up", "run-2:turn", "c2"]);
    const marker = out[3] as Extract<TaskChatItem, { kind: "marker" }>;
    expect(marker).toMatchObject({ variant: "turn_boundary", label: "Follow-up run" });
  });

  it("does not divide segments of one run, other agents, or exchanges split by a human", () => {
    expect(
      ids(markFollowUpRuns(
        [turn("run-1:turn:0"), reply("c1"), turn("run-1:turn:1")],
        new Map([["run-1:turn:0", meta("agent-1")], ["run-1:turn:1", meta("agent-1")]]),
        runByComment,
      )),
    ).toEqual(["run-1:turn:0", "c1", "run-1:turn:1"]);
    expect(
      ids(markFollowUpRuns([reply("c1"), turn("run-3:turn"), reply("c3", "agent-2")], metaById, runByComment)),
    ).toEqual(["c1", "run-3:turn", "c3"]);
    expect(
      ids(markFollowUpRuns([reply("c1"), human("again"), reply("c2")], metaById, runByComment)),
    ).toEqual(["c1", "again", "c2"]);
  });
});

describe("arrangeRunActivity", () => {
  it("keeps separate Worked rows below their replies and never attaches classic activity", () => {
    const run1 = turn("run-1:turn");
    const run2 = turn("run-2:turn");
    const out = arrangeRunActivity(
      [human("ask"), reply("c1"), run1, reply("c2"), run2],
      {
        settledTurns: [
          { turn: run1, anchorCommentId: "c1" },
          { turn: run2, anchorCommentId: "c2" },
        ],
        metaById: new Map([["run-1:turn", meta("agent-1")], ["run-2:turn", meta("agent-1")]]),
        comments: [
          comment("c1", "2025-01-01T10:00:10Z", { runId: "run-1" }),
          comment("c2", "2025-01-01T10:01:10Z", { runId: "run-2" }),
        ],
      },
    );
    expect(ids(out)).toEqual(["ask", "c1", "run-1:turn", "run-2:ppclip-follow-up", "c2", "run-2:turn"]);
    expect(out.every((item) => item.kind !== "message" || item.attachedTurn == null)).toBe(true);
  });

  it("still attaches a Paperclip Runner turn to its own reply", () => {
    const runner = turn("run-1:turn", { standaloneHeader: true });
    const out = arrangeRunActivity([human("ask"), reply("c1"), runner], {
      settledTurns: [{ turn: runner, anchorCommentId: "c1" }],
      metaById: new Map([["run-1:turn", meta("agent-1")]]),
      comments: [comment("c1", "2025-01-01T10:00:10Z", { runId: "run-1" })],
    });
    expect(ids(out)).toEqual(["ask", "c1"]);
    const bubble = out[1] as Extract<TaskChatItem, { kind: "message" }>;
    expect(bubble.attachedTurn?.id).toBe("run-1:turn");
  });
});
