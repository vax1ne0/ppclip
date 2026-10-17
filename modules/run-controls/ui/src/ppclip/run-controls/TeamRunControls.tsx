import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { CirclePause, Infinity as InfinityIcon, Loader2, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runControlsApi } from "./api";
import { drainLabel, unlimitedLabel } from "./display";
import { useInvalidateRunControls, useRunControls } from "./useRunControls";
import { usePpclipFeature } from "@/ppclip/features/store";

type Action = "unlimited" | "drain" | "resume" | "cancel-drain-after";

/**
 * ppclip RUN-1/RUN-2: team Unlimited / Drain / Resume for the Agents page header,
 * plus the armed "Drain after" notice. Renders nothing while the company's
 * run-controls switch is off.
 */
/** ppclip module switch (Settings → ppclip): runControls. */
export function TeamRunControls(props: Parameters<typeof TeamRunControlsContent>[0]) {
  return usePpclipFeature("runControls") ? <TeamRunControlsContent {...props} /> : null;
}

function TeamRunControlsContent({ companyId, agents }: { companyId: string; agents: Agent[] }) {
  const overview = useRunControls(companyId);
  const invalidate = useInvalidateRunControls(companyId);
  const [notice, setNotice] = useState<string | null>(null);
  const team = overview.data?.enabled ? overview.data.team : null;

  const mutation = useMutation({
    mutationFn: async (action: Action): Promise<string | null> => {
      if (!team) return null;
      if (action === "unlimited") {
        await runControlsApi.setUnlimited(companyId, team.unlimited !== "on");
        return null;
      }
      if (action === "drain") {
        await runControlsApi.drain(companyId);
        return null;
      }
      if (action === "cancel-drain-after") {
        if (team.drainAfterAgentId) await runControlsApi.setDrainAfter(companyId, team.drainAfterAgentId, false);
        return null;
      }
      const result = await runControlsApi.resume(companyId);
      const skipped = result.wakes.skipped.length;
      if (result.wakes.accepted === 0 && skipped === 0) return "No assigned work to resume. Agents accept new work again.";
      return `${result.wakes.accepted} task${result.wakes.accepted === 1 ? "" : "s"} resumed${skipped ? `, ${skipped} skipped` : ""}.`;
    },
    onMutate: () => setNotice(null),
    onSuccess: (message) => setNotice(message),
    onSettled: invalidate,
  });

  if (!team) return null;
  const busy = mutation.isPending ? mutation.variables : null;
  const draining = team.drain !== "off";
  const armedAgent = team.drainAfterAgentId ? agents.find((agent) => agent.id === team.drainAfterAgentId) : null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="ppclip-team-run-controls">
      {team.drainAfterAgentId && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
          Drain after {armedAgent?.name ?? "agent"}: waiting for its next run
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Cancel drain after"
            disabled={busy !== null}
            onClick={() => mutation.mutate("cancel-drain-after")}
          >
            <X className="h-3 w-3" />
          </Button>
        </span>
      )}
      <Button
        size="sm"
        variant={team.unlimited === "on" ? "secondary" : "outline"}
        aria-pressed={team.unlimited === "on"}
        disabled={busy !== null}
        onClick={() => mutation.mutate("unlimited")}
        title={team.unlimited === "on"
          ? "Turn off unlimited runs. Daily limits come back, and runs made while unlimited don't count against today's allowance."
          : "Lift every agent's daily run limit until you turn this off. Runs made meanwhile don't use up today's allowance."}
      >
        {busy === "unlimited" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <InfinityIcon className="h-3.5 w-3.5 mr-1.5" />}
        Unlimited: {unlimitedLabel(team)}
      </Button>
      <Button
        size="sm"
        variant={draining ? "secondary" : "outline"}
        aria-pressed={draining}
        data-drain-state={team.drain}
        disabled={busy !== null || team.drain === "draining" || team.drain === "drained"}
        onClick={() => mutation.mutate("drain")}
        title={team.drain === "drained"
          ? "The team is stopped. Click Resume to allow new work."
          : team.drain === "draining"
            ? "Current runs are finishing; nothing new starts."
            : "Drain: let current runs finish, then start nothing new."}
      >
        {busy === "drain" || team.drain === "draining"
          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          : <CirclePause className="h-3.5 w-3.5 mr-1.5" />}
        <span aria-live="polite">{team.drain === "mixed" ? "Drain all" : drainLabel(team)}</span>
      </Button>
      {(draining || team.drainAfterAgentId) && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => mutation.mutate("resume")}
          title="Resume: restore each agent's own run limit and wake one assigned task per agent."
        >
          {busy === "resume" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Resume
        </Button>
      )}
      {notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
      {mutation.isError && (
        <span role="alert" className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Run control failed"}
        </span>
      )}
    </div>
  );
}
