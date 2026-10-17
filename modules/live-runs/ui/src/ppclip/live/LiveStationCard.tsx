import { memo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Square, ExternalLink } from "lucide-react";
import { AGENT_ROLE_LABELS, characterStateForAgent, type CharacterState, type Issue } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";
import { getAdapterLabel } from "@/adapters/adapter-display-registry";
import { heartbeatsApi } from "@/api/heartbeats";
import { AgentAvatar } from "@/components/AgentAvatar";
import { MarkdownBody } from "@/components/MarkdownBody";
import { AgentStatusBadge, AgentStatusCapsule } from "@/components/StatusBadge";
import { StatusGlyph } from "@/components/StatusGlyph";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { agentRouteRef, agentUrl, cn, formatDurationMs, issueUrl, relativeTime } from "@/lib/utils";
import { AttentionStatusChip } from "../attention/AgentAttentionBadge";
import { poseForActivity, resolveLiveActivity } from "./live-activity";
import { replyExcerpt, savedReply } from "./saved-reply";
import type { Station } from "./station-order";
import { useSeen } from "./use-seen";
import type { AgentComputer } from "../computer-use/api";
import { ComputerPanel } from "../computer-use/ComputerPanel";
import { ComputerStateChip } from "../computer-use/ComputerStateChip";
import { liveAgentAnchor } from "./anchors";
import { agentComputerHref } from "../computer-use/links";
import { configuredModel } from "../agent-model";
import { useSecondTick } from "@/hooks/useSecondTick";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

function Elapsed({ since }: { since: string }) {
  useSecondTick(true); // official's shared 1 s ticker instead of a timer per card
  return <time dateTime={since}>{formatDurationMs(Date.now() - Date.parse(since))}</time>;
}

function TaskLine({ station, issue }: { station: Station; issue?: Issue }) {
  const run = station.run;
  if (!run?.issueId) {
    return (
      <p className="truncate text-sm text-muted-foreground">
        {!run ? "No recent runs" : run.invocationSource === "timer" ? "Scheduled heartbeat" : "Direct conversation"}
      </p>
    );
  }
  const status = issue?.status === "in_review" && issue.externalConversationState === "waiting" ? "idle" : issue?.status ?? "backlog";
  return (
    <Link
      to={issue ? issueUrl(issue) : `/issues/${run.issueId}`}
      className="group flex min-w-0 items-center gap-2 rounded-md text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={issue ? `${issue.identifier ?? ""} ${issue.title}`.trim() : undefined}
      data-testid="station-task"
    >
      <StatusGlyph status={status} size="md" className="shrink-0" />
      {issue?.identifier ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{issue.identifier}</span> : null}
      <span className="min-w-0 truncate group-hover:underline">{issue?.title ?? "Loading task…"}</span>
    </Link>
  );
}

function SavedReply({ runId }: { runId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const [expanded, setExpanded] = useState(false);
  // Finished runs do not change: fetch once, only after the card scrolls into view.
  const detail = useQuery({
    queryKey: queryKeys.runDetail(runId),
    queryFn: () => heartbeatsApi.get(runId),
    enabled: seen,
    staleTime: Infinity,
    retry: false,
  });
  const reply = savedReply(detail.data?.resultJson);
  const excerpt = reply ? replyExcerpt(reply) : null;

  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/40 p-4" data-testid="station-reply">
      <span className="text-xs font-medium text-muted-foreground">Last response</span>
      {detail.isError ? (
        <p className="text-sm text-muted-foreground">Couldn’t load the last response.</p>
      ) : !detail.data ? (
        <p className="text-sm text-muted-foreground" role="status">Loading last response…</p>
      ) : !reply || !excerpt ? (
        <p className="text-sm text-muted-foreground">No saved response for this run.</p>
      ) : (
        <>
          <MarkdownBody className="min-w-0 text-sm text-foreground">{expanded ? reply : excerpt.text}</MarkdownBody>
          {excerpt.truncated ? (
            <button
              type="button"
              className="self-start text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Read full response"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function StopRunButton({ runId, agentName, companyId }: { runId: string; agentName: string; companyId: string }) {
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => heartbeatsApi.cancel(runId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) }),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-muted-foreground hover:text-destructive"
      disabled={stop.isPending}
      aria-label={`Stop ${agentName}'s run`}
      onClick={() => stop.mutate()}
    >
      <Square className="size-3" fill="currentColor" aria-hidden />
      {stop.isPending ? "Stopping…" : "Stop"}
    </Button>
  );
}

const PHASE_STATUS: Record<Station["phase"], string | null> = {
  running: "running",
  queued: "queued",
  attention: null,
  trouble: null,
  idle: null,
};

const PHASE_WORDS: Record<Station["phase"], string> = {
  running: "working",
  queued: "queued",
  attention: "waiting",
  trouble: "needs a look",
  idle: "idle",
};

function stationPose(station: Station, activityKind: Parameters<typeof poseForActivity>[0] | null): CharacterState {
  if (station.phase === "running" && activityKind) return poseForActivity(activityKind);
  if (station.phase === "queued") return "loading";
  if (station.attentionStatus === "waiting_for_you") return "listening";
  if (station.phase === "trouble" && station.run && ["failed", "timed_out"].includes(station.run.status)) return "confused";
  return characterStateForAgent(station.agent.status);
}

/**
 * ppclip DASH-2: one big "agent station" on the Live page. The avatar is the
 * agent's presence: its official pose follows what it is doing and a soft
 * halo breathes while it works (motion-safe only, so reduced motion keeps it
 * still). Built from official components and tokens.
 */
export const LiveStationCard = memo(function LiveStationCard({
  station,
  issue,
  transcript,
  companyId,
  chatEnabled,
  computer,
  computerLiveView = false,
}: {
  station: Station;
  issue?: Issue;
  transcript: readonly TranscriptEntry[];
  companyId: string;
  chatEnabled: boolean;
  /** ppclip computer use: present only when the feature and this agent's computer are on. */
  computer?: AgentComputer;
  computerLiveView?: boolean;
}) {
  const { agent, run, phase, attentionStatus } = station;
  const live = phase === "running";
  const activity = live && run ? resolveLiveActivity(transcript, run) : null;
  const pose = stationPose(station, activity?.kind ?? null);
  const role = agent.title?.trim() || roleLabels[agent.role] || agent.role;
  const model = configuredModel(agent.adapterConfig);
  const provider = getAdapterLabel(agent.adapterType);
  const runUrl = run ? `/agents/${run.agentId}/runs/${run.id}` : null;
  const finished = run && !["running", "queued"].includes(run.status);
  const statusForBadge = PHASE_STATUS[phase] ?? (run && ["failed", "timed_out"].includes(run.status) && agent.status === "idle" ? "error" : agent.status);

  return (
    <article
      id={liveAgentAnchor(agent.id)}
      aria-label={`${agent.name}, ${activity?.label ?? PHASE_WORDS[phase]}${computer?.state === "waiting_for_human" ? ", needs you at its computer" : ""}`}
      data-phase={phase}
      data-agent-id={agent.id}
      className={cn(
        "flex min-w-0 scroll-mt-6 flex-col gap-5 rounded-xl border p-6 transition-colors",
        live
          ? "border-(--dashboard-run-border) bg-(--dashboard-run-background) shadow-(--shadow-extract-1)"
          : "border-border bg-card",
      )}
    >
      <header className="flex min-w-0 items-center gap-5">
        <div className="relative shrink-0">
          {live ? (
            <span
              aria-hidden
              data-presence="live"
              className="absolute -inset-2 rounded-full bg-(--dashboard-run-border) motion-safe:animate-pulse"
            />
          ) : null}
          <AgentAvatar agent={agent} size={96} pose={pose} name={agent.name} className="relative" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Link to={agentUrl(agent)} className="truncate text-lg font-semibold text-foreground hover:underline" title={agent.name}>
            {agent.name}
          </Link>
          <p className="truncate text-sm text-muted-foreground" title={role}>{role}</p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={`Provider: ${provider} · Model: ${model ?? "provider default"}`}>
            {provider} · {model ?? "Provider default model"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {attentionStatus && phase !== "running" && phase !== "queued"
              ? <AttentionStatusChip status={attentionStatus} />
              : <AgentStatusBadge status={statusForBadge} />}
            {computer ? <ComputerStateChip computer={computer} /> : null}
          </div>
        </div>
      </header>

      <section className="flex min-w-0 flex-col gap-3" aria-label={`${agent.name}'s current work`}>
        {activity && run ? (
          <div className="flex items-center gap-2.5" data-testid="station-activity">
            <AgentStatusCapsule status="running" />
            <span className="text-base font-medium text-foreground">{activity.label}</span>
            {run.startedAt ? (
              <span className="ml-auto font-mono text-xs text-muted-foreground" title="Elapsed">
                <Elapsed since={run.startedAt} />
              </span>
            ) : null}
          </div>
        ) : phase === "queued" && run ? (
          <p className="text-base font-medium text-muted-foreground" data-testid="station-activity">
            Queued · {relativeTime(run.createdAt)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {run ? `Last active ${relativeTime(run.finishedAt ?? run.startedAt ?? run.createdAt)}` : agent.lastHeartbeatAt ? `Last heartbeat ${relativeTime(agent.lastHeartbeatAt)}` : "Not run yet"}
          </p>
        )}
        <TaskLine station={station} issue={issue} />
        {finished && run ? <SavedReply runId={run.id} /> : null}
      </section>

      {computer ? <ComputerPanel companyId={companyId} computer={computer} agentName={agent.name} liveView={computerLiveView} bigScreenHref={agentComputerHref(agent)} /> : null}

      <footer className="mt-auto flex flex-wrap items-center gap-2">
        {runUrl ? (
          <Button asChild size="sm" variant="outline">
            <Link to={runUrl} aria-label={`Open run details for ${agent.name}`}>
              <ExternalLink />
              Run details
            </Link>
          </Button>
        ) : null}
        {chatEnabled ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/chats/${agentRouteRef(agent)}`} aria-label={`Chat with ${agent.name}`}>
              <MessageCircle />
              Chat
            </Link>
          </Button>
        ) : null}
        {run && (run.status === "running" || run.status === "queued") ? (
          <span className="ml-auto">
            <StopRunButton runId={run.id} agentName={agent.name} companyId={companyId} />
          </span>
        ) : null}
      </footer>
    </article>
  );
});
