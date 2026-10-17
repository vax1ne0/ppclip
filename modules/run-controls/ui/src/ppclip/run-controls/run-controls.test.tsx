// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentRunAllowance, RunControlsOverview } from "./api";
import { runsLeftDisplay, runsLeftTitle } from "./display";

const mockApi = vi.hoisted(() => ({
  overview: vi.fn(),
  setEnabled: vi.fn(),
  setUnlimited: vi.fn(),
  drain: vi.fn(),
  resume: vi.fn(),
  setDrainAfter: vi.fn(),
}));
vi.mock("./api", () => ({ runControlsApi: mockApi }));

import { TeamRunControls } from "./TeamRunControls";
import { DailyRunsLeft } from "./DailyRunsLeft";
import { DrainAfterMenuItem } from "./DrainAfterMenuItem";
import { RunControlsSettingsSection } from "./RunControlsSettingsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "company-1";
const row = (overrides: Partial<AgentRunAllowance> = {}): AgentRunAllowance => ({
  agentId: "agent-1", cap: 5, usedToday: 2, credit: 0, left: 3, unlimited: false, draining: false,
  drainState: null, liveRuns: 0, drainAfterArmed: false, ...overrides,
});
const enabledOverview = (overrides: Partial<RunControlsOverview> = {}): RunControlsOverview => ({
  enabled: true, day: "2026-10-16", resetsAt: "2026-10-17T00:00:00.000Z",
  team: { unlimited: "off", drain: "off", hasLiveWork: false, drainAfterAgentId: null },
  agents: [row()], ...overrides,
});
const disabledOverview: RunControlsOverview = {
  enabled: false, day: "2026-10-16", resetsAt: "2026-10-17T00:00:00.000Z", team: null, agents: [],
};
const agent = { id: "agent-1", companyId, name: "Alice", status: "idle" } as Agent;

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
  // Let the overview query resolve.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function surfaces() {
  return (
    <>
      <TeamRunControls companyId={companyId} agents={[agent]} />
      <DailyRunsLeft companyId={companyId} agentId="agent-1" />
      <DrainAfterMenuItem agent={agent} />
    </>
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(mockApi)) fn.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("run controls visibility", () => {
  it("hides every run control while the switch is off", async () => {
    mockApi.overview.mockResolvedValue(disabledOverview);
    await render(surfaces());
    expect(mockApi.overview).toHaveBeenCalledWith(companyId);
    expect(container.textContent).toBe("");
    expect(container.querySelector("[data-testid='ppclip-team-run-controls']")).toBeNull();
    expect(container.querySelector("[data-testid='ppclip-daily-runs-left']")).toBeNull();
  });

  it("shows team actions, runs left and drain after once the switch is on", async () => {
    mockApi.overview.mockResolvedValue(enabledOverview());
    await render(surfaces());
    expect(container.querySelector("[data-testid='ppclip-team-run-controls']")).not.toBeNull();
    expect(container.textContent).toContain("Unlimited: Off");
    expect(container.textContent).toContain("Drain");
    expect(container.textContent).not.toContain("Resume");
    expect(container.querySelector("[data-testid='ppclip-daily-runs-left']")?.textContent).toContain("3/5");
    expect(container.textContent).toContain("Drain after next run");
  });

  it("shows Resume and the armed plan while draining", async () => {
    mockApi.overview.mockResolvedValue(enabledOverview({
      team: { unlimited: "off", drain: "drained", hasLiveWork: false, drainAfterAgentId: null },
      agents: [row({ draining: true, drainState: "drained", cap: 0, left: 0 })],
    }));
    await render(surfaces());
    expect(container.textContent).toContain("Drained");
    expect(container.textContent).toContain("Resume");
    // A draining agent cannot be armed.
    expect(container.textContent).not.toContain("Drain after next run");
  });

  it("calls the team endpoints", async () => {
    mockApi.overview.mockResolvedValue(enabledOverview());
    mockApi.setUnlimited.mockResolvedValue({ agentIds: ["agent-1"] });
    await render(<TeamRunControls companyId={companyId} agents={[agent]} />);
    const unlimited = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Unlimited"));
    await act(async () => { unlimited!.click(); });
    expect(mockApi.setUnlimited).toHaveBeenCalledWith(companyId, true);
  });
});

describe("run controls settings", () => {
  it("turns the switch on", async () => {
    mockApi.overview.mockResolvedValue(disabledOverview);
    mockApi.setEnabled.mockResolvedValue({ enabled: true, changed: true, clearedAgentIds: [] });
    await render(<RunControlsSettingsSection companyId={companyId} />);
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid='ppclip-run-controls-toggle']")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => { toggle.click(); });
    expect(mockApi.setEnabled).toHaveBeenCalledWith(companyId, true);
  });

  it("asks before turning the switch off", async () => {
    mockApi.overview.mockResolvedValue(enabledOverview());
    await render(<RunControlsSettingsSection companyId={companyId} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const on = container.querySelector<HTMLButtonElement>("[data-testid='ppclip-run-controls-toggle']")!;
    expect(on.getAttribute("aria-checked")).toBe("true");
    await act(async () => { on.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.setEnabled).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("runs left display", () => {
  it("formats caps, credit, unlimited and drain states", () => {
    expect(runsLeftDisplay(row())).toEqual({ label: "3/5", tone: "muted" });
    expect(runsLeftDisplay(row({ left: 2 }))).toEqual({ label: "2/5", tone: "warning" });
    expect(runsLeftDisplay(row({ left: 0 }))).toEqual({ label: "0/5", tone: "danger" });
    expect(runsLeftDisplay(row({ cap: null, left: null }))).toEqual({ label: "∞", tone: "muted" });
    expect(runsLeftDisplay(row({ drainState: "draining" })).label).toBe("Draining");
    expect(runsLeftDisplay(row({ drainState: "drained" })).label).toBe("Drained");
    expect(runsLeftTitle(row({ usedToday: 4, credit: 2, left: 3 }), "2026-10-17T00:00:00.000Z"))
      .toContain("2 of 5 daily runs used. 2 runs made while unlimited don't count.");
  });
});
