/**
 * ppclip DASH-3 / PROV-1: account usage read from official Connections usage.
 *
 * Official exposes usage per AI account only on demand
 * (`GET /companies/:id/ai-connections/:connectionId/usage`, no-store, a live
 * provider call each time, no server cache). To stay gentle on provider rate
 * limits, every ppclip surface shares ONE query that only the leader tab polls
 * (every 5 minutes) and broadcasts to other tabs.
 */
import { useQuery } from "@tanstack/react-query";
import {
  AI_CONNECTION_CAPABILITIES,
  AI_PROVIDERS as SHARED_AI_PROVIDERS,
  supportsAiConnectionUsage,
  type AiProvider,
  type AiConnectionUsage,
  type AiConnectionUsageLimit,
  type AiManagedConnectionSummary,
} from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
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
};
type ProviderUsageSnapshot = { accounts: AccountUsage[]; checkedAt: string };

const providerUsageQueryKey = (companyId: string) => ["ppclip", "provider-usage", companyId] as const;

async function fetchProviderUsage(companyId: string): Promise<ProviderUsageSnapshot> {
  const list = await aiConnectionsApi.list(companyId);
  const connected = list.connections.filter((account) => account.status === "connected");
  const accounts = await Promise.all(connected.map(async (account): Promise<AccountUsage> => {
    const supported = account.usageProbeSupported ?? supportsAiConnectionUsage(account.provider, account.method);
    if (!supported) return { account, supported, usage: null, failed: false };
    try {
      return { account, supported, usage: await aiConnectionsApi.probeUsage(companyId, account.id, account.grantId), failed: false };
    } catch {
      return { account, supported, usage: null, failed: true };
    }
  }));
  return { accounts, checkedAt: new Date().toISOString() };
}

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

/** Short, masked status text; provider error bodies never reach the UI. */
export function usageStatusText(entry: AccountUsage) {
  if (!entry.supported) return "Unavailable for this sign-in method.";
  if (entry.failed) return "Couldn’t check usage. Try again later.";
  const usage = entry.usage;
  if (!usage) return "Usage not observed.";
  switch (usage.errorCode) {
    case "authentication_required": return "Sign in again to check usage.";
    case "permission_denied": return "Usage access denied.";
    case "rate_limited": return "Too many checks. Try again later.";
    case "connection_unavailable": return "Reconnect to check usage.";
    case "unsupported": return "Usage unavailable.";
    case "provider_unavailable":
    case "invalid_response": return "Couldn’t read usage. Try again later.";
    default: return usage.status === "ok" ? (headlineLimit(usage) ? null : "Usage not reported.") : "Usage unavailable.";
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
