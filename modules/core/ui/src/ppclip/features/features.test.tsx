// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock("@/api/client", () => ({ api: mockApi }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));

import { PpclipSettingsPage } from "./PpclipSettingsPage";
import { PpclipOn } from "./PpclipOn";
import { PPCLIP_FEATURE_KEYS, PPCLIP_MODULES, defaultPpclipFeatures } from "./registry";
import { ppclipFeatureEnabled, resetPpclipFeaturesForTests } from "./store";
import { isSameRunAgent } from "../task-chat-same-agent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockApi.get.mockReset();
  mockApi.patch.mockReset();
  resetPpclipFeaturesForTests();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("ppclip module registry", () => {
  it("lists every module once, all on by default", () => {
    expect(new Set(PPCLIP_FEATURE_KEYS).size).toBe(PPCLIP_FEATURE_KEYS.length);
    expect(PPCLIP_FEATURE_KEYS).toHaveLength(14);
    expect(Object.values(defaultPpclipFeatures()).every(Boolean)).toBe(true);
    for (const group of PPCLIP_MODULES) for (const feature of group.features) expect(feature.description.length).toBeGreaterThan(20);
  });
});

describe("Settings → ppclip", () => {
  it("shows each module group with a toggle per feature, and saves a change", async () => {
    mockApi.patch.mockResolvedValue({ ...defaultPpclipFeatures(), team: false });
    await render(<PpclipSettingsPage />);
    const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
    expect(headings).toEqual(["Updates", ...PPCLIP_MODULES.map((group) => group.title)]);
    const switches = container.querySelectorAll("[role='switch']");
    expect(switches).toHaveLength(14);
    expect([...switches].every((s) => s.getAttribute("aria-checked") === "true")).toBe(true);

    const team = container.querySelector("[data-testid='ppclip-feature-team'] [role='switch']") as HTMLButtonElement;
    await act(async () => { team.click(); });
    for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mockApi.patch).toHaveBeenCalledWith("/ppclip/features", { team: false });
    expect(ppclipFeatureEnabled("team")).toBe(false);
    expect(team.getAttribute("aria-checked")).toBe("false");
  });

  it("shows the server's refusal and keeps the switch as it was", async () => {
    mockApi.patch.mockRejectedValue(new Error("Instance admin access required"));
    await render(<PpclipSettingsPage />);
    const team = container.querySelector("[data-testid='ppclip-feature-team'] [role='switch']") as HTMLButtonElement;
    await act(async () => { team.click(); });
    for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Instance admin access required");
    expect(ppclipFeatureEnabled("team")).toBe(true);
  });
});

describe("module switches in use", () => {
  it("renders gated content only while the module is on", async () => {
    await render(<PpclipOn feature="liveRuns" fallback={<span>plain</span>}><a href="/live">Agents</a></PpclipOn>);
    expect(container.querySelector("a")).not.toBeNull();
    await act(async () => { resetPpclipFeaturesForTests({ liveRuns: false }); });
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("plain");
  });

  it("uses official's name-only same-agent check when Task chat is off", () => {
    const turn = { agentKey: "agent-a", agentName: null };
    const bubble = { agent: { id: "agent-b" }, authorName: "Bob" };
    expect(isSameRunAgent(turn, bubble)).toBe(false);
    resetPpclipFeaturesForTests({ taskChatRuns: false });
    expect(isSameRunAgent(turn, bubble)).toBe(true);
  });
});
