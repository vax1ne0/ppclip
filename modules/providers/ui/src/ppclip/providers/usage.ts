/**
 * ppclip DASH-3 / PROV-1: account usage read from official Connections usage.
 *
 * Official exposes usage per AI account only on demand
 * (`GET /companies/:id/ai-connections/:connectionId/usage`, no-store, a live
 * provider call each time, no server cache). To stay gentle on provider rate
 * limits, every ppclip surface shares ONE query that only the leader tab polls
 * (every 5 minutes) and broadcasts to other tabs.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AI_CONNECTION_CAPABILITIES,
  AI_PROVIDERS as SHARED_AI_PROVIDERS,
  type AiProvider,
  type AiConnectionUsage,
  type AiConnectionUsageLimit,
  type AiManagedConnectionSummary,
} from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { api } from "@/api/client";
import { AI_PROVIDERS } from "@/components/ai-connections/model";
import { getAdapterLabel } from "@/adapters/adapter-display-registry";
import { usePublishSharedQueryData, useSharedPollingQuery } from "@/hooks/useSharedPolling";
import { usePpclipFeature } from "../features/store";

const USAGE_REFRESH_MS = 5 * 60_000;

export type AccountUsage = {
  account: AiManagedConnectionSummary;
  /** False when the provider exposes no limits for this sign-in method. */
  supported: boolean;
  usage: AiConnectionUsage | null;
  /** The usage request itself failed (not a provider-reported state). */
  failed: boolean;
  /** Set when the numbers come from this computer's Claude Code sign-in (Anthropic won't share them for the connected account). */
  usageFrom?: "claude_code_local";
};

export const CLAUDE_CODE_SOURCE_NOTE = "From Claude Code on this computer. Anthropic doesn't share usage for Claude accounts connected in Paperclip.";
type ProviderUsageSnapshot = { accounts: AccountUsage[]; checkedAt: string };

const providerUsageQueryKey = (companyId: string) => ["ppclip", "provider-usage", companyId] as const;

/** Usage through ppclip's server cache: at most one provider check per account every 5 minutes, shared by all tabs. */
function fetchProviderUsage(companyId: string): Promise<ProviderUsageSnapshot> {
  return api.get<ProviderUsageSnapshot>(`/companies/${companyId}/ppclip/provider-usage`);
}

/**
 * Connected AI accounts from official's own list query (same key official
 * refreshes when an account is connected or removed). A local read, no
 * provider calls, so it is always current.
 */
export function useConnectedAccounts(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["ai-connections", companyId ?? ""],
    queryFn: () => aiConnectionsApi.list(companyId!),
    enabled: !!companyId,
    select: (list) => list.connections.filter((account) => account.status === "connected"),
  });
}

const accountsKey = (accounts: readonly AiManagedConnectionSummary[]) =>
  accounts.map((account) => `${account.id}:${account.grantId}`).sort().join(",");

export function useProviderUsage(companyId: string | null | undefined) {
  const usageOn = usePpclipFeature("providerUsage");
  const queryKey = providerUsageQueryKey(companyId ?? "");
  const shared = useSharedPollingQuery({
    companyId,
    resourceKey: "ppclip-provider-usage",
    queryKey,
    enabled: !!companyId && usageOn,
    refetchInterval: USAGE_REFRESH_MS,
    leaderOnly: true,
  });
  const query = useQuery({
    queryKey,
    queryFn: () => fetchProviderUsage(companyId!),
    enabled: shared.enabled,
    refetchInterval: shared.refetchInterval,
    staleTime: USAGE_REFRESH_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  usePublishSharedQueryData(shared, query.data, query.dataUpdatedAt);
  // The usage snapshot refreshes only every 5 minutes; when an account is
  // connected or removed, check usage again right away instead.
  const live = useConnectedAccounts(usageOn ? companyId : null);
  const liveKey = live.data ? accountsKey(live.data) : undefined;
  const snapshotKey = query.data ? accountsKey(query.data.accounts.map((entry) => entry.account)) : undefined;
  const { refetch, isFetching } = query;
  useEffect(() => {
    if (liveKey !== undefined && snapshotKey !== undefined && liveKey !== snapshotKey && !isFetching) void refetch();
  }, [liveKey, snapshotKey, isFetching, refetch]);
  return query;
}

// ---------------------------------------------------------------- pure helpers

export function providerName(provider: AiManagedConnectionSummary["provider"]) {
  return AI_PROVIDERS[provider]?.name ?? provider;
}

const SHORT_ADAPTER_LABELS: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  grok_local: "Grok",
  opencode_local: "OpenCode",
};
export function adapterShortLabel(adapterType: string) {
  return SHORT_ADAPTER_LABELS[adapterType] ?? getAdapterLabel(adapterType);
}

/** The Connections provider a routable harness signs in with (same rule as server aiProviderForAdapter). */
export function providerForAdapter(adapterType: string): AiProvider | null {
  for (const provider of SHARED_AI_PROVIDERS) {
    const methods = Object.values(AI_CONNECTION_CAPABILITIES[provider].methods);
    if (methods.some((method) => method?.adapters.includes(adapterType))) return provider;
  }
  return null;
}

/** Account-wide windows with a percentage; model/feature scopes and overage stay in the details. */
export function headlineLimit(usage: AiConnectionUsage | null): AiConnectionUsageLimit | null {
  if (!usage || usage.status !== "ok") return null;
  const windows = usage.limits.filter((limit) => limit.scope === null && limit.usedPercent != null);
  if (windows.length === 0) return null;
  return windows.reduce((max, limit) => ((limit.usedPercent ?? 0) > (max.usedPercent ?? 0) ? limit : max));
}

export function resetLabel(resetsAt: string | null, now = Date.now()) {
  if (!resetsAt) return null;
  const ms = Date.parse(resetsAt) - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Reset due";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Resets in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Resets in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `Resets in ${Math.round(hours / 24)} days`;
}

const amountText = (value: number, unit: string | null) => unit === "cents" ? `$${(value / 100).toFixed(2)}` : `${value}${unit ? ` ${unit}` : ""}`;

/**
 * A successful check without a percentage (e.g. Grok's credits billing omits
 * creditUsagePercent/used/monthlyLimit for weekly-plan accounts). Show what was
 * reported (used amount, prepaid balance, reset) instead of a bare "not reported".
 */
export function unratedUsageText(usage: AiConnectionUsage, now = Date.now()) {
  const window = usage.limits.find((limit) => limit.scope === null);
  const parts: string[] = [];
  if (window?.used != null) parts.push(`${amountText(window.used, window.unit)} used`);
  if (window?.remaining != null) parts.push(`${amountText(window.remaining, window.unit)} left`);
  if (usage.overage?.balance != null && usage.overage.balance > 0) parts.push(`${amountText(usage.overage.balance, usage.overage.unit)} prepaid balance`);
  const reset = resetLabel(window?.resetsAt ?? null, now);
  if (reset) parts.push(reset);
  return parts.length ? `No usage percentage reported. ${parts.join(" · ")}.` : "Usage not reported.";
}

/** Short, masked status text; provider error bodies never reach the UI. */
export function usageStatusText(entry: AccountUsage) {
  if (!entry.supported) return "Unavailable for this sign-in method.";
  if (entry.failed) return "Couldn’t check usage. Try again later.";
  const usage = entry.usage;
  if (!usage) return "Usage not observed.";
  switch (usage.errorCode) {
    case "authentication_required": return "Sign in again to check usage.";
    case "permission_denied": return usage.provider === "anthropic"
      ? "Anthropic doesn't share usage for Claude accounts connected in Paperclip. Sign in to Claude Code on this computer to see it here."
      : "Usage access denied.";
    case "rate_limited": return "Usage check temporarily rate-limited. Your allowance may still be exhausted; this does not mean it has reset. Checks retry automatically after a cooldown.";
    case "connection_unavailable": return "Reconnect to check usage.";
    case "unsupported": return "Usage unavailable.";
    case "provider_unavailable":
    case "invalid_response": return "Couldn’t read usage. Try again later.";
    default: return usage.status === "ok" ? (headlineLimit(usage) ? null : unratedUsageText(usage)) : "Usage unavailable.";
  }
}

/** Mode switch stops: two providers read "A only | Hybrid | B only"; more read "Hybrid | A only | …". */
export function modeStops(adapterTypes: string[]) {
  const sorted = [...adapterTypes].sort((a, b) => adapterShortLabel(a).localeCompare(adapterShortLabel(b)));
  const only = sorted.map((type) => ({ value: type, label: `${adapterShortLabel(type)} only` }));
  const hybrid = { value: "hybrid", label: "Hybrid" };
  if (only.length === 2) return [only[0]!, hybrid, only[1]!];
  return [hybrid, ...only];
}
