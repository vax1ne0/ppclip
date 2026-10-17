import { useMutation } from "@tanstack/react-query";
import { ToggleField } from "@/components/agent-config-primitives";
import { runControlsApi } from "./api";
import { useInvalidateRunControls, useRunControls } from "./useRunControls";
import { usePpclipFeature } from "@/ppclip/features/store";

/**
 * ppclip: Company Settings section for the run-controls master switch. Off by
 * default. Turning it off hides every run control and clears all agents' daily
 * run limits, so agents run unlimited.
 */
/** ppclip module switch (Settings → ppclip): runControls. */
export function RunControlsSettingsSection(props: Parameters<typeof RunControlsSettingsSectionContent>[0]) {
  return usePpclipFeature("runControls") ? <RunControlsSettingsSectionContent {...props} /> : null;
}

function RunControlsSettingsSectionContent({ companyId }: { companyId: string }) {
  const overview = useRunControls(companyId);
  const invalidate = useInvalidateRunControls(companyId);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => runControlsApi.setEnabled(companyId, enabled),
    onSettled: invalidate,
  });
  const enabled = mutation.isPending ? mutation.variables === true : overview.data?.enabled === true;

  function handleChange(next: boolean) {
    if (!next) {
      const confirmed = window.confirm(
        "Turn off run controls? Every agent's daily run limit is removed, Unlimited, Drain and Drain after are cleared, and agents run without limits.",
      );
      if (!confirmed) return;
    }
    mutation.mutate(next);
  }

  return (
    <div className="max-w-2xl space-y-4" data-testid="ppclip-run-controls-settings">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Run controls
      </div>
      <div className="space-y-2">
        <ToggleField
          label="Enable run controls"
          hint="Shows daily runs left on the Agents page and the team Unlimited, Drain, Resume and Drain after actions. Turning this off removes every agent's daily run limit."
          checked={enabled}
          onChange={handleChange}
          toggleTestId="ppclip-run-controls-toggle"
        />
        {mutation.isError && (
          <p className="text-xs text-destructive" role="alert">
            {mutation.error instanceof Error ? mutation.error.message : "Failed to change run controls"}
          </p>
        )}
        {mutation.isSuccess && !mutation.data.enabled && mutation.data.clearedAgentIds.length > 0 && (
          <p className="text-xs text-muted-foreground" role="status">
            Removed run limits from {mutation.data.clearedAgentIds.length} agent
            {mutation.data.clearedAgentIds.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </div>
  );
}
