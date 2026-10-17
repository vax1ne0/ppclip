import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, AttentionItem } from "@paperclipai/shared";
import { attentionApi } from "@/api/attention";
import { heartbeatsApi } from "@/api/heartbeats";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { usePpclipFeature, usePpclipFeatures } from "@/ppclip/features/store";
import {
  deriveAgentAttention,
  orderByUrgency,
  urgencyRank,
  type AgentAttention,
} from "./agent-attention";

/**
 * Live updates and official resolvers already invalidate both prefixes
 * (`["issues", companyId]`, `["attention", companyId]`); this is only a
 * fallback, one request per source for the whole company.
 */
const ATTENTION_REFRESH_MS = 30_000;
const BLOCKED_TASK_LIMIT = 500;

export const attentionFeedQueryKey = (companyId: string) =>
  [...queryKeys.attention(companyId), "ppclip-agent-attention"] as const;
export const blockedTasksQueryKey = (companyId: string) =>
  [...queryKeys.issues.list(companyId), "ppclip-attention-blocked"] as const;

/** The official attention feed (Decisions data), dismissed rows included: a dismissed card still blocks its agent. */
export function useAttentionFeed(companyId: string | null | undefined) {
  const needed = useAttentionNeeded();
  return useQuery({
    queryKey: attentionFeedQueryKey(companyId!),
    queryFn: () => attentionApi.list(companyId!, { all: true, includeDismissed: true }),
    enabled: !!companyId && needed,
    refetchInterval: ATTENTION_REFRESH_MS,
    staleTime: 10_000,
    retry: false,
  });
}

/** Attention data feeds both the statuses and the urgency order; skip it when both are off. */
function useAttentionNeeded() {
  const features = usePpclipFeatures();
  return features.attention || features.urgencyOrder;
}

function useBlockedTasks(companyId: string | null | undefined) {
  const needed = useAttentionNeeded();
  return useQuery({
    queryKey: blockedTasksQueryKey(companyId!),
    queryFn: () => issuesApi.list(companyId!, { status: "blocked", includeBlockedBy: true, limit: BLOCKED_TASK_LIMIT }),
    enabled: !!companyId && needed,
    refetchInterval: ATTENTION_REFRESH_MS,
    staleTime: 10_000,
    retry: false,
  });
}

const NO_ITEMS: AttentionItem[] = [];

/**
 * ppclip NAV-2: per-agent attention for a company. Every caller shares the
 * same two cached queries, so badges on a long list cost nothing extra.
 * A failed source simply contributes nothing (badges fall back to official).
 */
export function useAgentAttention(companyId: string | null | undefined) {
  const feed = useAttentionFeed(companyId);
  const blocked = useBlockedTasks(companyId);
  const byAgent = useMemo(
    () => deriveAgentAttention(feed.data?.items ?? NO_ITEMS, blocked.data ?? []),
    [feed.data, blocked.data],
  );
  return {
    byAgent,
    feedItems: feed.data?.items ?? NO_ITEMS,
    feedError: feed.isError,
    isError: feed.isError || blocked.isError,
    get: (agentId: string): AgentAttention | undefined => byAgent.get(agentId),
  };
}

/**
 * ppclip NAV-1: orders sidebar agents by urgency (running → waiting/pending →
 * blocked/error → idle), keeping the caller's order inside each group. Live
 * runs come from the official live-runs cache the sidebar already keeps fresh.
 */
export function useAgentUrgencyOrder(companyId: string | null | undefined) {
  const attention = useAgentAttention(companyId);
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId!),
    enabled: !!companyId,
    refetchInterval: false,
    staleTime: 30_000,
  });
  const liveByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
    }
    return counts;
  }, [liveRuns]);
  const { byAgent } = attention;
  const on = usePpclipFeature("urgencyOrder");
  return useCallback(
    <T extends Pick<Agent, "id" | "status" | "pauseReason">>(agents: readonly T[]): T[] =>
      on ? orderByUrgency(agents, (agent) => urgencyRank(agent, liveByAgent.get(agent.id) ?? 0, byAgent.get(agent.id))) : [...agents],
    [byAgent, liveByAgent, on],
  );
}
