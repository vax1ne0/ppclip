/**
 * ppclip PROV-1 / PROV-2: pure provider-routing logic (no I/O).
 *
 * A "provider" here is a routable harness (adapter type) whose sign-in lives in
 * official Connections: claude_local (Anthropic), codex_local (OpenAI),
 * grok_local (xAI) and opencode_local (OpenRouter). Usage observations always
 * come from official Connections usage (`AiConnectionUsage`); this module never
 * reads provider quota itself.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AI_CONNECTION_CAPABILITIES,
  AI_PROVIDERS,
  type AiConnectionUsage,
  type AiProvider,
} from "@paperclipai/shared";
import { parseObject as asRecord } from "@paperclipai/adapter-utils/server-utils";

const TIER_COUNT = 5;
const DEFAULT_TIER_NAMES = ["Light", "Standard", "Advanced", "Expert", "Maximum"] as const;
const TIER_IDS = ["tier-1", "tier-2", "tier-3", "tier-4", "tier-5"] as const;
const MAX_PROVIDERS = 12;

/** Routable adapter type -> the AI provider whose Connections account it signs in with. */
export function aiProviderForAdapter(adapterType: string): AiProvider | null {
  for (const provider of AI_PROVIDERS) {
    const methods = Object.values(AI_CONNECTION_CAPABILITIES[provider].methods);
    if (methods.some((method) => method?.adapters.includes(adapterType))) return provider;
  }
  return null;
}

export function isRoutableAdapter(adapterType: string) {
  return aiProviderForAdapter(adapterType) !== null;
}

const adapterTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,99}$/)
  .refine(isRoutableAdapter, "Only harnesses that sign in through Connections can be routed");
const modelSchema = z.string().trim().min(1).max(200);

const tierSchema = z
  .object({
    id: z.enum(TIER_IDS),
    name: z.string().trim().min(1).max(60),
    models: z.record(adapterTypeSchema, modelSchema),
  })
  .strict();

const providerSchema = z
  .object({
    adapterType: adapterTypeSchema,
    /** The agent whose harness flags, permissions and Connections binding a switched agent borrows. */
    templateAgentId: z.string().uuid(),
  })
  .strict();

const membershipSchema = z
  .object({ adapterType: adapterTypeSchema, model: modelSchema, tierId: z.enum(TIER_IDS) })
  .strict();

/** What the board may write (PUT body without `expectedRevision`). */
export const routingPolicyInputSchema = z
  .object({
    /** Opt-in: the in-server controller only switches agents while this is on. */
    enabled: z.boolean(),
    mode: z.string().min(1).max(100),
    /** An account-wide window at or above this % counts as exhausted. */
    thresholdPercent: z.number().int().min(50).max(100),
    providers: z.array(providerSchema).max(MAX_PROVIDERS),
    tiers: z.array(tierSchema).length(TIER_COUNT),
    /** Source model -> tier links, kept across tier edits so an agent keeps its tier. */
    modelTiers: z.array(membershipSchema).max(1000),
  })
  .strict()
  .superRefine((policy, ctx) => {
    const providers = policy.providers.map((p) => p.adapterType);
    if (new Set(providers).size !== providers.length) {
      ctx.addIssue({ code: "custom", path: ["providers"], message: "Each provider can be listed once." });
    }
    const tierIds = policy.tiers.map((t) => t.id);
    if (new Set(tierIds).size !== TIER_COUNT) {
      ctx.addIssue({ code: "custom", path: ["tiers"], message: "Tier identifiers must be unique." });
    }
    if (policy.mode !== "hybrid" && !providers.includes(policy.mode)) {
      ctx.addIssue({ code: "custom", path: ["mode"], message: "Select Hybrid or a listed provider." });
    }
    policy.tiers.forEach((tier, index) => {
      if (Object.keys(tier.models).some((type) => !providers.includes(type))) {
        ctx.addIssue({ code: "custom", path: ["tiers", index, "models"], message: "A tier refers to an unlisted provider." });
      }
    });
    const keys = policy.modelTiers.map((m) => `${m.adapterType}\u0000${m.model}`);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["modelTiers"], message: "Each source model belongs to exactly one tier." });
    }
  });

export const routingPolicyUpdateSchema = z
  .object({ expectedRevision: z.number().int().min(0) })
  .merge(z.object({ policy: routingPolicyInputSchema }))
  .strict();

export type RoutingPolicyInput = z.infer<typeof routingPolicyInputSchema>;
export type RoutingPolicy = RoutingPolicyInput & {
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type ProviderTier = RoutingPolicyInput["tiers"][number];

export function emptyTiers(): ProviderTier[] {
  return TIER_IDS.map((id, index) => ({ id, name: DEFAULT_TIER_NAMES[index]!, models: {} }));
}

export function defaultPolicy(): RoutingPolicy {
  return {
    enabled: false,
    mode: "hybrid",
    thresholdPercent: 100,
    providers: [],
    tiers: emptyTiers(),
    modelTiers: [],
    revision: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

/**
 * Adds a tier link for every model the tiers now name, keeping every existing
 * link (so an agent whose model was replaced in the table keeps its tier), and
 * drops links to providers that are no longer listed.
 */
export function withTierMemberships(policy: RoutingPolicyInput): RoutingPolicyInput {
  const providers = new Set(policy.providers.map((p) => p.adapterType));
  const memberships = policy.modelTiers.filter((m) => providers.has(m.adapterType));
  const known = new Set(memberships.map((m) => `${m.adapterType}\u0000${m.model}`));
  for (const tier of policy.tiers) {
    for (const [adapterType, model] of Object.entries(tier.models)) {
      const key = `${adapterType}\u0000${model}`;
      if (known.has(key)) continue;
      known.add(key);
      memberships.push({ adapterType, model, tierId: tier.id });
    }
  }
  return { ...policy, modelTiers: memberships };
}

/** The tier a source model belongs to: its saved link first, otherwise a tier naming it. */
export function tierOf(policy: Pick<RoutingPolicyInput, "tiers" | "modelTiers">, adapterType: string, model: string | null | undefined) {
  if (!model) return null;
  const link = policy.modelTiers.find((m) => m.adapterType === adapterType && m.model === model);
  if (link) return policy.tiers.find((t) => t.id === link.tierId) ?? null;
  return policy.tiers.find((t) => t.models[adapterType] === model) ?? null;
}

type ModelMapping = { ok: true; model: string; tierName: string } | { ok: false; reason: string };

/** The tier's model for the target provider. Tiers never change effort. */
export function mapModel(
  policy: Pick<RoutingPolicyInput, "tiers" | "modelTiers">,
  fromType: string,
  fromModel: string | null | undefined,
  toType: string,
): ModelMapping {
  const tier = tierOf(policy, fromType, fromModel);
  if (!tier) return { ok: false, reason: `${fromModel || "The default model"} is not in a model tier.` };
  const model = tier.models[toType];
  if (!model) return { ok: false, reason: `The ${tier.name} tier has no model for ${toType}.` };
  return { ok: true, model, tierName: tier.name };
}

/** At least one tier maps two providers, so switching can do something. */
// ---------------------------------------------------------------- usage → quota

export type QuotaState = "available" | "exhausted" | "unknown";

/** Account-wide windows only: model/feature scopes and overage are separate allowances. */
function accountWideLimits(usage: AiConnectionUsage) {
  return usage.limits.filter((limit) => limit.scope === null);
}

export function usageQuotaState(usage: AiConnectionUsage, thresholdPercent: number): QuotaState {
  if (usage.status !== "ok") return "unknown";
  const limits = accountWideLimits(usage);
  const exhausted = limits.some((limit) =>
    limit.allowed === false
    || limit.limitReached === true
    || (limit.usedPercent != null && limit.usedPercent >= thresholdPercent));
  if (exhausted) return "exhausted";
  const observed = limits.some((limit) => limit.usedPercent != null || limit.limitReached === false || limit.allowed === true);
  return observed ? "available" : "unknown";
}

/**
 * A provider is exhausted only when every observed account is; available when
 * any observed account has room. Unknown is never treated as available.
 */
export function providerQuotaState(usages: AiConnectionUsage[], thresholdPercent: number): QuotaState {
  const states = usages.map((usage) => usageQuotaState(usage, thresholdPercent));
  if (states.includes("available")) return "available";
  if (states.length > 0 && states.every((state) => state === "exhausted")) return "exhausted";
  return "unknown";
}

// ---------------------------------------------------------------- routing decision

type RouteDecision = { target: string; reason: string };

/**
 * Where an idle agent should run next.
 * - "<provider> only": that provider (when its tier model exists, or it is the agent's own).
 * - Hybrid: stay on the agent's own provider; move to the first listed provider
 *   with room when its quota is exhausted; return once its quota is available again.
 */
export function decideTarget(input: {
  mode: string;
  primaryType: string;
  currentType: string;
  previousMode: string | null;
  providers: string[];
  quota: (adapterType: string) => QuotaState;
  canMapTo: (adapterType: string) => boolean;
}): RouteDecision {
  const { mode, primaryType, currentType, previousMode, providers, quota, canMapTo } = input;
  if (mode !== "hybrid") {
    if (mode === primaryType) return { target: primaryType, reason: `${mode} only` };
    if (providers.includes(mode) && canMapTo(mode)) return { target: mode, reason: `${mode} only` };
    return { target: currentType, reason: `No ${mode} model in this agent's tier.` };
  }
  if (currentType !== primaryType) {
    const primaryQuota = quota(primaryType);
    // Releasing an explicit provider choice restores the agent; automatic
    // fallback back to the own provider needs positive evidence of room.
    if (primaryQuota === "available" || (previousMode !== "hybrid" && primaryQuota !== "exhausted")) {
      return { target: primaryType, reason: "Own provider has room again." };
    }
  }
  if (quota(currentType) !== "exhausted") return { target: currentType, reason: "Current provider has room or usage is unknown." };
  const fallback = providers.find((type) => type !== currentType && canMapTo(type) && quota(type) === "available");
  if (fallback) return { target: fallback, reason: `${currentType} is exhausted.` };
  return { target: currentType, reason: "Every mapped provider is exhausted or unknown." };
}

// ---------------------------------------------------------------- configuration

type JsonRecord = Record<string, unknown>;
export type HarnessConfig = { adapterType: string; adapterConfig: JsonRecord; aiConnection: unknown };

const EFFORT_SCALE = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const EFFORT_KEYS = ["effort", "modelReasoningEffort", "reasoningEffort", "variant"];
const EFFORT_KEY_BY_ADAPTER: Record<string, string> = {
  claude_local: "effort",
  codex_local: "modelReasoningEffort",
  grok_local: "reasoningEffort",
};
/** The agent's own identity, instructions and workspace always stay with the agent. */
const OWN_KEY = /instructions|paperclipSkillSync/i;
const OWN_KEYS = new Set(["cwd", "timeoutSec", "graceSec", "env"]);
const UNSAFE_TEMPLATE_KEYS = ["dangerouslySkipPermissions", "dangerouslyBypassApprovalsAndSandbox"];

function readEffort(config: JsonRecord): string | null {
  for (const key of EFFORT_KEYS) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** The same effort when supported, otherwise the strongest supported level not above it. */
export function translateEffort(effort: string | null, supported: readonly string[]): string | null {
  if (!effort || supported.length === 0) return null;
  if (supported.includes(effort)) return effort;
  const rank = EFFORT_SCALE.indexOf(effort);
  if (rank < 0) return null;
  const ranked = supported.filter((value) => EFFORT_SCALE.includes(value))
    .sort((a, b) => EFFORT_SCALE.indexOf(a) - EFFORT_SCALE.indexOf(b));
  const below = ranked.filter((value) => EFFORT_SCALE.indexOf(value) <= rank);
  return below.at(-1) ?? ranked[0] ?? null;
}

/**
 * The configuration an agent runs with on another provider: the template's
 * harness flags and Connections binding, the agent's own instructions,
 * workspace, timeouts and env, the tier model, and the agent's effort translated
 * to the target harness. Credentials are never copied from the template.
 */
export function buildRoutedConfig(input: {
  agent: HarnessConfig;
  primary: HarnessConfig;
  template: HarnessConfig;
  targetModel: string;
  supportedEfforts: (adapterType: string, model: string) => readonly string[];
}): HarnessConfig {
  const { agent, primary, template, targetModel } = input;
  for (const key of UNSAFE_TEMPLATE_KEYS) {
    if (template.adapterConfig[key] === true) {
      throw new Error("The provider's template agent skips permission checks. Turn that off before routing to it.");
    }
  }
  const adapterConfig: JsonRecord = {};
  for (const [key, value] of Object.entries(template.adapterConfig)) {
    if (OWN_KEY.test(key) || OWN_KEYS.has(key) || EFFORT_KEYS.includes(key)) continue;
    adapterConfig[key] = structuredClone(value);
  }
  for (const [key, value] of Object.entries(agent.adapterConfig)) {
    if (OWN_KEY.test(key) || OWN_KEYS.has(key)) adapterConfig[key] = structuredClone(value);
  }
  adapterConfig.model = targetModel;
  const effortKey = EFFORT_KEY_BY_ADAPTER[template.adapterType];
  const effort = translateEffort(readEffort(primary.adapterConfig), input.supportedEfforts(template.adapterType, targetModel));
  if (effortKey && effort) adapterConfig[effortKey] = effort;
  return { adapterType: template.adapterType, adapterConfig, aiConnection: structuredClone(template.aiConnection ?? null) };
}

/** Back to the agent's own provider: its saved config, with today's env. */
export function restoredConfig(agent: HarnessConfig, primary: HarnessConfig): HarnessConfig {
  const adapterConfig = structuredClone(primary.adapterConfig);
  if (agent.adapterConfig.env !== undefined) adapterConfig.env = structuredClone(agent.adapterConfig.env);
  else delete adapterConfig.env;
  return { adapterType: primary.adapterType, adapterConfig, aiConnection: structuredClone(primary.aiConnection ?? null) };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as JsonRecord).sort().map((key) => [key, canonical((value as JsonRecord)[key])]));
  }
  return value;
}

/** Detects edits made outside routing while an agent is switched. */
export function configSignature(config: HarnessConfig) {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ adapterType: config.adapterType, adapterConfig: config.adapterConfig, aiConnection: config.aiConnection ?? null })))
    .digest("hex");
}

// ---------------------------------------------------------------- per-agent record

/** `agents.metadata.ppclipProviderRouting` while an agent runs away from its own provider. */
const ROUTING_METADATA_KEY = "ppclipProviderRouting";
type AgentRoutingRecord = {
  /** The agent's own provider config, without `env` (env always stays on the agent). */
  primary: HarnessConfig;
  /** Signature of the config routing applied; a different one means someone edited it. */
  expected: string;
  mode: string;
  switchedAt: string;
};


export function readRoutingRecord(metadata: unknown): AgentRoutingRecord | null {
  const raw = asRecord(metadata)[ROUTING_METADATA_KEY];
  const record = asRecord(raw);
  const primary = asRecord(record.primary);
  if (typeof primary.adapterType !== "string" || typeof record.expected !== "string") return null;
  return {
    primary: { adapterType: primary.adapterType, adapterConfig: asRecord(primary.adapterConfig), aiConnection: primary.aiConnection ?? null },
    expected: record.expected,
    mode: typeof record.mode === "string" ? record.mode : "hybrid",
    switchedAt: typeof record.switchedAt === "string" ? record.switchedAt : "",
  };
}

export function withRoutingRecord(metadata: unknown, record: AgentRoutingRecord | null): JsonRecord {
  const result = { ...asRecord(metadata) };
  if (record) result[ROUTING_METADATA_KEY] = record;
  else delete result[ROUTING_METADATA_KEY];
  return result;
}

/** Ordinary agent updates keep the routing record: only the controller and board release change it. */
export function preserveRoutingMetadata(existing: unknown, next: unknown): JsonRecord | null {
  const stored = asRecord(existing);
  const has = Object.prototype.hasOwnProperty.call(stored, ROUTING_METADATA_KEY);
  if (next === null && !has) return null;
  const result = { ...asRecord(next) };
  delete result[ROUTING_METADATA_KEY];
  if (has) result[ROUTING_METADATA_KEY] = stored[ROUTING_METADATA_KEY];
  return result;
}

/** New agents never inherit another agent's routing record. */
export function stripRoutingMetadata<T>(metadata: T): T {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  if (!Object.prototype.hasOwnProperty.call(metadata, ROUTING_METADATA_KEY)) return metadata;
  const result = { ...(metadata as JsonRecord) };
  delete result[ROUTING_METADATA_KEY];
  return result as T;
}
