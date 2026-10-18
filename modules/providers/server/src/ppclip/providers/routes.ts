import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { unprocessable } from "../../errors.js";
import { validate } from "../../middleware/validate.js";
import { ppclipBoardAccess, type WriteAccessCheck } from "../route-access.js";
import { routingPolicyUpdateSchema } from "./policy.js";
import { providerRoutingService, type RoutingActor } from "./service.js";
import { ppclipFeatureGate } from "../features.js";
import { supportsAiConnectionUsage } from "@paperclipai/shared";
import { aiConnectionService } from "../../services/ai-connections.js";
import { getActorInfo } from "../../routes/authz.js";
import { cachedUsage, usageCacheKey } from "./usage-cache.js";
import { hostClaudeUsage } from "./host-claude-usage.js";
import { modelPolicyService, modelPolicyUpdateSchema } from "./model-policy.js";

type ProviderRoutingService = Pick<ReturnType<typeof providerRoutingService>, "status" | "savePolicy" | "release" | "reconcile">;

const agentParams = z.object({ companyId: z.string().uuid(), agentId: z.string().uuid() });

/**
 * ppclip provider routing (PROV-1 / PROV-2). Board only: reads need company
 * access; writes need the same permission as managing agents (`agents:create`)
 * because the controller rewrites agents' harness settings. Every write is
 * activity-logged by the service.
 */
export function ppclipProviderRoutingRoutes(
  db: Db,
  deps: { service?: ProviderRoutingService; assertWrite?: WriteAccessCheck } = {},
) {
  const router = Router();
  router.use("/companies/:companyId/ppclip/provider-routing", ppclipFeatureGate("providerRouting"));
  const service = deps.service ?? providerRoutingService(db);
  const guard = ppclipBoardAccess(db, deps.assertWrite);
  const readAccess = guard.read;
  async function writeAccess(req: Request, companyId: string): Promise<RoutingActor> {
    return { actorType: "user", actorId: await guard.write(req, companyId) };
  }

  const models = modelPolicyService(db);
  const modelPath = "/companies/:companyId/ppclip/model-policy";
  router.use(modelPath, ppclipFeatureGate("modelApprovals"));
  router.get(modelPath, async (req, res) => {
    const companyId = req.params.companyId as string;
    readAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await models.get(companyId));
  });
  router.put(modelPath, validate(modelPolicyUpdateSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await models.save(companyId, req.body.expectedRevision, req.body.policy, actor.actorId));
  });

  // Usage of the viewer's AI accounts through the shared server cache, so tabs and
  // page loads never multiply provider checks (they rate-limit hard).
  const usagePath = "/companies/:companyId/ppclip/provider-usage";
  router.use(usagePath, ppclipFeatureGate("providerUsage"));
  router.get(usagePath, async (req, res) => {
    const companyId = req.params.companyId as string;
    readAccess(req, companyId);
    const userId = getActorInfo(req).actorId;
    const connections = aiConnectionService(db);
    const listed = await connections.list(companyId, userId);
    const accounts = await Promise.all(listed.filter((account) => account.status === "connected").map(async (account) => {
      const supported = account.usageProbeSupported ?? supportsAiConnectionUsage(account.provider, account.method);
      if (!supported) return { account, supported, usage: null, failed: false };
      // Paperclip's Claude sign-in token can't read usage (Anthropic answers 403, or 429 once it
      // tires of asking), so a Claude subscription uses this computer's Claude Code usage first
      // and only asks the connection when that isn't available.
      if (account.provider === "anthropic" && account.method === "subscription") {
        const local = await cachedUsage("claude-code-on-this-computer", hostClaudeUsage);
        if (local?.status === "ok") return { account, supported, usage: local, failed: false, usageFrom: "claude_code_local" as const };
      }
      const usage = await cachedUsage(usageCacheKey(companyId, account), () => connections.probeUsage(companyId, userId, account.id, account.grantId));
      return { account, supported, usage, failed: usage === null };
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ accounts, checkedAt: new Date().toISOString() });
  });

  const base = "/companies/:companyId/ppclip/provider-routing";

  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string;
    readAccess(req, companyId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.status(companyId));
  });

  router.put(base, validate(routingPolicyUpdateSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    await service.savePolicy(companyId, req.body.expectedRevision, req.body.policy, actor);
    res.json(await service.status(companyId));
  });

  /** Run one controller pass now instead of waiting for the next interval. */
  router.post(`${base}/reconcile`, async (req, res) => {
    const companyId = req.params.companyId as string;
    await writeAccess(req, companyId);
    res.json(await service.reconcile(companyId));
  });

  /** Keep an agent's current settings and forget the saved original. */
  router.post(`${base}/agents/:agentId/release`, async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    const params = agentParams.safeParse(req.params);
    if (!params.success) throw unprocessable("Invalid agent ID");
    res.json(await service.release(companyId, params.data.agentId, actor));
  });

  return router;
}
