import { useMutation } from "@tanstack/react-query";
import { Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { usePpclipFeature } from "@/ppclip/features/store";
import { liveAgentHref } from "../live/anchors";
import { computerUseApi } from "./api";
import { AgentComputerControls, SupervisorStatus } from "./ComputerUseSettingsSection";
import { isLiveState, STATE_LABELS, useComputerUse, useInvalidateComputerUse } from "./useComputerUse";

/** Adapters that receive the computer tools (they take per-run MCP servers). */
export const COMPUTER_USE_ADAPTERS = ["claude_local", "codex_local"] as const;


/**
 * ppclip computer use: a "Computer use" card on the agent's Configuration tab,
 * so the computer can be turned on where the agent is configured. Hidden when
 * the computerUse module is off (Settings → ppclip).
 */
export function AgentComputerUseCard(props: { agent: { id: string; name: string; adapterType: string }; companyId: string }) {
  return usePpclipFeature("computerUse") ? <AgentComputerUseCardContent {...props} /> : null;
}

function AgentComputerUseCardContent({ agent, companyId }: { agent: { id: string; name: string; adapterType: string }; companyId: string }) {
  const supported = (COMPUTER_USE_ADAPTERS as readonly string[]).includes(agent.adapterType);
  const overview = useComputerUse(supported ? companyId : null);
  const invalidate = useInvalidateComputerUse(companyId);
  const turnOn = useMutation({
    mutationFn: () => computerUseApi.setEnabled(companyId, true),
    onSettled: invalidate,
  });
  const computer = overview.data?.agents.find((row) => row.agentId === agent.id);

  return (
    <div data-testid="agent-computer-use-card">
      <h3 className="mb-3 text-sm font-medium">Computer use</h3>
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground">
          A sandboxed Linux desktop with a browser for this agent. You can watch it live, take control to sign in, and hand it back.
        </p>
        {!supported ? (
          <p className="text-sm text-muted-foreground" data-testid="computer-unsupported">Available for Claude Code and Codex agents only.</p>
        ) : overview.isError ? (
          <p className="text-sm text-destructive" role="alert">{overview.error instanceof Error ? overview.error.message : "Couldn't load computer use."}</p>
        ) : !overview.data ? (
          <p className="text-sm text-muted-foreground" role="status">Loading…</p>
        ) : !overview.data.enabled ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-foreground">Computer use is off for this company.</p>
            <Button type="button" size="sm" disabled={turnOn.isPending} onClick={() => turnOn.mutate()} data-testid="computer-turn-on">
              <Monitor aria-hidden />
              {turnOn.isPending ? "Turning on…" : "Turn on computer use"}
            </Button>
            {turnOn.isError ? (
              <p className="text-xs text-destructive" role="alert">{turnOn.error instanceof Error ? turnOn.error.message : "Couldn't turn it on."}</p>
            ) : null}
          </div>
        ) : (
          <>
            <SupervisorStatus supervisor={overview.data.supervisor} />
            {computer ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Computer</span>
                  <Badge variant={computer.state === "waiting_for_human" ? "destructive" : "outline"} data-testid="agent-computer-state">
                    {STATE_LABELS[computer.state]}
                  </Badge>
                  {computer.enabled ? (
                    <Button asChild size="sm" variant="outline" className="ml-auto">
                      <Link to={liveAgentHref(agent.id)} data-testid="computer-watch-live">
                        <Monitor aria-hidden />
                        {isLiveState(computer.state) ? "Watch live" : "Open on Live runs"}
                      </Link>
                    </Button>
                  ) : null}
                </div>
                {computer.state === "waiting_for_human" && computer.request ? (
                  <p className="text-sm text-foreground">{agent.name} asked for you: <span className="text-muted-foreground">{computer.request.reason}</span></p>
                ) : null}
                <AgentComputerControls companyId={companyId} computer={computer} showName={false} as="div" />
                {computer.enabled ? (
                  <p className="text-xs text-muted-foreground">
                    Next: open Live runs and press Start computer, then ask {agent.name} in plain words, for example "open example.com with your computer and tell me the page title".
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">This agent isn't listed yet. Refresh in a moment.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
