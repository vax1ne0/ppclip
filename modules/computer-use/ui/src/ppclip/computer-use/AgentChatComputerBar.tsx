import { useState } from "react";
import { ChevronDown, ChevronUp, Expand, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { Link } from "@/lib/router";
import { usePpclipFeature } from "@/ppclip/features/store";
import { ComputerPanel } from "./ComputerPanel";
import { ComputerStateChip } from "./ComputerStateChip";
import { agentComputerHref } from "./links";
import { isLiveState, STATE_LABELS, useComputerUse } from "./useComputerUse";

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
  const on = usePpclipFeature("computerUse");
  const { selectedCompanyId } = useCompany();
  const overview = useComputerUse(on ? selectedCompanyId : null);
  const [open, setOpen] = useState(() => readOpen(agent.id));
  const computer = overview.data?.enabled ? overview.data.agents.find((row) => row.agentId === agent.id && row.enabled) : undefined;
  if (!on || !computer || !selectedCompanyId || !overview.data) return null;
  const liveView = overview.data.supervisor.ok ? overview.data.supervisor.provider.liveView : false;

  function toggle() {
    const next = !open;
    setOpen(next);
    writeOpen(agent.id, next);
  }

  return (
    <div className="sticky top-0 z-20 mb-3 flex shrink-0 flex-col gap-2 bg-background" data-testid="chat-computer-bar">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
        <Monitor className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm text-foreground">{agent.name}'s computer</span>
        {isLiveState(computer.state) ? <ComputerStateChip computer={computer} /> : <span className="text-xs text-muted-foreground">{STATE_LABELS[computer.state]}</span>}
        <div className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={toggle} aria-expanded={open} data-testid="chat-computer-toggle">
            {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
            {open ? "Hide screen" : "Show screen"}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to={agentComputerHref(agent)} data-testid="chat-computer-big-screen">
              <Expand aria-hidden />
              Big screen
            </Link>
          </Button>
        </div>
      </div>
      {open ? <div className="max-h-[60vh] overflow-y-auto"><ComputerPanel companyId={selectedCompanyId} computer={computer} agentName={agent.name} liveView={liveView} /></div> : null}
    </div>
  );
}
