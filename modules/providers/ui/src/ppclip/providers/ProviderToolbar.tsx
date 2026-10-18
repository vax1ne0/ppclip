import { useState } from "react";
import { AlertTriangle, Settings2 } from "lucide-react";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProviderMark } from "./ProviderMark";
import { cn } from "@/lib/utils";
import { ProviderSettingsSheet } from "./ProviderSettingsSheet";
import { usePpclipFeatures } from "../features/store";
import {
  headlineLimit,
  modeStops,
  providerName,
  resetLabel,
  usageStatusText,
  CLAUDE_CODE_SOURCE_NOTE,
  useProviderUsage,
  type AccountUsage,
} from "./usage";
import { useProviderRouting, useSetRoutingMode } from "./useProviderRouting";

function fillClass(percent: number) {
  if (percent > 90) return "bg-(--status-task-blocked)";
  if (percent > 70) return "bg-(--status-task-todo)";
  return "bg-(--status-task-done)";
}

function UsageDetails({ entry }: { entry: AccountUsage }) {
  const status = usageStatusText(entry);
  const windows = entry.usage?.status === "ok" ? entry.usage.limits.filter((limit) => limit.usedPercent != null) : [];
  return (
    <div className="space-y-1 text-left">
      <p className="font-medium">{providerName(entry.account.provider)} · {entry.account.name}</p>
      {windows.map((limit) => (
        <p key={limit.id} className="tabular-nums">
          {limit.label}: {Math.round(limit.usedPercent ?? 0)}% used{resetLabel(limit.resetsAt) ? ` · ${resetLabel(limit.resetsAt)}` : ""}
        </p>
      ))}
      {status ? <p>{status}</p> : null}
      {entry.usageFrom === "claude_code_local" ? <p className="text-muted-foreground">{CLAUDE_CODE_SOURCE_NOTE}</p> : null}
    </div>
  );
}

function UsageBar({ entry }: { entry: AccountUsage }) {
  const headline = headlineLimit(entry.usage);
  const percent = headline?.usedPercent ?? null;
  const clamped = percent == null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/apps"
          className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground no-underline hover:bg-accent hover:text-foreground"
          aria-label={`${providerName(entry.account.provider)} usage: ${percent == null ? "unknown" : `${Math.round(percent)}% used`}`}
          data-testid="ppclip-provider-usage-bar"
        >
          {entry.account.provider === "openai" ? (
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
              <img src="/brands/apps/openai.svg" alt="" className="size-4 object-contain dark:hidden" />
              <img src="/brands/apps/openai-dark.svg" alt="" className="hidden size-4 object-contain dark:block" />
            </span>
          ) : <ProviderMark provider={entry.account.provider} routing={entry.account.routing} />}
          {/* A compact pill: official's bordered QuotaBar box is too heavy at top-bar size. */}
          <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className={cn("absolute inset-y-0 left-0 rounded-full transition-(--tp-width-background-color) duration-150", fillClass(clamped))}
              style={{ width: `${clamped}%` }}
            />
          </span>
          <span className="tabular-nums">{percent == null ? "—" : `${Math.round(percent)}%`}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom"><UsageDetails entry={entry} /></TooltipContent>
    </Tooltip>
  );
}

/**
 * ppclip PROV-1: top-bar provider control. Usage bars come from official
 * Connections usage; the mode switch appears once routing is turned on for
 * the company and at least two providers are set up.
 */
export function ProviderToolbar({ companyId }: { companyId: string | null }) {
  const [open, setOpen] = useState(false);
  const features = usePpclipFeatures();
  const usage = useProviderUsage(companyId);
  const routing = useProviderRouting(companyId);
  const mode = useSetRoutingMode(companyId ?? "");
  if (!companyId || (!features.providerUsage && !features.providerRouting && !features.modelApprovals)) return null;

  const policy = routing.data?.policy;
  const providers = policy?.providers.map((p) => p.adapterType) ?? [];
  const tiersMapped = policy?.tiers.some((tier) => Object.keys(tier.models).length >= 2) ?? false;
  const showSwitch = Boolean(policy?.enabled) && providers.length >= 2;
  const selected = mode.isPending ? mode.variables?.policy.mode : policy?.mode;
  const health = routing.data?.controller.health;
  const attention = mode.isError
    || Boolean(health?.error)
    || Boolean(health?.agents.some((agent) => agent.state === "blocked"));
  const bars = (usage.data?.accounts ?? []).filter((entry) => entry.supported);

  return (
    <div className="flex items-center gap-1" data-testid="ppclip-provider-toolbar">
      {bars.length > 0 ? (
        <div className="hidden items-center gap-0.5 md:flex">
          {bars.map((entry) => <UsageBar key={`${entry.account.id}:${entry.account.grantId}`} entry={entry} />)}
        </div>
      ) : null}
      {showSwitch ? (
        <div className="flex overflow-hidden rounded-md border border-border" role="radiogroup" aria-label="Provider mode">
          {modeStops(providers).map((stop) => {
            const disabled = mode.isPending || (stop.value !== "hybrid" && !tiersMapped);
            return (
              <button
                key={stop.value}
                type="button"
                role="radio"
                aria-checked={selected === stop.value}
                disabled={disabled}
                title={!tiersMapped && stop.value !== "hybrid" ? "Map a model for two providers in one tier first." : undefined}
                className={cn(
                  "px-2 py-0.5 text-xs whitespace-nowrap transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
                  selected === stop.value && "bg-accent text-foreground",
                )}
                onClick={() => stop.value !== selected && mode.setMode(stop.value)}
              >
                {stop.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={attention ? "Providers need attention" : "Provider settings"}
            onClick={() => setOpen(true)}
            data-testid="ppclip-provider-settings-button"
          >
            {attention ? <AlertTriangle className="text-(--status-task-todo)" /> : <Settings2 />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {mode.isError ? "Couldn’t change the provider mode." : attention ? "Some agents need attention." : "Providers and model tiers"}
        </TooltipContent>
      </Tooltip>
      {open ? <ProviderSettingsSheet companyId={companyId} open={open} onOpenChange={setOpen} /> : null}
    </div>
  );
}
