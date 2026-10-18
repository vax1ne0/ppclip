import { randomUUID } from "node:crypto";
import express from "express";
import http from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentConfigRevisions,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@paperclipai/db";
import type { AiConnectionUsage, AiManagedConnectionSummary, AiProvider } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { truncateTablesWithDeadlockRetry } from "./helpers/truncate-with-deadlock-retry.js";
import { errorHandler } from "../middleware/error-handler.js";
import { forbidden } from "../errors.js";
import { agentService } from "../services/agents.ts";
import { emptyTiers, readRoutingRecord, type RoutingPolicyInput } from "../ppclip/providers/policy.ts";
import { ppclipProviderRoutingRoutes } from "../ppclip/providers/routes.ts";
import { providerRoutingService, type UsageSource } from "../ppclip/providers/service.ts";
import { modelPolicyService } from "../ppclip/providers/model-policy.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping ppclip provider routing tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

const board = { actorType: "user" as const, actorId: "board-user" };
type Actor = Express.Request["actor"];

describeEmbeddedPostgres("ppclip provider routing", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const used: Partial<Record<AiProvider, number | "error">> = {};
  const probes: string[] = [];

  const usage: UsageSource = {
    listAccounts: async (companyId) => (["anthropic", "openai"] as const).map((provider): AiManagedConnectionSummary => ({
      id: randomUUID(), grantId: randomUUID(), companyId, provider, method: "subscription", name: `${provider} account`,
      ownership: "shared", isDefault: false, status: "connected", usageProbeSupported: true,
    })),
    probe: async (_companyId, userId, account): Promise<AiConnectionUsage> => {
      probes.push(`${userId}:${account.provider}`);
      const value = used[account.provider];
      return {
        connectionId: account.id, grantId: account.grantId, provider: account.provider, method: account.method,
        status: value === "error" || value === undefined ? "error" : "ok", checkedAt: new Date().toISOString(),
        source: null, planType: null, overage: null,
        limits: typeof value === "number" ? [{
          id: "five_hour", label: "5 hour limit", scope: null, windowDurationSeconds: 18000, resetsAt: null,
          usedPercent: value, remainingPercent: 100 - value, used: null, limit: null, remaining: null, unit: "percent",
          limitReached: null, allowed: null,
        }] : [],
      };
    },
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("ppclip-provider-routing-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    for (const key of Object.keys(used)) delete used[key as AiProvider];
    probes.length = 0;
    await truncateTablesWithDeadlockRetry(db, `
      TRUNCATE TABLE "issues", "agent_config_revisions", "activity_log", "heartbeat_runs", "agent_runtime_state",
        "agent_task_sessions", "agents", "companies" RESTART IDENTITY CASCADE`, { attempts: 10, delayMs: () => 100 });
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  const service = () => providerRoutingService(db, { usage });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Paperclip", issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedAgent(companyId: string, name: string, adapterType: string, adapterConfig: Record<string, unknown>, runtimeConfig: Record<string, unknown> = {}) {
    const id = randomUUID();
    await db.insert(agents).values({
      id, companyId, name, role: "engineer", status: "idle", adapterType, adapterConfig, runtimeConfig, permissions: {},
    });
    return id;
  }

  const agentRow = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0]!;

  async function seedTeam() {
    const companyId = await seedCompany();
    const claude = await seedAgent(companyId, "Claude dev", "claude_local", {
      model: "claude-sonnet-5-5", effort: "high", cwd: "/work/claude", instructionsFilePath: "/work/claude/AGENTS.md",
      env: { DEBUG: { type: "plain", value: "1" } },
    }, { aiConnection: { mode: "responsible_user", provider: "anthropic", method: "subscription" }, heartbeat: { intervalSec: 0 } });
    const codex = await seedAgent(companyId, "Codex dev", "codex_local", {
      model: "gpt-6.1-sol", modelReasoningEffort: "medium", search: true, cwd: "/work/codex",
    }, { aiConnection: { mode: "responsible_user", provider: "openai", method: "subscription" } });
    await modelPolicyService(db).initializeExisting();
    return { companyId, claude, codex };
  }

  function policyFor(team: { claude: string; codex: string }, overrides: Partial<RoutingPolicyInput> = {}): RoutingPolicyInput {
    const tiers = emptyTiers();
    tiers[1] = { ...tiers[1]!, models: { claude_local: "claude-sonnet-5-5", codex_local: "gpt-6.1-sol" } };
    return {
      enabled: true, mode: "hybrid", thresholdPercent: 100, tiers, modelTiers: [],
      providers: [
        { adapterType: "claude_local", templateAgentId: team.claude },
        { adapterType: "codex_local", templateAgentId: team.codex },
      ],
      ...overrides,
    };
  }

  function app(actor: Actor, deps: Parameters<typeof ppclipProviderRoutingRoutes>[1] = {}) {
    const server = express();
    server.use(express.json());
    server.use((req, _res, next) => { req.actor = actor; next(); });
    server.use("/api", ppclipProviderRoutingRoutes(db, { service: service(), ...deps }));
    server.use(errorHandler);
    return server;
  }

  const localBoard: Actor = { type: "board", userId: "board-user", source: "local_implicit" } as Actor;

  describe("routes", () => {
    it("keeps approvals company-scoped, auditable, and revision checked", async () => {
      const team = await seedTeam();
      const other = await seedCompany();
      const path = `/api/companies/${team.companyId}/ppclip/model-policy`;
      const server = app(localBoard);
      const current = await modelPolicyService(db).get(team.companyId);
      expect(current.allowedModels).toHaveLength(2);
      const saved = await http(server).put(path).send({ expectedRevision: current.revision, policy: { allowedModels: [] } });
      expect(saved.status).toBe(200);
      expect(saved.body.allowedModels).toEqual([]);
      // A transaction that waited for the advisory lock can have an older
      // createdAt timestamp even though its policy revision is newer.
      await db.update(activityLog).set({ createdAt: new Date("2000-01-01T00:00:00Z") })
        .where(and(eq(activityLog.companyId, team.companyId), eq(activityLog.action, "ppclip.model_policy.updated"), eq(activityLog.actorType, "user")));
      expect((await modelPolicyService(db).get(team.companyId)).allowedModels).toEqual([]);
      expect((await modelPolicyService(db).get(other)).allowedModels).toEqual([]);
      expect((await http(server).put(path).send({ expectedRevision: current.revision, policy: { allowedModels: current.allowedModels } })).status).toBe(409);
      await modelPolicyService(db).initializeExisting();
      expect((await modelPolicyService(db).get(team.companyId)).allowedModels).toEqual([]);
      const userRows = await db.select().from(activityLog).where(and(eq(activityLog.companyId, team.companyId), eq(activityLog.action, "ppclip.model_policy.updated"), eq(activityLog.actorType, "user")));
      expect(userRows).toHaveLength(1);
    });

    it("does not auto-approve later agent edits or task override models", async () => {
      const team = await seedTeam();
      await db.update(agents).set({ adapterConfig: { model: "gpt-6-astra" } }).where(eq(agents.id, team.codex));
      await modelPolicyService(db).initializeExisting();
      await expect(modelPolicyService(db).assertAllowed(team.companyId, "codex_local", { model: "gpt-6-astra" })).rejects.toThrow(/not approved/);
      await expect(modelPolicyService(db).assertAllowed(team.companyId, "codex_local", {})).rejects.toThrow(/explicit model/);
    });

    it("requires write authority to change model approvals", async () => {
      const team = await seedTeam();
      const server = app(localBoard, { assertWrite: async () => { throw forbidden("read only"); } });
      const result = await http(server).put(`/api/companies/${team.companyId}/ppclip/model-policy`).send({ expectedRevision: 1, policy: { allowedModels: [] } });
      expect(result.status).toBe(403);
      expect((await modelPolicyService(db).get(team.companyId)).allowedModels).toHaveLength(2);
    });
    it("are board-only and company-scoped", async () => {
      const { companyId } = await seedTeam();
      const agentActor = { type: "agent", companyId, agentId: randomUUID(), source: "agent_key" } as Actor;
      expect((await http(app(agentActor)).get(`/api/companies/${companyId}/ppclip/provider-routing`)).status).toBe(403);
      const outsider = { type: "board", userId: "u2", source: "session", companyIds: [randomUUID()] } as Actor;
      expect((await http(app(outsider)).get(`/api/companies/${companyId}/ppclip/provider-routing`)).status).toBe(403);
      const res = await http(app(localBoard)).get(`/api/companies/${companyId}/ppclip/provider-routing`);
      expect(res.status).toBe(200);
      expect(res.body.policy).toMatchObject({ enabled: false, mode: "hybrid", revision: 0, providers: [] });
      expect(res.body.candidates.map((c: { adapterType: string }) => c.adapterType)).toEqual(["claude_local", "codex_local"]);
    });

    it("saves with a strict schema, revision checks and an activity entry", async () => {
      const team = await seedTeam();
      const url = `/api/companies/${team.companyId}/ppclip/provider-routing`;
      const server = app(localBoard);
      expect((await http(server).put(url).send({ expectedRevision: 0, policy: { ...policyFor(team), extra: 1 } })).status).toBe(400);
      const saved = await http(server).put(url).send({ expectedRevision: 0, policy: policyFor(team) });
      expect(saved.status).toBe(200);
      expect(saved.body.policy).toMatchObject({ enabled: true, revision: 1, updatedBy: "board-user" });
      expect(saved.body.policy.modelTiers).toHaveLength(2);
      const stale = await http(server).put(url).send({ expectedRevision: 0, policy: policyFor(team, { mode: "codex_local" }) });
      expect(stale.status).toBe(409);
      const logged = await db.select().from(activityLog).where(and(eq(activityLog.companyId, team.companyId), eq(activityLog.actorType, "user")));
      expect(logged.map((row) => row.action)).toEqual(["ppclip.provider_routing.updated"]);
      expect(logged[0]).toMatchObject({ actorType: "user", actorId: "board-user", entityType: "company", entityId: team.companyId });
      expect((await service().readPolicy(team.companyId))).toMatchObject({ revision: 1, mode: "hybrid", enabled: true });
    });

    it("rejects a template agent on the wrong harness and writes without permission", async () => {
      const team = await seedTeam();
      const url = `/api/companies/${team.companyId}/ppclip/provider-routing`;
      const wrong = policyFor({ claude: team.codex, codex: team.codex });
      expect((await http(app(localBoard)).put(url).send({ expectedRevision: 0, policy: wrong })).status).toBe(422);
      const denied = app(localBoard, { assertWrite: async () => { throw forbidden("nope"); } });
      expect((await http(denied).put(url).send({ expectedRevision: 0, policy: policyFor(team) })).status).toBe(403);
      expect((await http(denied).post(`${url}/reconcile`)).status).toBe(403);
      expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, team.companyId), eq(activityLog.actorType, "user")))).toEqual([]);
    });
  });

  describe("controller", () => {
    it("does nothing while routing is off", async () => {
      const team = await seedTeam();
      used.anthropic = 100;
      used.openai = 10;
      const health = await service().reconcile(team.companyId);
      expect(health.agents).toEqual([]);
      expect(probes).toEqual([]);
      expect((await agentRow(team.claude)).adapterType).toBe("claude_local");
    });

    it("moves an idle agent to a provider with room and back once its own has room", async () => {
      const team = await seedTeam();
      await service().savePolicy(team.companyId, 0, policyFor(team), board);
      used.anthropic = 100;
      used.openai = 20;
      const health = await service().reconcile(team.companyId);
      expect(probes.every((probe) => probe.startsWith("board-user:"))).toBe(true);
      expect(health.quotas).toEqual([
        { adapterType: "claude_local", state: "exhausted", accounts: 1 },
        { adapterType: "codex_local", state: "available", accounts: 1 },
      ]);
      const switched = await agentRow(team.claude);
      expect(switched.adapterType).toBe("codex_local");
      expect(switched.adapterConfig).toEqual({
        model: "gpt-6.1-sol", modelReasoningEffort: "high", search: true,
        cwd: "/work/claude", instructionsFilePath: "/work/claude/AGENTS.md", env: { DEBUG: { type: "plain", value: "1" } },
      });
      expect(switched.runtimeConfig).toEqual({ aiConnection: { mode: "responsible_user", provider: "openai", method: "subscription" }, heartbeat: { intervalSec: 0 } });
      expect(readRoutingRecord(switched.metadata)?.primary).toMatchObject({ adapterType: "claude_local", adapterConfig: { model: "claude-sonnet-5-5" } });
      expect(JSON.stringify(readRoutingRecord(switched.metadata))).not.toContain("DEBUG");
      expect(health.agents.find((a) => a.agentId === team.claude)).toMatchObject({ state: "switched" });
      expect((await agentRow(team.codex)).adapterType).toBe("codex_local");

      const revisions = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, team.claude));
      expect(revisions.map((r) => r.source)).toEqual(["ppclip_provider_routing"]);
      const switchedLog = await db.select().from(activityLog)
        .where(and(eq(activityLog.companyId, team.companyId), eq(activityLog.action, "ppclip.provider_routing.agent_switched")));
      expect(switchedLog[0]).toMatchObject({ actorType: "system", entityId: team.claude, details: expect.objectContaining({ from: "claude_local", to: "codex_local", restored: false }) });

      // An ordinary update cannot forge or drop the record.
      await agentService(db).update(team.claude, { metadata: { note: "x", ppclipProviderRouting: null } });
      expect(readRoutingRecord((await agentRow(team.claude)).metadata)).not.toBeNull();

      used.anthropic = 30;
      await service().reconcile(team.companyId);
      const restored = await agentRow(team.claude);
      expect(restored.adapterType).toBe("claude_local");
      expect(restored.adapterConfig).toEqual({
        model: "claude-sonnet-5-5", effort: "high", cwd: "/work/claude", instructionsFilePath: "/work/claude/AGENTS.md",
        env: { DEBUG: { type: "plain", value: "1" } },
      });
      expect(restored.runtimeConfig).toMatchObject({ aiConnection: { provider: "anthropic" } });
      expect(readRoutingRecord(restored.metadata)).toBeNull();
      expect(restored.metadata).toEqual({ note: "x" });
    });

    it("forces '<provider> only' and returns on Hybrid even without usage", async () => {
      const team = await seedTeam();
      await service().savePolicy(team.companyId, 0, policyFor(team, { mode: "codex_local" }), board);
      await service().reconcile(team.companyId);
      expect((await agentRow(team.claude)).adapterType).toBe("codex_local");
      await service().savePolicy(team.companyId, 1, policyFor(team), board);
      await service().reconcile(team.companyId);
      expect((await agentRow(team.claude)).adapterType).toBe("claude_local");
    });

    it("waits for live work, and blocks on task model overrides and outside edits", async () => {
      const team = await seedTeam();
      await service().savePolicy(team.companyId, 0, policyFor(team, { mode: "codex_local" }), board);
      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({ id: runId, companyId: team.companyId, agentId: team.claude, invocationSource: "on_demand", status: "running" });
      let health = await service().reconcile(team.companyId);
      expect(health.agents.find((a) => a.agentId === team.claude)).toMatchObject({ state: "waiting" });
      await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));

      const [task] = await db.insert(issues).values({
        companyId: team.companyId, title: "Override", status: "todo", assigneeAgentId: team.claude,
        assigneeAdapterOverrides: { adapterConfig: { model: "claude-opus-5-5" } },
      }).returning();
      health = await service().reconcile(team.companyId);
      expect(health.agents.find((a) => a.agentId === team.claude)).toMatchObject({ state: "blocked", message: expect.stringMatching(/own model/) });
      await db.update(issues).set({ status: "done" }).where(eq(issues.id, task!.id));

      await service().reconcile(team.companyId);
      expect((await agentRow(team.claude)).adapterType).toBe("codex_local");
      await agentService(db).update(team.claude, { adapterConfig: { ...(await agentRow(team.claude)).adapterConfig, model: "gpt-5" } });
      await service().savePolicy(team.companyId, 1, policyFor(team), board);
      health = await service().reconcile(team.companyId);
      expect(health.agents.find((a) => a.agentId === team.claude)).toMatchObject({ state: "blocked", message: expect.stringMatching(/outside routing/) });

      const res = await http(app(localBoard)).post(`/api/companies/${team.companyId}/ppclip/provider-routing/agents/${team.claude}/release`);
      expect(res.body).toEqual({ agentId: team.claude, released: true });
      expect(readRoutingRecord((await agentRow(team.claude)).metadata)).toBeNull();
      const released = await db.select().from(activityLog).where(eq(activityLog.action, "ppclip.provider_routing.agent_released"));
      expect(released).toHaveLength(1);
    });
  });
});
