import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { truncateTablesWithDeadlockRetry } from "./helpers/truncate-with-deadlock-retry.js";
import { computerUseService, type ComputerUseService } from "../ppclip/computer-use/service.ts";
import { computerMcpRoutes, computerTools, type AgentRunContext } from "../ppclip/computer-use/mcp.ts";
import { createSupervisorServer } from "../ppclip/computer-use/supervisor/server.ts";
import { FakeComputerProvider } from "../ppclip/computer-use/supervisor/fake-provider.ts";
import { httpSupervisorClient } from "../ppclip/computer-use/supervisor-client.ts";
import { ppclipComputerUseMcpServer } from "../ppclip/computer-use/index.ts";
import { readComputerUse } from "../ppclip/computer-use/state.ts";
import { agentService } from "../services/agents.ts";
import { errorHandler } from "../middleware/index.js";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping ppclip computer-use tests: ${support.reason ?? "unsupported environment"}`);

const TOKEN = "s".repeat(48);
const operator = { kind: "operator" as const, userId: "board-user" };

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean; structuredContent?: Record<string, unknown> };
const textOf = (r: ToolResult) => r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

describeEmbeddedPostgres("ppclip computer use (fake sandbox)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const provider = new FakeComputerProvider();
  const supervisor = createSupervisorServer({ provider, token: TOKEN, port: 0 });
  let service!: ComputerUseService;
  let tools!: ReturnType<typeof computerTools>;
  let clock = new Date("2026-10-17T10:00:00Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("ppclip-computer-use-");
    db = createDb(tempDb.connectionString);
    const port = await supervisor.listen();
    service = computerUseService(db, {
      supervisor: httpSupervisorClient({ url: `http://127.0.0.1:${port}`, token: () => TOKEN }),
      now: () => clock,
      leaseMs: 10 * 60_000,
      idleMs: 15 * 60_000,
    });
    tools = computerTools(service);
  }, 30_000);

  afterEach(async () => {
    provider.boxes.clear();
    provider.profiles.clear();
    clock = new Date("2026-10-17T10:00:00Z");
    await truncateTablesWithDeadlockRetry(db, `TRUNCATE TABLE "activity_log", "heartbeat_runs", "agents", "companies" RESTART IDENTITY CASCADE`, { attempts: 10, delayMs: () => 100 });
  });

  afterAll(async () => {
    await supervisor.close();
    await tempDb?.cleanup();
  });

  async function seed() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId, name: "Paperclip", issuePrefix: `C${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      defaultResponsibleUserId: "responsible-user", requireBoardApprovalForNewAgents: false,
    });
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId, companyId, name: "Robin", role: "engineer", status: "idle", adapterType: "claude_local",
      adapterConfig: {}, runtimeConfig: {}, permissions: {}, metadata: { keep: "me" },
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, invocationSource: "on_demand", status: "running", startedAt: clock });
    const ctx: AgentRunContext = { companyId, agentId, runId };
    return { companyId, agentId, runId, ctx };
  }

  async function enable(companyId: string, agentId: string, patch: { shell?: boolean } = {}) {
    await service.setEnabled(companyId, true, operator);
    await service.updateAgent(companyId, agentId, { enabled: true, ...patch }, operator);
  }

  const call = (ctx: AgentRunContext, name: string, args: Record<string, unknown> = {}) => tools.run(ctx, name, args) as Promise<ToolResult>;
  const state = async (companyId: string, agentId: string) => (await service.readMeta(companyId, agentId));
  const actions = async (companyId: string) => (await db.select({ action: activityLog.action, details: activityLog.details, actorType: activityLog.actorType })
    .from(activityLog).where(eq(activityLog.companyId, companyId)).orderBy(activityLog.createdAt, activityLog.id));

  it("is off by default: no tools, no MCP server, refused operator actions", async () => {
    const { companyId, agentId, ctx } = await seed();
    expect((await service.overview(companyId)).enabled).toBe(false);
    expect(await tools.list(ctx)).toEqual([]);
    const agent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    expect(await ppclipComputerUseMcpServer(db, agent, "jwt", "http://127.0.0.1:3100")).toBeNull();
    await expect(service.operate(companyId, agentId, "start", operator)).rejects.toThrow(/Company Settings/);

    await service.setEnabled(companyId, true, operator);
    // The company switch alone is not enough: each agent opts in.
    expect(await tools.list(ctx)).toEqual([]);
    await service.updateAgent(companyId, agentId, { enabled: true }, operator);
    const tools1 = (await tools.list(ctx)).map((t) => t.name);
    expect(tools1).toContain("computer_screenshot");
    expect(tools1).not.toContain("computer_shell");
    const enabledAgent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    expect(await ppclipComputerUseMcpServer(db, enabledAgent, "jwt", "http://127.0.0.1:3100/")).toEqual({
      name: "Computer", url: "http://127.0.0.1:3100/api/ppclip/computer-use/mcp", token: "jwt", connectionId: "ppclip-computer-use",
    });
    expect(await ppclipComputerUseMcpServer(db, enabledAgent, null, "http://127.0.0.1:3100")).toBeNull();
  });

  it("starts on first use, acts, and keeps page content fenced as untrusted", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    const shot = await call(ctx, "computer_screenshot");
    expect(shot.isError).toBeUndefined();
    expect(shot.content.some((c) => c.type === "image")).toBe(true);
    const meta = await state(companyId, agentId);
    expect(meta.state).toBe("agent");
    // Same frame again: no new image.
    expect((await call(ctx, "computer_screenshot")).content.some((c) => c.type === "image")).toBe(false);

    expect(textOf(await call(ctx, "browser_navigate", { url: "http://169.254.169.254/latest/meta-data" }))).toMatch(/blocked_url/);
    expect((await call(ctx, "browser_navigate", { url: "https://example.com/" })).isError).toBeUndefined();
    const page = textOf(await call(ctx, "browser_page"));
    expect(page).toMatch(/<untrusted_page_content>[\s\S]*IGNORE ALL PREVIOUS INSTRUCTIONS[\s\S]*<\/untrusted_page_content>/);
    expect(page).toMatch(/\[2\] textbox\(password\): Password — password field/);

    expect(textOf(await call(ctx, "browser_type_element", { ref: 2, text: "hunter2", epoch: meta.epoch }))).toMatch(/sensitive_field/);
    expect(textOf(await call(ctx, "browser_click_element", { ref: 3, epoch: meta.epoch }))).toMatch(/needs_confirm/);
    expect((await call(ctx, "browser_click_element", { ref: 3, epoch: meta.epoch, confirm: true })).isError).toBeUndefined();
    expect((await call(ctx, "computer_act", { epoch: meta.epoch, actions: [{ type: "click", x: 10, y: 10 }, { type: "type", text: "hello" }] })).isError).toBeUndefined();
    expect(provider.boxes.get(agentId)!.typed).toEqual(["hello"]);

    const log = await actions(companyId);
    const toolRows = log.filter((r) => r.action === "ppclip.computer_use.tool");
    expect(toolRows.length).toBeGreaterThanOrEqual(5);
    // Typed text is never stored, only its length.
    expect(JSON.stringify(toolRows)).not.toContain("hello");
    expect(JSON.stringify(toolRows)).not.toContain("hunter2");
    expect(toolRows.find((r) => (r.details as { tool?: string }).tool === "computer_act")!.details).toMatchObject({ actions: [{ type: "click", x: 10, y: 10 }, { type: "type", chars: 5 }], outcome: "ok" });
    expect(log.map((r) => r.action)).toEqual(expect.arrayContaining(["ppclip.computer_use.start", "ppclip.computer_use.ready"]));
  });

  it("freezes the agent while a person has control, blinds it in private mode, and makes it look again after release", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    await call(ctx, "computer_screenshot");
    expect(textOf(await call(ctx, "computer_request_takeover", { reason: "Please sign in to GitHub" }))).toMatch(/person has been asked/);
    expect((await state(companyId, agentId)).state).toBe("waiting_for_human");
    expect(textOf(await call(ctx, "computer_act", { epoch: 99, actions: [{ type: "key", key: "Return" }] }))).toMatch(/waiting_for_human/);

    await service.operate(companyId, agentId, "take_control", operator);
    const during = await state(companyId, agentId);
    expect(during).toMatchObject({ state: "human", lease: { holderUserId: "board-user", private: false } });
    expect(provider.boxes.get(agentId)!.interactive).toBe(true);
    expect(textOf(await call(ctx, "computer_act", { epoch: during.epoch, actions: [{ type: "key", key: "Return" }] }))).toMatch(/human_has_control/);
    expect(textOf(await call(ctx, "browser_navigate", { url: "https://example.com" }))).toMatch(/human_has_control/);
    // Observation still works in normal takeover...
    expect((await call(ctx, "computer_screenshot")).isError).toBeUndefined();
    // ...but not in private mode.
    await service.operate(companyId, agentId, "take_control_private", operator);
    expect(textOf(await call(ctx, "computer_screenshot"))).toMatch(/private_takeover/);
    expect(textOf(await call(ctx, "browser_page"))).toMatch(/private_takeover/);

    const before = await state(companyId, agentId);
    await service.operate(companyId, agentId, "release", operator);
    const after = await state(companyId, agentId);
    expect(after).toMatchObject({ state: "agent", lease: null, request: null });
    expect(provider.boxes.get(agentId)!.interactive).toBe(false);
    // An action citing the old epoch is refused until the agent looks again.
    expect(textOf(await call(ctx, "computer_act", { epoch: before.epoch, actions: [{ type: "key", key: "Return" }] }))).toMatch(/stale_observation/);
    expect((await call(ctx, "computer_act", { epoch: after.epoch, actions: [{ type: "key", key: "Return" }] })).isError).toBeUndefined();

    const log = (await actions(companyId)).map((r) => r.action);
    expect(log).toEqual(expect.arrayContaining([
      "ppclip.computer_use.request_takeover", "ppclip.computer_use.take_control", "ppclip.computer_use.take_control_private", "ppclip.computer_use.release",
    ]));
    // Refusals are audited too.
    const refused = (await actions(companyId)).filter((r) => r.action === "ppclip.computer_use.tool" && (r.details as { outcome?: string }).outcome === "refused");
    expect(refused.map((r) => (r.details as { code: string }).code)).toEqual(expect.arrayContaining(["human_has_control", "stale_observation", "private_takeover"]));
  });

  it("pause freezes the sandbox; revoke removes the tools until restored; the switch ends everything", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    await call(ctx, "computer_screenshot");
    await service.operate(companyId, agentId, "pause", operator);
    expect(provider.boxes.get(agentId)!.paused).toBe(true);
    expect(textOf(await call(ctx, "computer_screenshot"))).toMatch(/paused/);
    await service.operate(companyId, agentId, "resume", operator);
    expect(provider.boxes.get(agentId)!.paused).toBe(false);

    await service.operate(companyId, agentId, "revoke", operator);
    expect(await tools.list(ctx)).toEqual([]);
    expect(provider.boxes.get(agentId)!.running).toBe(false);
    const agent = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    expect(await ppclipComputerUseMcpServer(db, agent, "jwt", "http://x")).toBeNull();
    await expect(service.operate(companyId, agentId, "start", operator)).rejects.toThrow();
    await service.operate(companyId, agentId, "restore", operator);
    expect((await state(companyId, agentId)).state).toBe("stopped");

    await call(ctx, "computer_screenshot");
    expect(provider.boxes.get(agentId)!.running).toBe(true);
    const result = await service.setEnabled(companyId, false, operator);
    expect(result.stoppedAgentIds).toEqual([agentId]);
    expect(provider.boxes.get(agentId)!.running).toBe(false);
    expect(await tools.list(ctx)).toEqual([]);
  });

  it("issues live-view tickets that die when control changes", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    await call(ctx, "computer_screenshot");
    const view = await service.issueTicket(companyId, agentId, "board-user", "view");
    expect(await service.resolveTicket(view)).toMatchObject({ mode: "view", agentId });
    await expect(service.issueTicket(companyId, agentId, "board-user", "control")).rejects.toThrow(/Take control/);
    await service.operate(companyId, agentId, "take_control", operator);
    await expect(service.issueTicket(companyId, agentId, "someone-else", "control")).rejects.toThrow(/Take control/);
    const control = await service.issueTicket(companyId, agentId, "board-user", "control");
    expect(await service.resolveTicket(control)).toMatchObject({ mode: "control" });
    // Switching to private grants a new lease: the old control ticket stops working.
    await service.operate(companyId, agentId, "take_control_private", operator);
    expect(await service.resolveTicket(control)).toBeNull();
    const control2 = await service.issueTicket(companyId, agentId, "board-user", "control");
    await service.operate(companyId, agentId, "release", operator);
    expect(await service.resolveTicket(control2)).toBeNull();
    // View tickets survive control changes but not a revoke.
    expect(await service.resolveTicket(view)).not.toBeNull();
    await service.operate(companyId, agentId, "revoke", operator);
    expect(await service.resolveTicket(view)).toBeNull();
    expect(await service.resolveTicket("not-a-ticket")).toBeNull();
  });

  it("expires a person's control into paused, and stops idle computers", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    await call(ctx, "computer_screenshot");
    await service.operate(companyId, agentId, "take_control", operator);
    clock = new Date(clock.getTime() + 11 * 60_000);
    await service.sweep();
    expect((await state(companyId, agentId)).state).toBe("paused");
    expect(provider.boxes.get(agentId)!.paused).toBe(true);
    expect(provider.boxes.get(agentId)!.interactive).toBe(false);

    await service.operate(companyId, agentId, "resume", operator);
    clock = new Date(clock.getTime() + 16 * 60_000);
    await service.sweep();
    expect((await state(companyId, agentId)).state).toBe("stopped");
    expect((await actions(companyId)).some((r) => r.action === "ppclip.computer_use.stop" && (r.details as { reason?: string }).reason === "idle")).toBe(true);
  });

  it("serialises tool calls with control changes: take control waits for the in-flight action", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId);
    await call(ctx, "computer_screenshot");
    const epoch = (await state(companyId, agentId)).epoch;
    const order: string[] = [];
    const slow = service.withAgentLock(agentId, async () => {
      await new Promise((r) => setTimeout(r, 150));
      order.push("agent-action");
    });
    const take = service.operate(companyId, agentId, "take_control", operator).then(() => order.push("take-control"));
    const late = call(ctx, "computer_act", { epoch, actions: [{ type: "key", key: "a" }] }).then((r) => { order.push("late-agent-call"); return r; });
    await Promise.all([slow, take]);
    expect(textOf(await late)).toMatch(/human_has_control/);
    expect(order).toEqual(["agent-action", "take-control", "late-agent-call"]);
  });

  it("offers shell only when enabled, and agent PATCHes or hires cannot touch the record", async () => {
    const { companyId, agentId, ctx } = await seed();
    await enable(companyId, agentId, { shell: true });
    expect((await tools.list(ctx)).map((t) => t.name)).toContain("computer_shell");
    expect(textOf(await call(ctx, "computer_shell", { command: "id" }))).toMatch(/fake: id/);

    const svc = agentService(db);
    await svc.update(agentId, { metadata: { keep: "changed", computerUse: { enabled: false, state: "agent" } } } as never);
    const row = (await db.select().from(agents).where(eq(agents.id, agentId)))[0]!;
    expect((row.metadata as Record<string, unknown>).keep).toBe("changed");
    expect(readComputerUse(row.metadata)).toMatchObject({ enabled: true, shell: true });
  });

  it("serves the MCP endpoint only to the live run's own agent token", async () => {
    const { companyId, agentId, runId } = await seed();
    await enable(companyId, agentId);
    const app = express();
    app.use(express.json());
    let actor: Record<string, unknown> = { type: "agent", source: "agent_jwt", agentId, companyId, runId };
    app.use((req, _res, next) => { (req as unknown as { actor: unknown }).actor = actor; next(); });
    app.use("/api", computerMcpRoutes(db, service));
    app.use(errorHandler);

    // Requests shaped like a real MCP client's (Claude and Codex send these headers).
    const mcp = (body: Record<string, unknown>) => request(app).post("/api/ppclip/computer-use/mcp")
      .set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", ...body });
    const init = await mcp({ id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.body.result.instructions).toMatch(/untrusted data/);
    expect(init.body.result.serverInfo.name).toBe("ppclip-computer");
    const list = await mcp({ id: 2, method: "tools/list" });
    expect(list.body.result.tools.length).toBeGreaterThan(5);
    const status = await mcp({ id: 3, method: "tools/call", params: { name: "computer_status" } });
    expect(status.body.result.structuredContent).toMatchObject({ state: "off", youMayAct: false });
    const hidden = await mcp({ id: 4, method: "tools/call", params: { name: "computer_shell", arguments: { command: "id" } } });
    expect(hidden.body.result).toMatchObject({ isError: true });

    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(and(eq(heartbeatRuns.id, runId)));
    expect((await mcp({ id: 5, method: "tools/list" })).status).toBe(403);
    actor = { type: "board", source: "session", userId: "u" };
    expect((await mcp({ id: 6, method: "tools/list" })).status).toBe(403);
  });
});
