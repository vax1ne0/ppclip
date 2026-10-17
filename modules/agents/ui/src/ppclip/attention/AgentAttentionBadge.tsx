import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";
import { AgentStatusBadge } from "@/components/StatusBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ATTENTION_LABELS,
  attentionStatusFor,
  type AgentAttention,
  type AttentionStatus,
  type TaskRef,
} from "./agent-attention";
import { useAgentAttention } from "./useAgentAttention";
import { usePpclipFeature } from "@/ppclip/features/store";

/**
 * Derived statuses reuse official status hues (no new tokens): a person's
 * decision reads like "in review", waiting on a teammate like "todo", and a
 * blocked task like official's blocked status.
 */
const STATUS_VAR: Record<AttentionStatus, string> = {
  waiting_for_you: "--status-task-in_review",
  pending_on_agent: "--status-task-todo",
  blocked_task: "--status-task-blocked",
};

const taskLabel = (task: TaskRef) => `${task.identifier ?? "Task"} · ${task.title}`;

/** Official agent chip markup (`.status-chip`), recoloured for a derived status. */
export function AttentionStatusChip({ status }: { status: AttentionStatus }) {
  return (
    <span
      className="status-chip inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium leading-none whitespace-nowrap shrink-0"
      style={{ "--sc": `var(${STATUS_VAR[status]})` } as CSSProperties}
      data-attention-status={status}
    >
      {ATTENTION_LABELS[status]}
    </span>
  );
}

function AttentionDetails({ status, attention, agentNames }: {
  status: AttentionStatus;
  attention: AgentAttention;
  agentNames: Map<string, string>;
}): ReactNode {
  if (status === "waiting_for_you") {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-medium">Waiting for your response</p>
        {attention.waiting.slice(0, 4).map((item) => (
          <p key={item.id}>{item.task ? `${taskLabel(item.task)}: ` : ""}{item.title}</p>
        ))}
        {attention.waiting.length > 4 ? <p>+{attention.waiting.length - 4} more</p> : null}
      </div>
    );
  }
  if (status === "pending_on_agent") {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-medium">Blocked by a teammate’s task</p>
        {attention.dependencies.slice(0, 4).map((dependency) => (
          <p key={`${dependency.task.id}:${dependency.blocker.id}`}>
            {taskLabel(dependency.task)} waits on {taskLabel(dependency.blocker)}
            {` (${agentNames.get(dependency.blockerAgentId) ?? "another agent"})`}
          </p>
        ))}
        {attention.dependencies.length > 4 ? <p>+{attention.dependencies.length - 4} more</p> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">Blocked, not waiting on another agent</p>
      {attention.blockedTasks.slice(0, 4).map((task) => <p key={task.id}>{taskLabel(task)}</p>)}
      {attention.blockedTasks.length > 4 ? <p>+{attention.blockedTasks.length - 4} more</p> : null}
    </div>
  );
}

/**
 * ppclip NAV-2: drop-in for official's `AgentStatusBadge`. Shows "Waiting for
 * you", "Pending on agent" or "Blocked task" when they apply (with the reason
 * on hover), otherwise official's badge unchanged.
 */
/** ppclip module switch (Settings → ppclip): attention. */
export function AgentAttentionBadge(props: Parameters<typeof AgentAttentionBadgeContent>[0]) {
  return usePpclipFeature("attention") ? <AgentAttentionBadgeContent {...props} /> : <AgentStatusBadge status={props.agent.status} />;
}

function AgentAttentionBadgeContent({ agent }: { agent: Pick<Agent, "id" | "companyId" | "status"> }) {
  const { get } = useAgentAttention(agent.companyId);
  const attention = get(agent.id);
  const status = attentionStatusFor(agent, attention);
  // Names for the "waits on" hint come from the roster cache every page already holds.
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(agent.companyId),
    queryFn: () => agentsApi.list(agent.companyId),
    enabled: status === "pending_on_agent",
  });
  const agentNames = useMemo(() => new Map((agents ?? []).map((entry) => [entry.id, entry.name])), [agents]);
  if (!status || !attention) return <AgentStatusBadge status={agent.status} />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AttentionStatusChip status={status} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        <AttentionDetails status={status} attention={attention} agentNames={agentNames} />
      </TooltipContent>
    </Tooltip>
  );
}
