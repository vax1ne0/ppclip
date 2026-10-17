import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { accessService } from "../services/access.js";
import { authorizationDeniedDetails } from "../services/authorization.js";
import { assertBoard, assertCompanyAccess } from "../routes/authz.js";

export type WriteAccessCheck = (req: Request, companyId: string) => Promise<void>;

/**
 * Access rules shared by ppclip's board routes: reads need a board user with
 * access to the company; writes also need the permission to manage agents
 * (`agents:create`), the same check official uses for agent changes.
 */
export function ppclipBoardAccess(db: Db, assertWrite?: WriteAccessCheck) {
  const access = accessService(db);
  const assertManage: WriteAccessCheck = assertWrite ?? (async (req, companyId) => {
    const decision = await access.decide({ actor: req.actor, action: "agents:create", resource: { type: "company", companyId } });
    if (!decision.allowed) throw forbidden(decision.explanation, authorizationDeniedDetails(decision));
  });
  function read(req: Request, companyId: string) {
    assertBoard(req);
    assertCompanyAccess(req, companyId);
  }
  /** Checks write access and returns the acting board user id. */
  async function write(req: Request, companyId: string): Promise<string> {
    read(req, companyId);
    await assertManage(req, companyId);
    return req.actor.userId ?? "board";
  }
  return { read, write };
}
