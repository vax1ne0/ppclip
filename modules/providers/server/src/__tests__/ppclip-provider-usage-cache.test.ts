import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConnectionUsage } from "@paperclipai/shared";
import { cachedUsage, clearUsageCacheForTests, RATE_LIMIT_RETRY_MS, TRANSIENT_RETRY_MS, USAGE_TTL_MS } from "../ppclip/providers/usage-cache.js";

const reading = (status: "ok" | "error", usedPercent = 40, errorCode: string | null = null) => ({
  connectionId: "c", grantId: "g", provider: "anthropic", method: "subscription", status, errorCode,
  checkedAt: new Date().toISOString(), source: "anthropic_oauth", planType: null, overage: null,
  limits: status === "ok" ? [{ id: "five_hour", label: "5 hour limit", scope: null, windowDurationSeconds: 18000, resetsAt: null,
    usedPercent, remainingPercent: 100 - usedPercent, used: null, limit: null, remaining: null, unit: "percent", limitReached: null, allowed: null }] : [],
}) as unknown as AiConnectionUsage;

beforeEach(() => {
  clearUsageCacheForTests();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("ppclip shared usage cache", () => {
  it("checks a provider at most once per TTL, sharing concurrent requests", async () => {
    const probe = vi.fn(async () => reading("ok"));
    const [a, b] = await Promise.all([cachedUsage("k", probe), cachedUsage("k", probe)]);
    expect(a).toBe(b);
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(USAGE_TTL_MS + 1);
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good reading when the provider rate-limits, and backs off", async () => {
    const good = reading("ok", 55);
    const probe = vi.fn().mockResolvedValueOnce(good).mockResolvedValue(reading("error", 0, "rate_limited"));
    expect(await cachedUsage("k", probe)).toBe(good);
    vi.advanceTimersByTime(USAGE_TTL_MS + 1);
    expect(await cachedUsage("k", probe)).toBe(good);
    expect(await cachedUsage("k", probe)).toBe(good);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("retries a temporary failure after a short pause instead of the full TTL", async () => {
    const probe = vi.fn().mockResolvedValueOnce(reading("error", 0, "provider_unavailable")).mockResolvedValue(reading("ok", 30));
    expect((await cachedUsage("k", probe))?.status).toBe("error");
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TRANSIENT_RETRY_MS + 1);
    expect((await cachedUsage("k", probe))?.status).toBe("ok");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("returns the provider's error when there is no earlier reading, without retrying immediately", async () => {
    const limited = reading("error", 0, "rate_limited");
    const probe = vi.fn(async () => limited);
    expect(await cachedUsage("k", probe)).toBe(limited);
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(USAGE_TTL_MS + 1);
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RATE_LIMIT_RETRY_MS - USAGE_TTL_MS);
    await cachedUsage("k", probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps a known exhausted allowance while usage checks are throttled", async () => {
    const exhausted = reading("ok", 100);
    const probe = vi.fn().mockResolvedValueOnce(exhausted).mockResolvedValue(reading("error", 0, "rate_limited"));
    await cachedUsage("exhausted", probe);
    vi.advanceTimersByTime(USAGE_TTL_MS + 1);
    const kept = await cachedUsage("exhausted", probe);
    expect(kept).toBe(exhausted);
    expect(kept?.limits[0].usedPercent).toBe(100);
    vi.advanceTimersByTime(USAGE_TTL_MS + 1);
    await cachedUsage("exhausted", probe);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});
