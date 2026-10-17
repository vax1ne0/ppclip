import { Monitor } from "lucide-react";
import { SidebarNavItem } from "@/components/SidebarNavItem";
import { contextualSidebarStyles } from "@/components/contextual-sidebar-styles";
import { useCompany } from "@/context/CompanyContext";
import { usePpclipFeature } from "@/ppclip/features/store";
import { agentComputerHrefFromRef } from "./links";
import { computerChipLabel } from "./ComputerStateChip";
import { isLiveState, useComputerUse } from "./useComputerUse";

/**
 * ppclip computer use: a "Computer" entry in the agent page's sidebar, shown
 * when this agent has a computer. Opens the big screen.
 */
export function AgentComputerNav({ agentRef, agentId }: { agentRef: string; agentId?: string }) {
  const on = usePpclipFeature("computerUse");
  const { selectedCompanyId } = useCompany();
  const overview = useComputerUse(on && agentId ? selectedCompanyId : null);
  const computer = overview.data?.enabled ? overview.data.agents.find((row) => row.agentId === agentId && row.enabled) : undefined;
  if (!on || !computer) return null;
  const live = isLiveState(computer.state);
  return (
    <div data-slot="contextual-sidebar-section" className={contextualSidebarStyles.section} data-testid="agent-computer-nav">
      <p data-slot="contextual-sidebar-section-label" className={contextualSidebarStyles.sectionLabel}>Computer</p>
      <div data-slot="contextual-sidebar-group" className={contextualSidebarStyles.group}>
        <SidebarNavItem
          to={agentComputerHrefFromRef(agentRef)}
          label="Live screen"
          icon={Monitor}
          textBadge={live ? computerChipLabel(computer) : undefined}
          textBadgeTone={computer.state === "waiting_for_human" ? "amber" : "default"}
        />
      </div>
    </div>
  );
}
