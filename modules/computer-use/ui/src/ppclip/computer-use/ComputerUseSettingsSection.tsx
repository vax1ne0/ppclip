import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ToggleField } from "@/components/agent-config-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computerUseApi, type AgentComputer, type SupervisorHealth } from "./api";
import { isLiveState, STATE_LABELS, useComputerUse, useInvalidateComputerUse } from "./useComputerUse";
import { usePpclipFeature } from "@/ppclip/features/store";

/**
 * The per-agent computer controls: give it a computer, shell, allowed sites,
 * delete the profile. Shared by Company Settings and the agent's Configuration tab.
 */
export function AgentComputerControls({ companyId, computer, showName = true, as: Tag = "li" }: {
  companyId: string;
  computer: AgentComputer;
  showName?: boolean;
  as?: "li" | "div";
}) {
  const invalidate = useInvalidateComputerUse(companyId);
  const [hosts, setHosts] = useState(computer.allowedHosts.join(", "));
  const update = useMutation({
    mutationFn: (patch: { enabled?: boolean; shell?: boolean; allowedHosts?: string[] }) => computerUseApi.updateAgent(companyId, computer.agentId, patch),
    onSettled: invalidate,
  });
  const reset = useMutation({
    mutationFn: () => computerUseApi.deleteComputer(companyId, computer.agentId, true),
    onSettled: invalidate,
  });
  const live = isLiveState(computer.state);

  function saveHosts() {
    const list = hosts.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
    if (list.join(",") !== computer.allowedHosts.join(",")) update.mutate({ allowedHosts: list });
  }

  return (
    <Tag className={showName ? "flex flex-col gap-2 rounded-md border border-border p-3" : "flex flex-col gap-2"} data-testid={`computer-agent-${computer.agentId}`}>
      {showName ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{computer.name}</span>
          <span className="ml-auto text-xs text-muted-foreground">{STATE_LABELS[computer.state]}</span>
        </div>
      ) : null}
      <ToggleField
        label="Give this agent a computer"
        hint="Adds the computer tools to this agent's runs (Claude and Codex local adapters)."
        checked={computer.enabled}
        onChange={(enabled) => update.mutate({ enabled })}
        toggleTestId={`computer-enable-${computer.agentId}`}
      />
      {computer.enabled ? (
        <>
          <ToggleField
            label="Allow shell inside the sandbox"
            hint="Runs commands inside the sandbox only, as a separate unprivileged user. Never on this machine. Takes effect next time the computer starts."
            checked={computer.shell}
            onChange={(shell) => update.mutate({ shell })}
          />
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Sites it may visit (empty = any public site). Takes effect next time the computer starts.</span>
            <Input value={hosts} onChange={(e) => setHosts(e.target.value)} onBlur={saveHosts} placeholder="example.com, *.example.org" />
          </label>
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={live || reset.isPending}
              title={live ? "Stop the computer first" : undefined}
              onClick={() => {
                if (window.confirm(`Delete ${computer.name}'s computer and its browser profile? Saved logins are lost.`)) reset.mutate();
              }}
            >
              Delete computer and browser profile
            </Button>
          </div>
        </>
      ) : null}
      {update.isError || reset.isError ? (
        <p className="text-xs text-destructive" role="alert">{(update.error ?? reset.error) instanceof Error ? (update.error ?? reset.error)!.message : "Failed"}</p>
      ) : null}
    </Tag>
  );
}

/** Whether the computer supervisor answers, and how to start it if not. */
export function SupervisorStatus({ supervisor }: { supervisor: SupervisorHealth }) {
  return supervisor.ok ? (
    <p className="text-xs text-muted-foreground" role="status" data-testid="computer-supervisor-status">
      Supervisor connected: {supervisor.provider.isolation}.
    </p>
  ) : (
    <p className="text-xs text-destructive" role="status" data-testid="computer-supervisor-status">
      {/Start it with/.test(supervisor.error) ? supervisor.error : `${supervisor.error} Start it with: node scripts/ppclip/computer-supervisor.mjs (or start-local.mjs --with-computer).`}
    </p>
  );
}

/**
 * ppclip: Company Settings section for computer use. Off by default. Turning it
 * off stops every computer, closes every stream and ends any takeover at once.
 */
/** ppclip module switch (Settings → ppclip): computerUse. */
export function ComputerUseSettingsSection(props: Parameters<typeof ComputerUseSettingsSectionContent>[0]) {
  return usePpclipFeature("computerUse") ? <ComputerUseSettingsSectionContent {...props} /> : null;
}

function ComputerUseSettingsSectionContent({ companyId }: { companyId: string }) {
  const overview = useComputerUse(companyId);
  const invalidate = useInvalidateComputerUse(companyId);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => computerUseApi.setEnabled(companyId, enabled),
    onSettled: invalidate,
  });
  const enabled = mutation.isPending ? mutation.variables === true : overview.data?.enabled === true;
  const supervisor = overview.data?.supervisor;

  function handleChange(next: boolean) {
    if (!next && !window.confirm("Turn off computer use? Every agent computer stops, live views close and any takeover ends. Browser profiles are kept.")) return;
    mutation.mutate(next);
  }

  return (
    <div className="max-w-2xl space-y-4" data-testid="ppclip-computer-use-settings">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Computer use</div>
      <div className="space-y-2">
        <ToggleField
          label="Enable computer use"
          hint="Gives chosen agents a sandboxed Linux desktop and browser that you can watch and take over on the Live page. Needs the ppclip computer supervisor running on this machine."
          checked={enabled}
          onChange={handleChange}
          toggleTestId="ppclip-computer-use-toggle"
        />
        {mutation.isError ? (
          <p className="text-xs text-destructive" role="alert">{mutation.error instanceof Error ? mutation.error.message : "Failed to change computer use"}</p>
        ) : null}
        {enabled && supervisor ? <SupervisorStatus supervisor={supervisor} /> : null}
      </div>
      {enabled && overview.data ? (
        <ul className="space-y-2" aria-label="Agents with computers">
          {overview.data.agents.map((computer) => <AgentComputerControls key={computer.agentId} companyId={companyId} computer={computer} />)}
        </ul>
      ) : null}
    </div>
  );
}
