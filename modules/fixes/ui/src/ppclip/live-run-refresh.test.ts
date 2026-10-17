import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshScopedLiveRuns } from "./live-run-refresh";

describe("refreshScopedLiveRuns", () => {
  it("invalidates only this company's scoped live-run lists", async () => {
    const client = new QueryClient();
    const keys = [
      ["live-runs", "c1"],
      ["live-runs", "c1", "dashboard", { minRunCount: 4 }],
      ["live-runs", "c1", "dashboard-live", { minRunCount: 50 }],
      ["live-runs", "c2", "dashboard", { minRunCount: 4 }],
      ["issues", "live-runs", "c1"],
    ];
    for (const key of keys) client.setQueryData(key, []);

    await refreshScopedLiveRuns(client, "c1");

    const stale = keys.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key.slice(0, 3));
    expect(stale).toEqual([["live-runs", "c1", "dashboard"], ["live-runs", "c1", "dashboard-live"]]);
  });
});
