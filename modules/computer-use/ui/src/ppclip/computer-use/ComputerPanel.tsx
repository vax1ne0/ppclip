import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Expand, Hand, LoaderCircle, LockKeyhole, Maximize2, Monitor, MoreHorizontal, Pause, Play, Power, RefreshCw, ShieldOff, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Keep frequent actions visible without turning a narrow chat into a button grid. */
function ChatControls({ computer, busy, pending, run }: { computer: AgentComputer; busy: boolean; pending?: ComputerAction; run: (action: ComputerAction) => void }) {
  const actions = availableActions(computer);
  const primary = actions.find(action => ["take-control", "release", "start", "resume", "restore"].includes(action));
  const inline = actions.filter(action => action === primary || action === "pause" || (computer.state === "paused" && action === "take-control") || (computer.state === "starting" && action === "stop"));
  const more = actions.filter(action => !inline.includes(action));
  return <div className="flex items-center gap-1.5" role="group" aria-label="Computer controls">
    {inline.map(action => {
      const Icon = ACTION_ICONS[action];
      return <Button key={action} type="button" size="sm" variant={action === primary ? "default" : "outline"} className="h-8 gap-1.5 px-2.5 text-xs" disabled={busy} onClick={() => run(action)}>
        {busy && pending === action ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}{ACTION_LABELS[action]}
      </Button>;
    })}
    {more.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" className="size-8 p-0" aria-label="More computer actions" disabled={busy}>{busy && pending && more.includes(pending) ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden /> : <MoreHorizontal className="size-4" aria-hidden />}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {more.map(action => {
          const Icon = ACTION_ICONS[action];
          return <Fragment key={action}>
            {action === "revoke" && more.length > 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem variant={action === "revoke" ? "destructive" : "default"} disabled={busy} onSelect={() => run(action)}>
              <Icon className="size-4" aria-hidden /><span>{ACTION_LABELS[action]}</span>
            </DropdownMenuItem>
          </Fragment>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>;
}

function ChatPlaceholder({ icon: Icon, title, detail, children, spinning = false }: { icon: typeof Monitor; title: string; detail: string; children?: ReactNode; spinning?: boolean }) {
  return <div className="flex min-h-44 flex-col items-center justify-center px-5 py-6 text-center">
    <span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-muted/25"><Icon className={`size-5 text-muted-foreground ${spinning ? "motion-safe:animate-spin" : ""}`} strokeWidth={1.5} aria-hidden /></span>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    {children}
  </div>;
}

function syncViewerTheme(frame: HTMLIFrameElement | null, compact = false) {
  const style = getComputedStyle(document.documentElement);
  const tokens = Object.fromEntries(["background", "foreground", "border", "accent", "ring", "status-task-done", "status-task-todo", "destructive"]
    .map(token => [token, style.getPropertyValue(`--${token}`).trim()]).filter(([, value]) => value));
  frame?.contentWindow?.postMessage({ type: "ppclip:computer-view-theme", tokens, compact }, "*");
}

function stateVariant(state: AgentComputer["state"]): "default" | "secondary" | "destructive" | "outline" {
  if (state === "waiting_for_human" || state === "revoked") return "destructive";
  if (state === "agent") return "default";
  if (state === "human" || state === "human_private") return "secondary";
  return "outline";
}

/** The live desktop, embedded through Paperclip's ticketed proxy in a sandboxed frame. */
function LiveView({ companyId, computer, agentName, compact = false }: { companyId: string; computer: AgentComputer; agentName: string; compact?: boolean }) {
  const frameBox = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Tickets are process-local capabilities, not reusable query data. Never
  // mount a previously cached URL after navigation or a server restart.
  const instanceId = useId();
  const reconnects = useRef<number[]>([]);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const humanState = computer.state === "human" || computer.state === "human_private";
  const viewer = useQuery({
    // A new ticket whenever control changes; the old one stops working at the server anyway.
    queryKey: ["ppclip", "computer-use", "viewer", companyId, computer.agentId, instanceId, computer.state, computer.lease?.grantedAt ?? null],
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
    staleTime: 60_000,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    retry: 1,
  });
  useEffect(() => {
    reconnects.current = [];
    setConnectionFailed(false);
  }, [computer.state, computer.lease?.grantedAt]);
  const refetch = viewer.refetch;
  useEffect(() => {
    const observer = new MutationObserver(() => syncViewerTheme(frame.current, compact));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => observer.disconnect();
  }, [viewer.data?.src, compact]);
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !viewer.data
        || event.data?.type !== "ppclip:computer-view-disconnected"
        || event.data?.src !== viewer.data.src) return;
      const recent = reconnects.current.filter(at => Date.now() - at < 60_000);
      if (recent.length >= 3) { setConnectionFailed(true); return; }
      reconnects.current = [...recent, Date.now()];
      void refetch();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [viewer.data, refetch]);
  function reconnect() {
    reconnects.current = [];
    setConnectionFailed(false);
    void refetch();
  }
  if ((viewer.isError || connectionFailed) && compact) return <div role="alert"><ChatPlaceholder icon={Monitor} title="Live screen unavailable" detail="Reconnect to try again. Control hasn’t changed."><Button type="button" size="sm" variant="outline" className="mt-3 h-8 gap-1.5 text-xs" onClick={reconnect}><RefreshCw className="size-3.5" aria-hidden />Reconnect live view</Button></ChatPlaceholder></div>;
  if (viewer.isError || connectionFailed) return <div className="space-y-2" role="alert">
    <p className="text-sm text-muted-foreground">The live view could not connect. The computer’s state has not changed.</p>
    <Button type="button" size="sm" variant="outline" onClick={reconnect}><RefreshCw aria-hidden />Reconnect live view</Button>
  </div>;
  if (!viewer.data && compact) return <div role="status"><ChatPlaceholder icon={LoaderCircle} title="Connecting…" detail="Opening the live screen." spinning /></div>;
  if (!viewer.data) return <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />Connecting to the live view…</div>;
  const driving = viewer.data.mode === "control";
  return (
    <div className={compact ? "group/screen relative flex min-w-0 flex-col" : "flex flex-col gap-2"}>
      <div ref={frameBox} className="flex items-center justify-center bg-background">
      <iframe
        ref={frame}
        key={viewer.data.src}
        src={viewer.data.src}
        onLoad={() => syncViewerTheme(frame.current, compact)}
        title={`${agentName}'s computer${driving ? " (you are in control)" : " (view only)"}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write"
        className={compact ? "block aspect-[8/5] max-h-[42vh] min-h-40 w-full border-0 bg-muted/20" : "aspect-video w-full rounded-lg border border-border bg-muted"}
        data-testid="computer-live-view"
      />
      </div>
      {compact ? <div className="absolute right-2 bottom-2 flex items-center gap-1 rounded-lg border border-border bg-background/95 p-0.5 shadow-sm" aria-label="Screen tools">
        {!driving && humanState && <span className="px-2 text-[11px] text-muted-foreground" role="status">View only</span>}
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip><TooltipTrigger asChild><Button type="button" size="sm" variant="ghost" className="size-8 p-0" onClick={reconnect} disabled={viewer.isFetching}><RefreshCw className={`size-3.5 ${viewer.isFetching ? "motion-safe:animate-spin" : ""}`} aria-hidden /><span className="sr-only">Reconnect</span></Button></TooltipTrigger><TooltipContent>Reconnect live view</TooltipContent></Tooltip>
          {typeof document !== "undefined" && document.fullscreenEnabled && <Tooltip><TooltipTrigger asChild><Button type="button" size="sm" variant="ghost" className="size-8 p-0" onClick={() => void frameBox.current?.requestFullscreen?.()} data-testid="computer-fullscreen"><Maximize2 className="size-3.5" aria-hidden /><span className="sr-only">Full screen</span></Button></TooltipTrigger><TooltipContent>Full screen</TooltipContent></Tooltip>}
        </div>
      </div> : <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={reconnect} disabled={viewer.isFetching}><RefreshCw aria-hidden className={viewer.isFetching ? "motion-safe:animate-spin" : undefined} />Reconnect</Button>
        <p className="text-xs text-muted-foreground">
          {driving ? "You’re in control · Agent paused" : "View only"}
        </p>
        {typeof document !== "undefined" && document.fullscreenEnabled ? (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => void frameBox.current?.requestFullscreen?.()} data-testid="computer-fullscreen">
            <Maximize2 aria-hidden />
            Full screen
          </Button>
        ) : null}
      </div>}
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

function ComputerPanelContent({ companyId, computer, agentName, liveView, variant = "card", bigScreenHref, chatHeader }: {
  companyId: string;
  computer: AgentComputer;
  agentName: string;
  liveView: boolean;
  /** "page": the agent's big-screen computer page (no card border, larger heading). */
  variant?: "card" | "page" | "chat";
  /** Shown as a "Big screen" link on cards. */
  bigScreenHref?: string;
  /** Compose chat identity and controls into one header, without duplicating mutation state. */
  chatHeader?: (controls: ReactNode) => ReactNode;
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
  const chat = variant === "chat";
  if (chat) {
    const stopped = computer.state === "stopped" || computer.state === "off";
    const chatControls = !stopped ? <ChatControls computer={computer} busy={mutation.isPending} pending={mutation.variables} run={run} /> : null;
    return <section ref={ref} className="flex min-w-0 flex-col" aria-label={`${agentName}'s computer`} data-testid="computer-panel" data-variant="chat">
      {chatHeader ? chatHeader(chatControls) : chatControls && <div className="flex justify-end px-3 py-2">{chatControls}</div>}
      {computer.state === "waiting_for_human" && computer.request && <div className="flex items-start gap-2 border-b border-border bg-muted/20 px-3 py-2 text-xs" data-testid="computer-request"><Hand className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden /><p className="min-w-0 break-words leading-relaxed"><span className="font-medium">{agentName} asked for help: </span>{computer.request.reason}</p></div>}
      {stopped ? <ChatPlaceholder icon={mutation.isPending ? LoaderCircle : Monitor} title={mutation.isPending ? "Starting computer…" : "Computer is stopped"} detail={mutation.isPending ? "Preparing your desktop." : "Open the desktop and browser here."} spinning={mutation.isPending}>
        <Button type="button" size="sm" className="mt-4 h-8 gap-1.5 text-xs" disabled={mutation.isPending} onClick={() => run("start")}>{mutation.isPending ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <Power className="size-3.5" aria-hidden />}{mutation.isPending ? "Starting…" : "Start computer"}</Button>
      </ChatPlaceholder> : computer.state === "starting" ? <div role="status"><ChatPlaceholder icon={LoaderCircle} title="Starting computer…" detail="Your live screen will appear here." spinning /></div>
        : computer.state === "paused" ? <div role="status"><ChatPlaceholder icon={Pause} title="Computer paused" detail="Resume the agent or take control yourself." /></div>
        : computer.state === "revoked" ? <ChatPlaceholder icon={ShieldOff} title="Access revoked" detail="Restore access to use this computer again." />
        : live && !liveView ? <ChatPlaceholder icon={Monitor} title="Live screen unavailable" detail="This provider doesn’t support a live view." />
        : live && seen ? <LiveView compact companyId={companyId} computer={computer} agentName={agentName} /> : null}
      {error && <p className="border-t border-border px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">{error}</p>}
    </section>;
  }
  const controls = <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Computer controls">
    {availableActions(computer).map((action) => {
      const Icon = ACTION_ICONS[action];
      const pending = mutation.isPending && mutation.variables === action;
      return <Button key={action} type="button" size="sm"
        variant={action === "revoke" ? "ghost" : ["take-control", "release", "start", "resume"].includes(action) ? "default" : "outline"}
        className={action === "revoke" ? "text-destructive" : undefined}
        disabled={mutation.isPending} onClick={() => run(action)}>
        {pending ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden /> : <Icon aria-hidden />}
        <span>{ACTION_LABELS[action]}</span>
      </Button>;
    })}
  </div>;
  if (variant === "page" && (computer.state === "stopped" || computer.state === "off")) return (
    <section ref={ref} aria-label={`${agentName}'s computer`} data-testid="computer-panel" data-variant={variant}
      className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Monitor className="size-4" aria-hidden />Desktop</span>
        <Badge variant="outline" data-testid="computer-state">{STATE_LABELS[computer.state]}</Badge>
      </div>
      <div className="flex min-h-80 flex-col items-center justify-center px-6 py-12 text-center sm:min-h-96">
        <Monitor aria-hidden strokeWidth={1.25} className="mb-5 size-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold tracking-tight">Computer is stopped</h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Start {agentName}’s computer to open the desktop and browser here.</p>
        <Button type="button" className="mt-6" disabled={mutation.isPending} onClick={() => run("start")}>
          {mutation.isPending ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : <Power aria-hidden />}
          {mutation.isPending ? "Starting…" : "Start computer"}
        </Button>
        {mutation.isPending && <p role="status" className="mt-3 text-xs text-muted-foreground">Preparing the desktop. The live screen will open when it’s ready.</p>}
        {error ? <p className="mt-4 max-w-md text-sm text-destructive" role="alert">{error}</p> : null}
      </div>
    </section>
  );
  return (
    <section
      ref={ref}
      className={variant === "page" ? "flex min-w-0 flex-col gap-4" : "flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4"}
      aria-label={`${agentName}'s computer`}
      data-testid="computer-panel"
      data-variant={variant}
    >
      <div className="flex flex-wrap items-center gap-2">
        {variant === "card" && <><Monitor className="size-4 text-muted-foreground" aria-hidden /><span className="text-sm font-medium text-foreground">Computer</span></>}
        <Badge variant={stateVariant(computer.state)} className={variant === "card" ? "ml-auto" : undefined} data-testid="computer-state">{STATE_LABELS[computer.state]}</Badge>
        {variant === "page" && computer.lease && (computer.state === "human" || computer.state === "human_private") && (
          <span className="text-xs tabular-nums text-muted-foreground" title="Control expires and the computer pauses unless you release it sooner.">Pauses at {new Date(computer.lease.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        )}
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
      {variant !== "page" && computer.lease && (computer.state === "human" || computer.state === "human_private") ? (
        <p className="text-xs tabular-nums text-muted-foreground" title="Control expires and the computer pauses unless you release it sooner.">
          Pauses at {new Date(computer.lease.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </p>
      ) : null}
      {variant === "page" && computer.state === "starting" ? (
        <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-border px-6 py-12 text-center sm:min-h-96" role="status">
          <LoaderCircle aria-hidden className="size-6 text-muted-foreground motion-safe:animate-spin" />
          <h3 className="text-lg font-semibold">Starting computer…</h3>
          <p className="max-w-sm text-sm text-muted-foreground">The live screen will appear when the desktop is ready.</p>
        </div>
      ) : computer.state === "paused" ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-8 text-center" role="status">
          <Pause className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Computer paused</p>
          <p className="text-xs text-muted-foreground">Resume to let the agent continue, or take control to use the computer yourself.</p>
        </div>
      ) : live && liveView && seen && computer.state !== "starting" ? <LiveView companyId={companyId} computer={computer} agentName={agentName} /> : null}
      {live && !liveView ? <p className="text-sm text-muted-foreground">This provider has no live view.</p> : null}
      {controls}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </section>
  );
}
