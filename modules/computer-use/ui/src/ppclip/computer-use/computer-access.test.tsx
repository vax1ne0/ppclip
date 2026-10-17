// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetPpclipFeaturesForTests } from "@/ppclip/features/store";
import type { AgentComputer, ComputerUseOverview } from "./api";

const mockApi = vi.hoisted(() => ({ overview: vi.fn(), setEnabled: vi.fn(), updateAgent: vi.fn(), act: vi.fn(), viewer: vi.fn(), deleteComputer: vi.fn() }));
const agentsApi = vi.hoisted(() => ({ get: vi.fn() }));
const route = vi.hoisted(() => ({ params: { agentId: "robin" } as Record<string, string> }));
vi.mock("./api", () => ({ computerUseApi: mockApi }));
vi.mock("@/api/agents", () => ({ agentsApi }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => <a href={to} {...rest}>{children}</a>,
  NavLink: ({ to, children, ...rest }: { to: string; children: ReactNode }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => route.params,
  useLocation: () => ({ pathname: "/agents/robin/computer", search: "", hash: "" }),
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-1", companies: [{ id: "company-1" }] }) }));
const breadcrumbs = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: breadcrumbs.set }) }));
vi.mock("@/components/SidebarNavItem", () => ({
  SidebarNavItem: ({ to, label, textBadge }: { to: string; label: string; textBadge?: string }) => <a href={to} data-badge={textBadge}>{label}</a>,
}));

import { AgentComputerPage } from "./AgentComputerPage";
import { AgentComputerNav } from "./AgentComputerNav";
import { AgentChatComputerBar } from "./AgentChatComputerBar";
import { ComputerPanel } from "./ComputerPanel";
import { agentComputerHref, agentComputerHrefFromRef } from "./links";
import { TeamAgentCard, type TeamCardPresentation } from "../team/TeamAgentCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const robin = { id: "agent-1", companyId: "company-1", name: "Robin", urlKey: "robin", adapterType: "claude_local", status: "idle", role: "engineer", title: null, adapterConfig: {} } as unknown as Agent;
const computer = (overrides: Partial<AgentComputer> = {}): AgentComputer => ({
  agentId: "agent-1", name: "Robin", enabled: true, state: "agent", epoch: 2, lease: null, request: null,
  shell: false, allowedHosts: [], lastActivityAt: null, ...overrides,
});
const overview = (overrides: Partial<ComputerUseOverview> = {}): ComputerUseOverview => ({
  enabled: true,
  supervisor: { ok: true, provider: { kind: "docker", isolation: "Docker container", caveats: [], liveView: true } },
  agents: [computer()],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const q = (id: string) => container.querySelector<HTMLElement>(`[data-testid=${id}]`);

beforeEach(() => {
  resetPpclipFeaturesForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [...Object.values(mockApi), agentsApi.get, breadcrumbs.set]) fn.mockReset();
  mockApi.viewer.mockResolvedValue({ src: "/api/ppclip/computer-use/view/t/vnc_lite.html", mode: "view" });
  agentsApi.get.mockResolvedValue(robin);
  try { window.localStorage.clear(); } catch { /* jsdom storage */ }
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("links", () => {
  it("point inside the agent page", () => {
    expect(agentComputerHref(robin)).toBe("/agents/robin/computer");
    expect(agentComputerHrefFromRef("agent-1")).toBe("/agents/agent-1/computer");
  });
});

describe("AgentComputerPage (big screen)", () => {
  it("shows the live screen large, with controls, links and breadcrumbs", async () => {
    mockApi.overview.mockResolvedValue(overview());
    await render(<AgentComputerPage />);
    expect(agentsApi.get).toHaveBeenCalledWith("robin", "company-1");
    expect(container.textContent).toMatch(/Robin's computer/);
    expect(q("computer-panel")?.getAttribute("data-variant")).toBe("page");
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q("computer-live-view")).not.toBeNull();
    expect(container.textContent).toMatch(/Take control/);
    expect(breadcrumbs.set).toHaveBeenLastCalledWith([
      { label: "Agents", href: "/agents/all" },
      { label: "Robin", href: "/agents/robin" },
      { label: "Computer" },
    ]);
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/dashboard/live#live-agent-agent-1", "/agents/robin/runtime"]));
  });

  it("offers the setup card when the agent has no computer yet", async () => {
    mockApi.overview.mockResolvedValue(overview({ enabled: false }));
    await render(<AgentComputerPage />);
    expect(q("computer-panel")).toBeNull();
    expect(q("computer-turn-on")).not.toBeNull();
  });

  it("says so when the module is off", async () => {
    resetPpclipFeaturesForTests({ computerUse: false });
    await render(<AgentComputerPage />);
    expect(q("agent-computer-off")).not.toBeNull();
    expect(agentsApi.get).not.toHaveBeenCalled();
  });
});

describe("AgentComputerNav (agent sidebar)", () => {
  it("adds a Live screen entry with the state when the agent has a computer", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ state: "waiting_for_human" })] }));
    await render(<AgentComputerNav agentRef="robin" agentId="agent-1" />);
    const link = q("agent-computer-nav")!.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/agents/robin/computer");
    expect(link.getAttribute("data-badge")).toBe("Needs you");
  });

  it("stays hidden without a computer or with the module off", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ enabled: false })] }));
    await render(<AgentComputerNav agentRef="robin" agentId="agent-1" />);
    expect(q("agent-computer-nav")).toBeNull();
    resetPpclipFeaturesForTests({ computerUse: false });
    mockApi.overview.mockResolvedValue(overview());
    await render(<AgentComputerNav agentRef="robin" agentId="agent-1" />);
    expect(q("agent-computer-nav")).toBeNull();
  });
});

describe("AgentChatComputerBar (agent chat)", () => {
  it("shows the state, opens the screen in place and links to the big screen", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ lastActivityAt: new Date().toISOString() })] }));
    await render(<AgentChatComputerBar agent={robin} />);
    expect(q("chat-computer-bar")?.textContent).toMatch(/Robin's computer[\s\S]*Using its computer/);
    expect(q("chat-computer-big-screen")?.getAttribute("href")).toBe("/agents/robin/computer");
    expect(q("computer-panel")).toBeNull();
    await act(async () => { q("chat-computer-toggle")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q("computer-panel")).not.toBeNull();
    expect(q("computer-live-view")).not.toBeNull();
    // The choice is remembered for this agent.
    expect(window.localStorage.getItem("ppclip.chat-computer-open:agent-1")).toBe("1");
  });

  it("renders nothing when the agent has no computer", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ enabled: false })] }));
    await render(<AgentChatComputerBar agent={robin} />);
    expect(q("chat-computer-bar")).toBeNull();
  });
});

describe("Team card and Live card links", () => {
  const presentation = (): TeamCardPresentation => ({ level: 1, groupLabel: "Engineering", groupColor: "var(--primary)", showLabels: false, header: (c) => c });

  it("Team card gets a Computer button and a state chip only when the agent has a computer", async () => {
    await render(<TeamAgentCard agent={robin} tasks={[]} workState="ready" retryWork={vi.fn()} chatEnabled={false} presentation={presentation()} />);
    expect(q("team-computer-link")).toBeNull();
    await render(<TeamAgentCard agent={robin} tasks={[]} workState="ready" retryWork={vi.fn()} chatEnabled={false} presentation={presentation()} computer={computer({ state: "waiting_for_human" })} />);
    expect(q("team-computer-link")?.getAttribute("href")).toBe("/agents/robin/computer");
    expect(q("station-computer-chip")?.textContent).toBe("Needs you");
  });

  it("the Live card panel links to the big screen", async () => {
    await render(<ComputerPanel companyId="company-1" computer={computer()} agentName="Robin" liveView={false} bigScreenHref="/agents/robin/computer" />);
    expect(q("computer-big-screen")?.getAttribute("href")).toBe("/agents/robin/computer");
  });
});
