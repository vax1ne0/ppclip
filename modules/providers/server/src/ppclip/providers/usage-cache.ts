import type { AiConnectionUsage } from "@paperclipai/shared";

/**
 * One server-side cache for AI account usage, shared by every browser tab,
 * page load and the routing controller, so each provider's usage endpoint is
 * asked at most once per USAGE_TTL_MS per account (sooner only when a limit
 * resets). Providers rate-limit these endpoints hard (Anthropic answers
 * "rate_limited" after a few checks), so:
 *   - concurrent requests for the same account share one probe;
 *   - a failed or rate-limited probe keeps serving the last good reading
 *     (its own checkedAt tells the UI how old it is) and is not retried until
 *     the TTL passes.
 */
export const USAGE_TTL_MS = 5 * 60_000;
export const TRANSIENT_RETRY_MS = 30_000;
const STOP_ASKING = new Set(["rate_limited", "permission_denied", "authentication_required", "unsupported", "connection_unavailable"]);
const MAX_ENTRIES = 1000;

type Entry = { expires: number; value: AiConnectionUsage | null };
const fresh = new Map<string, Entry>();
const lastGood = new Map<string, AiConnectionUsage>();
const inFlight = new Map<string, Promise<AiConnectionUsage | null>>();

function expiryFor(value: AiConnectionUsage | null, now: number) {
  const resets = (value?.status === "ok" ? value.limits : [])
    .map((limit) => Date.parse(limit.resetsAt ?? ""))
    .filter((t) => Number.isFinite(t) && t > now);
  return Math.min(now + USAGE_TTL_MS, ...resets);
}

/** Usage for one account, from cache when fresh; `probe` is called at most once per TTL. */
export async function cachedUsage(key: string, probe: () => Promise<AiConnectionUsage | null>): Promise<AiConnectionUsage | null> {
  const now = Date.now();
  const hit = fresh.get(key);
  if (hit && hit.expires > now) return hit.value;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = (async () => {
    const value = await probe().catch(() => null);
    const at = Date.now();
    if (fresh.size > MAX_ENTRIES) { fresh.clear(); lastGood.clear(); }
    if (value?.status === "ok") {
      lastGood.set(key, value);
      fresh.set(key, { value, expires: expiryFor(value, at) });
      return value;
    }
    // Keep showing the last good reading. Back off for the full TTL when the
    // provider said to stop (rate limit, no permission, sign-in needed); retry a
    // temporary failure (provider unavailable, network) sooner.
    const kept = lastGood.get(key) ?? value;
    const stop = value?.errorCode && STOP_ASKING.has(value.errorCode);
    fresh.set(key, { value: kept, expires: at + (stop ? USAGE_TTL_MS : TRANSIENT_RETRY_MS) });
    return kept;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

export function usageCacheKey(companyId: string, account: { id: string; grantId?: string | null }) {
  return `${companyId}:${account.id}:${account.grantId ?? ""}`;
}

/** Tests start from an empty cache. */
export function clearUsageCacheForTests() {
  fresh.clear();
  lastGood.clear();
  inFlight.clear();
}
