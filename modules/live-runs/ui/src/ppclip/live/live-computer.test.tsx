// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resetPpclipFeaturesForTests } from "@/ppclip/features/store";
import type { AgentComputer } from "../computer-use/api";
import type { Station } from "./station-order";

vi.mock("@/lib/router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock("../computer-use/api", () => ({ computerUseApi: { act: vi.fn(), viewer: vi.fn() } }));

import { LiveStationCard } from "./LiveStationCard";

const agent = { id: "agent-1", companyId: "company-1", name: "Robin", urlKey: "robin", status: "idle", role: "engineer", title: null,
  adapterType: "claude_local", adapterConfig: {} } as unknown as Agent;
const station: Station = { agent, run: null, phase: "idle", attentionStatus: null };
const computer = (overrides: Partial<AgentComputer> = {}): AgentComputer => ({
  agentId: "agent-1", name: "Robin", enabled: true, state: "agent", epoch: 2, lease: null, request: null,
  shell: false, allowedHosts: [], lastActivityAt: null, ...overrides,
});

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetPpclipFeaturesForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Live runs card with a computer", () => {
  it("carries an anchor for Watch live links and no computer UI without a computer", async () => {
    await render(<LiveStationCard station={station} transcript={[]} companyId="company-1" chatEnabled={false} />);
    const card = container.querySelector("article")!;
    expect(card.id).toBe("live-agent-agent-1");
    expect(container.querySelector("[data-testid=station-computer-chip]")).toBeNull();
    expect(container.querySelector("[data-testid=computer-panel]")).toBeNull();
  });

  it("shows 'Needs you' in the header and the request in the computer panel", async () => {
    await render(
      <LiveStationCard station={station} transcript={[]} companyId="company-1" chatEnabled={false}
        computer={computer({ state: "waiting_for_human", request: { reason: "Please sign in to GitHub", at: "x" } })} />,
    );
    expect(container.querySelector("[data-testid=station-computer-chip]")?.textContent).toBe("Needs you");
    expect(container.querySelector("article")!.getAttribute("aria-label")).toMatch(/needs you at its computer/);
    expect(container.querySelector("[data-testid=computer-state]")?.textContent).toBe("Needs you");
    expect(container.querySelector("[data-testid=computer-request]")?.textContent).toMatch(/Please sign in to GitHub/);
  });

  it("says the agent is using its computer while it acts", async () => {
    await render(
      <LiveStationCard station={station} transcript={[]} companyId="company-1" chatEnabled={false}
        computer={computer({ lastActivityAt: new Date().toISOString() })} />,
    );
    expect(container.querySelector("[data-testid=station-computer-chip]")?.textContent).toBe("Using its computer");
  });

  it("hides the computer panel when the computerUse module is off", async () => {
    resetPpclipFeaturesForTests({ computerUse: false });
    await render(<LiveStationCard station={station} transcript={[]} companyId="company-1" chatEnabled={false} computer={computer()} />);
    expect(container.querySelector("[data-testid=computer-panel]")).toBeNull();
    expect(container.querySelector("[data-testid=station-computer-chip]")).toBeNull();
  });
});
