// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetPpclipFeaturesForTests } from "@/ppclip/features/store";
import type { AgentComputer, ComputerUseOverview } from "./api";

const mockApi = vi.hoisted(() => ({
  overview: vi.fn(),
  setEnabled: vi.fn(),
  updateAgent: vi.fn(),
  act: vi.fn(),
  viewer: vi.fn(),
  deleteComputer: vi.fn(),
}));
vi.mock("./api", () => ({ computerUseApi: mockApi }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => <a href={to} {...rest}>{children}</a>,
}));

import { AgentComputerUseCard } from "./AgentComputerUseCard";
import { ComputerStateChip, computerChipLabel } from "./ComputerStateChip";
import { liveAgentAnchor, liveAgentHref } from "../live/anchors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "company-1";
const claude = { id: "agent-1", name: "Robin", adapterType: "claude_local" };
const computer = (overrides: Partial<AgentComputer> = {}): AgentComputer => ({
  agentId: "agent-1", name: "Robin", enabled: true, state: "stopped", epoch: 1, lease: null, request: null,
  shell: false, allowedHosts: [], lastActivityAt: null, ...overrides,
});
const overview = (overrides: Partial<ComputerUseOverview> = {}): ComputerUseOverview => ({
  enabled: true,
  supervisor: { ok: true, provider: { kind: "fake", isolation: "none (in-memory test double)", caveats: [], liveView: false } },
  agents: [computer()],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const q = (id: string) => container.querySelector(`[data-testid=${id}]`);

beforeEach(() => {
  resetPpclipFeaturesForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(mockApi)) fn.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AgentComputerUseCard", () => {
  it("is hidden when the computerUse module is off", async () => {
    resetPpclipFeaturesForTests({ computerUse: false });
    mockApi.overview.mockResolvedValue(overview());
    await render(<AgentComputerUseCard agent={claude} companyId={companyId} />);
    expect(q("agent-computer-use-card")).toBeNull();
    expect(mockApi.overview).not.toHaveBeenCalled();
  });

  it("explains which adapters can use it and asks nothing of the server for others", async () => {
    await render(<AgentComputerUseCard agent={{ ...claude, adapterType: "gemini_local" }} companyId={companyId} />);
    expect(q("computer-unsupported")?.textContent).toBe("Available for Claude Code and Codex agents only.");
    expect(mockApi.overview).not.toHaveBeenCalled();
  });

  it("offers to turn computer use on when the company switch is off", async () => {
    mockApi.overview.mockResolvedValueOnce(overview({ enabled: false })).mockResolvedValue(overview());
    mockApi.setEnabled.mockResolvedValue({ enabled: true, changed: true, stoppedAgentIds: [] });
    await render(<AgentComputerUseCard agent={{ ...claude, adapterType: "codex_local" }} companyId={companyId} />);
    expect(container.textContent).toMatch(/off for this company/);
    await act(async () => { (q("computer-turn-on") as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mockApi.setEnabled).toHaveBeenCalledWith(companyId, true);
    expect(q("computer-turn-on")).toBeNull();
    expect(q("computer-enable-agent-1")).not.toBeNull();
  });

  it("shows supervisor problems with the way to start it", async () => {
    mockApi.overview.mockResolvedValue(overview({ supervisor: { ok: false, error: "The computer supervisor is not reachable at http://127.0.0.1:7091. Is it running?" } }));
    await render(<AgentComputerUseCard agent={claude} companyId={companyId} />);
    expect(q("computer-supervisor-status")?.textContent).toMatch(/not reachable[\s\S]*--with-computer/);
  });

  it("toggles this agent's computer, shell and sites through the shared controls", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ enabled: false })] }));
    mockApi.updateAgent.mockResolvedValue({});
    await render(<AgentComputerUseCard agent={claude} companyId={companyId} />);
    expect(q("computer-watch-live")).toBeNull();
    await act(async () => { (q("computer-enable-agent-1") as HTMLButtonElement).click(); });
    expect(mockApi.updateAgent).toHaveBeenCalledWith(companyId, "agent-1", { enabled: true });
  });

  it("links to the agent's Live runs card and shows when it needs you", async () => {
    mockApi.overview.mockResolvedValue(overview({ agents: [computer({ state: "waiting_for_human", request: { reason: "Sign in to GitHub", at: "x" } })] }));
    await render(<AgentComputerUseCard agent={claude} companyId={companyId} />);
    expect(q("agent-computer-state")?.textContent).toBe("Needs you");
    expect(container.textContent).toMatch(/asked for you: Sign in to GitHub/);
    const link = q("computer-watch-live") as HTMLAnchorElement;
    expect(link.textContent).toMatch(/Watch live/);
    expect(link.getAttribute("href")).toBe("/dashboard/live#live-agent-agent-1");
    expect(liveAgentHref("agent-1")).toBe(`/dashboard/live#${liveAgentAnchor("agent-1")}`);
    // Shell, sites and profile deletion come with the controls once the computer is on.
    expect(container.textContent).toMatch(/Allow shell inside the sandbox/);
    expect(container.textContent).toMatch(/Delete computer and browser profile/);
  });

  it("says 'Open on Live runs' while the computer is stopped", async () => {
    mockApi.overview.mockResolvedValue(overview());
    await render(<AgentComputerUseCard agent={claude} companyId={companyId} />);
    expect(q("computer-watch-live")?.textContent).toMatch(/Open on Live runs/);
    expect(container.textContent).toMatch(/press Start computer/);
  });
});

describe("ComputerStateChip", () => {
  it("is empty while the computer is off and says when the agent is using it", async () => {
    await render(<ComputerStateChip computer={computer({ state: "stopped" })} />);
    expect(q("station-computer-chip")).toBeNull();
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(computerChipLabel(computer({ state: "agent", lastActivityAt: "2026-10-17T09:59:30Z" }), now)).toBe("Using its computer");
    expect(computerChipLabel(computer({ state: "agent", lastActivityAt: "2026-10-17T09:50:00Z" }), now)).toBe("Agent driving");
    await render(<ComputerStateChip computer={computer({ state: "waiting_for_human", request: { reason: "2FA", at: "x" } })} />);
    expect(q("station-computer-chip")?.textContent).toBe("Needs you");
    expect(q("station-computer-chip")?.getAttribute("title")).toBe("2FA");
  });
});
