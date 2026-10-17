// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "@/context/ToastContext";
import { Agents } from "@/pages/Agents";
import { runControlsQueryKey } from "@/ppclip/run-controls/useRunControls";
import { EXTRA_COLUMNS_STORAGE_KEY } from "./RosterExtraColumns";
import { AgentTaskHoverCard, orderCurrentTasks } from "./AgentTaskHoverCard";

const api = vi.hoisted(() => ({
  agents: vi.fn(),
  issues: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ pathname: "/agents/all", search: "", hash: "", state: null }),
  useNavigate: () => api.navigate,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1" }) }));
vi.mock("@/context/DialogContext", () => ({ useDialogActions: () => ({ openNewAgent: vi.fn() }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: api.agents, org: vi.fn(async () => []) } }));
vi.mock("@/api/builtInAgents", () => ({ builtInAgentsApi: { list: vi.fn(async () => []) } }));
vi.mock("@/api/environments", () => ({ environmentsApi: { list: vi.fn(async () => []), capabilities: vi.fn(async () => null) } }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: vi.fn(async () => []) } }));
vi.mock("@/api/instanceSettings", () => ({
  instanceSettingsApi: { get: vi.fn(async () => ({ experimental: {} })), getExperimental: vi.fn(async () => ({})) },
}));
vi.mock("@/api/resourceMemberships", () => ({
  resourceMembershipsApi: { listMine: vi.fn(async () => ({ projectMemberships: {}, agentMemberships: {} })) },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { list: api.issues } }));
vi.mock("@/api/attention", () => ({ attentionApi: { list: vi.fn(async () => ({ items: [] })) } }));
vi.mock("@/ppclip/run-controls/api", () => ({ runControlsApi: { overview: vi.fn(() => new Promise(() => {})) } }));
vi.mock("@/adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => `label:${type}`,
  agentDisplayAdapterType: (agent: { adapterType: string }) => agent.adapterType,
}));

const alpha = {
  id: "agent-1", companyId: "company-1", name: "Alpha", urlKey: "alpha", role: "engineer", title: null, icon: null,
  status: "idle", reportsTo: null, adapterType: "codex_local", adapterConfig: { model: "gpt-5.4" }, runtimeConfig: {},
  pauseReason: null, pausedAt: null, lastHeartbeatAt: null, metadata: null,
} as unknown as Agent;

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}><ToastProvider><TooltipProvider>{node}</TooltipProvider></ToastProvider></QueryClientProvider>,
    );
  });
  await flush();
}

function setRunControls(enabled: boolean) {
  client.setQueryData(runControlsQueryKey("company-1"), {
    enabled, day: "2026-10-16", resetsAt: "2026-10-17T00:00:00.000Z", team: null,
    agents: [{ agentId: "agent-1", cap: 10, usedToday: 3, credit: 0, left: 7, unlimited: false, draining: false, drainState: null, liveRuns: 0, drainAfterArmed: false }],
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.localStorage.clear();
  api.agents.mockResolvedValue([alpha]);
  api.issues.mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

describe("All agents roster extra columns", () => {
  it("shows Model / provider and Runs left (only while run controls are on), once each", async () => {
    setRunControls(true);
    await render(<Agents />);
    const model = container.querySelectorAll("[data-testid='ppclip-model-provider']");
    expect(model).toHaveLength(1);
    expect(model[0]!.getAttribute("aria-label")).toBe("Model / provider");
    expect(model[0]!.textContent).toBe("gpt-5.4label:codex_local");
    // Official's own model cell is not duplicated.
    expect(container.textContent?.match(/gpt-5\.4/g)).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='ppclip-daily-runs-left']")).toHaveLength(1);
    expect(container.querySelector("[data-testid='ppclip-daily-runs-left']")?.textContent).toContain("7");

    await act(async () => setRunControls(false));
    await flush();
    expect(container.querySelector("[data-testid='ppclip-daily-runs-left']")).toBeNull();
    expect(container.querySelector("[data-testid='ppclip-model-provider']")).not.toBeNull();
  });

  it("hides and shows the extra columns with a toggle remembered per browser", async () => {
    setRunControls(true);
    await render(<Agents />);
    const toggle = () => container.querySelector<HTMLButtonElement>("button[aria-label$='model and runs left columns']")!;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");

    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-testid='ppclip-model-provider']")).toBeNull();
    expect(container.querySelector("[data-testid='ppclip-daily-runs-left']")).toBeNull();
    expect(window.localStorage.getItem(EXTRA_COLUMNS_STORAGE_KEY)).toBe("hidden");

    // A fresh mount (e.g. coming back to the page) keeps the choice.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(<Agents />);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-testid='ppclip-model-provider']")).toBeNull();

    await act(async () => toggle().click());
    expect(container.querySelector("[data-testid='ppclip-model-provider']")).not.toBeNull();
    expect(window.localStorage.getItem(EXTRA_COLUMNS_STORAGE_KEY)).toBe("shown");
  });
});

describe("agent name task hover card", () => {
  it("orders current tasks in progress first", () => {
    const ordered = orderCurrentTasks([
      { id: "1", status: "todo", identifier: "PAP-1" },
      { id: "2", status: "blocked", identifier: "PAP-2" },
      { id: "3", status: "done", identifier: "PAP-3" },
      { id: "4", status: "in_progress", identifier: "PAP-4" },
      { id: "5", status: "in_review", identifier: "PAP-5" },
    ]);
    expect(ordered.map((task) => task.identifier)).toEqual(["PAP-4", "PAP-5", "PAP-2", "PAP-1"]);
  });

  it("is wired to the roster name and loads the agent's open tasks only when opened", async () => {
    setRunControls(false);
    api.issues.mockResolvedValue([
      { id: "t1", identifier: "PAP-1", title: "Next up", status: "todo", assigneeAgentId: "agent-1" },
      { id: "t2", identifier: "PAP-2", title: "Doing now", status: "in_progress", assigneeAgentId: "agent-1" },
    ]);
    await render(<Agents />);
    const trigger = container.querySelector<HTMLElement>("[data-ppclip-agent-name]")!;
    expect(trigger.textContent).toBe("Alpha");
    const taskCalls = () => api.issues.mock.calls.filter(([, filters]) => filters?.assigneeAgentId === "agent-1");
    expect(taskCalls()).toHaveLength(0);

    await act(async () => { trigger.focus(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    await flush();
    expect(taskCalls()).toEqual([["company-1", { assigneeAgentId: "agent-1", status: "todo,in_progress,in_review,blocked", limit: 50 }]]);
    const card = document.body.querySelector("[data-radix-popper-content-wrapper]");
    expect(card?.textContent).toContain("Current tasks");
    const links = [...(card?.querySelectorAll("a") ?? [])].map((link) => link.textContent);
    expect(links).toEqual(["In ProgressPAP-2Doing now", "TodoPAP-1Next up"]);
  });

  it("renders standalone with the official popover surface", async () => {
    await render(<AgentTaskHoverCard agent={alpha} />);
    expect(container.querySelector("[data-ppclip-agent-name]")?.getAttribute("tabindex")).toBe("0");
  });
});
