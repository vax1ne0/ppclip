import { api } from "@/api/client";

/** Mirrors server/src/ppclip/computer-use/state.ts and service.ts. */
export type ComputerState =
  | "off"
  | "starting"
  | "agent"
  | "waiting_for_human"
  | "human"
  | "human_private"
  | "paused"
  | "stopped"
  | "revoked";

export type ControlLease = { holderUserId: string; private: boolean; grantedAt: string; expiresAt: string };

export type AgentComputer = {
  agentId: string;
  name: string;
  enabled: boolean;
  state: ComputerState;
  epoch: number;
  lease: ControlLease | null;
  request: { reason: string; at: string; runId?: string | null } | null;
  shell: boolean;
  allowedHosts: string[];
  lastActivityAt: string | null;
};

export type SupervisorHealth =
  | { ok: true; provider: { kind: string; isolation: string; caveats: string[]; liveView: boolean } }
  | { ok: false; error: string };

export type ComputerUseOverview = { enabled: boolean; supervisor: SupervisorHealth; agents: AgentComputer[] };

export type ComputerAction =
  | "start"
  | "stop"
  | "take-control"
  | "take-control-private"
  | "release"
  | "pause"
  | "resume"
  | "revoke"
  | "restore";

const base = (companyId: string) => `/companies/${companyId}/ppclip/computer-use`;

export const computerUseApi = {
  overview: (companyId: string) => api.get<ComputerUseOverview>(base(companyId)),
  setEnabled: (companyId: string, enabled: boolean) =>
    api.put<{ enabled: boolean; changed: boolean; stoppedAgentIds: string[] }>(base(companyId), { enabled }),
  updateAgent: (companyId: string, agentId: string, patch: { enabled?: boolean; shell?: boolean; allowedHosts?: string[] }) =>
    api.patch<unknown>(`${base(companyId)}/agents/${agentId}`, patch),
  act: (companyId: string, agentId: string, action: ComputerAction) =>
    api.post<unknown>(`${base(companyId)}/agents/${agentId}/${action}`, {}),
  viewer: (companyId: string, agentId: string, mode: "view" | "control") =>
    api.post<{ src: string; mode: "view" | "control" }>(`${base(companyId)}/agents/${agentId}/viewer`, { mode }),
  deleteComputer: (companyId: string, agentId: string, purgeProfile: boolean) =>
    api.post<{ ok: boolean }>(`${base(companyId)}/agents/${agentId}/delete`, { purgeProfile }),
};
