// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { AgentAttentionBadge } from "./AgentAttentionBadge";
import { PendingConfirmations } from "./PendingConfirmations";
import { attentionFeedQueryKey, blockedTasksQueryKey } from "./useAgentAttention";
import { feedItem } from "./test-fixtures";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
const apis = vi.hoisted(() => ({ attention: vi.fn(), issues: vi.fn(), agents: vi.fn() }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: apis.attention } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: apis.issues } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: apis.agents } }));

const agent = (id: string, status = "idle") => ({ id, companyId: "company-1", name: `Agent ${id}`, status } as Agent);

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(attentionFeedQueryKey("company-1"), {
    items: [
      feedItem({ createdBy: "wait", subject: { ...feedItem({}).subject, title: "Approve the launch plan?" } }),
      feedItem({ createdBy: "other", policy: "anyone", kind: "ask_user_questions", subject: { ...feedItem({}).subject, title: "Which region?", href: "/PAP/issues/PAP-2#interaction-q" } }),
    ],
  });
  client.setQueryData(blockedTasksQueryKey("company-1"), [
    { id: "t1", identifier: "PAP-7", title: "Write docs", status: "blocked", assigneeAgentId: "pend",
      blockedBy: [{ id: "b1", identifier: "PAP-8", title: "Build API", status: "in_progress", assigneeAgentId: "builder" }] },
    { id: "t2", identifier: "PAP-9", title: "Deploy", status: "blocked", assigneeAgentId: "stuck", blockedBy: [] },
  ]);
  client.setQueryData(queryKeys.agents.list("company-1"), [agent("builder")]);
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

describe("AgentAttentionBadge", () => {
  it("shows derived statuses in the official chip style", async () => {
    await render(<>
      <AgentAttentionBadge agent={agent("wait")} />
      <AgentAttentionBadge agent={agent("pend")} />
      <AgentAttentionBadge agent={agent("stuck")} />
    </>);
    const chips = [...container.querySelectorAll<HTMLElement>("[data-attention-status]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["Waiting for you", "Pending on agent", "Blocked task"]);
    expect(chips.every((chip) => chip.classList.contains("status-chip"))).toBe(true);
    expect(chips[0]!.style.getPropertyValue("--sc")).toBe("var(--status-task-in_review)");
  });

  it("falls back to official's badge when nothing applies or official's state wins", async () => {
    await render(<>
      <AgentAttentionBadge agent={agent("calm")} />
      <AgentAttentionBadge agent={agent("wait", "running")} />
    </>);
    expect(container.querySelector("[data-attention-status]")).toBeNull();
    expect(container.textContent).toBe("idlerunning");
  });

  it("explains a pending status on focus, naming the teammate", async () => {
    await render(<AgentAttentionBadge agent={agent("pend")} />);
    const trigger = container.querySelector<HTMLElement>("[tabindex='0']")!;
    await act(async () => { trigger.focus(); });
    const tooltip = document.body.querySelector("[data-slot='tooltip-content']");
    expect(tooltip?.textContent).toContain("PAP-7 · Write docs waits on PAP-8 · Build API (Agent builder)");
  });
});

describe("PendingConfirmations", () => {
  it("lists open cards split by who can respond, each linking to its card", async () => {
    await render(<PendingConfirmations companyId="company-1" />);
    const button = container.querySelector<HTMLButtonElement>("button[aria-label='Pending confirmations: 2']");
    expect(button).not.toBeNull();
    await act(async () => { button!.click(); });
    const needs = document.body.querySelector("section[aria-label='Needs your response']");
    const shared = document.body.querySelector("section[aria-label='You or a teammate can respond']");
    expect(needs?.textContent).toContain("Approve the launch plan?");
    expect(needs?.textContent).toContain("from Name wait");
    expect(shared?.textContent).toContain("Which region?");
    expect(shared?.querySelector("a")?.getAttribute("href")).toBe("/PAP/issues/PAP-2#interaction-q");
  });

  it("renders nothing until the feed loads", async () => {
    client.removeQueries({ queryKey: attentionFeedQueryKey("company-1") });
    apis.attention.mockReturnValue(new Promise(() => {}));
    await render(<PendingConfirmations companyId="company-1" />);
    expect(container.innerHTML).toBe("");
  });
});
