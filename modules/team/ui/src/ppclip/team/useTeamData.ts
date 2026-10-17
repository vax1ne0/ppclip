import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, Issue } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { buildAgentLinks, type AgentLink } from "./agent-links";

/** Open work only; finished tasks never draw arrows or appear on cards. */
export const TEAM_OPEN_STATUSES = "todo,in_progress,in_review,blocked";
/** Live updates already invalidate task queries; this slow poll is only a fallback. */
const TEAM_WORK_REFRESH_MS = 30_000;
const TEAM_WORK_LIMIT = 500;

const teamWorkQueryKey = (companyId: string) => [...queryKeys.issues.list(companyId), "ppclip-team-open-work"] as const;

type TeamWorkState = "loading" | "error" | "ready";

/**
 * ppclip TEAM-1: everything the Team page reads, from official APIs only:
 * the agent list (manager links come from `reportsTo`, the same data as the
 * official org chart) and open tasks with their `blockedBy` relations.
 */
export function useTeamData(companyId: string | null | undefined) {
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId,
  });
  const workQuery = useQuery({
    queryKey: teamWorkQueryKey(companyId!),
    queryFn: () => issuesApi.list(companyId!, { status: TEAM_OPEN_STATUSES, includeBlockedBy: true, limit: TEAM_WORK_LIMIT }),
    enabled: !!companyId,
    refetchInterval: TEAM_WORK_REFRESH_MS,
  });

  const agents = useMemo<Agent[]>(
    () => (agentsQuery.data ?? []).filter((agent) => agent.status !== "terminated"),
    [agentsQuery.data],
  );
  const tasks = workQuery.data;
  const tasksByAgent = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const task of tasks ?? []) {
      if (!task.assigneeAgentId) continue;
      map.set(task.assigneeAgentId, [...(map.get(task.assigneeAgentId) ?? []), task]);
    }
    return map;
  }, [tasks]);
  const links = useMemo<AgentLink[]>(() => (tasks ? buildAgentLinks(tasks) : []), [tasks]);
  const workState: TeamWorkState = workQuery.isError ? "error" : tasks ? "ready" : "loading";

  return {
    agents,
    agentsLoading: agentsQuery.isLoading,
    agentsError: agentsQuery.error as Error | null,
    tasksByAgent,
    links,
    workState,
    retryWork: () => void workQuery.refetch(),
  };
}
