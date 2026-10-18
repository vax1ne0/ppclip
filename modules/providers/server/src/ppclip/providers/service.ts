/**
 * ppclip PROV-2: provider-routing policy storage and the in-server controller.
 *
 * Storage needs no migration and has one source of truth, the database:
 * - The company policy is the latest `ppclip.provider_routing.updated` activity
 *   row for the company (its `details.policy`). Every save is an audit entry.
 * - While an agent runs away from its own provider, `agents.metadata.ppclipProviderRouting`
 *   keeps its own config (without env) so Hybrid can restore it.
 * - Controller health lives in this server process: the controller runs here.
 *
 * Usage observations come only from official Connections usage
 * (`aiConnectionService.probeUsage`), probed as the board user who turned
 * routing on, with a short cache so providers are not polled aggressively.
 */
import { and, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { activityLog, agents, heartbeatRuns, issues, type Db } from "@paperclipai/db";
import {
  aiConnectionBindingSchema,
  type AiConnectionUsage,
  type AiManagedConnectionSummary,
} from "@paperclipai/shared";
import { claudeLocalReasoningEffortsForModel } from "@paperclipai/adapter-claude-local";
import { codexLocalReasoningEffortsForModel } from "@paperclipai/adapter-codex-local";
import { grokLocalReasoningEffortsForModel } from "@paperclipai/adapter-grok-local";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { sanitizeRecord } from "../../redaction.js";
import { logActivity } from "../../services/activity-log.js";
import { updateAgentConfigurationInTransaction } from "../../services/agent-configuration-transaction.js";
import { aiConnectionService } from "../../services/ai-connections.js";
import { ppclipFeature } from "../features.js";
import {
  aiProviderForAdapter,
  buildRoutedConfig,
  configSignature,
  decideTarget,
  defaultPolicy,
  isRoutableAdapter,
  mapModel,
  providerQuotaState,
  readRoutingRecord,
  restoredConfig,
  routingPolicyInputSchema,
  withRoutingRecord,
  withTierMemberships,
  type HarnessConfig,
  type QuotaState,
  type RoutingPolicy,
  type RoutingPolicyInput,
} from "./policy.js";
import { parseObject as asRecord } from "@paperclipai/adapter-utils/server-utils";
import { cachedUsage, usageCacheKey } from "./usage-cache.js";
import { modelPolicyService } from "./model-policy.js";

const POLICY_UPDATED_ACTION = "ppclip.provider_routing.updated";
const AGENT_SWITCHED_ACTION = "ppclip.provider_routing.agent_switched";
const AGENT_RELEASED_ACTION = "ppclip.provider_routing.agent_released";
const CONTROLLER_INTERVAL_MS = 60_000;
const LIVE_RUN_STATUSES = ["queued", "running", "scheduled_retry"];
const CLOSED_TASK_STATUSES = ["done", "cancelled"];
const WAITING_AGENT_STATUSES = new Set(["running", "paused", "pending_approval"]);

type AgentRow = typeof agents.$inferSelect;
export type RoutingActor = { actorType: "user" | "system"; actorId: string };
export type AgentRoutingHealth = {
  agentId: string;
  state: "ready" | "switched" | "waiting" | "blocked";
  message: string;
  adapterType: string;
  primaryAdapterType: string | null;
};
type ProviderQuota = { adapterType: string; state: QuotaState; accounts: number };
export type ControllerHealth = {
  checkedAt: string;
  revision: number;
  agents: AgentRoutingHealth[];
  quotas: ProviderQuota[];
  error: string | null;
};
type ProviderCandidate = {
  adapterType: string;
  agents: { id: string; name: string }[];
};
export type ProviderRoutingStatus = {
  policy: RoutingPolicy;
  candidates: ProviderCandidate[];
  routedAgents: { agentId: string; name: string; adapterType: string; primaryAdapterType: string }[];
  controller: { intervalMs: number; health: ControllerHealth | null };
};

/** Seams for tests: Connections listing and usage probes default to official's service. */
export type UsageSource = {
  listAccounts: (companyId: string, userId: string) => Promise<AiManagedConnectionSummary[]>;
  probe: (companyId: string, userId: string, account: AiManagedConnectionSummary) => Promise<AiConnectionUsage | null>;
};


function harnessOf(agent: Pick<AgentRow, "adapterType" | "adapterConfig" | "runtimeConfig">): HarnessConfig {
  return {
    adapterType: agent.adapterType,
    adapterConfig: asRecord(agent.adapterConfig),
    aiConnection: asRecord(agent.runtimeConfig).aiConnection ?? null,
  };
}

/** The agent's own provider config: its saved one while routed, else its current one. */
function ownHarness(agent: AgentRow): HarnessConfig {
  return readRoutingRecord(agent.metadata)?.primary ?? harnessOf(agent);
}

function withoutEnv(config: HarnessConfig): HarnessConfig {
  const { env: _env, ...adapterConfig } = config.adapterConfig;
  return { ...config, adapterConfig };
}

export function supportedEfforts(adapterType: string, model: string): readonly string[] {
  if (adapterType === "claude_local") return claudeLocalReasoningEffortsForModel(model);
  if (adapterType === "codex_local") return codexLocalReasoningEffortsForModel(model);
  if (adapterType === "grok_local") return grokLocalReasoningEffortsForModel(model);
  return [];
}

/** Official Connections, through the shared usage cache (one probe per account per TTL). */
function officialUsageSource(db: Db): UsageSource {
  const connections = aiConnectionService(db);
  return {
    listAccounts: (companyId, userId) => connections.list(companyId, userId),
    probe: (companyId, userId, account) => cachedUsage(usageCacheKey(companyId, account),
      () => connections.probeUsage(companyId, userId, account.id, account.grantId)),
  };
}

const health = new Map<string, ControllerHealth>();
function controllerHealth(companyId: string) {
  return health.get(companyId) ?? null;
}

export function providerRoutingService(db: Db, options: { usage?: UsageSource } = {}) {
  const usage = options.usage ?? officialUsageSource(db);

  async function readPolicy(companyId: string, client: Pick<Db, "select"> = db): Promise<RoutingPolicy> {
    const [row] = await client
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.companyId, companyId),
        eq(activityLog.entityType, "company"),
        eq(activityLog.entityId, companyId),
        eq(activityLog.action, POLICY_UPDATED_ACTION),
      ))
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(1);
    if (!row) return defaultPolicy();
    const stored = asRecord(asRecord(row.details).policy);
    const parsed = routingPolicyInputSchema.safeParse({
      enabled: stored.enabled, mode: stored.mode, thresholdPercent: stored.thresholdPercent,
      providers: stored.providers, tiers: stored.tiers, modelTiers: stored.modelTiers,
    });
    // An unreadable entry turns routing off rather than guessing.
    if (!parsed.success) return { ...defaultPolicy(), revision: Number(stored.revision) || 0 };
    return {
      ...parsed.data,
      revision: Number(stored.revision) || 0,
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : null,
      updatedBy: typeof stored.updatedBy === "string" ? stored.updatedBy : null,
    };
  }

  async function companyAgents(companyId: string, client: Pick<Db, "select"> = db) {
    return client.select().from(agents).where(eq(agents.companyId, companyId)).orderBy(agents.createdAt, agents.id);
  }

  async function savePolicy(companyId: string, expectedRevision: number, input: RoutingPolicyInput, actor: RoutingActor) {
    const next = withTierMemberships(routingPolicyInputSchema.parse(input));
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.provider_routing:${companyId}`}, 0))`);
      const current = await readPolicy(companyId, tx);
      if (current.revision !== expectedRevision) {
        throw conflict("Provider settings changed in another window. Reload before saving.");
      }
      const team = await companyAgents(companyId, tx);
      for (const provider of next.providers) {
        const template = team.find((agent) => agent.id === provider.templateAgentId);
        if (!template || template.status === "terminated") {
          throw unprocessable(`Choose an active ${provider.adapterType} agent as that provider's template.`);
        }
        if (ownHarness(template).adapterType !== provider.adapterType) {
          throw unprocessable(`The ${provider.adapterType} template agent must use ${provider.adapterType}.`);
        }
      }
      const policy: RoutingPolicy = {
        ...next,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.actorId,
      };
      await logActivity(tx as unknown as Db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: POLICY_UPDATED_ACTION,
        entityType: "company",
        entityId: companyId,
        details: { policy, enabledChanged: current.enabled !== policy.enabled, modeChanged: current.mode !== policy.mode },
      });
      return policy;
    });
  }

  async function status(companyId: string): Promise<ProviderRoutingStatus> {
    const [policy, team] = await Promise.all([readPolicy(companyId), companyAgents(companyId)]);
    const byType = new Map<string, { id: string; name: string }[]>();
    for (const agent of team) {
      if (agent.status === "terminated") continue;
      const own = ownHarness(agent).adapterType;
      if (!isRoutableAdapter(own)) continue;
      byType.set(own, [...(byType.get(own) ?? []), { id: agent.id, name: agent.name }]);
    }
    for (const provider of policy.providers) if (!byType.has(provider.adapterType)) byType.set(provider.adapterType, []);
    const candidates = [...byType.entries()]
      .map(([adapterType, list]) => ({ adapterType, agents: list }))
      .sort((a, b) => a.adapterType.localeCompare(b.adapterType));
    const routedAgents = team.flatMap((agent) => {
      const record = readRoutingRecord(agent.metadata);
      return record ? [{ agentId: agent.id, name: agent.name, adapterType: agent.adapterType, primaryAdapterType: record.primary.adapterType }] : [];
    });
    return { policy, candidates, routedAgents, controller: { intervalMs: CONTROLLER_INTERVAL_MS, health: controllerHealth(companyId) } };
  }

  /** Accept the agent's current settings as its own and forget the saved original. */
  async function release(companyId: string, agentId: string, actor: RoutingActor) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.provider_routing:${companyId}`}, 0))`);
      const [agent] = await tx.select().from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).for("update");
      if (!agent) throw notFound("Agent not found");
      const record = readRoutingRecord(agent.metadata);
      if (!record) return { agentId, released: false };
      await tx.update(agents).set({ metadata: withRoutingRecord(agent.metadata, null), updatedAt: new Date() }).where(eq(agents.id, agentId));
      await logActivity(tx as unknown as Db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId, action: AGENT_RELEASED_ACTION,
        entityType: "agent", entityId: agentId, agentId,
        details: { adapterType: agent.adapterType, primaryAdapterType: record.primary.adapterType },
      });
      return { agentId, released: true };
    });
  }

  async function providerQuotas(companyId: string, policy: RoutingPolicy, team: AgentRow[]) {
    const quotas = new Map<string, ProviderQuota>();
    const userId = policy.updatedBy;
    const accounts = userId ? await usage.listAccounts(companyId, userId).catch(() => []) : [];
    for (const provider of policy.providers) {
      const aiProvider = aiProviderForAdapter(provider.adapterType);
      const template = team.find((agent) => agent.id === provider.templateAgentId);
      const binding = aiConnectionBindingSchema.safeParse(template ? ownHarness(template).aiConnection : null);
      const pinned = binding.success && binding.data.mode === "shared" ? binding.data : null;
      const matching = accounts.filter((account) =>
        account.provider === aiProvider
        && account.status === "connected"
        && account.usageProbeSupported !== false
        && (!pinned || (account.id === pinned.connectionId && account.grantId === pinned.grantId)));
      const observations: AiConnectionUsage[] = [];
      for (const account of matching) {
        const observed = userId ? await usage.probe(companyId, userId, account) : null;
        if (observed) observations.push(observed);
      }
      quotas.set(provider.adapterType, {
        adapterType: provider.adapterType,
        state: providerQuotaState(observations, policy.thresholdPercent),
        accounts: matching.length,
      });
    }
    return quotas;
  }

  async function liveRunAgents(companyId: string) {
    const rows = await db.selectDistinct({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, LIVE_RUN_STATUSES)));
    return new Set(rows.map((row) => row.agentId));
  }

  async function taskModelOverride(agentId: string, client: Pick<Db, "select"> = db) {
    const rows = await client.select({ identifier: issues.identifier, overrides: issues.assigneeAdapterOverrides }).from(issues)
      .where(and(
        eq(issues.assigneeAgentId, agentId),
        notInArray(issues.status, CLOSED_TASK_STATUSES),
        isNotNull(issues.assigneeAdapterOverrides),
      ));
    return rows.find((row) => {
      const config = asRecord(asRecord(row.overrides).adapterConfig);
      return ["model", "effort", "modelReasoningEffort", "reasoningEffort"].some((key) => config[key] !== undefined);
    }) ?? null;
  }

  /** One controller pass for a company. Switches only idle agents, one transaction each. */
  async function reconcile(companyId: string): Promise<ControllerHealth> {
    const policy = await readPolicy(companyId);
    const checkedAt = new Date().toISOString();
    if (!policy.enabled) {
      const off: ControllerHealth = { checkedAt, revision: policy.revision, agents: [], quotas: [], error: null };
      health.set(companyId, off);
      return off;
    }
    const team = await companyAgents(companyId);
    const quotas = await providerQuotas(companyId, policy, team);
    const live = await liveRunAgents(companyId);
    const providerTypes = policy.providers.map((p) => p.adapterType);
    const results: AgentRoutingHealth[] = [];

    for (const agent of team) {
      const record = readRoutingRecord(agent.metadata);
      if (agent.status === "terminated") continue;
      if (!record && !providerTypes.includes(agent.adapterType)) continue;
      const primary = record?.primary ?? withoutEnv(harnessOf(agent));
      const report = (state: AgentRoutingHealth["state"], message: string) =>
        results.push({ agentId: agent.id, state, message, adapterType: agent.adapterType, primaryAdapterType: primary.adapterType });
      try {
        if (WAITING_AGENT_STATUSES.has(agent.status) || live.has(agent.id)) {
          report("waiting", agent.status === "paused" ? "Paused agents stay where they are." : "Switches after the current work finishes.");
          continue;
        }
        if (record && configSignature(harnessOf(agent)) !== record.expected) {
          report("blocked", "Settings changed outside routing. Keep the current settings or restore them before routing resumes.");
          continue;
        }
        const primaryModel = typeof primary.adapterConfig.model === "string" ? primary.adapterConfig.model : null;
        const templateFor = (type: string) => {
          const provider = policy.providers.find((p) => p.adapterType === type);
          const template = provider ? team.find((a) => a.id === provider.templateAgentId && a.status !== "terminated") : null;
          return template ? ownHarness(template) : null;
        };
        const canMapTo = (type: string) =>
          type === primary.adapterType
          || (templateFor(type)?.adapterType === type && mapModel(policy, primary.adapterType, primaryModel, type).ok);
        const decision = decideTarget({
          mode: policy.mode,
          primaryType: primary.adapterType,
          currentType: agent.adapterType,
          previousMode: record?.mode ?? null,
          providers: providerTypes,
          quota: (type) => quotas.get(type)?.state ?? "unknown",
          canMapTo,
        });
        if (decision.target === agent.adapterType) {
          report(record ? "switched" : "ready", record ? `Running on ${agent.adapterType} instead of ${primary.adapterType}.` : decision.reason);
          continue;
        }
        const override = await taskModelOverride(agent.id);
        if (override) {
          report("blocked", `Task ${override.identifier ?? ""} has its own model or effort. Clear it before this agent can switch.`.replace("  ", " "));
          continue;
        }
        const restoring = decision.target === primary.adapterType;
        let next: HarnessConfig;
        if (restoring) {
          next = restoredConfig(harnessOf(agent), primary);
        } else {
          const template = templateFor(decision.target);
          const mapping = mapModel(policy, primary.adapterType, primaryModel, decision.target);
          if (!template || !mapping.ok) throw new Error(mapping.ok ? "The provider's template agent is unavailable." : mapping.reason);
          if (!record) {
            const own = primary.adapterConfig;
            if (JSON.stringify(sanitizeRecord(own)) !== JSON.stringify(own)) {
              throw new Error("This agent keeps credentials in its harness settings. Move them to Connections or secrets before routing.");
            }
          }
          next = buildRoutedConfig({ agent: harnessOf(agent), primary, template, targetModel: mapping.model, supportedEfforts });
        }
        const applied = await apply(companyId, agent.id, agent.updatedAt, next, restoring ? null : { primary, mode: policy.mode }, decision.reason);
        if (!applied) {
          report("waiting", "The agent changed or started work; retrying on the next pass.");
          continue;
        }
        report(restoring ? "ready" : "switched", restoring
          ? `Restored to ${primary.adapterType}.`
          : `Switched to ${next.adapterType} · ${String(next.adapterConfig.model)}.`);
      } catch (error) {
        report("blocked", error instanceof Error ? error.message : "Switching failed.");
      }
    }
    const result: ControllerHealth = {
      checkedAt,
      revision: policy.revision,
      agents: results,
      quotas: [...quotas.values()],
      error: null,
    };
    health.set(companyId, result);
    return result;
  }

  async function apply(
    companyId: string,
    agentId: string,
    seenUpdatedAt: Date,
    next: HarnessConfig,
    routed: { primary: HarnessConfig; mode: string } | null,
    reason: string,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.provider_routing:${companyId}`}, 0))`);
      const [fresh] = await tx.select().from(agents).where(and(eq(agents.id, agentId), eq(agents.companyId, companyId))).for("update");
      if (!fresh || fresh.updatedAt.getTime() !== seenUpdatedAt.getTime() || WAITING_AGENT_STATUSES.has(fresh.status)) return false;
      const [liveRun] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, LIVE_RUN_STATUSES))).limit(1);
      if (liveRun) return false;
      await modelPolicyService(tx as unknown as Db).assertAllowed(companyId, next.adapterType, next.adapterConfig);
      const runtimeConfig = { ...asRecord(fresh.runtimeConfig) };
      if (next.aiConnection) runtimeConfig.aiConnection = next.aiConnection;
      else delete runtimeConfig.aiConnection;
      // Official's in-transaction configuration update normalizes secrets and runner
      // config, records a config revision, and resets sessions because the harness changes.
      const updated = await updateAgentConfigurationInTransaction(
        tx as unknown as Db,
        agentId,
        { adapterType: next.adapterType, adapterConfig: next.adapterConfig, runtimeConfig },
        { recordRevision: { source: "ppclip_provider_routing" } },
      );
      if (!updated) return false;
      // Sign the stored row exactly as later passes read it.
      const [stored] = await tx.select().from(agents).where(eq(agents.id, agentId));
      if (!stored) return false;
      const previous = readRoutingRecord(fresh.metadata);
      const record = routed
        ? { primary: previous?.primary ?? routed.primary, expected: configSignature(harnessOf(stored)), mode: routed.mode, switchedAt: new Date().toISOString() }
        : null;
      await tx.update(agents).set({ metadata: withRoutingRecord(stored.metadata, record) }).where(eq(agents.id, agentId));
      await logActivity(tx as unknown as Db, {
        companyId, actorType: "system", actorId: "ppclip-provider-routing", action: AGENT_SWITCHED_ACTION,
        entityType: "agent", entityId: agentId, agentId,
        details: {
          from: fresh.adapterType, to: next.adapterType,
          model: typeof next.adapterConfig.model === "string" ? next.adapterConfig.model : null,
          restored: routed === null, reason,
        },
      });
      return true;
    });
  }

  async function enabledCompanyIds() {
    const rows = await db.selectDistinct({ companyId: activityLog.companyId }).from(activityLog)
      .where(eq(activityLog.action, POLICY_UPDATED_ACTION));
    const enabled: string[] = [];
    for (const row of rows) if ((await readPolicy(row.companyId)).enabled) enabled.push(row.companyId);
    return enabled;
  }

  return { readPolicy, savePolicy, status, release, reconcile, enabledCompanyIds };
}

/**
 * The controller runs inside the server as a periodic job, so it shares the
 * server's database and can never read a different policy than the API wrote.
 * It only acts for companies that turned routing on (off by default).
 */
export function startProviderRoutingController(
  db: Db,
  options: { intervalMs?: number; isPaused?: () => boolean; onError?: (error: unknown) => void } = {},
) {
  const service = providerRoutingService(db);
  let running = false;
  const tick = async () => {
    if (running || options.isPaused?.()) return;
    if (!ppclipFeature("providerRouting")) return;
    running = true;
    try {
      for (const companyId of await service.enabledCompanyIds()) {
        await service.reconcile(companyId).catch((error) => {
          health.set(companyId, {
            checkedAt: new Date().toISOString(), revision: 0, agents: [], quotas: [],
            error: error instanceof Error ? error.message : "Controller pass failed.",
          });
          options.onError?.(error);
        });
      }
    } catch (error) {
      options.onError?.(error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), options.intervalMs ?? CONTROLLER_INTERVAL_MS);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
