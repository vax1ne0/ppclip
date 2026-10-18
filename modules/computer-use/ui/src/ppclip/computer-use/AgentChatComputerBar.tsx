import { useId, useState } from "react";
import { ChevronDown, ChevronUp, Expand, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="sticky top-0 z-20 mb-3 flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background" data-testid="chat-computer-bar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate text-sm font-medium">{agent.name}'s computer</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${computer.state === "agent" ? "bg-emerald-500" : computer.state === "human" || computer.state === "human_private" ? "bg-blue-500" : computer.state === "waiting_for_human" || computer.state === "paused" ? "bg-amber-500" : computer.state === "revoked" ? "bg-destructive" : "bg-muted-foreground/60"}`} />
            {computer.state === "off" ? "Not started" : STATE_LABELS[computer.state]}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs" onClick={toggle} aria-expanded={open} aria-controls={open ? screenId : undefined} data-testid="chat-computer-toggle">
            {open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            <span>{open ? "Hide screen" : "Show screen"}</span>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs">
            <Link to={agentComputerHref(agent)} data-testid="chat-computer-big-screen">
              <Expand className="size-3.5" aria-hidden />
              <span>Big screen</span>
            </Link>
          </Button>
        </div>
      </div>
      {open ? <div id={screenId} className="max-h-[58vh] overflow-y-auto border-t border-border"><ComputerPanel variant="chat" companyId={selectedCompanyId} computer={computer} agentName={agent.name} liveView={liveView} /></div> : null}
    </div>
  );
}
