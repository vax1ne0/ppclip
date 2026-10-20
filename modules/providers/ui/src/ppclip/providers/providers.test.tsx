// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConnectionUsage, AiConnectionUsageLimit, AiManagedConnectionSummary } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ProviderRoutingStatus } from "./api";

const mockConnections = vi.hoisted(() => ({ list: vi.fn(), probeUsage: vi.fn() }));
const mockRouting = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), reconcile: vi.fn(), release: vi.fn() }));
const mockAgents = vi.hoisted(() => ({ adapterModels: vi.fn() }));

vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: mockConnections }));
// ppclip's cached usage endpoint, played by the same mocks the server would call.
vi.mock("@/api/client", () => ({
  api: {
    get: async (path: string) => {
      if (path === "/ppclip/features") throw new Error("not mocked");
      const list = await mockConnections.list();
      const accounts = await Promise.all(list.connections.filter((a: AiManagedConnectionSummary) => a.status === "connected").map(async (account: AiManagedConnectionSummary) => {
        if (account.usageProbeSupported === false) return { account, supported: false, usage: null, failed: false };
        const companyId = path.split("/")[2];
        try { return { account, supported: true, usage: await mockConnections.probeUsage(companyId, account.id, account.grantId), failed: false }; }
        catch { return { account, supported: true, usage: null, failed: true }; }
      }));
      return { accounts, checkedAt: new Date().toISOString() };
    },
  },
}));
vi.mock("@/api/agents", () => ({ agentsApi: mockAgents }));
vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), providerRoutingApi: mockRouting }));
vi.mock("@/lib/router", () => ({
  Link: ({ children, className, to, ...rest }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to} {...rest}>{children}</a>
  ),
}));
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: ({ name }: { name: string }) => <span data-logo={name} /> }));

import { SubscriptionUsagePanel } from "./SubscriptionUsagePanel";
import { ProviderToolbar } from "./ProviderToolbar";
import { ProviderSettingsSheet } from "./ProviderSettingsSheet";
import { resetPpclipFeaturesForTests } from "../features/store";
import { headlineLimit, modeStops, resetLabel, unratedUsageText, usageStatusText, type AccountUsage } from "./usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const companyId = "company-1";
const account = (overrides: Partial<AiManagedConnectionSummary> = {}): AiManagedConnectionSummary => ({
  id: "conn-1", grantId: "grant-1", companyId, provider: "anthropic", method: "subscription", name: "Team Claude",
  ownership: "shared", isDefault: false, status: "connected", usageProbeSupported: true, ...overrides,
});
const limit = (overrides: Partial<AiConnectionUsageLimit> = {}): AiConnectionUsageLimit => ({
  id: "five_hour", label: "5 hour limit", scope: null, windowDurationSeconds: 18000, resetsAt: null,
  usedPercent: 42, remainingPercent: 58, used: null, limit: null, remaining: null, unit: "percent",
  limitReached: null, allowed: null, ...overrides,
});
const usage = (overrides: Partial<AiConnectionUsage> = {}): AiConnectionUsage => ({
  connectionId: "conn-1", grantId: "grant-1", provider: "anthropic", method: "subscription", status: "ok",
  checkedAt: "2026-10-16T10:00:00.000Z", source: "anthropic_oauth", planType: null, limits: [limit()], overage: null,
  ...overrides,
});

function routingStatus(overrides: Partial<ProviderRoutingStatus["policy"]> = {}): ProviderRoutingStatus {
  const tiers = ["Light", "Standard", "Advanced", "Expert", "Maximum"].map((name, index) => ({
    id: `tier-${index + 1}` as const, name, models: {} as Record<string, string>,
  }));
  tiers[1]!.models = { claude_local: "claude-sonnet-5-5", codex_local: "gpt-6.1-sol" };
  return {
    policy: {
      enabled: true, mode: "hybrid", thresholdPercent: 100, revision: 3, updatedAt: null, updatedBy: "u",
      providers: [
        { adapterType: "claude_local", templateAgentId: "agent-c" },
        { adapterType: "codex_local", templateAgentId: "agent-x" },
      ],
      tiers: tiers as ProviderRoutingStatus["policy"]["tiers"], modelTiers: [], ...overrides,
    },
    candidates: [
      { adapterType: "claude_local", agents: [{ id: "agent-c", name: "Claude dev" }] },
      { adapterType: "codex_local", agents: [{ id: "agent-x", name: "Codex dev" }] },
    ],
    routedAgents: [],
    controller: { intervalMs: 60000, health: null },
  };
}

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TooltipProvider>{node}</TooltipProvider></QueryClientProvider>);
  });
  for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  resetPpclipFeaturesForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [...Object.values(mockConnections), ...Object.values(mockRouting), ...Object.values(mockAgents)]) fn.mockReset();
  mockAgents.adapterModels.mockResolvedValue([]);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("usage helpers", () => {
  it("headlines the fullest account-wide window, ignoring scoped and overage windows", () => {
    const observed = usage({ limits: [
      limit({ usedPercent: 30 }),
      limit({ id: "seven_day", usedPercent: 61 }),
      limit({ id: "seven_day_opus", scope: "seven_day_opus", usedPercent: 99 }),
      limit({ id: "extra_usage", scope: "overage", usedPercent: 100 }),
    ] });
    expect(headlineLimit(observed)?.id).toBe("seven_day");
    expect(headlineLimit(usage({ status: "error", limits: [] }))).toBeNull();
  });

  it("describes a percentage-free check instead of 'not reported'", () => {
    const now = Date.parse("2026-10-20T00:00:00.000Z");
    // Shape of a real Grok weekly-plan credits response after server parsing.
    const grok = usage({ provider: "xai", limits: [limit({ id: "grok_credits", usedPercent: null, used: null, limit: null, remaining: null, unit: "cents", resetsAt: "2026-10-22T00:00:00.000Z" })],
      overage: { enabled: null, available: false, unlimited: null, used: 0, limit: 0, remaining: 0, balance: 0, unit: "cents" } });
    expect(headlineLimit(grok)).toBeNull();
    expect(unratedUsageText(grok, now)).toBe("No usage percentage reported. Resets in 2 days.");
    expect(unratedUsageText(usage({ limits: [limit({ usedPercent: null, used: 1250, remaining: 750, unit: "cents", resetsAt: null })] }), now))
      .toBe("No usage percentage reported. $12.50 used · $7.50 left.");
    expect(unratedUsageText(usage({ limits: [limit({ usedPercent: null, resetsAt: null })] }), now)).toBe("Usage not reported.");
  });

  it("formats resets and masks failures", () => {
    const now = Date.parse("2026-10-16T10:00:00.000Z");
    expect(resetLabel("2026-10-16T10:30:00.000Z", now)).toBe("Resets in 30m");
    expect(resetLabel("2026-10-16T13:15:00.000Z", now)).toBe("Resets in 3h 15m");
    expect(resetLabel("2026-10-20T10:00:00.000Z", now)).toBe("Resets in 4 days");
    expect(resetLabel("2026-10-16T09:00:00.000Z", now)).toBe("Reset due");
    const entry = (overrides: Partial<AccountUsage>): AccountUsage => ({ account: account(), supported: true, usage: null, failed: false, ...overrides });
    expect(usageStatusText(entry({ supported: false }))).toBe("Unavailable for this sign-in method.");
    expect(usageStatusText(entry({ failed: true }))).toMatch(/Couldn’t check usage/);
    expect(usageStatusText(entry({ usage: usage({ status: "unavailable", errorCode: "authentication_required", message: "raw provider text" }) }))).toBe("Sign in again to check usage.");
    expect(usageStatusText(entry({ usage: usage() }))).toBeNull();
    expect(usageStatusText(entry({ usage: usage({ status: "unavailable", errorCode: "rate_limited" }) }))).toContain("does not mean it has reset");
    // Paperclip's Claude sign-in token can't read usage: explain it instead of "access denied".
    expect(usageStatusText(entry({ usage: usage({ status: "unavailable", errorCode: "permission_denied" }) })))
      .toMatch(/Anthropic doesn't share usage.*Claude Code on this computer/);
    expect(usageStatusText(entry({ usage: usage({ provider: "openai", status: "unavailable", errorCode: "permission_denied" }) })))
      .toBe("Usage access denied.");
  });

  it("labels Claude usage that comes from this computer's Claude Code", async () => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockResolvedValue(usage());
    mockRouting.status.mockResolvedValue(routingStatus());
    // Simulate the server's fallback marker on the usage snapshot.
    const client = await import("@/api/client");
    const original = client.api.get;
    client.api.get = (async (path: string) => {
      const snapshot = await (original as (p: string) => Promise<{ accounts: AccountUsage[] }>)(path);
      return { ...snapshot, accounts: snapshot.accounts.map((a) => ({ ...a, usageFrom: "claude_code_local" })) };
    }) as typeof client.api.get;
    try {
      await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
      const row = document.body.querySelector("[data-testid='ppclip-provider-account']")!;
      expect(row.textContent).toContain("42% used");
      expect(row.textContent).toContain("From Claude Code on this computer");
    } finally {
      client.api.get = original;
    }
  });

  it("orders mode stops like the old toolbar for two providers", () => {
    expect(modeStops(["codex_local", "claude_local"]).map((s) => s.label)).toEqual(["Claude only", "Hybrid", "Codex only"]);
    expect(modeStops(["grok_local", "codex_local", "claude_local"]).map((s) => s.label)).toEqual(["Hybrid", "Claude only", "Codex only", "Grok only"]);
  });
});

describe("SubscriptionUsagePanel", () => {
  it("shows each connected account's official usage and the unsupported state", async () => {
    mockConnections.list.mockResolvedValue({
      currentUserId: "u", canManageConnections: true,
      connections: [
        account(),
        account({ id: "conn-2", grantId: "grant-2", provider: "openai", method: "api_key", name: "OpenAI key", usageProbeSupported: false }),
        account({ id: "conn-3", grantId: "grant-3", name: "Expired Claude", status: "expired" }),
      ],
    });
    mockConnections.probeUsage.mockResolvedValue(usage());
    await render(<SubscriptionUsagePanel companyId={companyId} />);
    expect(mockConnections.probeUsage).toHaveBeenCalledTimes(1);
    expect(mockConnections.probeUsage).toHaveBeenCalledWith(companyId, "conn-1", "grant-1");
    const cards = container.querySelectorAll("[data-testid='ppclip-subscription-usage-account']");
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain("Team Claude");
    expect(cards[0]!.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("42");
    expect(cards[1]!.textContent).toContain("Unavailable for this sign-in method.");
    expect(container.textContent).not.toContain("Expired Claude");
  });

  it("explains what to do when nothing is connected", async () => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [] });
    await render(<SubscriptionUsagePanel companyId={companyId} />);
    expect(container.textContent).toContain("No AI accounts are connected yet.");
    expect(container.querySelector("a[href='/apps']")).not.toBeNull();
  });

  it("masks a failed usage request", async () => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockRejectedValue(new Error("upstream 500: secret body"));
    await render(<SubscriptionUsagePanel companyId={companyId} />);
    expect(container.textContent).toContain("Couldn’t check usage. Try again later.");
    expect(container.textContent).not.toContain("secret body");
  });
});

describe("ProviderToolbar", () => {
  beforeEach(() => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockResolvedValue(usage());
  });

  it("shows usage bars and the mode switch once routing is on", async () => {
    mockRouting.status.mockResolvedValue(routingStatus());
    mockRouting.save.mockResolvedValue(routingStatus({ mode: "codex_local", revision: 4 }));
    await render(<ProviderToolbar companyId={companyId} />);
    expect(container.querySelector("[data-testid='ppclip-provider-usage-bar']")?.textContent).toContain("42%");
    const stops = [...container.querySelectorAll("[role='radio']")];
    expect(stops.map((s) => s.textContent)).toEqual(["Claude only", "Hybrid", "Codex only"]);
    expect(stops[1]!.getAttribute("aria-checked")).toBe("true");
    await act(async () => { (stops[2] as HTMLButtonElement).click(); });
    expect(mockRouting.save).toHaveBeenCalledWith(companyId, 3, expect.objectContaining({ mode: "codex_local", enabled: true }));
  });

  it("hides the switch while routing is off and flags agents that need attention", async () => {
    const status = routingStatus({ enabled: false });
    status.controller.health = {
      checkedAt: "2026-10-16T10:00:00.000Z", revision: 3, quotas: [], error: null,
      agents: [{ agentId: "agent-c", state: "blocked", message: "Settings changed outside routing.", adapterType: "codex_local", primaryAdapterType: "claude_local" }],
    };
    mockRouting.status.mockResolvedValue(status);
    await render(<ProviderToolbar companyId={companyId} />);
    expect(container.querySelector("[role='radiogroup']")).toBeNull();
    expect(container.querySelector("[aria-label='Providers need attention']")).not.toBeNull();
  });
});

describe("ProviderSettingsSheet", () => {
  it("hides approved models when its module is off", async () => {
    resetPpclipFeaturesForTests({ modelApprovals: false });
    mockConnections.list.mockResolvedValue({ connections: [] });
    mockRouting.status.mockResolvedValue(routingStatus());
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    expect(document.body.textContent).not.toContain("Approved models");
    await act(async () => { resetPpclipFeaturesForTests(); });
    expect(document.body.textContent).toContain("Approved models");
  });
  it("edits the five model tiers with catalog suggestions and saves them", async () => {
    mockRouting.status.mockResolvedValue(routingStatus());
    mockRouting.save.mockResolvedValue(routingStatus({ revision: 4 }));
    mockAgents.adapterModels.mockImplementation(async (_companyId: string, type: string) =>
      type === "codex_local" ? [{ id: "gpt-6-astra", label: "GPT-6 Astra" }] : [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }]);
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    const table = document.body.querySelector("[data-testid='ppclip-model-tiers']")!;
    expect(table.querySelectorAll("tbody tr")).toHaveLength(5);
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Tier", "Claude", "Codex"]);
    expect(document.body.querySelector("datalist#ppclip-models-codex_local option")?.getAttribute("value")).toBe("gpt-6-astra");

    const input = document.body.querySelector("input[aria-label='Expert Codex model']") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "gpt-6-astra");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save provider settings")!;
    await act(async () => { save.click(); });
    expect(mockRouting.save).toHaveBeenCalledTimes(1);
    const [, revision, policy] = mockRouting.save.mock.calls[0]!;
    expect(revision).toBe(3);
    expect(policy.tiers[3].models).toEqual({ codex_local: "gpt-6-astra" });
    expect(policy.tiers[1].models).toEqual({ claude_local: "claude-sonnet-5-5", codex_local: "gpt-6.1-sol" });
    expect(Object.keys(policy).sort()).toEqual(["enabled", "mode", "modelTiers", "providers", "thresholdPercent", "tiers"]);
  });

  it("lists connected accounts and asks to connect a provider whose agents have no account", async () => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockResolvedValue(usage());
    mockRouting.status.mockResolvedValue(routingStatus());
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    const accounts = document.body.querySelectorAll("[data-testid='ppclip-provider-account']");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.textContent).toContain("Team Claude");
    expect(accounts[0]!.textContent).toContain("42% used");
    const missing = document.body.querySelector("[data-testid='ppclip-provider-missing-account']")!;
    expect(missing.textContent).toContain("ChatGPT subscription");
    expect(missing.textContent).toContain("1 agent uses this provider");
    expect(missing.querySelector("a")?.getAttribute("href")).toBe("/apps");
  });

  it("treats a newly connected account as connected and refreshes usage right away", async () => {
    // The first list (the usage snapshot) predates the Claude sign-in; later reads include it.
    mockConnections.list
      .mockResolvedValueOnce({ currentUserId: "u", canManageConnections: true, connections: [] })
      .mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockResolvedValue(usage());
    mockRouting.status.mockResolvedValue(routingStatus());
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const missing = [...document.body.querySelectorAll("[data-testid='ppclip-provider-missing-account']")].map((row) => row.textContent);
    expect(missing.some((text) => text?.includes("Claude subscription"))).toBe(false);
    expect(document.body.querySelector("[data-testid='ppclip-provider-account']")?.textContent).toContain("Team Claude");
    expect(mockConnections.probeUsage).toHaveBeenCalled();
  });

  it("closes the panel when a link opens Connections", async () => {
    mockConnections.list.mockResolvedValue({ currentUserId: "u", canManageConnections: true, connections: [account()] });
    mockConnections.probeUsage.mockResolvedValue(usage());
    mockRouting.status.mockResolvedValue(routingStatus());
    const onOpenChange = vi.fn();
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={onOpenChange} />);
    const manage = [...document.body.querySelectorAll("a")].find((a) => a.textContent === "Manage connections")!;
    await act(async () => { manage.click(); });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("hides switching controls while off, and saves only after a change", async () => {
    mockRouting.status.mockResolvedValue(routingStatus({ enabled: false }));
    mockRouting.save.mockResolvedValue(routingStatus({ revision: 4 }));
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    expect(document.body.querySelector("[data-testid='ppclip-model-tiers']")).toBeNull();
    const save = () => [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Save provider settings")!;
    expect(save().disabled).toBe(true);

    const toggle = document.body.querySelector("[data-testid='ppclip-provider-routing-enabled']") as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    expect(document.body.querySelector("[data-testid='ppclip-model-tiers']")).not.toBeNull();
    expect(save().disabled).toBe(false);

    const discard = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Discard")!;
    await act(async () => { discard.click(); });
    expect(document.body.querySelector("[data-testid='ppclip-model-tiers']")).toBeNull();
    expect(save().disabled).toBe(true);
    expect(mockRouting.save).not.toHaveBeenCalled();
  });

  it("lets the board keep an agent's current settings when it is blocked", async () => {
    const status = routingStatus();
    status.routedAgents = [{ agentId: "agent-c", name: "Claude dev", adapterType: "codex_local", primaryAdapterType: "claude_local" }];
    status.controller.health = {
      checkedAt: "2026-10-16T10:00:00.000Z", revision: 3, quotas: [], error: null,
      agents: [{ agentId: "agent-c", state: "blocked", message: "Settings changed outside routing.", adapterType: "codex_local", primaryAdapterType: "claude_local" }],
    };
    mockRouting.status.mockResolvedValue(status);
    mockRouting.release.mockResolvedValue({ agentId: "agent-c", released: true });
    await render(<ProviderSettingsSheet companyId={companyId} open onOpenChange={() => {}} />);
    const panel = document.body.querySelector("[data-testid='ppclip-provider-controller']")!;
    expect(panel.textContent).toContain("Claude dev");
    expect(panel.textContent).toContain("Needs attention");
    const keep = [...panel.querySelectorAll("button")].find((b) => b.textContent === "Keep current settings")!;
    await act(async () => { keep.click(); });
    expect(mockRouting.release).toHaveBeenCalledWith(companyId, "agent-c");
  });
});
