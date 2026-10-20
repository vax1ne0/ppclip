import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Expand, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCompany } from "@/context/CompanyContext";
import { Link } from "@/lib/router";
import { usePpclipFeature } from "@/ppclip/features/store";
import { ComputerPanel } from "./ComputerPanel";
import { agentComputerHref } from "./links";
import { STATE_LABELS, useComputerUse } from "./useComputerUse";

const OPEN_KEY = "ppclip.chat-computer-open";

function readOpen(agentId: string) {
  try {
    return window.localStorage.getItem(`${OPEN_KEY}:${agentId}`) === "1";
  } catch {
    return false;
  }
}

function writeOpen(agentId: string, open: boolean) {
  try {
    window.localStorage.setItem(`${OPEN_KEY}:${agentId}`, open ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

type ChatAgent = { id: string; name: string; urlKey?: string | null; adapterType: string };

/**
 * ppclip computer use: a slim bar above an agent chat when the agent has a
 * computer. Shows its state, opens the live screen in place, or jumps to the
 * big screen. Nothing is shown otherwise.
 */
export function AgentChatComputerBar({ agent }: { agent: ChatAgent }) {
  return <ChatComputerBarContent key={agent.id} agent={agent} />;
}

function ChatComputerBarContent({ agent }: { agent: ChatAgent }) {
  const on = usePpclipFeature("computerUse");
  const { selectedCompanyId } = useCompany();
  const overview = useComputerUse(on ? selectedCompanyId : null);
  const [open, setOpen] = useState(() => readOpen(agent.id));
  const screenId = useId();
  const computer = overview.data?.enabled ? overview.data.agents.find((row) => row.agentId === agent.id && row.enabled) : undefined;
  if (!on || !computer || !selectedCompanyId || !overview.data) return null;
  const liveView = overview.data.supervisor.ok ? overview.data.supervisor.provider.liveView : false;

  function toggle() {
    const next = !open;
    setOpen(next);
    writeOpen(agent.id, next);
  }

  const status = computer.state === "human_private" ? "Private · hidden from agent" : computer.state === "off" ? "Not started" : STATE_LABELS[computer.state];
  const expiry = computer.lease ? ` · Pauses at ${new Date(computer.lease.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
  const header = (controls: ReactNode = null) => (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
            <Monitor className="size-4 text-muted-foreground" aria-hidden />
            <span aria-hidden className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background ${computer.state === "agent" ? "bg-emerald-500" : computer.state === "human" || computer.state === "human_private" ? "bg-blue-500" : computer.state === "waiting_for_human" || computer.state === "paused" ? "bg-amber-500" : computer.state === "revoked" ? "bg-destructive" : "bg-muted-foreground/60"}`} />
          </span>
          <div className="min-w-0">
            <span className="block truncate text-sm font-medium" title={`${agent.name}'s computer`}>Computer<span className="sr-only"> · {agent.name}'s computer</span></span>
            <Tooltip><TooltipTrigger asChild><span className="block truncate text-[11px] leading-4 text-muted-foreground" role="status" tabIndex={0}>{status}</span></TooltipTrigger><TooltipContent>{status}{expiry}</TooltipContent></Tooltip>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {controls}
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={toggle} aria-expanded={open} aria-controls={open ? screenId : undefined} data-testid="chat-computer-toggle">
            <span>{open ? "Hide screen" : "Show screen"}</span>
            {open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          </Button>
          <Tooltip><TooltipTrigger asChild>
            <Button asChild size="sm" variant="ghost" className="size-8 p-0">
              <Link to={agentComputerHref(agent)} aria-label={`Open ${agent.name}'s computer on a big screen`} data-testid="chat-computer-big-screen"><Expand className="size-3.5" aria-hidden /><span className="sr-only">Big screen</span></Link>
            </Button>
          </TooltipTrigger><TooltipContent>Open big screen</TooltipContent></Tooltip>
        </div>
      </div>
  );
  // Match the card to the live screen: the chat viewer is at most 42vh tall
  // and the desktop is 8:5, so wider cards only add letterbox gaps. Collapsed
  // and expanded share the width so toggling doesn't shift the layout.
  // The card floats over the chat: a zero-height, click-through sticky layer
  // takes no row of its own, so the conversation stays visible and usable on
  // both sides of the card instead of behind a full-width strip.
  return (
    <div className="pointer-events-none sticky top-0 z-20 h-0 shrink-0 overflow-visible px-2">
      <div className="pointer-events-auto relative top-2 mx-auto flex w-full max-w-[max(67.2vh,24rem)] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg" data-testid="chat-computer-bar">
        {open ? <div id={screenId} className="max-h-[58vh] overflow-y-auto overscroll-contain"><ComputerPanel variant="chat" companyId={selectedCompanyId} computer={computer} agentName={agent.name} liveView={liveView} chatHeader={header} /></div> : header()}
      </div>
    </div>
  );
}
