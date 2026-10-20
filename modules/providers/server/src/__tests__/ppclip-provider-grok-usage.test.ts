import { describe, expect, it } from "vitest";
import { probeAiConnectionUsage } from "../services/ai-connection-usage.js";

// ppclip: redacted copy of a real 2026-10-20 cli-chat-proxy.grok.com/v1/billing?format=credits
// response for a SuperGrok (unified billing, weekly period) account. Only identifiers
// were removed; the omitted creditUsagePercent/used/monthlyLimit are genuinely absent.
const GROK_WEEKLY_CREDITS = {
  config: {
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-10-15T00:00:00+00:00", end: "2026-10-22T00:00:00+00:00" },
    onDemandCap: { val: 0 }, onDemandUsed: { val: 0 }, isUnifiedBillingUser: true, prepaidBalance: { val: 0 },
    topUpMethod: "redacted", billingPeriodStart: "2026-10-15T00:00:00+00:00", billingPeriodEnd: "2026-10-22T00:00:00+00:00",
  },
};
const auth = JSON.stringify({ "https://auth.x.ai::00000000-0000-4000-8000-000000000000": { key: "fixture-key", refresh_token: "fixture-refresh" } });

describe("Grok credits usage", () => {
  it("keeps a weekly-plan response without a percentage as ok, with its reset window", async () => {
    const request = (async () => new Response(JSON.stringify(GROK_WEEKLY_CREDITS), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await probeAiConnectionUsage({ provider: "xai", method: "subscription" }, auth, { request });
    expect(result.status).toBe("ok");
    const window = result.limits.find((limit) => limit.id === "grok_credits");
    expect(window).toMatchObject({ usedPercent: null, used: null, limit: null, resetsAt: "2026-10-22T00:00:00.000Z", windowDurationSeconds: 7 * 24 * 3600 });
    expect(result.overage).toMatchObject({ used: 0, limit: 0, balance: 0, available: false });
  });
});