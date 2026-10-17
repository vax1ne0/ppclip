import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";
import { agentsApi } from "@/api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { useLiveRunTranscripts } from "@/components/transcript/useLiveRunTranscripts";
import { queryKeys } from "@/lib/queryKeys";
import { useAgentAttention } from "../attention/useAgentAttention";
import { buildStations, countStations } from "./station-order";

/** Same window as official's Live page (`DASHBOARD_LIVE_RUN_LIMIT`). */
const LIVE_STATIONS_RUN_LIMIT = 50;
/** Fallback poll; run lifecycle events already refresh scoped live-run keys (FIX-1). */
const LIVE_STATIONS_REFRESH_MS = 15_000;
/** Transcripts stream only for this many running cards (activity falls back to run progress after that). */
const LIVE_STATIONS_TRANSCRIPT_LIMIT = 8;
const TRANSCRIPT_MAX_CHUNKS = 40;
const TRANSCRIPT_READ_LIMIT_BYTES = 64_000;
const EMPTY_TRANSCRIPT: TranscriptEntry[] = [];

export const liveStationsRunsKey = (companyId: string) =>
  [...queryKeys.liveRuns(companyId), "ppclip-live-stations", { limit: LIVE_STATIONS_RUN_LIMIT }] as const;

/**
 * ppclip DASH-2: everything the Live page reads, from official data only:
 * the agent roster, official live runs (the exact company key official keeps
 * patched from run events, plus a scoped "recent" window), NAV-2 attention,
 * task titles for the cards, and live transcripts for running cards only.
 */
export function useLiveStations(companyId: string) {
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });
  // Official's exact company key: live (queued/running) runs, patched in place by live events.
  const liveNow = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    staleTime: 30_000,
  });
  // Scoped window of recent runs for idle cards (refreshed when a run finishes).
  const recent = useQuery({
    queryKey: liveStationsRunsKey(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId, {
      minCount: LIVE_STATIONS_RUN_LIMIT,
      limit: LIVE_STATIONS_RUN_LIMIT,
    }),
    refetchInterval: LIVE_STATIONS_REFRESH_MS,
  });
  const attention = useAgentAttention(companyId);

  const runs = useMemo(() => {
    const byId = new Map<string, LiveRunForIssue>();
    for (const run of recent.data ?? []) byId.set(run.id, run);
    for (const run of liveNow.data ?? []) byId.set(run.id, run);
    return [...byId.values()];
  }, [liveNow.data, recent.data]);

  const stations = useMemo(
    () => buildStations(agentsQuery.data ?? [], runs, attention.byAgent),
    [agentsQuery.data, runs, attention.byAgent],
  );
  const counts = useMemo(() => countStations(stations), [stations]);

  const issueIds = useMemo(
    () => [...new Set(stations.flatMap((station) => (station.run?.issueId ? [station.run.issueId] : [])))],
    [stations],
  );
  const issueQueries = useQueries({
    queries: issueIds.map((issueId) => ({
      queryKey: queryKeys.issues.detail(issueId),
      queryFn: () => issuesApi.get(issueId),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const query of issueQueries) if (query.data) map.set(query.data.id, query.data);
    return map;
  }, [issueQueries]);

  const transcriptRuns = useMemo(
    () => stations
      .flatMap((station) => (station.run?.status === "running" ? [station.run] : []))
      .slice(0, LIVE_STATIONS_TRANSCRIPT_LIMIT),
    [stations],
  );
  const { transcriptByRun } = useLiveRunTranscripts({
    runs: transcriptRuns,
    companyId,
    maxChunksPerRun: TRANSCRIPT_MAX_CHUNKS,
    logReadLimitBytes: TRANSCRIPT_READ_LIMIT_BYTES,
  });

  return {
    stations,
    counts,
    issueById,
    transcriptFor: (runId: string) => transcriptByRun.get(runId) ?? EMPTY_TRANSCRIPT,
    isLoading: agentsQuery.isLoading,
    error: (agentsQuery.error as Error | null) ?? null,
  };
}
