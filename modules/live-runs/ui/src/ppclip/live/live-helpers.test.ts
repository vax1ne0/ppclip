import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";
import type { LiveRunForIssue } from "@/api/heartbeats";
import type { AgentAttention } from "../attention/agent-attention";
import { EMPTY_ATTENTION } from "../attention/test-fixtures";
import { currentRunActivity, poseForActivity, resolveLiveActivity, toolActivity } from "./live-activity";
import { buildStations, countStations, latestRunByAgent, stationPhase, stationSummary } from "./station-order";
import { replyExcerpt, savedReply } from "./saved-reply";

const call = (name: string, toolUseId = name): TranscriptEntry => ({ kind: "tool_call", ts: "t", name, input: {}, toolUseId });
const result = (toolUseId: string): TranscriptEntry => ({ kind: "tool_result", ts: "t", toolUseId, content: "ok", isError: false });

describe("currentRunActivity", () => {
  it("names the newest unfinished tool call in plain words", () => {
    expect(currentRunActivity([call("read_file")])?.label).toBe("Reading");
    expect(currentRunActivity([call("Read")])?.label).toBe("Reading");
    expect(currentRunActivity([call("apply_patch")])?.label).toBe("Writing");
    expect(currentRunActivity([call("Edit")])?.label).toBe("Writing");
    expect(currentRunActivity([call("Grep")])?.label).toBe("Searching");
    expect(currentRunActivity([call("WebSearch")])?.label).toBe("Searching");
    expect(currentRunActivity([call("exec_command")])?.label).toBe("Running command");
    expect(currentRunActivity([call("Bash")])?.label).toBe("Running command");
    expect(currentRunActivity([call("mcp__linear__create_ticket")])?.label).toBe("Using create ticket");
  });

  it("stops claiming a tool runs once its result arrived", () => {
    expect(currentRunActivity([call("read_file", "a"), result("a")])?.label).toBe("Thinking");
    expect(currentRunActivity([call("Bash", "x"), call("read_file", "a"), result("a")])?.label).toBe("Running command");
  });

  it("reports Responding / Thinking from the latest text entry", () => {
    expect(currentRunActivity([call("Read", "a"), result("a"), { kind: "assistant", ts: "t", text: "Done" }])?.label).toBe("Responding");
    expect(currentRunActivity([{ kind: "thinking", ts: "t", text: "hmm" }])?.label).toBe("Thinking");
  });

  it("says the run waits on a person while a runtime request is pending", () => {
    const request = (status: "pending" | "resolved"): TranscriptEntry => ({
      kind: "runtime_request", ts: "t", requestId: "r1", requestKind: "command_approval", turnId: null,
      requestType: "permission", status, prompt: "Run?", choices: [], fields: [],
    });
    expect(currentRunActivity([call("Bash"), request("pending")])).toEqual({ kind: "waiting", label: "Waiting for approval" });
    expect(currentRunActivity([request("pending"), request("resolved")])).toBeNull();
  });

  it("falls back to the server's run progress, then to Working", () => {
    expect(resolveLiveActivity([], { currentToolName: "Grep" }).label).toBe("Searching");
    expect(resolveLiveActivity([], { lastAssistantSnippet: "Hi" }).label).toBe("Responding");
    expect(resolveLiveActivity([], {}).label).toBe("Working");
    expect(resolveLiveActivity([call("Edit")], { currentToolName: "Grep" }).label).toBe("Writing");
  });

  it("maps activities to official avatar poses", () => {
    expect(poseForActivity("thinking")).toBe("thinking");
    expect(poseForActivity("waiting")).toBe("listening");
    expect(poseForActivity(toolActivity("Bash").kind)).toBe("working");
  });
});

const agent = (id: string, status = "idle"): Agent => ({ id, companyId: "c", name: `Agent ${id}`, status, role: "engineer", title: null, adapterType: "claude_local", adapterConfig: {}, urlKey: id } as unknown as Agent);
let seq = 0;
const run = (agentId: string, status: string, createdAt: string, extra: Partial<LiveRunForIssue> = {}): LiveRunForIssue => ({
  id: `run-${agentId}-${seq++}`, agentId, agentName: agentId, status, createdAt, startedAt: createdAt,
  finishedAt: ["running", "queued"].includes(status) ? null : createdAt, invocationSource: "assignment",
  triggerDetail: null, adapterType: "claude_local", ...extra,
});

describe("station ordering", () => {
  it("keeps one run per agent: active beats a newer finished run, otherwise newest wins", () => {
    const picked = latestRunByAgent([
      run("a", "succeeded", "2026-10-02T00:00:00Z"),
      run("a", "running", "2026-10-01T00:00:00Z"),
      run("b", "failed", "2026-10-01T00:00:00Z"),
      run("b", "succeeded", "2026-10-03T00:00:00Z"),
      run("c", "queued", "2026-10-04T00:00:00Z"),
      run("c", "running", "2026-10-01T00:00:00Z"),
    ]);
    expect(picked.get("a")?.status).toBe("running");
    expect(picked.get("b")?.status).toBe("succeeded");
    expect(picked.get("c")?.status).toBe("running");
  });

  it("orders running → queued → waiting/pending → error/paused → idle, newest first within a group", () => {
    const attention = new Map<string, AgentAttention>([
      ["waits", { ...EMPTY_ATTENTION, waiting: [{ id: "i", kind: "interaction", title: "Ok?", href: null, task: null }] }],
      ["pends", { ...EMPTY_ATTENTION, dependencies: [{ task: { id: "t", identifier: null, title: "T" }, blocker: { id: "b", identifier: null, title: "B" }, blockerAgentId: "x" }] }],
    ]);
    const stations = buildStations(
      [agent("idle-old"), agent("never"), agent("paused", "paused"), agent("waits"), agent("pends"), agent("queued"), agent("runs"), agent("idle-new"), agent("broke"), agent("gone", "terminated")],
      [
        run("idle-old", "succeeded", "2026-10-01T00:00:00Z"),
        run("idle-new", "succeeded", "2026-10-05T00:00:00Z"),
        run("queued", "queued", "2026-10-06T00:00:00Z"),
        run("runs", "running", "2026-10-02T00:00:00Z"),
        run("broke", "failed", "2026-10-03T00:00:00Z"),
        run("gone", "running", "2026-10-07T00:00:00Z"),
      ],
      attention,
    );
    expect(stations.map((station) => station.agent.id)).toEqual([
      "runs", "queued", "waits", "pends", "broke", "paused", "idle-new", "idle-old", "never",
    ]);
    expect(stations.map((station) => station.phase)).toEqual([
      "running", "queued", "attention", "attention", "trouble", "trouble", "idle", "idle", "idle",
    ]);
    expect(stations.find((station) => station.agent.id === "waits")?.attentionStatus).toBe("waiting_for_you");
    expect(countStations(stations)).toEqual({ running: 1, queued: 1, attention: 2, trouble: 2, idle: 3 });
  });

  it("lets official states win over derived attention", () => {
    expect(stationPhase({ status: "running" }, null, null)).toBe("running");
    expect(stationPhase({ status: "pending_approval" }, null, null)).toBe("attention");
    expect(stationPhase({ status: "error" }, null, null)).toBe("trouble");
    expect(stationPhase({ status: "idle" }, { status: "running" }, "waiting_for_you")).toBe("running");
    expect(stationPhase({ status: "idle" }, null, "blocked_task")).toBe("trouble");
  });
});

describe("saved reply and summary", () => {
  it("reads the saved reply from the run result, never inventing one", () => {
    expect(savedReply({ summary: " Shipped it. " })).toBe("Shipped it.");
    expect(savedReply({ result: "From result" })).toBe("From result");
    expect(savedReply({ stdout: "log" })).toBeNull();
    expect(savedReply(null)).toBeNull();
  });

  it("cuts long replies at a word boundary", () => {
    expect(replyExcerpt("short")).toEqual({ text: "short", truncated: false });
    const long = replyExcerpt("word ".repeat(100), 40);
    expect(long.truncated).toBe(true);
    expect(long.text.endsWith("word…")).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(41);
  });

  it("summarises the page in one line, leaving out empty groups", () => {
    expect(stationSummary({ running: 2, queued: 0, attention: 1, trouble: 1, idle: 5 })).toBe("2 working · 1 waiting · 1 needs a look · 5 idle");
    expect(stationSummary({ running: 0, queued: 0, attention: 0, trouble: 0, idle: 0 })).toBe("No agents yet");
  });
});
