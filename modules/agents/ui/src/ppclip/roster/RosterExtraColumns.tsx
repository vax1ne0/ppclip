import { useCallback, useState } from "react";
import { Columns3 } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { getAdapterLabel } from "@/adapters/adapter-display-registry";
import { DailyRunsLeft } from "@/ppclip/run-controls/DailyRunsLeft";
import { usePpclipFeature } from "@/ppclip/features/store";
import { configuredModel } from "@/ppclip/agent-model";

export const EXTRA_COLUMNS_STORAGE_KEY = "ppclip:agents-extra-columns";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(EXTRA_COLUMNS_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

/** ppclip AGENTS-1: show/hide the roster's extra columns, remembered per browser. */
export function useRosterExtraColumns() {
  const [visible, setVisible] = useState(readStored);
  const toggle = useCallback(() => {
    setVisible((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(EXTRA_COLUMNS_STORAGE_KEY, next ? "shown" : "hidden");
      } catch {
        // Storage blocked: the choice lasts for this visit only.
      }
      return next;
    });
  }, []);
  // Module off (Settings → ppclip): no extra columns, and official's model column comes back.
  const enabled = usePpclipFeature("rosterExtras");
  return { visible: visible && enabled, toggle, enabled };
}

/** ppclip module switch (Settings → ppclip): rosterExtras. */
export function ExtraColumnsToggle(props: Parameters<typeof ExtraColumnsToggleContent>[0]) {
  return usePpclipFeature("rosterExtras") ? <ExtraColumnsToggleContent {...props} /> : null;
}

function ExtraColumnsToggleContent({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const label = visible ? "Hide model and runs left columns" : "Show model and runs left columns";
  return (
    <Button
      type="button"
      size="icon-sm"
      variant={visible ? "secondary" : "ghost"}
      className="hidden @5xl:inline-flex"
      onClick={onToggle}
      aria-pressed={visible}
      aria-label={label}
      title={label}
    >
      <Columns3 className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * ppclip AGENTS-1: the roster's extra columns: "Model / provider" (the
 * configured model over the adapter that runs it) and "Runs left" (RUN-1,
 * rendered only while the run-controls switch is on). Hidden while the
 * rosterExtras module is off (Settings → ppclip).
 */
export function RosterExtraColumns(props: Parameters<typeof RosterExtraColumnsContent>[0]) {
  return usePpclipFeature("rosterExtras") ? <RosterExtraColumnsContent {...props} /> : null;
}

function RosterExtraColumnsContent({ agent }: { agent: Agent }) {
  const model = configuredModel(agent.adapterConfig);
  const provider = getAdapterLabel(agent.adapterType);
  return (
    <>
      <div className="w-44 min-w-0 leading-tight" aria-label="Model / provider" data-testid="ppclip-model-provider">
        <div className="truncate font-mono text-xs text-muted-foreground" title={model ? `Model: ${model}` : "Provider default model"}>
          {model ?? "—"}
        </div>
        <div className="truncate font-mono text-(length:--text-micro) text-muted-foreground/70" title={`Provider: ${provider}`}>
          {provider}
        </div>
      </div>
      <DailyRunsLeft companyId={agent.companyId} agentId={agent.id} />
    </>
  );
}
