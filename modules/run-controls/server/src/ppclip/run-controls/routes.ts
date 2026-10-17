import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { heartbeatService } from "../../services/heartbeat.js";
import { ppclipBoardAccess } from "../route-access.js";
import { runControlsService, type RunControlActor } from "./service.js";
import { ppclipFeatureGate } from "../features.js";

const switchSchema = z.object({ enabled: z.boolean() }).strict();
const unlimitedSchema = z.object({ enabled: z.boolean() }).strict();
const drainAfterSchema = z.object({ agentId: z.string().uuid(), armed: z.boolean() }).strict();

/**
 * ppclip run controls (RUN-1, RUN-2 and the master switch). Board only: reads
 * need company access, writes need the same permission as managing agents
 * (`agents:create`), and every write is activity-logged.
 */
export function ppclipRunControlRoutes(db: Db) {
  const router = Router();
  router.use("/companies/:companyId/ppclip/run-controls", ppclipFeatureGate("runControls"));
  const guard = ppclipBoardAccess(db);
  const heartbeat = heartbeatService(db);
  const service = runControlsService(db, {
    readCap: (agent) => heartbeat.parseHeartbeatPolicy(agent).maxDailyRuns,
    wakeForResume: async (agentId, issueId, actor) => {
      const run = await heartbeat.wakeup(agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        reason: "ppclip_run_controls_resume",
        payload: { issueId },
        requestedByActorType: actor.actorType === "system" ? "system" : actor.actorType,
        requestedByActorId: actor.actorId,
        contextSnapshot: { issueId, taskKey: issueId, triggeredBy: "board" },
      });
      return run ? { accepted: true } : { accepted: false, message: "A wake request was skipped." };
    },
  });

  const readAccess = guard.read;
  async function writeAccess(req: Request, companyId: string): Promise<RunControlActor> {
    return { actorType: "user", actorId: await guard.write(req, companyId) };
  }

  router.get("/companies/:companyId/ppclip/run-controls", async (req, res) => {
    const companyId = req.params.companyId as string;
    readAccess(req, companyId);
    res.json(await service.overview(companyId));
  });

  router.put("/companies/:companyId/ppclip/run-controls", validate(switchSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.setEnabled(companyId, req.body.enabled, actor));
  });

  router.post("/companies/:companyId/ppclip/run-controls/unlimited", validate(unlimitedSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.setUnlimited(companyId, req.body.enabled, actor));
  });

  router.post("/companies/:companyId/ppclip/run-controls/drain", async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.drain(companyId, actor));
  });

  router.post("/companies/:companyId/ppclip/run-controls/resume", async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.resume(companyId, actor));
  });

  router.post("/companies/:companyId/ppclip/run-controls/drain-after", validate(drainAfterSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.setDrainAfter(companyId, req.body.agentId, req.body.armed, actor));
  });

  return router;
}
