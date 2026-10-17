import { describe, expect, it } from "vitest";
import { buildAgentLinks, type LinkIssue } from "./agent-links";

const issue = (id: string, fields: Partial<LinkIssue>): LinkIssue => ({ id, identifier: id, title: null, status: "todo", assigneeAgentId: null, ...fields });

describe("buildAgentLinks", () => {
  it("draws waiting from a blocked task's owner to the blocker's owner", () => {
    const links = buildAgentLinks([
      issue("A-49", { status: "blocked", assigneeAgentId: "ahmed", blockedBy: [issue("A-54", { status: "blocked", assigneeAgentId: "layla" })] }),
      issue("A-54", { status: "blocked", assigneeAgentId: "layla" }),
    ]);
    expect(links).toEqual([{ from: "ahmed", to: "layla", kind: "waiting", tasks: ["A-54"] }]);
  });

  it("draws nothing for a one-way handoff the creator is not waiting on", () => {
    const links = buildAgentLinks([
      issue("A-55", { status: "in_progress", assigneeAgentId: "ahmed" }),
      issue("A-63", { status: "in_progress", assigneeAgentId: "karim", parentId: "A-55", createdByAgentId: "ahmed" }),
    ]);
    expect(links).toEqual([]);
  });

  it("draws a loop while a review is in progress", () => {
    const links = buildAgentLinks([issue("A-7", { status: "in_review", assigneeAgentId: "youssef", createdByAgentId: "omar" })]);
    expect(links).toEqual([{ from: "omar", to: "youssef", kind: "loop", tasks: ["A-7"] }]);
  });

  it("labels open sub-tasks of a blocked parent as inferred dependencies", () => {
    const links = buildAgentLinks([
      issue("A-55", { status: "blocked", assigneeAgentId: "ahmed" }),
      issue("A-59", { status: "in_progress", assigneeAgentId: "omar", parentId: "A-55", createdByAgentId: "ahmed" }),
    ]);
    expect(links).toEqual([{ from: "ahmed", to: "omar", kind: "waiting", tasks: ["A-59 (open subtask; inferred)"] }]);
  });

  it("marks handoffs in both directions as a loop and ignores finished work", () => {
    const links = buildAgentLinks([
      issue("A-1", { status: "in_progress", assigneeAgentId: "omar", createdByAgentId: "karim" }),
      issue("A-2", { status: "in_review", assigneeAgentId: "karim", createdByAgentId: "omar" }),
      issue("A-3", { status: "done", assigneeAgentId: "nour", createdByAgentId: "karim" }),
    ]);
    expect(links).toEqual([{ from: "omar", to: "karim", kind: "loop", tasks: ["A-2", "A-1"] }]);
  });

  it("follows official terminal blockers to the agent actually holding the work", () => {
    const links = buildAgentLinks([
      issue("A-10", { status: "blocked", assigneeAgentId: "ahmed", blockedBy: [
        { id: "A-11", identifier: "A-11", status: "blocked", assigneeAgentId: "layla",
          terminalBlockers: [{ id: "A-12", identifier: "A-12", status: "in_progress", assigneeAgentId: "omar" }] },
      ] }),
    ]);
    expect(links).toEqual([{ from: "ahmed", to: "layla", kind: "waiting", tasks: ["A-11"] }, { from: "ahmed", to: "omar", kind: "waiting", tasks: ["A-12"] }]);
  });
});
