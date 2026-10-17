import type { Db } from "@paperclipai/db";
import { computerUseService, isComputerUseEnabled, sharedComputerUseService } from "./service.js";
import { readComputerUse } from "./state.js";
import { httpSupervisorClient } from "./supervisor-client.js";
import { COMPUTER_MCP_PATH } from "./mcp.js";
import { ppclipFeature } from "../features.js";

/** The process-wide service, talking to the supervisor configured by environment variables. */
export function ppclipComputerUse(db: Db) {
  return sharedComputerUseService(db, () => computerUseService(db, { supervisor: httpSupervisorClient() }));
}

/**
 * Heartbeat hook: the computer MCP server for this run, or null. Only when the
 * company switch is on and the agent's own opt-in is on. Authenticated with the
 * run's agent JWT, so the endpoint can check the run is live.
 */
export async function ppclipComputerUseMcpServer(
  db: Db,
  agent: { id: string; companyId: string; metadata: unknown },
  authToken: string | null | undefined,
  apiBaseUrl: string,
) {
  if (!authToken) return null;
  if (!ppclipFeature("computerUse")) return null;
  const meta = readComputerUse(agent.metadata);
  if (!meta.enabled || meta.state === "revoked") return null;
  if (!(await isComputerUseEnabled(db, agent.companyId))) return null;
  return { name: "Computer", url: `${apiBaseUrl.replace(/\/+$/, "")}/api${COMPUTER_MCP_PATH}`, token: authToken, connectionId: "ppclip-computer-use" };
}
