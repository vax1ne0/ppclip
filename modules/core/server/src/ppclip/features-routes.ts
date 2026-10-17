import { Router } from "express";
import { z } from "zod";
import { companies, type Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { logActivity } from "../services/activity-log.js";
import { assertBoardOrgAccess, assertInstanceAdmin, getActorInfo } from "../routes/authz.js";
import { PPCLIP_FEATURE_KEYS, readPpclipFeatures, writePpclipFeatures } from "./features.js";

const patchSchema = z
  .object(Object.fromEntries(PPCLIP_FEATURE_KEYS.map((key) => [key, z.boolean().optional()])) as Record<(typeof PPCLIP_FEATURE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>)
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Change at least one module.");

/**
 * ppclip module switches, mirroring official's Experimental settings: any
 * board member may read them, only an instance admin may change them, and each
 * change is written to every company's activity log.
 */
export function ppclipFeatureRoutes(db: Db) {
  const router = Router();

  router.get("/ppclip/features", (req, res) => {
    assertBoardOrgAccess(req);
    res.json(readPpclipFeatures());
  });

  router.patch("/ppclip/features", validate(patchSchema), async (req, res) => {
    assertInstanceAdmin(req);
    const patch = req.body as Partial<Record<(typeof PPCLIP_FEATURE_KEYS)[number], boolean>>;
    const updated = writePpclipFeatures(patch);
    const actor = getActorInfo(req);
    const rows = await db.select({ id: companies.id }).from(companies);
    await Promise.all(rows.map(({ id }) => logActivity(db, {
      companyId: id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      agentApiKeyId: actor.agentApiKeyId,
      action: "ppclip.features_updated",
      entityType: "instance_settings",
      entityId: "ppclip-features",
      details: { changed: patch },
    })));
    res.json(updated);
  });

  return router;
}
