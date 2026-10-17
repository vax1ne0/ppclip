import { describe, expect, it } from "vitest";
import type { AiConnectionUsage, AiConnectionUsageLimit } from "@paperclipai/shared";
import {
  aiProviderForAdapter,
  buildRoutedConfig,
  configSignature,
  decideTarget,
  emptyTiers,
  mapModel,
  preserveRoutingMetadata,
  providerQuotaState,
  readRoutingRecord,
  restoredConfig,
  routingPolicyInputSchema,
  stripRoutingMetadata,
  tierOf,
  translateEffort,
  usageQuotaState,
  withRoutingRecord,
  withTierMemberships,
  type QuotaState,
  type RoutingPolicyInput,
} from "../ppclip/providers/policy.js";

const template = "11111111-1111-4111-8111-111111111111";
const codexTemplate = "22222222-2222-4222-8222-222222222222";

function policy(overrides: Partial<RoutingPolicyInput> = {}): RoutingPolicyInput {
  const tiers = emptyTiers();
  tiers[1] = { ...tiers[1]!, models: { claude_local: "claude-sonnet-5-5", codex_local: "gpt-6.1-sol" } };
  tiers[3] = { ...tiers[3]!, models: { claude_local: "claude-opus-5-5", codex_local: "gpt-6-astra" } };
  return {
    enabled: true,
    mode: "hybrid",
    thresholdPercent: 100,
    providers: [
      { adapterType: "claude_local", templateAgentId: template },
      { adapterType: "codex_local", templateAgentId: codexTemplate },
    ],
    tiers,
    modelTiers: [],
    ...overrides,
  };
}

function limit(overrides: Partial<AiConnectionUsageLimit>): AiConnectionUsageLimit {
  return {
    id: "five_hour", label: "5 hour limit", scope: null, windowDurationSeconds: 18000, resetsAt: null,
    usedPercent: null, remainingPercent: null, used: null, limit: null, remaining: null, unit: "percent",
    limitReached: null, allowed: null, ...overrides,
  };
}

function usage(limits: AiConnectionUsageLimit[], status: AiConnectionUsage["status"] = "ok"): AiConnectionUsage {
  return {
    connectionId: "c", grantId: "g", provider: "anthropic", method: "subscription", status,
    checkedAt: "2026-10-16T00:00:00.000Z", source: null, planType: null, limits, overage: null,
  };
}

describe("ppclip provider routing policy schema", () => {
  it("accepts a five-tier policy and rejects unknown modes, harnesses and extra keys", () => {
    expect(routingPolicyInputSchema.safeParse(policy()).success).toBe(true);
    expect(routingPolicyInputSchema.safeParse(policy({ mode: "gemini_local" })).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse(policy({ mode: "codex_local" })).success).toBe(true);
    expect(routingPolicyInputSchema.safeParse(policy({ providers: [{ adapterType: "process", templateAgentId: template }], mode: "hybrid", tiers: emptyTiers() })).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse({ ...policy(), extra: true }).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse(policy({ tiers: emptyTiers().slice(0, 4) })).success).toBe(false);
    expect(routingPolicyInputSchema.safeParse(policy({ thresholdPercent: 40 })).success).toBe(false);
  });

  it("rejects duplicate providers, tiers naming unlisted providers and duplicate model links", () => {
    const p = policy();
    expect(routingPolicyInputSchema.safeParse({ ...p, providers: [...p.providers, p.providers[0]] }).success).toBe(false);
    const tiers = emptyTiers();
    tiers[0] = { ...tiers[0]!, models: { grok_local: "grok-4.7" } };
    expect(routingPolicyInputSchema.safeParse({ ...p, tiers }).success).toBe(false);
    const link = { adapterType: "claude_local", model: "m", tierId: "tier-1" as const };
    expect(routingPolicyInputSchema.safeParse({ ...p, modelTiers: [link, { ...link, tierId: "tier-2" }] }).success).toBe(false);
  });

  it("maps harnesses to their Connections provider", () => {
    expect(aiProviderForAdapter("claude_local")).toBe("anthropic");
    expect(aiProviderForAdapter("codex_local")).toBe("openai");
    expect(aiProviderForAdapter("grok_local")).toBe("xai");
    expect(aiProviderForAdapter("process")).toBeNull();
  });
});

describe("ppclip model tiers", () => {
  it("maps a model through its tier, never touching effort", () => {
    expect(mapModel(policy(), "claude_local", "claude-sonnet-5-5", "codex_local")).toEqual({ ok: true, model: "gpt-6.1-sol", tierName: "Standard" });
    expect(mapModel(policy(), "codex_local", "gpt-6-astra", "claude_local")).toMatchObject({ ok: true, model: "claude-opus-5-5" });
    expect(mapModel(policy(), "claude_local", "claude-haiku-4-5", "codex_local")).toMatchObject({ ok: false });
    expect(mapModel(policy(), "claude_local", null, "codex_local")).toMatchObject({ ok: false, reason: expect.stringMatching(/default model/) });
  });

  it("keeps old model links when a tier's model is replaced", () => {
    const saved = withTierMemberships(policy());
    expect(saved.modelTiers).toHaveLength(4);
    const tiers = saved.tiers.map((tier) => tier.id === "tier-2" ? { ...tier, models: { ...tier.models, claude_local: "claude-sonnet-6" } } : tier);
    const next = withTierMemberships({ ...saved, tiers });
    expect(tierOf(next, "claude_local", "claude-sonnet-5-5")?.name).toBe("Standard");
    expect(tierOf(next, "claude_local", "claude-sonnet-6")?.name).toBe("Standard");
    expect(mapModel(next, "claude_local", "claude-sonnet-5-5", "codex_local")).toMatchObject({ ok: true, model: "gpt-6.1-sol" });
  });

  it("drops links to providers that are no longer listed", () => {
    const saved = withTierMemberships(policy());
    const next = withTierMemberships({
      ...saved,
      providers: saved.providers.slice(0, 1),
      tiers: saved.tiers.map((tier) => ({ ...tier, models: Object.fromEntries(Object.entries(tier.models).filter(([type]) => type === "claude_local")) })),
    });
    expect(next.modelTiers.every((link) => link.adapterType === "claude_local")).toBe(true);
  });
});

describe("ppclip quota from Connections usage", () => {
  it("counts only account-wide windows and treats errors as unknown", () => {
    expect(usageQuotaState(usage([limit({ usedPercent: 40 })]), 100)).toBe("available");
    expect(usageQuotaState(usage([limit({ usedPercent: 100 })]), 100)).toBe("exhausted");
    expect(usageQuotaState(usage([limit({ usedPercent: 96 })]), 95)).toBe("exhausted");
    expect(usageQuotaState(usage([limit({ usedPercent: 40 }), limit({ id: "seven_day_opus", scope: "seven_day_opus", usedPercent: 100 })]), 100)).toBe("available");
    expect(usageQuotaState(usage([limit({ allowed: false })]), 100)).toBe("exhausted");
    expect(usageQuotaState(usage([limit({ id: "extra_usage", scope: "overage", usedPercent: 100 })]), 100)).toBe("unknown");
    expect(usageQuotaState(usage([], "unsupported"), 100)).toBe("unknown");
    expect(usageQuotaState(usage([limit({ usedPercent: 100 })], "error"), 100)).toBe("unknown");
  });

  it("is exhausted only when every observed account is", () => {
    const full = usage([limit({ usedPercent: 100 })]);
    const room = usage([limit({ usedPercent: 10 })]);
    expect(providerQuotaState([full, room], 100)).toBe("available");
    expect(providerQuotaState([full, full], 100)).toBe("exhausted");
    expect(providerQuotaState([full, usage([], "error")], 100)).toBe("unknown");
    expect(providerQuotaState([], 100)).toBe("unknown");
  });
});

describe("ppclip routing decisions", () => {
  const base = {
    mode: "hybrid",
    primaryType: "claude_local",
    currentType: "claude_local",
    previousMode: null as string | null,
    providers: ["claude_local", "codex_local", "grok_local"],
    canMapTo: (type: string) => type !== "grok_local",
  };
  const quotas = (map: Record<string, QuotaState>) => (type: string) => map[type] ?? "unknown";

  it("Hybrid stays on the own provider while it has room or usage is unknown", () => {
    expect(decideTarget({ ...base, quota: quotas({ claude_local: "available" }) }).target).toBe("claude_local");
    expect(decideTarget({ ...base, quota: quotas({}) }).target).toBe("claude_local");
  });

  it("Hybrid falls back to the first mapped provider with room", () => {
    const quota = quotas({ claude_local: "exhausted", codex_local: "available", grok_local: "available" });
    expect(decideTarget({ ...base, quota })).toEqual({ target: "codex_local", reason: "claude_local is exhausted." });
    expect(decideTarget({ ...base, quota: quotas({ claude_local: "exhausted", codex_local: "unknown" }) }).target).toBe("claude_local");
  });

  it("Hybrid returns home only on positive evidence, unless an explicit choice is released", () => {
    const away = { ...base, currentType: "codex_local", previousMode: "hybrid" };
    expect(decideTarget({ ...away, quota: quotas({ claude_local: "available" }) }).target).toBe("claude_local");
    expect(decideTarget({ ...away, quota: quotas({ claude_local: "unknown" }) }).target).toBe("codex_local");
    expect(decideTarget({ ...away, previousMode: "codex_local", quota: quotas({ claude_local: "unknown" }) }).target).toBe("claude_local");
    expect(decideTarget({ ...away, previousMode: "codex_local", quota: quotas({ claude_local: "exhausted" }) }).target).toBe("codex_local");
  });

  it("'<provider> only' forces that provider when the tier maps it", () => {
    expect(decideTarget({ ...base, mode: "codex_local", quota: quotas({}) }).target).toBe("codex_local");
    expect(decideTarget({ ...base, mode: "grok_local", quota: quotas({}) }).target).toBe("claude_local");
    expect(decideTarget({ ...base, mode: "claude_local", currentType: "codex_local", quota: quotas({}) }).target).toBe("claude_local");
  });
});

describe("ppclip routed configuration", () => {
  const supported = (type: string) => type === "codex_local" ? ["minimal", "low", "medium", "high", "xhigh"] : ["low", "medium", "high", "max"];
  const primary = {
    adapterType: "claude_local",
    adapterConfig: { model: "claude-opus-5-5", effort: "max", cwd: "/work", instructionsFilePath: "/i.md", timeoutSec: 600, chrome: true },
    aiConnection: { mode: "responsible_user", provider: "anthropic", method: "subscription" },
  };
  const agent = { ...primary, adapterConfig: { ...primary.adapterConfig, env: { FOO: { type: "plain", value: "1" } } } };
  const codex = {
    adapterType: "codex_local",
    adapterConfig: { model: "gpt-5", modelReasoningEffort: "low", search: true, cwd: "/other", env: { OPENAI_API_KEY: "x" }, instructionsFilePath: "/other.md" },
    aiConnection: { mode: "responsible_user", provider: "openai", method: "subscription" },
  };

  it("borrows the template's harness and binding but keeps the agent's own instructions, workspace and env", () => {
    const routed = buildRoutedConfig({ agent, primary, template: codex, targetModel: "gpt-6-astra", supportedEfforts: supported });
    expect(routed).toEqual({
      adapterType: "codex_local",
      adapterConfig: {
        model: "gpt-6-astra", modelReasoningEffort: "xhigh", search: true,
        cwd: "/work", instructionsFilePath: "/i.md", timeoutSec: 600, env: { FOO: { type: "plain", value: "1" } },
      },
      aiConnection: codex.aiConnection,
    });
  });

  it("refuses a template that skips permission checks", () => {
    const unsafe = { ...codex, adapterConfig: { ...codex.adapterConfig, dangerouslyBypassApprovalsAndSandbox: true } };
    expect(() => buildRoutedConfig({ agent, primary, template: unsafe, targetModel: "gpt-6-astra", supportedEfforts: supported })).toThrow(/permission checks/);
  });

  it("translates effort to the nearest supported level, never stronger", () => {
    expect(translateEffort("max", ["low", "medium", "high", "xhigh"])).toBe("xhigh");
    expect(translateEffort("minimal", ["low", "medium", "high"])).toBe("low");
    expect(translateEffort("high", ["low", "medium", "high"])).toBe("high");
    expect(translateEffort("high", [])).toBeNull();
    expect(translateEffort(null, ["low"])).toBeNull();
  });

  it("restores the saved config with the agent's current env", () => {
    const routedAgent = { ...codex, adapterConfig: { ...codex.adapterConfig, env: { FOO: { type: "plain", value: "2" } } } };
    expect(restoredConfig(routedAgent, primary)).toEqual({ ...primary, adapterConfig: { ...primary.adapterConfig, env: { FOO: { type: "plain", value: "2" } } } });
  });

  it("signs configs independent of key order", () => {
    expect(configSignature({ adapterType: "a", adapterConfig: { x: 1, y: { b: 1, a: 2 } }, aiConnection: null }))
      .toBe(configSignature({ adapterType: "a", adapterConfig: { y: { a: 2, b: 1 }, x: 1 }, aiConnection: undefined }));
  });
});

describe("ppclip routing record metadata", () => {
  const record = { primary: { adapterType: "claude_local", adapterConfig: { model: "m" }, aiConnection: null }, expected: "sig", mode: "hybrid", switchedAt: "t" };

  it("round-trips and keeps other metadata", () => {
    const metadata = withRoutingRecord({ key: "v" }, record);
    expect(readRoutingRecord(metadata)).toEqual(record);
    expect(withRoutingRecord(metadata, null)).toEqual({ key: "v" });
    expect(readRoutingRecord({ ppclipProviderRouting: { expected: 1 } })).toBeNull();
  });

  it("ordinary updates cannot change or drop the record; hires never inherit it", () => {
    const stored = withRoutingRecord({ key: "v" }, record);
    expect(preserveRoutingMetadata(stored, { key: "w", ppclipProviderRouting: { forged: true } })).toEqual({ key: "w", ppclipProviderRouting: record });
    expect(preserveRoutingMetadata(stored, null)).toEqual({ ppclipProviderRouting: record });
    expect(preserveRoutingMetadata({ key: "v" }, null)).toBeNull();
    expect(stripRoutingMetadata(stored)).toEqual({ key: "v" });
  });
});
