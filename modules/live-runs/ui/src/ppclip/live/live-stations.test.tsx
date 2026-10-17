// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";
import type { LiveRunForIssue } from "@/api/heartbeats";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { DashboardLive } from "@/pages/DashboardLive";
import { attentionFeedQueryKey, blockedTasksQueryKey } from "../attention/useAgentAttention";
import { feedItem } from "../attention/test-fixtures";
import { liveStationsRunsKey } from "./useLiveStations";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", companies: [{ id: "company-1" }] }) }));
const breadcrumbs = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: breadcrumbs.set }) }));
vi.mock("@/components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
const transcripts = vi.hoisted(() => ({ byRun: new Map<string, TranscriptEntry[]>(), requested: [] as string[][] }));
vi.mock("@/components/transcript/useLiveRunTranscripts", () => ({
  useLiveRunTranscripts: ({ runs }: { runs: { id: string }[] }) => {
    transcripts.requested.push(runs.map((run) => run.id));
    return { transcriptByRun: transcripts.byRun, hasOutputForRun: () => true };
  },
}));
const apis = vi.hoisted(() => ({ runGet: vi.fn(), cancel: vi.fn(), never: () => new Promise(() => {}) }));
vi.mock("@/api/heartbeats", () => ({
  heartbeatsApi: { get: apis.runGet, cancel: apis.cancel, liveRunsForCompany: apis.never },
}));
vi.mock("@/api/agents", () => ({ agentsApi: { list: apis.never } }));
vi.mock("@/api/issues", () => ({ issuesApi: { get: apis.never, list: apis.never } }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: apis.never } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: apis.never } }));

const agent = (id: string, status = "idle", extra: Partial<Agent> = {}): Agent => ({
  id, companyId: "company-1", name: `Agent ${id}`, urlKey: id, status, role: "engineer", title: null,
  adapterType: "claude_local", adapterConfig: { model: "claude-opus-4" }, ...extra,
} as unknown as Agent);
const run = (id: string, agentId: string, status: string, createdAt: string, extra: Partial<LiveRunForIssue> = {}): LiveRunForIssue => ({
  id, agentId, agentName: agentId, status, createdAt, startedAt: createdAt,
  finishedAt: ["running", "queued"].includes(status) ? null : createdAt,
  invocationSource: "assignment", triggerDetail: null, adapterType: "claude_local", ...extra,
});

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider><DashboardLive /></TooltipProvider></QueryClientProvider>);
  });
}
const cards = () => [...container.querySelectorAll<HTMLElement>("article[data-agent-id]")];
const card = (agentId: string) => container.querySelector<HTMLElement>(`article[data-agent-id='${agentId}']`)!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  transcripts.byRun = new Map();
  transcripts.requested = [];
  apis.runGet.mockReset();
  apis.cancel.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.agents.list("company-1"), [
    agent("idle-1"), agent("worker"), agent("waiter"), agent("queuer"), agent("fired", "terminated"),
  ]);
  client.setQueryData(queryKeys.liveRuns("company-1"), [
    run("run-work", "worker", "running", "2026-10-16T10:00:00Z", { issueId: "issue-1" }),
    run("run-queue", "queuer", "queued", "2026-10-16T10:05:00Z"),
  ]);
  client.setQueryData(liveStationsRunsKey("company-1"), [
    run("run-work-old", "worker", "succeeded", "2026-10-16T11:00:00Z"),
    run("run-idle", "idle-1", "succeeded", "2026-10-15T09:00:00Z", { issueId: "issue-2" }),
    run("run-fired", "fired", "running", "2026-10-16T09:00:00Z"),
  ]);
  client.setQueryData(attentionFeedQueryKey("company-1"), { items: [feedItem({ createdBy: "waiter" })] });
  client.setQueryData(blockedTasksQueryKey("company-1"), []);
  client.setQueryData(queryKeys.issues.detail("issue-1"), { id: "issue-1", identifier: "PAP-12", title: "Ship the live page", status: "in_progress" });
  client.setQueryData(queryKeys.issues.detail("issue-2"), { id: "issue-2", identifier: "PAP-9", title: "Write release notes", status: "done" });
  client.setQueryData(queryKeys.instance.experimentalSettings, { enableAgentChat: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Live runs page (DASH-2 stations)", () => {
  it("shows one card per non-terminated agent, working agents first", async () => {
    await render();
    expect(cards().map((element) => element.dataset.agentId)).toEqual(["worker", "queuer", "waiter", "idle-1"]);
    expect(cards().map((element) => element.dataset.phase)).toEqual(["running", "queued", "attention", "idle"]);
    expect(container.querySelector("h1")?.textContent).toBe("Live agent runs");
    expect(container.querySelector("[data-testid='live-summary']")?.textContent).toBe("1 working · 1 queued · 1 waiting · 1 idle");
    expect(breadcrumbs.set).toHaveBeenCalledWith([{ label: "Dashboard", href: "/dashboard" }, { label: "Live runs" }]);
  });

  it("shows the live activity from the transcript, task link, provider and model", async () => {
    transcripts.byRun.set("run-work", [{ kind: "tool_call", ts: "t", name: "Grep", input: {}, toolUseId: "g" }]);
    await render();
    const worker = card("worker");
    expect(worker.querySelector("[data-testid='station-activity']")?.textContent).toContain("Searching");
    expect(worker.getAttribute("aria-label")).toBe("Agent worker, Searching");
    expect(worker.querySelector<HTMLAnchorElement>("[data-testid='station-task']")?.textContent).toBe("PAP-12Ship the live page");
    expect(worker.textContent).toContain("claude-opus-4");
    expect(worker.querySelector("img")?.getAttribute("src")).toContain("/working.png");
    expect(worker.querySelector("a[aria-label='Open run details for Agent worker']")?.getAttribute("href")).toBe("/agents/worker/runs/run-work");
    expect(worker.querySelector("a[aria-label='Chat with Agent worker']")?.getAttribute("href")).toBe("/chats/worker");
    // Transcripts are requested for running cards only.
    expect(transcripts.requested.at(-1)).toEqual(["run-work"]);
  });

  it("gives running agents a motion-safe breathing halo and still avatars otherwise", async () => {
    await render();
    const halo = card("worker").querySelector<HTMLElement>("[data-presence='live']");
    expect(halo).not.toBeNull();
    expect(halo!.className).toContain("motion-safe:animate-pulse");
    expect(halo!.className.split(" ")).not.toContain("animate-pulse");
    expect(card("idle-1").querySelector("[data-presence]")).toBeNull();
    expect(card("queuer").querySelector("img")?.getAttribute("src")).toContain("/loading.png");
    expect(card("waiter").querySelector("img")?.getAttribute("src")).toContain("/listening.png");
  });

  it("shows an idle agent's last task and saved reply, expanding with Read full response", async () => {
    const reply = `Release notes are done. ${"Every section was reviewed with the team. ".repeat(12)}Final line.`;
    apis.runGet.mockResolvedValue({ id: "run-idle", resultJson: { summary: reply } });
    await render();
    const idle = card("idle-1");
    expect(idle.querySelector("[data-testid='station-task']")?.textContent).toBe("PAP-9Write release notes");
    expect(apis.runGet).toHaveBeenCalledWith("run-idle");
    expect(apis.runGet).toHaveBeenCalledTimes(1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const body = () => idle.querySelector("[data-testid='markdown']")!.textContent!;
    expect(body().endsWith("…")).toBe(true);
    expect(body()).not.toContain("Final line.");
    const toggle = [...idle.querySelectorAll("button")].find((button) => button.textContent === "Read full response")!;
    await act(async () => toggle.click());
    expect(body()).toContain("Final line.");
    expect(toggle.textContent).toBe("Show less");
    expect(idle.querySelector("a[aria-label='Open run details for Agent idle-1']")).not.toBeNull();
  });

  it("offers Stop only on active runs and hides Chat when Agent Chat is off", async () => {
    client.setQueryData(queryKeys.instance.experimentalSettings, { enableAgentChat: false });
    await render();
    expect(container.querySelector("a[aria-label^='Chat with']")).toBeNull();
    const stop = card("worker").querySelector<HTMLButtonElement>("button[aria-label=\"Stop Agent worker's run\"]");
    expect(stop).not.toBeNull();
    expect(card("idle-1").querySelector("button[aria-label^='Stop']")).toBeNull();
    await act(async () => stop!.click());
    expect(apis.cancel).toHaveBeenCalledWith("run-work");
  });
});
