import { Bot } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { LiveStationCard } from "./LiveStationCard";
import type { TranscriptEntry } from "@/adapters";
import { stationSummary } from "./station-order";
import { useLiveStations } from "./useLiveStations";
import { useComputerUse } from "../computer-use/useComputerUse";

const NO_TRANSCRIPT: TranscriptEntry[] = [];

/**
 * ppclip DASH-2: the Live runs page as a grid of big agent stations, one per
 * agent, working agents first. Replaces official's run-card panel on
 * `/dashboard/live` only; the Dashboard keeps official's cards.
 */
export function LiveStations({ companyId }: { companyId: string }) {
  const live = useLiveStations(companyId);
  const chat = useAgentChatEnabled();
  const computers = useComputerUse(companyId);
  const computerUse = computers.data?.enabled ? computers.data : null;
  const liveView = computerUse?.supervisor.ok ? computerUse.supervisor.provider.liveView : false;

  if (live.isLoading) return <PageSkeleton variant="dashboard" />;
  if (live.error) return <p className="text-sm text-destructive">{live.error.message}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">Live agent runs</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="live-summary">
          {stationSummary(live.counts)}
        </p>
      </div>

      {live.stations.length === 0 ? (
        <EmptyState icon={Bot} message="No agents yet. Hire an agent to see it work here." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3" data-testid="live-stations">
          {live.stations.map((station) => (
            <LiveStationCard
              key={station.agent.id}
              station={station}
              issue={station.run?.issueId ? live.issueById.get(station.run.issueId) : undefined}
              transcript={station.run ? live.transcriptFor(station.run.id) : NO_TRANSCRIPT}
              companyId={companyId}
              chatEnabled={chat.enabled}
              computer={computerUse?.agents.find((c) => c.agentId === station.agent.id && c.enabled)}
              computerLiveView={liveView}
            />
          ))}
        </div>
      )}
    </div>
  );
}
