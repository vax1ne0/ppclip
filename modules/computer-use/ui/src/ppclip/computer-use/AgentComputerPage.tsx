import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useParams } from "@/lib/router";
import { agentUrl } from "@/lib/utils";
import { usePpclipFeature } from "@/ppclip/features/store";
import { liveAgentHref } from "../live/anchors";
import { AgentComputerUseCard, COMPUTER_USE_ADAPTERS } from "./AgentComputerUseCard";
import { ComputerPanel } from "./ComputerPanel";
import { SupervisorStatus } from "./ComputerUseSettingsSection";
import { useComputerUse } from "./useComputerUse";

/**
 * ppclip computer use: the agent's computer on a big screen, at
 * /agents/<agent>/computer. It sits inside the agent page, so the agent's
 * sidebar stays. Watch, take control, release, pause, stop and full screen.
 */
export function AgentComputerPage() {
  const on = usePpclipFeature("computerUse");
  const { agentId: agentRef = "" } = useParams<{ agentId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const agent = useQuery({
    queryKey: [...queryKeys.agents.detail(agentRef), selectedCompanyId ?? null, "ppclip-computer"],
    queryFn: () => agentsApi.get(agentRef, selectedCompanyId ?? undefined),
    enabled: on && Boolean(agentRef && selectedCompanyId),
  });
  const supported = Boolean(agent.data && (COMPUTER_USE_ADAPTERS as readonly string[]).includes(agent.data.adapterType));
  const overview = useComputerUse(on && supported ? selectedCompanyId : null);
  const computer = overview.data?.agents.find((row) => row.agentId === agent.data?.id);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Agents", href: "/agents/all" },
      ...(agent.data ? [{ label: agent.data.name, href: agentUrl(agent.data) }] : []),
      { label: "Computer" },
    ]);
  }, [setBreadcrumbs, agent.data]);

  if (!on) {
    return <p className="text-sm text-muted-foreground" data-testid="agent-computer-off">Computer use is turned off in Settings → ppclip.</p>;
  }
  if (agent.isError) return <p className="text-sm text-destructive">{agent.error instanceof Error ? agent.error.message : "Agent not found."}</p>;
  if (!agent.data || !selectedCompanyId) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;

  const ready = overview.data?.enabled && computer?.enabled;
  return (
    <div className="flex flex-col gap-4" data-testid="agent-computer-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Live screen</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to={liveAgentHref(agent.data.id)}>Live runs</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to={`${agentUrl(agent.data)}/runtime`}>Computer settings</Link>
          </Button>
        </div>
      </div>
      {ready && overview.data ? (
        <>
          {!overview.data.supervisor.ok ? <SupervisorStatus supervisor={overview.data.supervisor} /> : null}
          <ComputerPanel
            companyId={selectedCompanyId}
            computer={computer!}
            agentName={agent.data.name}
            liveView={overview.data.supervisor.ok ? overview.data.supervisor.provider.liveView : false}
            variant="page"
          />
        </>
      ) : (
        <div className="max-w-2xl">
          <AgentComputerUseCard agent={agent.data} companyId={selectedCompanyId} />
        </div>
      )}
    </div>
  );
}
