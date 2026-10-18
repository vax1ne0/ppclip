import { useEffect } from "react";
import { Navigate } from "@/lib/router";
import { usePpclipFeature } from "@/ppclip/features/store";
import { Network } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useDialogActions } from "@/context/DialogContext";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { AgentActionButtons } from "@/components/AgentActionButtons";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { TeamAgentCard } from "./TeamAgentCard";
import { TeamCanvas } from "./TeamCanvas";
import { useTeamData } from "./useTeamData";
import { useComputerUse } from "@/ppclip/computer-use/useComputerUse";

const EVIDENCE_STATUS = {
  loading: "Loading open tasks for work arrows…",
  error: "Couldn’t load open tasks, so work arrows are hidden. Reporting lines are unaffected.",
  ready: undefined,
} as const;

/**
 * ppclip TEAM-1: the Team page at `/:companyPrefix/team`. A canvas of agent
 * cards joined by reporting lines and work arrows, built only from official
 * APIs and official UI components.
 */
/** ppclip TEAM-1, behind its module switch: off sends /team back to the dashboard. */
export function TeamPage() {
  return usePpclipFeature("team") ? <TeamPageContent /> : <Navigate to="/dashboard" replace />;
}

function TeamPageContent() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewAgent } = useDialogActions();
  const chat = useAgentChatEnabled();
  const team = useTeamData(selectedCompanyId);
  // ppclip computer use: a Computer button on agents that have one (module switch respected).
  const computerFeature = usePpclipFeature("computerUse");
  const computers = useComputerUse(computerFeature ? selectedCompanyId : null);
  const computerFor = (agentId: string) =>
    computerFeature && computers.data?.enabled ? computers.data.agents.find((c) => c.agentId === agentId && c.enabled) : undefined;

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) return <EmptyState icon={Network} message="Select an organization to see its team." />;
  if (team.agentsLoading) return <PageSkeleton variant="org-chart" />;
  if (team.agentsError) return <p className="text-sm text-destructive">{team.agentsError.message}</p>;
  if (!team.agents.length) {
    return <EmptyState icon={Network} message="Create your first agent to build the team." action="New Agent" onAction={openNewAgent} />;
  }

  return (
    <div className="flex h-(--sz-calc-38) min-h-(--sz-420px) flex-col md:h-full md:min-h-0">
      <TeamCanvas
        companyId={selectedCompanyId}
        agents={team.agents}
        links={team.workState === "ready" ? team.links : []}
        evidenceStatus={EVIDENCE_STATUS[team.workState]}
        renderCard={(agent, presentation) => (
          <TeamAgentCard
            agent={agent}
            tasks={team.tasksByAgent.get(agent.id) ?? []}
            workState={team.workState}
            retryWork={team.retryWork}
            chatEnabled={chat.enabled}
            presentation={presentation}
            computer={computerFor(agent.id)}
            actions={(
              <AgentActionButtons
                agent={agent}
                companyId={selectedCompanyId}
                showAssign={false}
                showRun={false}
                showStatus={false}
                showLifecycleControls={false}
                navigateToRunOnInvoke={false}
                className="flex items-center [&>button]:size-9 [&>button]:rounded-md [&>button]:border [&>button]:border-input [&>button]:bg-background [&>button]:shadow-xs"
              />
            )}
          />
        )}
      />
    </div>
  );
}
