import { useMutation } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { CirclePause, Loader2 } from "lucide-react";
import { runControlsApi } from "./api";
import { useInvalidateRunControls, useRunControls } from "./useRunControls";
import { usePpclipFeature } from "@/ppclip/features/store";

/**
 * ppclip RUN-2: "Drain after next run" in an agent's actions menu. When armed,
 * the whole team drains as soon as this agent's next run starts. The server
 * checks eligibility (idle, waiting only on another agent, no human decision
 * pending) and explains a refusal. Hidden while run controls are off.
 */
/** ppclip module switch (Settings → ppclip): runControls. */
export function DrainAfterMenuItem(props: Parameters<typeof DrainAfterMenuItemContent>[0]) {
  return usePpclipFeature("runControls") ? <DrainAfterMenuItemContent {...props} /> : null;
}

function DrainAfterMenuItemContent({
  agent,
  onDone,
  onError,
}: {
  agent: Pick<Agent, "id" | "companyId" | "status">;
  onDone?: () => void;
  onError?: (message: string) => void;
}) {
  const overview = useRunControls(agent.companyId);
  const invalidate = useInvalidateRunControls(agent.companyId);
  const row = overview.data?.agents.find((entry) => entry.agentId === agent.id);
  const armed = row?.drainAfterArmed === true;
  const mutation = useMutation({
    mutationFn: () => runControlsApi.setDrainAfter(agent.companyId, agent.id, !armed),
    onSuccess: () => onDone?.(),
    onError: (error) => onError?.(error instanceof Error ? error.message : "Drain after failed"),
    onSettled: invalidate,
  });
  if (!overview.data?.enabled || !row || agent.status === "terminated") return null;
  const otherArmed = !armed && overview.data.team?.drainAfterAgentId != null;
  if (!armed && (row.draining || otherArmed)) return null;

  return (
    <button
      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      title={armed
        ? "Cancel the planned team drain."
        : "When this agent starts its next run, drain the whole team: running work finishes and nothing new starts."}
    >
      {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CirclePause className="h-3 w-3" />}
      {armed ? "Cancel drain after" : "Drain after next run"}
    </button>
  );
}
