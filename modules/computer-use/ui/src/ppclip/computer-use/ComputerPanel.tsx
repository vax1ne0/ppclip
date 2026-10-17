import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Expand, Hand, LockKeyhole, Maximize2, Monitor, Pause, Play, Power, ShieldOff, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useSeen } from "../live/use-seen";
import { computerUseApi, type AgentComputer, type ComputerAction } from "./api";
import { availableActions, isLiveState, STATE_LABELS, useInvalidateComputerUse } from "./useComputerUse";
import { usePpclipFeature } from "@/ppclip/features/store";

const ACTION_LABELS: Record<ComputerAction, string> = {
  start: "Start computer",
  stop: "Stop",
  "take-control": "Take control",
  "take-control-private": "Take control privately",
  release: "Release to agent",
  pause: "Pause",
  resume: "Resume",
  revoke: "Revoke access",
  restore: "Restore access",
};

const ACTION_ICONS: Record<ComputerAction, typeof Hand> = {
  start: Power,
  stop: Power,
  "take-control": Hand,
  "take-control-private": LockKeyhole,
  release: Undo2,
  pause: Pause,
  resume: Play,
  revoke: ShieldOff,
  restore: Undo2,
};

const CONFIRM: Partial<Record<ComputerAction, string>> = {
  stop: "Stop this computer? The browser profile is kept, so logins survive.",
  revoke: "Revoke access? The stream closes, the computer stops and the agent's computer tools are refused until you restore access.",
  "take-control-private": "Take control privately? The agent cannot see the screen until you release it. Use this to type passwords or codes.",
};

const VIEW_REFRESH_MS = 8 * 60_000;

function stateVariant(state: AgentComputer["state"]): "default" | "secondary" | "destructive" | "outline" {
  if (state === "waiting_for_human" || state === "revoked") return "destructive";
  if (state === "agent") return "default";
  if (state === "human" || state === "human_private") return "secondary";
  return "outline";
}

/** The live desktop, embedded through Paperclip's ticketed proxy in a sandboxed frame. */
function LiveView({ companyId, computer, agentName }: { companyId: string; computer: AgentComputer; agentName: string }) {
  const frameBox = useRef<HTMLDivElement>(null);
  const humanState = computer.state === "human" || computer.state === "human_private";
  const viewer = useQuery({
    // A new ticket whenever control changes; the old one stops working at the server anyway.
    queryKey: ["ppclip", "computer-use", "viewer", computer.agentId, computer.state, computer.lease?.grantedAt ?? null],
    queryFn: async () => {
      if (humanState) {
        try {
          return await computerUseApi.viewer(companyId, computer.agentId, "control");
        } catch {
          // Someone else holds control: watch instead.
        }
      }
      return computerUseApi.viewer(companyId, computer.agentId, "view");
    },
    refetchInterval: VIEW_REFRESH_MS,
    staleTime: VIEW_REFRESH_MS,
    retry: 1,
  });
  if (viewer.isError) return <p className="text-sm text-muted-foreground">The live view is not available right now.</p>;
  if (!viewer.data) return <p className="text-sm text-muted-foreground" role="status">Connecting to the live view…</p>;
  const driving = viewer.data.mode === "control";
  return (
    <div className="flex flex-col gap-2">
      <div ref={frameBox} className="flex items-center justify-center bg-background">
      <iframe
        key={viewer.data.src}
        src={viewer.data.src}
        title={`${agentName}'s computer${driving ? " (you are in control)" : " (view only)"}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write"
        className="aspect-video w-full rounded-lg border border-border bg-muted"
        data-testid="computer-live-view"
      />
      </div>
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {driving ? "You are in control. Click inside the screen to type. The agent is paused until you release." : "View only."}
        </p>
        {typeof document !== "undefined" && document.fullscreenEnabled ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => void frameBox.current?.requestFullscreen?.()} data-testid="computer-fullscreen">
            <Maximize2 aria-hidden />
            Full screen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ppclip computer use: the agent's sandboxed desktop on its Live card, with the
 * takeover controls. Every action goes through the board API and is audited.
 */
/** ppclip module switch (Settings → ppclip): computerUse. */
export function ComputerPanel(props: Parameters<typeof ComputerPanelContent>[0]) {
  return usePpclipFeature("computerUse") ? <ComputerPanelContent {...props} /> : null;
}

function ComputerPanelContent({ companyId, computer, agentName, liveView, variant = "card", bigScreenHref }: {
  companyId: string;
  computer: AgentComputer;
  agentName: string;
  liveView: boolean;
  /** "page": the agent's big-screen computer page (no card border, larger heading). */
  variant?: "card" | "page";
  /** Shown as a "Big screen" link on cards. */
  bigScreenHref?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const seen = useSeen(ref);
  const invalidate = useInvalidateComputerUse(companyId);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (action: ComputerAction) => computerUseApi.act(companyId, computer.agentId, action),
    onMutate: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : "That did not work."),
    onSettled: invalidate,
  });
  useEffect(() => setError(null), [computer.state]);

  function run(action: ComputerAction) {
    const question = CONFIRM[action];
    if (question && !window.confirm(question)) return;
    mutation.mutate(action);
  }

  const live = isLiveState(computer.state);
  return (
    <section
      ref={ref}
      className={variant === "page" ? "flex min-w-0 flex-col gap-4" : "flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"}
      aria-label={`${agentName}'s computer`}
      data-testid="computer-panel"
      data-variant={variant}
    >
      <div className="flex items-center gap-2">
        <Monitor className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium text-foreground">Computer</span>
        <Badge variant={stateVariant(computer.state)} className="ml-auto" data-testid="computer-state">{STATE_LABELS[computer.state]}</Badge>
        {bigScreenHref && variant === "card" ? (
          <Button asChild size="sm" variant="ghost">
            <Link to={bigScreenHref} aria-label={`Open ${agentName}'s computer on a big screen`} data-testid="computer-big-screen">
              <Expand aria-hidden />
              Big screen
            </Link>
          </Button>
        ) : null}
      </div>
      {computer.state === "waiting_for_human" && computer.request ? (
        <p className="text-sm text-foreground" data-testid="computer-request">
          {agentName} asked for you: <span className="text-muted-foreground">{computer.request.reason}</span>
        </p>
      ) : null}
      {computer.lease && (computer.state === "human" || computer.state === "human_private") ? (
        <p className="text-xs text-muted-foreground">
          Control returns to paused at {new Date(computer.lease.expiresAt).toLocaleTimeString()} unless you release it sooner.
        </p>
      ) : null}
      {live && liveView && seen && computer.state !== "starting" ? <LiveView companyId={companyId} computer={computer} agentName={agentName} /> : null}
      {live && !liveView ? <p className="text-sm text-muted-foreground">This provider has no live view.</p> : null}
      <div className="flex flex-wrap gap-2">
        {availableActions(computer).map((action) => {
          const Icon = ACTION_ICONS[action];
          return (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={action === "revoke" ? "ghost" : action === "take-control" || action === "release" || action === "start" ? "default" : "outline"}
              className={action === "revoke" ? "text-destructive" : undefined}
              disabled={mutation.isPending}
              onClick={() => run(action)}
            >
              <Icon aria-hidden />
              {ACTION_LABELS[action]}
            </Button>
          );
        })}
      </div>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
