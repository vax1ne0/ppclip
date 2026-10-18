import { useState } from "react";
import { AgentComputerBadge } from "@/ppclip/computer-use/AgentComputerBadge";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import type { Agent, Issue } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { Link } from "@/lib/router";
import { issueUrl } from "@/lib/utils";
import { StatusIcon } from "@/components/StatusIcon";
import { usePpclipFeature } from "@/ppclip/features/store";

const OPEN_STATUSES = "todo,in_progress,in_review,blocked";
const TASK_ORDER: Record<string, number> = { in_progress: 0, in_review: 1, blocked: 2, todo: 3 };
const SHOWN = 5;

/** Open tasks for the hover card: in progress first, then review, blocked and up next. */
export function orderCurrentTasks(tasks: readonly Pick<Issue, "id" | "status" | "identifier">[]) {
  return [...tasks]
    .filter((task) => task.status in TASK_ORDER)
    .sort((a, b) => TASK_ORDER[a.status]! - TASK_ORDER[b.status]! || (a.identifier ?? a.id).localeCompare(b.identifier ?? b.id));
}

const agentTasksQueryKey = (companyId: string, agentId: string) =>
  [...queryKeys.issues.list(companyId), "ppclip-agent-current-tasks", agentId] as const;

function TaskList({ agent }: { agent: Pick<Agent, "id" | "companyId" | "name"> }) {
  // Loads only while the card is open; live updates invalidate the issues prefix.
  const { data, isError, isPending } = useQuery({
    queryKey: agentTasksQueryKey(agent.companyId, agent.id),
    queryFn: () => issuesApi.list(agent.companyId, { assigneeAgentId: agent.id, status: OPEN_STATUSES, limit: 50 }),
    staleTime: 15_000,
  });
  if (isPending) return <p className="text-xs text-muted-foreground" role="status">Loading tasks…</p>;
  if (isError) return <p className="text-xs text-muted-foreground">Couldn’t load tasks.</p>;
  const tasks = orderCurrentTasks(data ?? []) as Issue[];
  if (tasks.length === 0) return <p className="text-xs text-muted-foreground">No open tasks.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {tasks.slice(0, SHOWN).map((task) => (
        <li key={task.id}>
          <Link to={issueUrl(task)} className="group flex min-w-0 items-center gap-2 text-sm no-underline text-inherit" title={task.title}>
            <StatusIcon status={task.status} />
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.identifier ?? "Task"}</span>
            <span className="min-w-0 truncate group-hover:underline">{task.title}</span>
          </Link>
        </li>
      ))}
      {tasks.length > SHOWN ? <li className="text-xs text-muted-foreground">+{tasks.length - SHOWN} more</li> : null}
    </ul>
  );
}

/**
 * ppclip AGENTS-1: hovering (or focusing) an agent's name shows its current
 * work, in progress first, in official's popover surface.
 */
/** ppclip module switch (Settings → ppclip): rosterExtras. */
export function AgentTaskHoverCard(props: Parameters<typeof AgentTaskHoverCardContent>[0]) {
  return <span className="inline-flex min-w-0 items-center gap-1.5">{usePpclipFeature("rosterExtras") ? <AgentTaskHoverCardContent {...props} /> : <span className="truncate">{props.agent.name}</span>}<AgentComputerBadge agentId={props.agent.id} /></span>;
}

function AgentTaskHoverCardContent({ agent }: { agent: Pick<Agent, "id" | "companyId" | "name"> }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCardPrimitive.Root open={open} onOpenChange={setOpen} openDelay={300} closeDelay={100}>
      <HoverCardPrimitive.Trigger asChild>
        <span tabIndex={0} className="truncate focus-visible:outline-none focus-visible:underline" data-ppclip-agent-name="">
          {agent.name}
        </span>
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={4}
          // The card renders inside the row's link (React portals bubble), so
          // keep clicks on task links from also opening the agent.
          onClick={(event) => event.stopPropagation()}
          className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 flex w-80 flex-col gap-2 rounded-md border p-3 shadow-md outline-hidden"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium">{agent.name}</p>
            <span className="shrink-0 text-xs text-muted-foreground">Current tasks</span>
          </div>
          {open ? <TaskList agent={agent} /> : null}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}
