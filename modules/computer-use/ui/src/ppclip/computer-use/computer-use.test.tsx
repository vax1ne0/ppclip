// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
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

import { ComputerPanel } from "./ComputerPanel";
import { ComputerUseSettingsSection } from "./ComputerUseSettingsSection";
import { availableActions } from "./useComputerUse";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "company-1";
const computer = (overrides: Partial<AgentComputer> = {}): AgentComputer => ({
  agentId: "agent-1", name: "Robin", enabled: true, state: "agent", epoch: 3, lease: null, request: null,
  shell: false, allowedHosts: [], lastActivityAt: null, ...overrides,
});
const overview = (overrides: Partial<ComputerUseOverview> = {}): ComputerUseOverview => ({
  enabled: true,
  supervisor: { ok: true, provider: { kind: "docker", isolation: "Docker container (shares the host kernel)", caveats: [], liveView: true } },
  agents: [computer()],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const button = (label: string) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(label));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.viewer.mockResolvedValue({ src: "/api/ppclip/computer-use/view/t/vnc_lite.html", mode: "view" });
  mockApi.act.mockResolvedValue({});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ComputerPanel", () => {
  it("embeds a view-only live view in a sandboxed frame while the agent drives", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />);
    expect(container.querySelector("[data-testid=computer-state]")?.textContent).toBe("Agent driving");
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(mockApi.viewer).toHaveBeenCalledWith(companyId, "agent-1", "view");
    expect(button("Take control")).toBeTruthy();
    expect(button("Release to agent")).toBeFalsy();
  });

  it("shows the agent's request and asks for a control stream while a person drives", async () => {
    mockApi.viewer.mockImplementation((_c: string, _a: string, mode: string) => Promise.resolve({ src: `/x/${mode}`, mode }));
    const lease = { holderUserId: "me", private: false, grantedAt: "2026-10-17T10:00:00Z", expiresAt: "2026-10-17T10:30:00Z" };
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "human", lease, request: { reason: "Sign in to GitHub", at: "x" } })} agentName="Robin" liveView />);
    expect(mockApi.viewer).toHaveBeenCalledWith(companyId, "agent-1", "control");
    expect(container.querySelector("iframe")?.getAttribute("title")).toMatch(/you are in control/);
    expect(button("Release to agent")).toBeTruthy();
    expect(button("Take control privately")).toBeTruthy();
  });

  it("falls back to watching when someone else holds control", async () => {
    mockApi.viewer.mockImplementation((_c: string, _a: string, mode: string) => mode === "control" ? Promise.reject(new Error("Take control first.")) : Promise.resolve({ src: "/x/view", mode }));
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "human" })} agentName="Robin" liveView />);
    expect(container.querySelector("iframe")?.getAttribute("title")).toMatch(/view only/);
  });

  it("highlights a takeover request and sends operator actions to the API", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "waiting_for_human", request: { reason: "2FA code needed", at: "x" } })} agentName="Robin" liveView />);
    expect(container.querySelector("[data-testid=computer-request]")?.textContent).toMatch(/2FA code needed/);
    await act(async () => { button("Take control")!.click(); });
    expect(mockApi.act).toHaveBeenCalledWith(companyId, "agent-1", "take-control");
  });

  it("asks before revoking and does nothing when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render(<ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />);
    await act(async () => { button("Revoke access")!.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.act).not.toHaveBeenCalled();
  });

  it("does not open a stream when stopped, and offers only Start", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "stopped" })} agentName="Robin" liveView />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(mockApi.viewer).not.toHaveBeenCalled();
    expect(Array.from(container.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Start computer"]);
  });

  it("never offers the agent-only or invalid transitions", () => {
    expect(availableActions({ state: "revoked" })).toEqual(["restore"]);
    expect(availableActions({ state: "human_private" })).not.toContain("take-control");
    expect(availableActions({ state: "agent" })).not.toContain("release");
  });
});

describe("ComputerUseSettingsSection", () => {
  it("is off by default and lists nothing until switched on", async () => {
    mockApi.overview.mockResolvedValue(overview({ enabled: false, agents: [] }));
    await render(<ComputerUseSettingsSection companyId={companyId} />);
    expect(container.querySelector("[data-testid=ppclip-computer-use-toggle]")?.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector("[aria-label='Agents with computers']")).toBeNull();
  });

  it("shows supervisor health and per-agent opt-in when on", async () => {
    mockApi.overview.mockResolvedValue(overview({ supervisor: { ok: false, error: "The computer supervisor is not reachable." }, agents: [computer({ enabled: false })] }));
    mockApi.updateAgent.mockResolvedValue({});
    await render(<ComputerUseSettingsSection companyId={companyId} />);
    expect(container.querySelector("[data-testid=computer-supervisor-status]")?.textContent).toMatch(/not reachable[\s\S]*computer-supervisor\.mjs/);
    const toggle = container.querySelector<HTMLButtonElement>("[data-testid=computer-enable-agent-1]")!;
    await act(async () => { toggle.click(); });
    expect(mockApi.updateAgent).toHaveBeenCalledWith(companyId, "agent-1", { enabled: true });
  });

  it("confirms before switching off", async () => {
    mockApi.overview.mockResolvedValue(overview());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await render(<ComputerUseSettingsSection companyId={companyId} />);
    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid=ppclip-computer-use-toggle]")!.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.setEnabled).not.toHaveBeenCalled();
  });
});
