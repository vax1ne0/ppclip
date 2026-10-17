import type { QueryClient } from "@tanstack/react-query";
import { ppclipFeatureEnabled } from "./features/store";

/**
 * ppclip FIX-1: official keeps the exact company live-runs list in sync from
 * run events, but scoped copies of it (the Dashboard agents panel and the Live
 * page add a scope and limits to the key) are neither patched nor polled, so a
 * finished run stays "live" there until reload. Refetch only those scoped lists.
 */
export function refreshScopedLiveRuns(queryClient: QueryClient, companyId: string) {
  if (!ppclipFeatureEnabled("liveRefresh")) return Promise.resolve();
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey.length > 2 && queryKey[0] === "live-runs" && queryKey[1] === companyId,
  });
}
