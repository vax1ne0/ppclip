import { cn } from "@/lib/utils";
import { runsLeftDisplay, runsLeftTitle, type RunsLeftTone } from "./display";
import { useRunControls } from "./useRunControls";
import { usePpclipFeature } from "@/ppclip/features/store";

const toneClass: Record<RunsLeftTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-(--status-agent-paused)",
  danger: "text-destructive",
  draining: "text-(--status-agent-paused)",
  drained: "text-(--status-task-icon-done)",
};

/**
 * ppclip RUN-1: the "daily runs left" roster column (today's runs vs official's
 * `heartbeat.maxDailyRuns`, UTC day). Renders nothing while the company's
 * run-controls switch is off. Every row shares one cached overview request.
 */
/** ppclip module switch (Settings → ppclip): runControls. */
export function DailyRunsLeft(props: Parameters<typeof DailyRunsLeftContent>[0]) {
  return usePpclipFeature("runControls") ? <DailyRunsLeftContent {...props} /> : null;
}

function DailyRunsLeftContent({ companyId, agentId }: { companyId: string; agentId: string }) {
  const overview = useRunControls(companyId);
  if (!overview.data?.enabled) return null;
  const row = overview.data.agents.find((entry) => entry.agentId === agentId);
  if (!row) return null;
  const display = runsLeftDisplay(row);
  return (
    <div
      className="w-16 min-w-0 leading-tight text-right"
      title={runsLeftTitle(row, overview.data.resetsAt)}
      data-testid="ppclip-daily-runs-left"
    >
      <div className={cn("font-mono text-xs", toneClass[display.tone])}>{display.label}</div>
      <div className="text-(length:--text-micro) text-muted-foreground/70">
        {row.drainState ? `${row.usedToday} today` : "runs left"}
      </div>
    </div>
  );
}
