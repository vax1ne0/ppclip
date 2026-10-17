import { useQuery, useQueryClient } from "@tanstack/react-query";
import { runControlsApi } from "./api";

export const runControlsQueryKey = (companyId: string | null | undefined) =>
  ["ppclip", "run-controls", companyId ?? null] as const;

/** The company's run-control state; `enabled` stays false until the master switch is on. */
export function useRunControls(companyId: string | null | undefined) {
  return useQuery({
    queryKey: runControlsQueryKey(companyId),
    queryFn: () => runControlsApi.overview(companyId!),
    enabled: !!companyId,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

/** Run controls rewrite agents' configs, so refresh the overview and every agent cache. */
export function useInvalidateRunControls(companyId: string | null | undefined) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: runControlsQueryKey(companyId) }),
      queryClient.invalidateQueries({ queryKey: ["agents"] }),
    ]);
  };
}
