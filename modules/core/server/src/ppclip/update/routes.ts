import { Router } from "express";
import { z } from "zod";
import { count, eq } from "drizzle-orm";
import { companies, heartbeatRuns, type Db } from "@paperclipai/db";
import { conflict } from "../../errors.js";
import { validate } from "../../middleware/validate.js";
import { logActivity } from "../../services/activity-log.js";
import { assertBoardOrgAccess, assertInstanceAdmin, getActorInfo } from "../../routes/authz.js";
import { UpdateBlockedError, updateService, type UpdateDeps } from "./service.js";

const startSchema = z.object({ force: z.boolean().optional() }).strict();

/**
 * ppclip self-update. Any board member may see the status; only an instance
 * admin may check or start an update, and starting one is written to every
 * company's activity log.
 */
export function ppclipUpdateRoutes(db: Db, deps: UpdateDeps = {}) {
  const router = Router();
  const service = updateService({
    countRunningRuns: async () => Number((await db.select({ n: count() }).from(heartbeatRuns).where(eq(heartbeatRuns.status, "running")))[0]?.n ?? 0),
    ...deps,
  });

  router.get("/ppclip/update", async (req, res) => {
    assertBoardOrgAccess(req);
    res.json(await service.status());
  });

  router.post("/ppclip/update/check", async (req, res) => {
    assertInstanceAdmin(req);
    res.json(await service.check());
  });

  router.get("/ppclip/update/check-progress", (req, res) => {
    assertBoardOrgAccess(req);
    res.set("cache-control", "no-store").json(service.checkProgress());
  });

  router.post("/ppclip/update", validate(startSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const actor = getActorInfo(req);
    const before = await service.status();
    try {
      await service.start({ force: req.body.force === true });
    } catch (err) {
      if (err instanceof UpdateBlockedError) throw conflict(err.message);
      throw err;
    }
    const rows = await db.select({ id: companies.id }).from(companies);
    await Promise.all(rows.map(({ id }) => logActivity(db, {
      companyId: id, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId, action: "ppclip.updated", entityType: "instance_settings", entityId: "ppclip-update",
      details: { from: before.current?.commit ?? null, available: before.available.length, runningRuns: before.runningRuns },
    })));
    res.status(202).json({ started: true });
  });

  return router;
}
