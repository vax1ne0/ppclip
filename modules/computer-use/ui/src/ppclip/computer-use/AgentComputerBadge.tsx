import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Monitor } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { usePpclipFeature } from "@/ppclip/features/store";
import { useComputerUse } from "./useComputerUse";

const EnabledComputers = createContext<ReadonlySet<string>>(new Set());

/** One shared overview subscription for all name badges, rather than polling per row. */
export function ComputerBadgesProvider({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const on = usePpclipFeature("computerUse");
  const overview = useComputerUse(on ? selectedCompanyId : null);
  const enabled = useMemo(() => new Set(on && overview.data?.enabled ? overview.data.agents.filter(agent => agent.enabled).map(agent => agent.agentId) : []), [on, overview.data]);
  return <EnabledComputers.Provider value={enabled}>{children}</EnabledComputers.Provider>;
}
export function AgentComputerBadge({ agentId }: { agentId?: string }) {
  const enabled = useContext(EnabledComputers);
  if (!agentId || !enabled.has(agentId)) return null;
  return <span role="img" aria-label="Computer use enabled" title="Computer use enabled" className="inline-flex shrink-0 items-center text-muted-foreground" data-testid="agent-computer-badge"><Monitor aria-hidden="true" className="size-3.5" /></span>;
}
