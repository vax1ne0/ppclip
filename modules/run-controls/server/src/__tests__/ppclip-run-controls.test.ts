import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  companies,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { drainHeartbeatRunsToQuiescence } from "./helpers/drain-heartbeat-runs.js";
import { truncateTablesWithDeadlockRetry } from "./helpers/truncate-with-deadlock-retry.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { agentService } from "../services/agents.ts";
import { runningProcesses } from "../adapters/index.ts";
import { runControlsService } from "../ppclip/run-controls/service.ts";
import { readDrainAfter, readRunControl } from "../ppclip/run-controls/state.ts";
import { modelPolicyService } from "../ppclip/providers/model-policy.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0, signal: null, timedOut: false, errorMessage: null,
    summary: "Run-controls test run.", provider: "test", model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({ supportsLocalAgentJwt: false, execute: mockAdapterExecute })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
if (!embeddedPostgresSupport.supported) {
  console.warn(`Skipping ppclip run-controls tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`);
}

const board = { actorType: "user" as const, actorId: "board-user" };
type Heartbeat = Record<string, unknown>;

describeEmbeddedPostgres("ppclip run controls", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let service!: ReturnType<typeof runControlsService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("ppclip-run-controls-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db, { runtimeEnv: { ...process.env, PAPERCLIP_IN_WORKTREE: "false" } });
    service = runControlsService(db, {
      readCap: (agent) => heartbeat.parseHeartbeatPolicy(agent).maxDailyRuns,
      wakeForResume: async (agentId, issueId, actor) => {
        const run = await heartbeat.wakeup(agentId, {
          source: "on_demand", triggerDetail: "manual", reason: "ppclip_run_controls_resume",
          payload: { issueId }, requestedByActorType: "user", requestedByActorId: actor.actorId,
          contextSnapshot: { issueId, taskKey: issueId },
        });
        return { accepted: Boolean(run) };
      },
    });
  }, 30_000);

  afterEach(async () => {
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    await truncateTablesWithDeadlockRetry(db, `
      TRUNCATE TABLE "issue_relations", "issue_comments", "issues", "heartbeat_run_events", "cost_events",
        "activity_log", "heartbeat_runs", "agent_wakeup_requests", "agent_runtime_state", "agents", "companies"
      RESTART IDENTITY CASCADE`, { attempts: 10, delayMs: () => 100 });
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Paperclip", issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user", requireBoardApprovalForNewAgents: false,
    });
    // Execution fixtures must satisfy the current explicit-model policy too.
    await modelPolicyService(db).save(companyId, 0, { allowedModels: [{ adapterType: "codex_local", model: "test-model" }] }, "board-user");
    return companyId;
  }

  async function seedAgent(companyId: string, name: string, heartbeatConfig: Heartbeat = {}, metadata: Record<string, unknown> | null = null) {
    const id = randomUUID();
    await db.insert(agents).values({
      id, companyId, name, role: "engineer", status: "idle", adapterType: "codex_local", adapterConfig: { model: "test-model" },
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1, ...heartbeatConfig } },
      permissions: {}, metadata,
    });
    return id;
  }

  async function seedRuns(companyId: string, agentId: string, count: number, startedAt: Date, status = "succeeded") {
    for (let i = 0; i < count; i += 1) {
      await db.insert(heartbeatRuns).values({
        id: randomUUID(), companyId, agentId, invocationSource: "on_demand", status,
        startedAt: new Date(startedAt.getTime() + i), finishedAt: status === "succeeded" ? startedAt : null,
      });
    }
  }

  const agentRow = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0]!;
  const heartbeatOf = async (id: string) => ((await agentRow(id)).runtimeConfig as { heartbeat: Heartbeat }).heartbeat;
  const allowance = async (companyId: string, agentId: string) =>
    (await service.overview(companyId)).agents.find((row) => row.agentId === agentId)!;
  const wake = (agentId: string) => heartbeat.wakeup(agentId, { source: "on_demand", triggerDetail: "manual" });

  it("is off by default, refuses team actions while off, and logs the switch", async () => {
    const companyId = await seedCompany();
    await seedAgent(companyId, "Alice", { maxDailyRuns: 3 });
    expect(await service.overview(companyId)).toMatchObject({ enabled: false, agents: [], team: null });
    await expect(service.drain(companyId, board)).rejects.toThrow(/turned off/);

    expect(await service.setEnabled(companyId, true, board)).toMatchObject({ changed: true, clearedAgentIds: [] });
    expect(await service.setEnabled(companyId, true, board)).toMatchObject({ changed: false });
    expect((await service.overview(companyId)).enabled).toBe(true);
    const logged = await db.select({ action: activityLog.action, actorId: activityLog.actorId }).from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), like(activityLog.action, "ppclip.run_controls.%")));
    expect(logged).toEqual([{ action: "ppclip.run_controls.enabled", actorId: "board-user" }]);
  });

  it("switching off clears every daily cap alias and all run-control state", async () => {
    const companyId = await seedCompany();
    const capped = await seedAgent(companyId, "Capped", { maxDailyRuns: 3, dailyRunLimit: 4 });
    const alias = await seedAgent(companyId, "Alias", { maxRunsPerDay: 2, wakeOnDemand: true });
    const untouched = await seedAgent(companyId, "Free", { intervalSec: 30 });
    await service.setEnabled(companyId, true, board);
    await service.drain(companyId, board);
    expect(await heartbeatOf(alias)).toMatchObject({ maxDailyRuns: 0, wakeOnDemand: false });

    const result = await service.setEnabled(companyId, false, board);
    expect(result.clearedAgentIds.sort()).toEqual([capped, alias, untouched].sort());
    expect(await heartbeatOf(capped)).toEqual({ wakeOnDemand: true, maxConcurrentRuns: 1 });
    expect(await heartbeatOf(alias)).toEqual({ wakeOnDemand: true, maxConcurrentRuns: 1 });
    expect(await heartbeatOf(untouched)).toEqual({ wakeOnDemand: true, maxConcurrentRuns: 1, intervalSec: 30 });
    expect((await agentRow(alias)).metadata).toEqual({});
    expect(await service.isEnabled(companyId)).toBe(false);
    // Unlimited again: the official scheduler accepts a wake.
    expect(await wake(alias)).not.toBeNull();
  });

  it("counts today's started runs against the official cap (UTC day, queued excluded)", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId, "Alice", { dailyRunCap: 5 });
    const free = await seedAgent(companyId, "Free");
    await service.setEnabled(companyId, true, board);
    const now = new Date();
    await seedRuns(companyId, agentId, 2, new Date(now.getTime() - 1_000));
    await seedRuns(companyId, agentId, 1, new Date(now.getTime() - 1_000), "queued");
    await seedRuns(companyId, agentId, 3, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 60_000));
    expect(await allowance(companyId, agentId)).toMatchObject({ cap: 5, usedToday: 2, credit: 0, left: 3, liveRuns: 1 });
    expect(await allowance(companyId, free)).toMatchObject({ cap: null, left: null });
  });

  it("credits runs made while Unlimited was on, and the scheduler honours the credit", async () => {
    const companyId = await seedCompany();
    const agentId = await seedAgent(companyId, "Alice", { maxDailyRuns: 2 });
    await service.setEnabled(companyId, true, board);
    await seedRuns(companyId, agentId, 2, new Date(Date.now() - 60_000));
    expect((await allowance(companyId, agentId)).left).toBe(0);
    expect(await wake(agentId)).toBeNull();

    await service.setUnlimited(companyId, true, board);
    expect(await heartbeatOf(agentId)).not.toHaveProperty("maxDailyRuns");
    const since = readRunControl((await agentRow(agentId)).metadata).unlimitedSince!;
    await seedRuns(companyId, agentId, 2, new Date(Date.parse(since) + 10));
    expect(await allowance(companyId, agentId)).toMatchObject({ unlimited: true, left: null });

    await service.setUnlimited(companyId, false, board);
    expect(await heartbeatOf(agentId)).toMatchObject({ maxDailyRuns: 2 });
    expect(readRunControl((await agentRow(agentId)).metadata).credit).toMatchObject({ runs: 2 });
    // 4 runs today, cap 2 + credit 2: still none left.
    expect(await allowance(companyId, agentId)).toMatchObject({ cap: 2, usedToday: 4, credit: 2, left: 0 });

    // One more credited run makes room for exactly one scheduled wake.
    await db.update(agents).set({
      metadata: { runControl: { credit: { day: new Date().toISOString().slice(0, 10), runs: 3 } } },
    }).where(eq(agents.id, agentId));
    expect((await allowance(companyId, agentId)).left).toBe(1);
    expect(await wake(agentId)).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);

    // A credit from yesterday has expired.
    await db.update(agents).set({ metadata: { runControl: { credit: { day: "2000-01-01", runs: 10 } } } })
      .where(eq(agents.id, agentId));
    expect(await wake(agentId)).toBeNull();
  });

  it("Drain stops new runs; Resume restores settings and wakes one task per agent", async () => {
    const companyId = await seedCompany();
    const alice = await seedAgent(companyId, "Alice", { maxDailyRuns: 7, wakeOnDemand: true });
    const bob = await seedAgent(companyId, "Bob");
    await service.setEnabled(companyId, true, board);
    await service.drain(companyId, board);
    expect(await heartbeatOf(alice)).toMatchObject({ maxDailyRuns: 0, wakeOnDemand: false });
    expect(await heartbeatOf(bob)).toMatchObject({ maxDailyRuns: 0, wakeOnDemand: false });
    const overview = await service.overview(companyId);
    expect(overview.team).toMatchObject({ drain: "drained", hasLiveWork: false });
    expect(await wake(bob)).toBeNull();

    const todo = randomUUID(), inProgress = randomUUID(), blocker = randomUUID(), blocked = randomUUID();
    await db.insert(issues).values([
      { id: todo, companyId, title: "Todo", status: "todo", assigneeAgentId: alice },
      { id: inProgress, companyId, title: "In progress", status: "in_progress", assigneeAgentId: alice },
      { id: blocker, companyId, title: "Blocker", status: "todo", assigneeAgentId: null },
      { id: blocked, companyId, title: "Blocked", status: "todo", assigneeAgentId: bob },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: blocker, relatedIssueId: blocked, type: "blocks" });

    const resumed = await service.resume(companyId, board);
    expect(resumed.agentIds.sort()).toEqual([alice, bob].sort());
    expect(resumed.wakes.accepted).toBe(1);
    expect(await heartbeatOf(alice)).toEqual({ maxDailyRuns: 7, wakeOnDemand: true, maxConcurrentRuns: 1 });
    expect(await heartbeatOf(bob)).toEqual({ wakeOnDemand: true, maxConcurrentRuns: 1 });
    expect((await agentRow(bob)).metadata).toEqual({});
    const wakes = await db.select({ agentId: agentWakeupRequests.agentId, payload: agentWakeupRequests.payload })
      .from(agentWakeupRequests).where(eq(agentWakeupRequests.reason, "ppclip_run_controls_resume"));
    expect(wakes).toEqual([{ agentId: alice, payload: expect.objectContaining({ issueId: inProgress }) }]);
  });

  it("drain after: arming is protected, and the armed agent's claimed run drains the team", async () => {
    const companyId = await seedCompany();
    const alice = await seedAgent(companyId, "Alice", { maxDailyRuns: 9 });
    const bob = await seedAgent(companyId, "Bob");
    const carol = await seedAgent(companyId, "Carol");
    await service.setEnabled(companyId, true, board);
    await expect(service.setDrainAfter(companyId, alice, true, board)).rejects.toThrow(/not waiting only on another agent/);

    const waiting = randomUUID(), bobTask = randomUUID();
    await db.insert(issues).values([
      { id: waiting, companyId, title: "Waiting", status: "blocked", assigneeAgentId: alice },
      { id: bobTask, companyId, title: "Bob's task", status: "in_progress", assigneeAgentId: bob },
    ]);
    await db.insert(issueRelations).values({ companyId, issueId: bobTask, relatedIssueId: waiting, type: "blocks" });
    expect(await service.setDrainAfter(companyId, alice, true, board)).toMatchObject({ changed: true });
    expect((await service.overview(companyId)).team?.drainAfterAgentId).toBe(alice);

    // An ordinary agent update cannot forge or clear the plan.
    await agentService(db).update(alice, { metadata: { note: "edited", drainAfter: { state: "cancelled" } } });
    expect(readDrainAfter((await agentRow(alice)).metadata)?.state).toBe("armed");
    expect(((await agentRow(alice)).metadata as Record<string, unknown>).note).toBe("edited");

    // Bob's run starts first: nothing drains.
    expect(await wake(bob)).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect(readRunControl((await agentRow(carol)).metadata).draining).toBeUndefined();

    const run = await wake(alice);
    expect(run).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const [claimed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    expect(claimed?.startedAt).not.toBeNull();
    expect(readDrainAfter((await agentRow(alice)).metadata)).toMatchObject({ state: "triggered", runId: run!.id });
    for (const id of [alice, bob, carol]) {
      expect(await heartbeatOf(id)).toMatchObject({ maxDailyRuns: 0, wakeOnDemand: false });
      expect(readRunControl((await agentRow(id)).metadata)).toMatchObject({ draining: true, triggeredByRunId: run!.id });
    }
    expect(readRunControl((await agentRow(alice)).metadata).saved).toEqual({ maxDailyRuns: 9, wakeOnDemand: true });
    expect(await wake(carol)).toBeNull();
    const triggered = await db.select().from(activityLog).where(and(
      eq(activityLog.companyId, companyId), eq(activityLog.action, "ppclip.run_controls.drain_after_triggered"),
    ));
    expect(triggered).toHaveLength(1);

    // Resume restores everyone.
    await service.resume(companyId, board);
    expect(await heartbeatOf(alice)).toMatchObject({ maxDailyRuns: 9, wakeOnDemand: true });
    expect(await heartbeatOf(carol)).not.toHaveProperty("maxDailyRuns");
  });

  it("cancelling drain after leaves the team running", async () => {
    const companyId = await seedCompany();
    const alice = await seedAgent(companyId, "Alice");
    const bob = await seedAgent(companyId, "Bob");
    await service.setEnabled(companyId, true, board);
    await db.update(agents).set({ metadata: { drainAfter: { state: "armed" } } }).where(eq(agents.id, alice));
    await expect(service.setDrainAfter(companyId, bob, true, board)).rejects.toThrow();
    expect(await service.setDrainAfter(companyId, alice, false, board)).toMatchObject({ changed: true });
    expect(await wake(alice)).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect(await heartbeatOf(bob)).not.toHaveProperty("maxDailyRuns");
    expect(readDrainAfter((await agentRow(alice)).metadata)?.state).toBe("cancelled");
  });
});
