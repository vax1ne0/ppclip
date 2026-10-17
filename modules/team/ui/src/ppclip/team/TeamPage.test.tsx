// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Issue } from "@paperclipai/shared";
import { applyCompanyPrefix, isBoardPathWithoutPrefix } from "@/lib/company-routes";
import { TeamAgentCard, selectTeamWork, type TeamCardPresentation } from "./TeamAgentCard";
import { TEAM_OPEN_STATUSES } from "./useTeamData";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listIssues: vi.fn(),
  experimental: vi.fn(),
  setBreadcrumbs: vi.fn(),
  actionProps: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "co-1" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }) }));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewAgent: vi.fn() }) }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: mocks.listAgents } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: mocks.listIssues } }));
vi.mock("@/api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: mocks.experimental } }));
vi.mock("@/components/AgentActionButtons", () => ({
  AgentActionButtons: (props: Record<string, unknown>) => {
    mocks.actionProps.push(props);
    return <button type="button">Pause</button>;
  },
}));

import { TeamPage } from "./TeamPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = (id: string, name: string, extra: Partial<Agent> = {}) =>
  ({ id, companyId: "co-1", name, urlKey: name.toLowerCase(), role: "engineer", title: null, status: "idle", reportsTo: null, lastHeartbeatAt: null, ...extra }) as Agent;
const task = (id: string, status: string, assigneeAgentId: string, extra: Partial<Issue> = {}) =>
  ({ id, identifier: id, title: `Task ${id}`, status, assigneeAgentId, parentId: null, createdByAgentId: null, ...extra }) as Issue;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  mocks.actionProps.length = 0;
  for (const fn of [mocks.listAgents, mocks.listIssues, mocks.experimental, mocks.setBreadcrumbs]) fn.mockReset();
  mocks.experimental.mockResolvedValue({ enableAgentChat: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("Team page", () => {
  it("is a company-prefixed board route", () => {
    expect(isBoardPathWithoutPrefix("/team")).toBe(true);
    expect(applyCompanyPrefix("/team", "PAP")).toBe("/PAP/team");
  });

  it("renders a card per active agent with work, chat and actions from official APIs", async () => {
    mocks.listAgents.mockResolvedValue([
      agent("lead", "Lead", { role: "ceo" }),
      agent("eng", "Engineer", { reportsTo: "lead", status: "running" }),
      agent("gone", "Gone", { status: "terminated" }),
    ]);
    mocks.listIssues.mockResolvedValue([
      task("T-2", "blocked", "eng", { blockedBy: [{ id: "T-9", identifier: "T-9", title: "Spec", status: "in_progress", assigneeAgentId: "lead" }] as Issue["blockedBy"] }),
      task("T-1", "in_progress", "eng"),
      task("T-9", "in_progress", "lead"),
    ]);
    await render(<TeamPage />);

    expect(mocks.setBreadcrumbs).toHaveBeenCalledWith([{ label: "Team" }]);
    expect(mocks.listIssues).toHaveBeenCalledWith("co-1", expect.objectContaining({ status: TEAM_OPEN_STATUSES, includeBlockedBy: true }));
    expect(container.querySelector("[data-team-card=lead]")).not.toBeNull();
    expect(container.querySelector("[data-team-card=eng]")).not.toBeNull();
    expect(container.querySelector("[data-team-card=gone]")).toBeNull();

    const eng = container.querySelector("[data-team-card=eng]")!;
    const work = [...eng.querySelectorAll("li a")].map((link) => link.getAttribute("href"));
    expect(work).toEqual(["/issues/T-1", "/issues/T-2"]);
    expect(eng.querySelector("[aria-label='Chat with Engineer']")?.getAttribute("href")).toBe("/chats/engineer");
    expect(eng.textContent).toContain("running");
    expect(mocks.actionProps.at(-1)).toMatchObject({ showAssign: false, showRun: false, showStatus: false });

    // Reporting line plus the waiting arrow derived from the blocked task.
    expect(container.querySelector("path[data-kind=report]")).not.toBeNull();
    expect(container.querySelector("path[data-kind=waiting]")).not.toBeNull();
  });

  it("hides work arrows and says why when tasks cannot load", async () => {
    mocks.listAgents.mockResolvedValue([agent("a", "Ada")]);
    mocks.listIssues.mockRejectedValue(new Error("nope"));
    await render(<TeamPage />);
    expect(container.textContent).toContain("Couldn’t load assigned work.");
    expect(container.querySelector("path[data-kind=waiting]")).toBeNull();
  });
});

describe("Team card", () => {
  const presentation = (extra: Partial<TeamCardPresentation> = {}): TeamCardPresentation => ({
    level: 2, groupLabel: "Engineering", groupColor: "var(--agent-5a)", showLabels: true, managerName: "Lead",
    header: (children) => children, ...extra,
  });

  it("orders assigned work in progress first, then blocked", () => {
    const tasks = [task("C", "todo", "a"), task("B", "blocked", "a"), task("A", "in_progress", "a"), task("D", "done", "a"), task("E", "in_progress", "other")];
    expect(selectTeamWork(tasks, "a").map((t) => t.id)).toEqual(["A", "B", "C"]);
  });

  it("shows role, group, depth dots and hides chat when agent chat is off", async () => {
    await render(
      <TeamAgentCard agent={agent("a", "Ada", { title: "Backend" })} tasks={[]} workState="ready" retryWork={vi.fn()} chatEnabled={false} presentation={presentation()} />,
    );
    expect(container.textContent).toContain("Backend · Engineering");
    expect(container.querySelector("[aria-label^='Reporting level 2, reports to Lead']")!.children).toHaveLength(2);
    expect(container.querySelector("[aria-label^='Chat with']")).toBeNull();
    expect(container.textContent).toContain("No open tasks.");
  });

  it("does not mistake loading work for no work", async () => {
    await render(<TeamAgentCard agent={agent("a", "Ada")} tasks={[]} workState="loading" retryWork={vi.fn()} chatEnabled presentation={presentation({ showLabels: false })} />);
    expect(container.textContent).toContain("Loading assigned work");
    expect(container.textContent).not.toContain("No open tasks.");
    expect(container.querySelector("[aria-label^='Reporting level']")).toBeNull();
  });
});
