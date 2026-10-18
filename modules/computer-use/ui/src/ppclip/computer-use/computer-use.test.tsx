// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  it("shows a paused placeholder without requesting a stream and keeps recovery actions available", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "paused" })} agentName="Robin" liveView />);
    expect(container.textContent).toContain("Computer paused");
    expect(container.querySelector("iframe")).toBeNull();
    expect(mockApi.viewer).not.toHaveBeenCalled();
    expect(button("Resume")).toBeTruthy();
    await act(async () => { button("Take control")!.click(); });
    expect(mockApi.act).toHaveBeenCalledWith(companyId, "agent-1", "take-control");
  });
  it("keeps the sandboxed viewer toolbar in sync with the app theme", async () => {
    const element = document.documentElement;
    const previous = element.style.getPropertyValue("--background");
    try {
      element.style.setProperty("--background", "#171717");
      await render(<ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />);
      const frame = container.querySelector("iframe")!;
      const post = vi.spyOn(frame.contentWindow!, "postMessage");
      await act(async () => { frame.dispatchEvent(new Event("load")); });
      expect(post).toHaveBeenLastCalledWith({ type: "ppclip:computer-view-theme", tokens: expect.objectContaining({ background: "#171717" }) }, "*");
      await act(async () => { element.style.setProperty("--background", "#ffffff"); });
      expect(post).toHaveBeenLastCalledWith({ type: "ppclip:computer-view-theme", tokens: expect.objectContaining({ background: "#ffffff" }) }, "*");
    } finally {
      if (previous) element.style.setProperty("--background", previous);
      else element.style.removeProperty("--background");
    }
  });
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

  it("requests a new ticket when reopening with the same query cache", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const panel = <ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />;
    const mount = async (node: React.ReactNode) => {
      await act(async () => { root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    };
    await mount(panel);
    expect(mockApi.viewer).toHaveBeenCalledTimes(1);
    await mount(null);
    mockApi.viewer.mockResolvedValue({ src: "/fresh-ticket", mode: "view" });
    await mount(panel);
    expect(mockApi.viewer).toHaveBeenCalledTimes(2);
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe("/fresh-ticket");
  });

  it("renews on focus and offers a manual reconnect", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />);
    const calls = mockApi.viewer.mock.calls.length;
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockApi.viewer.mock.calls.length).toBe(calls);
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockApi.viewer.mock.calls.length).toBeGreaterThan(calls);
    const renewed = mockApi.viewer.mock.calls.length;
    await act(async () => { button("Reconnect")!.click(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(mockApi.viewer.mock.calls.length).toBe(renewed + 1);
    focusManager.setFocused(undefined);
  });

  it("only accepts reconnect signals from its own frame and stops retry loops", async () => {
    await render(<ComputerPanel companyId={companyId} computer={computer()} agentName="Robin" liveView />);
    const data = { type: "ppclip:computer-view-disconnected", src: "/api/ppclip/computer-use/view/t/vnc_lite.html" };
    const post = async (source: Window | null, payload = data) => {
      await act(async () => { window.dispatchEvent(new MessageEvent("message", { source, data: payload })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    };
    await post(window);
    expect(mockApi.viewer).toHaveBeenCalledTimes(1);
    await post(container.querySelector("iframe")!.contentWindow, { ...data, src: "/old-ticket" });
    expect(mockApi.viewer).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) await post(container.querySelector("iframe")!.contentWindow);
    expect(mockApi.viewer).toHaveBeenCalledTimes(4);
    expect(button("Reconnect live view")).toBeTruthy();
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
  it("keeps a stopped page in its screen frame, starts only on demand and shows pending feedback", async () => {
    let finish!: () => void;
    mockApi.act.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await render(<ComputerPanel companyId={companyId} computer={computer({ state: "stopped" })} agentName="Robin" liveView variant="page" />);
    expect(container.textContent).toContain("Computer is stopped");
    expect(mockApi.viewer).not.toHaveBeenCalled();
    expect(mockApi.act).not.toHaveBeenCalled();
    await act(async () => button("Start computer")!.click());
    expect(mockApi.act).toHaveBeenCalledWith(companyId, "agent-1", "start");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(button("Starting…")?.disabled).toBe(true);
    await act(async () => finish());
  });

  it("never offers the agent-only or invalid transitions", () => {
    expect(availableActions({ state: "revoked" })).toEqual(["restore"]);
    expect(availableActions({ state: "human_private" })).not.toContain("take-control");
    expect(availableActions({ state: "agent" })).not.toContain("release");
  });
  it.each(["starting", "paused", "human_private"] as const)("keeps chat controls legible in the %s state without duplicate headings", async state => {
    await render(<ComputerPanel companyId={companyId} computer={computer({ state })} agentName="Robin" liveView variant="chat" />);
    expect(container.querySelector('[data-testid="computer-state"]')).toBeNull();
    expect(container.querySelector('[aria-label="Computer controls"]')).not.toBeNull();
    if (state === "human_private") {
      expect(button("Release to agent")).toBeTruthy();
      expect(button("Take control")).toBeFalsy();
    } else {
      expect(mockApi.viewer).not.toHaveBeenCalled();
      expect(container.textContent).toContain(state === "starting" ? "Starting computer…" : "Computer paused");
    }
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
