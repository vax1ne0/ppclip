import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";
import { computerUseApi, type AgentComputer, type ComputerState } from "./api";

const computerUseQueryKey = (companyId: string | null | undefined) => ["ppclip", "computer-use", companyId ?? null] as const;

/** The company's computer-use overview; refreshed by live events when control changes. */
export function useComputerUse(companyId: string | null | undefined) {
  const queryClient = useQueryClient();
  useCompanyLiveEvent((event) => {
    const payload = (event as { payload?: { reason?: unknown } }).payload;
    if (event.type === "agent.status" && payload?.reason === "ppclip_computer_use") {
      void queryClient.invalidateQueries({ queryKey: computerUseQueryKey(companyId) });
    }
  });
  return useQuery({
    queryKey: computerUseQueryKey(companyId),
    queryFn: () => computerUseApi.overview(companyId!),
    enabled: !!companyId,
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
}

export function useInvalidateComputerUse(companyId: string | null | undefined) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: computerUseQueryKey(companyId) });
}

export const STATE_LABELS: Record<ComputerState, string> = {
  off: "Off",
  starting: "Starting",
  agent: "Agent driving",
  waiting_for_human: "Needs you",
  human: "You're in control",
  human_private: "Private control",
  paused: "Paused",
  stopped: "Stopped",
  revoked: "Access revoked",
};

export function isLiveState(state: ComputerState) {
  return state !== "off" && state !== "stopped" && state !== "revoked";
}

/** Which buttons the Live card shows for a state. Mirrors the server's transition table. */
export function availableActions(computer: Pick<AgentComputer, "state">) {
  switch (computer.state) {
    case "off":
    case "stopped":
      return ["start"] as const;
    case "starting":
      return ["stop", "revoke"] as const;
    case "agent":
    case "waiting_for_human":
      return ["take-control", "take-control-private", "pause", "stop", "revoke"] as const;
    case "human":
      return ["release", "take-control-private", "pause", "stop", "revoke"] as const;
    case "human_private":
      return ["release", "pause", "stop", "revoke"] as const;
    case "paused":
      return ["resume", "take-control", "stop", "revoke"] as const;
    case "revoked":
      return ["restore"] as const;
  }
}
