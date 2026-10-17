import { api } from "@/api/client";

/** Mirrors server/src/ppclip/providers/policy.ts and service.ts. */
type TierId = "tier-1" | "tier-2" | "tier-3" | "tier-4" | "tier-5";
export type ProviderTier = { id: TierId; name: string; models: Record<string, string> };
export type RoutingPolicyInput = {
  enabled: boolean;
  mode: string;
  thresholdPercent: number;
  providers: { adapterType: string; templateAgentId: string }[];
  tiers: ProviderTier[];
  modelTiers: { adapterType: string; model: string; tierId: TierId }[];
};
export type RoutingPolicy = RoutingPolicyInput & { revision: number; updatedAt: string | null; updatedBy: string | null };
export type QuotaState = "available" | "exhausted" | "unknown";
export type AgentRoutingHealth = {
  agentId: string;
  state: "ready" | "switched" | "waiting" | "blocked";
  message: string;
  adapterType: string;
  primaryAdapterType: string | null;
};
export type ControllerHealth = {
  checkedAt: string;
  revision: number;
  agents: AgentRoutingHealth[];
  quotas: { adapterType: string; state: QuotaState; accounts: number }[];
  error: string | null;
};
export type ProviderRoutingStatus = {
  policy: RoutingPolicy;
  candidates: { adapterType: string; agents: { id: string; name: string }[] }[];
  routedAgents: { agentId: string; name: string; adapterType: string; primaryAdapterType: string }[];
  controller: { intervalMs: number; health: ControllerHealth | null };
};

const base = (companyId: string) => `/companies/${companyId}/ppclip/provider-routing`;

export const providerRoutingApi = {
  status: (companyId: string) => api.get<ProviderRoutingStatus>(base(companyId)),
  save: (companyId: string, expectedRevision: number, policy: RoutingPolicyInput) =>
    api.put<ProviderRoutingStatus>(base(companyId), { expectedRevision, policy }),
  reconcile: (companyId: string) => api.post<ControllerHealth>(`${base(companyId)}/reconcile`, {}),
  release: (companyId: string, agentId: string) =>
    api.post<{ agentId: string; released: boolean }>(`${base(companyId)}/agents/${agentId}/release`, {}),
};

export function policyInput(policy: RoutingPolicy): RoutingPolicyInput {
  return {
    enabled: policy.enabled,
    mode: policy.mode,
    thresholdPercent: policy.thresholdPercent,
    providers: policy.providers,
    tiers: policy.tiers,
    modelTiers: policy.modelTiers,
  };
}
