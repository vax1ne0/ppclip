import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../../middleware/validate.js";
import { ppclipBoardAccess } from "../route-access.js";
import { computerMcpRoutes } from "./mcp.js";
import type { ComputerUseService, OperatorAction } from "./service.js";
import { ppclipComputerUse } from "./index.js";
import { ppclipFeatureGate } from "../features.js";

const switchSchema = z.object({ enabled: z.boolean() }).strict();
const agentSchema = z.object({
  enabled: z.boolean().optional(),
  shell: z.boolean().optional(),
  allowedHosts: z.array(z.string().max(253)).max(50).optional(),
}).strict();
const viewerSchema = z.object({ mode: z.enum(["view", "control"]) }).strict();
const deleteSchema = z.object({ purgeProfile: z.boolean() }).strict();

const ACTIONS: Record<string, OperatorAction> = {
  start: "start",
  stop: "stop",
  "take-control": "take_control",
  "take-control-private": "take_control_private",
  release: "release",
  pause: "pause",
  resume: "resume",
  revoke: "revoke",
  restore: "restore",
};

const VIEW_PREFIX = "/ppclip/computer-use/view";
const VIEW_FILE = /^[A-Za-z0-9_./-]{1,200}$/;

/** Builds the iframe address for a ticket: noVNC's lite client, pointed at the ticket's websocket path. */
function viewerSrc(ticket: string, mode: "view" | "control") {
  const base = `/api${VIEW_PREFIX}/${ticket}`;
  const params = new URLSearchParams({ autoconnect: "true", scale: "true", resize: "scale", view_only: mode === "view" ? "true" : "false", path: `${base.slice(1)}/websockify` });
  return `${base}/vnc_lite.html?${params.toString()}`;
}

/**
 * ppclip computer use (board side). Reads need company access; every write
 * needs the same permission as managing agents (`agents:create`) and is
 * activity-logged. The agent MCP endpoint and the view proxy are mounted here too.
 */
export function ppclipComputerUseRoutes(db: Db, service: ComputerUseService = ppclipComputerUse(db)) {
  const router = Router();
  router.use("/companies/:companyId/ppclip/computer-use", ppclipFeatureGate("computerUse"));
  router.use(VIEW_PREFIX, ppclipFeatureGate("computerUse"));
  const guard = ppclipBoardAccess(db);

  const sweeper = setInterval(() => { void service.sweep().catch(() => undefined); }, 30_000);
  sweeper.unref?.();

  const readAccess = guard.read;
  async function writeAccess(req: Request, companyId: string) {
    return { kind: "operator" as const, userId: await guard.write(req, companyId) };
  }

  const base = "/companies/:companyId/ppclip/computer-use";

  router.get(base, async (req, res) => {
    const companyId = req.params.companyId as string;
    readAccess(req, companyId);
    res.json(await service.overview(companyId));
  });

  router.put(base, validate(switchSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.setEnabled(companyId, req.body.enabled, actor));
  });

  router.patch(`${base}/agents/:agentId`, validate(agentSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.updateAgent(companyId, req.params.agentId as string, req.body, actor));
  });

  router.post(`${base}/agents/:agentId/viewer`, validate(viewerSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const mode = req.body.mode as "view" | "control";
    // Watching needs company access; driving needs write access and the caller's own lease.
    const userId = mode === "control" ? (await writeAccess(req, companyId)).userId : (readAccess(req, companyId), req.actor.userId ?? "board");
    const ticket = await service.issueTicket(companyId, req.params.agentId as string, userId, mode);
    res.json({ src: viewerSrc(ticket, mode), mode });
  });

  router.post(`${base}/agents/:agentId/delete`, validate(deleteSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const actor = await writeAccess(req, companyId);
    res.json(await service.deleteComputer(companyId, req.params.agentId as string, req.body.purgeProfile, actor));
  });

  router.post(`${base}/agents/:agentId/:action`, async (req, res) => {
    const companyId = req.params.companyId as string;
    const action = ACTIONS[req.params.action as string];
    if (!action) return res.status(404).json({ error: "Unknown action" });
    const actor = await writeAccess(req, companyId);
    res.json(await service.operate(companyId, req.params.agentId as string, action, actor));
  });

  // noVNC files for the live view. The ticket is the capability: it was issued to an
  // authorised operator, expires, and is re-checked against current state on every request.
  router.get(`${VIEW_PREFIX}/:ticket/*splat`, async (req, res) => {
    const ticket = await service.resolveTicket(req.params.ticket as string);
    if (!ticket) return res.status(403).json({ error: "This live view has expired. Reopen it." });
    const splat = (req.params as Record<string, unknown>).splat;
    const file = Array.isArray(splat) ? splat.join("/") : String(splat ?? "");
    if (!VIEW_FILE.test(file) || file.includes("..")) return res.status(400).json({ error: "bad path" });
    const upstream = await service.supervisor.streamFile(ticket.agentId, ticket.mode, file, "");
    res.status(upstream.status);
    res.setHeader("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    // The iframe is sandboxed without same-origin, so module scripts load in CORS mode.
    res.setHeader("access-control-allow-origin", "*");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  });

  router.use(computerMcpRoutes(db, service));
  return router;
}
