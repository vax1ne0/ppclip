import { and, desc, eq, ne, sql } from "drizzle-orm";
import { activityLog, agents, companies, type Db } from "@paperclipai/db";
import { agentHarnessType } from "@paperclipai/shared";
import { z } from "zod";
import { conflict } from "../../errors.js";
import { logActivity } from "../../services/activity-log.js";
import { ppclipFeature } from "../features.js";

const ACTION = "ppclip.model_policy.updated";
const ENTITY = "ppclip_model_policy";
const entry = z.object({ adapterType: z.string().trim().min(1).max(100), model: z.string().trim().min(1).max(200) }).strict();
export const modelPolicyInputSchema = z.object({ allowedModels: z.array(entry).max(200) }).strict();
export const modelPolicyUpdateSchema = z.object({ expectedRevision: z.number().int().nonnegative(), policy: modelPolicyInputSchema }).strict();
export type ModelPolicy = z.infer<typeof modelPolicyInputSchema> & { revision: number; updatedAt: string; updatedBy: string };
type Client = Pick<Db, "select">;

function modelHarness(adapterType: string, config: Record<string, unknown>) {
  const harness = agentHarnessType(adapterType, config);
  return ({ codex: "codex_local", claude: "claude_local", grok: "grok_local", gemini: "gemini_local", kimi: "kimi_local", pi: "pi_local", hermes: "hermes_local" } as Record<string, string>)[harness] ?? harness;
}

function isModelHarness(adapterType: string, config: Record<string, unknown>) {
  if (["process", "http", "openclaw_gateway", "hermes_gateway"].includes(adapterType)) return false;
  if (adapterType === "paperclip_runner" && ["openai_dot", "grok_bot"].includes(String(config.provider))) return false;
  return true;
}

function explicitModel(adapterType: string, config: Record<string, unknown>) {
  if (typeof config.model === "string") return config.model.trim();
  if (adapterType === "kimi_local") {
    const binding = (config.env as Record<string, unknown> | undefined)?.KIMI_MODEL_NAME as { type?: string; value?: unknown } | undefined;
    if (binding?.type === "plain" && typeof binding.value === "string") return binding.value.trim();
  }
  return "";
}

export function assertAllowedModel(policy: Pick<ModelPolicy, "allowedModels">, adapterType: string, config: Record<string, unknown>) {
  if (!isModelHarness(adapterType, config)) return;
  const model = explicitModel(adapterType, config);
  if (!model || /^(default|auto)$/i.test(model)) throw new Error("Choose an explicit model in agent settings before running this agent.");
  const harness = modelHarness(adapterType, config);
  const args = [...(Array.isArray(config.extraArgs) ? config.extraArgs : []), ...(Array.isArray(config.args) ? config.args : [])].join(" ");
  if (/(?:^|\s)(?:--model(?:=|\s|$)|-m(?:[^\s]*|\s|$)|(?:-c|--config)(?:=|\s+)?['"]?(?:model|model_provider)\s*=)/.test(args)) {
    throw new Error("Set the model in the Model field instead of overriding it in extra arguments.");
  }
  if (!policy.allowedModels.some(entry => entry.adapterType === harness && entry.model === model)) {
    throw new Error(`Model ${model} (${harness}) is not approved for this company. Add it under Providers → Approved models.`);
  }
}

export function modelPolicyService(db: Db) {
  async function read(companyId: string, client: Client = db): Promise<ModelPolicy | null> {
    const [row] = await client.select({ details: activityLog.details }).from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.entityType, ENTITY), eq(activityLog.entityId, companyId), eq(activityLog.action, ACTION)))
      // Transaction timestamps can precede an advisory-lock wait. Revision,
      // assigned under that lock, is the authoritative order of approvals.
      .orderBy(desc(sql`(${activityLog.details}->'policy'->>'revision')::bigint`), desc(activityLog.createdAt), desc(activityLog.id)).limit(1);
    if (!row) return null;
    const raw = (row.details as { policy?: unknown } | null)?.policy as ModelPolicy | undefined;
    const parsed = modelPolicyInputSchema.safeParse(raw && { allowedModels: raw.allowedModels });
    if (!parsed.success || !Number.isSafeInteger(raw?.revision)) throw new Error("Model approval settings could not be read. Review them in Providers before running agents.");
    return { ...parsed.data, revision: raw!.revision, updatedAt: raw!.updatedAt, updatedBy: raw!.updatedBy };
  }
  async function write(companyId: string, policy: ModelPolicy, actor: { actorType: "user" | "system"; actorId: string }, client: Db) {
    await logActivity(client, { companyId, ...actor, action: ACTION, entityType: ENTITY, entityId: companyId, details: { policy } });
    return policy;
  }
  async function initialize(companyId: string): Promise<ModelPolicy> {
    const saved = await read(companyId);
    if (saved) return saved;
    // One-time migration: snapshot explicit, existing choices. Never infer an
    // approval from the model of the pending run or a later configuration edit.
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.model_policy:${companyId}`}, 0))`);
      const existing = await read(companyId, tx);
      if (existing) return existing;
      const team = await tx.select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig }).from(agents)
        .where(and(eq(agents.companyId, companyId), ne(agents.status, "terminated"), ne(agents.status, "pending_approval")));
      const entries = new Map<string, z.infer<typeof entry>>();
      for (const agent of team) {
        const config = agent.adapterConfig ?? {};
        const model = explicitModel(agent.adapterType, config);
        if (!isModelHarness(agent.adapterType, config) || !model || /^(default|auto)$/i.test(model)) continue;
        const adapterType = modelHarness(agent.adapterType, config);
        entries.set(`${adapterType}:${model}`, { adapterType, model });
      }
      return write(companyId, { allowedModels: [...entries.values()], revision: 1, updatedAt: new Date().toISOString(), updatedBy: "ppclip-existing-models" },
        { actorType: "system", actorId: "ppclip-existing-models" }, tx as unknown as Db);
    });
  }
  return {
    get: async (companyId: string): Promise<ModelPolicy> => await read(companyId) ?? { allowedModels: [], revision: 0, updatedAt: "", updatedBy: "" },
    async initializeExisting() {
      if (!ppclipFeature("modelApprovals")) return;
      for (const company of await db.select({ id: companies.id }).from(companies)) await initialize(company.id);
    },
    async save(companyId: string, expectedRevision: number, input: z.infer<typeof modelPolicyInputSchema>, userId: string) {
      const parsed = modelPolicyInputSchema.parse(input);
      return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ppclip.model_policy:${companyId}`}, 0))`);
        const current = await read(companyId, tx);
        if ((current?.revision ?? 0) !== expectedRevision) throw conflict("Model approvals changed in another window. Reload before saving.");
        return write(companyId, { ...parsed, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: userId },
          { actorType: "user", actorId: userId }, tx as unknown as Db);
      });
    },
    async assertAllowed(companyId: string, adapterType: string, config: Record<string, unknown>) {
      if (!ppclipFeature("modelApprovals")) return;
      if (isModelHarness(adapterType, config)) assertAllowedModel(await read(companyId) ?? { allowedModels: [] }, adapterType, config);
    },
  };
}
