import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Monitor } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
export function AgentComputerBadge({ agentId, size = "default" }: { agentId?: string; size?: "compact" | "default" | "heading" }) {
  const enabled = useContext(EnabledComputers);
  if (!agentId || !enabled.has(agentId)) return null;
  return <Tooltip>
    <TooltipTrigger asChild>
      <span role="img" aria-label="Computer use enabled" data-testid="agent-computer-badge" className={cn(
        "inline-flex shrink-0 self-center items-center justify-center rounded-md border border-border/70 bg-muted/40 align-middle leading-none text-muted-foreground",
        size === "compact" ? "size-4" : size === "heading" ? "size-6" : "size-4.5",
      )}>
        <Monitor aria-hidden="true" strokeWidth={1.75} className={size === "compact" ? "size-2.5" : size === "heading" ? "size-3.5" : "size-3"} />
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={6}>Computer use enabled</TooltipContent>
  </Tooltip>;
}
