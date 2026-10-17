import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent, type Issue } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { agentRouteRef, agentUrl, issueUrl, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentAttentionBadge } from "@/ppclip/attention/AgentAttentionBadge";
import { StatusIcon } from "@/components/StatusIcon";

/** What the canvas tells each card about its place on the board. */
export type TeamCardPresentation = {
  /** Reporting level, 1 = top. */
  level: number;
  groupLabel: string;
  /** CSS colour (a token reference or a validated custom hex). */
  groupColor: string;
  showLabels: boolean;
  managerName?: string;
  /** Wraps the identity row; in Edit mode it becomes the move-only drag handle. */
  header: (children: ReactNode) => ReactNode;
  /** "Hide N direct reports" control, when the agent has reports. */
  reportsToggle?: ReactNode;
};

const WORK_ORDER: Record<string, number> = { in_progress: 0, blocked: 1, in_review: 2, todo: 3 };
const WORK_SHOWN = 2;
const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

/** Open work assigned to the agent: in progress first, then blocked, then review and up next. */
export function selectTeamWork(tasks: Issue[], agentId: string): Issue[] {
  return tasks
    .filter((task) => task.assigneeAgentId === agentId && task.status in WORK_ORDER)
    .sort((a, b) => WORK_ORDER[a.status]! - WORK_ORDER[b.status]! || (a.identifier ?? a.id).localeCompare(b.identifier ?? b.id));
}

const normalize = (value: string) => value.trim().toLocaleLowerCase();

/**
 * ppclip TEAM-1: one agent on the Team canvas, in official's card style.
 * Presentation only: the page owns data and passes in the action cluster.
 */
export function TeamAgentCard({ agent, tasks, workState, retryWork, chatEnabled, actions, presentation }: {
  agent: Agent;
  tasks: Issue[];
  workState: "loading" | "error" | "ready";
  retryWork: () => void;
  chatEnabled: boolean;
  actions?: ReactNode;
  presentation: TeamCardPresentation;
}) {
  const work = selectTeamWork(tasks, agent.id);
  const url = agentUrl(agent);
  const role = agent.title?.trim() || roleLabels[agent.role] || agent.role;
  const subtitle = [role, presentation.showLabels && normalize(presentation.groupLabel) !== normalize(role) ? presentation.groupLabel : null]
    .filter(Boolean).join(" · ");
  const depthLabel = `Reporting level ${presentation.level}${presentation.managerName ? `, reports to ${presentation.managerName}` : ", no manager"}`;

  const identity = (
    <div className="flex min-w-0 items-center gap-3">
      <AgentAvatar agent={agent} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={url} className="min-w-0 truncate text-sm font-semibold text-foreground hover:underline" title={agent.name}>
            {agent.name}
          </Link>
          {presentation.showLabels ? (
            <span className="flex shrink-0 items-center gap-0.5" role="img" aria-label={depthLabel} title={depthLabel}>
              {Array.from({ length: presentation.level }, (_, index) => (
                <span key={index} className="size-1.5 rounded-full" style={{ backgroundColor: presentation.groupColor }} />
              ))}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={subtitle}>{subtitle}</p>
      </div>
    </div>
  );

  return (
    <div className="relative flex flex-col gap-3 py-4 pr-4 pl-5">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: presentation.groupColor }} />
      {presentation.header(identity)}

      <div className="flex min-h-6 items-center justify-between gap-2">
        <AgentAttentionBadge agent={agent} />
        <span className="truncate font-mono text-xs text-muted-foreground" title="Last heartbeat">
          {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "No runs yet"}
        </span>
      </div>

      <section className="flex flex-col gap-1.5" aria-label={`Assigned work for ${agent.name}`}>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Assigned work</span>
          {workState === "ready" ? <span className="font-mono">{work.length} open</span> : null}
        </div>
        {workState === "error" ? (
          <p className="text-xs text-muted-foreground">
            Couldn’t load assigned work.{" "}
            <button type="button" className="underline hover:text-foreground" onClick={retryWork}>Try again</button>
          </p>
        ) : workState === "loading" ? (
          <p className="text-xs text-muted-foreground" role="status">Loading assigned work…</p>
        ) : work.length === 0 ? (
          <p className="text-xs text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {work.slice(0, WORK_SHOWN).map((task) => (
              <li key={task.id}>
                <Link to={issueUrl(task)} className="group flex min-w-0 items-center gap-2 text-sm" title={task.title}>
                  <StatusIcon status={task.status} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.identifier ?? "Task"}</span>
                  <span className="min-w-0 truncate group-hover:underline">{task.title}</span>
                </Link>
              </li>
            ))}
            {work.length > WORK_SHOWN ? (
              <li className="text-xs text-muted-foreground">+{work.length - WORK_SHOWN} more</li>
            ) : null}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {chatEnabled ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/chats/${agentRouteRef(agent)}`} aria-label={`Chat with ${agent.name}`}>
              <MessageCircle />
              Chat
            </Link>
          </Button>
        ) : <span />}
        {actions}
      </div>
      {presentation.reportsToggle}
    </div>
  );
}
