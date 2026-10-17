import { api } from "@/api/client";

/** Mirrors server/src/ppclip/run-controls/service.ts. */
export type AgentRunAllowance = {
  agentId: string;
  /** The agent's normal daily cap (null = no cap); today's credit is not included. */
  cap: number | null;
  usedToday: number;
  /** Runs made while Unlimited was on that do not count today. */
  credit: number;
  /** Runs left today, credit included (null = no cap). */
  left: number | null;
  unlimited: boolean;
  draining: boolean;
  drainState: "draining" | "drained" | null;
  liveRuns: number;
  drainAfterArmed: boolean;
};

export type TeamRunControlState = {
  unlimited: "on" | "off" | "mixed";
  drain: "off" | "draining" | "drained" | "mixed";
  hasLiveWork: boolean;
  drainAfterAgentId: string | null;
};

export type RunControlsOverview = {
  enabled: boolean;
  day: string;
  resetsAt: string;
  team: TeamRunControlState | null;
  agents: AgentRunAllowance[];
};

type ResumeResult = { agentIds: string[]; wakes: { accepted: number; skipped: string[] } };

const base = (companyId: string) => `/companies/${companyId}/ppclip/run-controls`;

export const runControlsApi = {
  overview: (companyId: string) => api.get<RunControlsOverview>(base(companyId)),
  setEnabled: (companyId: string, enabled: boolean) =>
    api.put<{ enabled: boolean; changed: boolean; clearedAgentIds: string[] }>(base(companyId), { enabled }),
  setUnlimited: (companyId: string, enabled: boolean) =>
    api.post<{ agentIds: string[] }>(`${base(companyId)}/unlimited`, { enabled }),
  drain: (companyId: string) => api.post<{ agentIds: string[] }>(`${base(companyId)}/drain`, {}),
  resume: (companyId: string) => api.post<ResumeResult>(`${base(companyId)}/resume`, {}),
  setDrainAfter: (companyId: string, agentId: string, armed: boolean) =>
    api.post<{ agentId: string; armed: boolean; changed: boolean }>(`${base(companyId)}/drain-after`, { agentId, armed }),
};
