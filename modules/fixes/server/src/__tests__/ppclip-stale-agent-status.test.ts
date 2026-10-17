import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const published = vi.hoisted(() => [] as unknown[]);
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: (event: unknown) => published.push(event) }));

import { repairStaleRunningAgents } from "../ppclip/stale-agent-status.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("ppclip repairStaleRunningAgents", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const companyId = randomUUID();
  const now = new Date("2026-10-16T12:00:00Z");
  const stale = new Date(now.getTime() - 60_000);
  const fresh = new Date(now.getTime() - 5_000);

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("ppclip-stale-agent-status-");
    db = createDb(tempDb.connectionString);
    await db.insert(companies).values({
      id: companyId, name: "Paperclip", issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
  }, 120_000);

  afterAll(async () => { await tempDb?.cleanup(); });

  async function agent(name: string, updatedAt: Date, runStatuses: string[] = []) {
    const id = randomUUID();
    await db.insert(agents).values({
      id, companyId, name, role: "engineer", status: "running", adapterType: "codex_local",
      adapterConfig: {}, runtimeConfig: {}, permissions: {}, updatedAt,
    });
    for (const [index, status] of runStatuses.entries()) {
      await db.insert(heartbeatRuns).values({
        id: randomUUID(), companyId, agentId: id, invocationSource: "on_demand", status, nextEventSeq: 1,
        createdAt: new Date(stale.getTime() - 60_000 + index * 1_000),
      });
    }
    return id;
  }
  const statusOf = async (id: string) =>
    (await db.select({ status: agents.status }).from(agents).where(eq(agents.id, id)))[0]?.status;

  it("resets stale running agents and leaves live or recent ones alone", async () => {
    const noRuns = await agent("NoRuns", stale);
    const lastFailed = await agent("LastFailed", stale, ["succeeded", "failed"]);
    const stillRunning = await agent("StillRunning", stale, ["running"]);
    const queued = await agent("Queued", stale, ["queued"]);
    const recent = await agent("Recent", fresh);

    const repaired = await repairStaleRunningAgents(db, now);

    expect(repaired.map((row) => row.id).sort()).toEqual([noRuns, lastFailed].sort());
    expect(await statusOf(noRuns)).toBe("idle");
    expect(await statusOf(lastFailed)).toBe("error");
    expect(await statusOf(stillRunning)).toBe("running");
    expect(await statusOf(queued)).toBe("running");
    expect(await statusOf(recent)).toBe("running");
    expect(published).toHaveLength(2);
  });
});
