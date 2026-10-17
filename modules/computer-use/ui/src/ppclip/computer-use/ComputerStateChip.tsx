import { Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePpclipFeature } from "@/ppclip/features/store";
import type { AgentComputer } from "./api";
import { isLiveState, STATE_LABELS } from "./useComputerUse";

/** The agent used its computer this recently: the chip says "Using its computer". */
export const RECENT_COMPUTER_ACTIVITY_MS = 2 * 60_000;

export function computerChipLabel(computer: Pick<AgentComputer, "state" | "lastActivityAt">, now = Date.now()) {
  if (computer.state === "agent" && computer.lastActivityAt && now - Date.parse(computer.lastActivityAt) < RECENT_COMPUTER_ACTIVITY_MS) {
    return "Using its computer";
  }
  return STATE_LABELS[computer.state];
}

/** A compact computer state for the Live runs card header. Nothing while the computer is off. */
export function ComputerStateChip({ computer }: { computer: AgentComputer }) {
  const on = usePpclipFeature("computerUse");
  if (!on || !isLiveState(computer.state)) return null;
  const needsYou = computer.state === "waiting_for_human";
  return (
    <Badge variant={needsYou ? "destructive" : "secondary"} data-testid="station-computer-chip" title={needsYou && computer.request ? computer.request.reason : undefined}>
      <Monitor aria-hidden />
      {computerChipLabel(computer)}
    </Badge>
  );
}
