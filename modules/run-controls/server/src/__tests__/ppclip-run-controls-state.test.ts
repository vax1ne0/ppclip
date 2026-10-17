import { describe, expect, it } from "vitest";
import {
  activeRunCredit,
  applyRunControl,
  clearRunControls,
  needsRunControlClear,
  preserveRunControlMetadata,
  readRunControl,
  runsStartedSince,
  stripRunControlMetadata,
} from "../ppclip/run-controls/state.ts";
import { ppclipRunCreditForDay } from "../ppclip/run-controls/credit.ts";
import { computeAllowance, summarizeTeam } from "../ppclip/run-controls/service.ts";

const now = new Date("2026-10-16T12:00:00Z");
const ctx = (currentCap: number | null, extra: Partial<Parameters<typeof applyRunControl>[2]> = {}) =>
  ({ currentCap, now, actor: "user-1", ...extra });
const heartbeatOf = (config: { runtimeConfig: unknown }) =>
  (config.runtimeConfig as { heartbeat: Record<string, unknown> }).heartbeat;

describe("ppclip run-control state", () => {
  it("Unlimited lifts the cap, saves it, and restores it with today's credit", () => {
    const agent = { metadata: { other: 1 }, runtimeConfig: { heartbeat: { dailyRunCap: 5, intervalSec: 60 } } };
    const on = applyRunControl(agent, { unlimited: true, draining: false }, ctx(5));
    expect(heartbeatOf(on)).toEqual({ intervalSec: 60 });
    expect(readRunControl(on.metadata)).toMatchObject({
      unlimited: true, unlimitedSince: now.toISOString(), saved: { maxDailyRuns: 5, wakeOnDemand: null },
    });

    const off = applyRunControl(on, { unlimited: false, draining: false }, ctx(null, { creditRuns: 2 }));
    expect(heartbeatOf(off)).toEqual({ intervalSec: 60, maxDailyRuns: 5 });
    expect(off.metadata).toEqual({ other: 1, runControl: expect.objectContaining({ credit: { day: "2026-10-16", runs: 2 } }) });
    expect(readRunControl(off.metadata).saved).toBeUndefined();

    // A second unlimited cycle the same day adds to today's credit.
    const again = applyRunControl(
      applyRunControl(off, { unlimited: true, draining: false }, ctx(5)),
      { unlimited: false, draining: false }, ctx(null, { creditRuns: 1 }),
    );
    expect(readRunControl(again.metadata).credit).toEqual({ day: "2026-10-16", runs: 3 });
  });

  it("Drain sets cap 0 and wake off; Resume restores the saved values and removes absent keys", () => {
    const agent = { metadata: null, runtimeConfig: { heartbeat: { wakeOnDemand: true } } };
    const drained = applyRunControl(agent, { unlimited: false, draining: true }, ctx(null));
    expect(heartbeatOf(drained)).toEqual({ maxDailyRuns: 0, wakeOnDemand: false });
    expect(readRunControl(drained.metadata)).toMatchObject({ draining: true, saved: { maxDailyRuns: null, wakeOnDemand: true } });

    const resumed = applyRunControl(drained, { unlimited: false, draining: false }, ctx(0));
    expect(heartbeatOf(resumed)).toEqual({ wakeOnDemand: true });
    expect(resumed.metadata).toEqual({});
  });

  it("keeps Unlimited and Drain independent", () => {
    const agent = { metadata: {}, runtimeConfig: { heartbeat: { maxDailyRuns: 4 } } };
    const unlimited = applyRunControl(agent, { unlimited: true, draining: false }, ctx(4));
    const both = applyRunControl(unlimited, { unlimited: true, draining: true }, ctx(null));
    expect(heartbeatOf(both)).toMatchObject({ maxDailyRuns: 0, wakeOnDemand: false });
    expect(readRunControl(both.metadata).saved).toEqual({ maxDailyRuns: 4, wakeOnDemand: null });
    const resumed = applyRunControl(both, { unlimited: true, draining: false }, ctx(0));
    expect(heartbeatOf(resumed)).toEqual({});
    expect(readRunControl(resumed.metadata)).toMatchObject({ unlimited: true, saved: { maxDailyRuns: 4 } });
  });

  it("switch-off clears every cap alias and restores the saved wake setting", () => {
    const drained = applyRunControl(
      { metadata: { drainAfter: { state: "armed" } }, runtimeConfig: { heartbeat: { maxRunsPerDay: 3, wakeOnDemand: true } } },
      { unlimited: false, draining: true }, ctx(3),
    );
    expect(needsRunControlClear(drained)).toBe(true);
    const cleared = clearRunControls(drained);
    expect(heartbeatOf(cleared)).toEqual({ wakeOnDemand: true });
    expect(cleared.metadata).toEqual({});
    expect(needsRunControlClear(cleared)).toBe(false);
    expect(heartbeatOf(clearRunControls({ metadata: {}, runtimeConfig: { heartbeat: { dailyRunLimit: 2, wakeOnDemand: false } } })))
      .toEqual({ wakeOnDemand: false });
  });

  it("credits only today's runs and expires them at the next UTC day", () => {
    const metadata = { runControl: { credit: { day: "2026-10-16", runs: 2.7 } } };
    expect(activeRunCredit(metadata, "2026-10-16")).toBe(2);
    expect(activeRunCredit(metadata, "2026-10-17")).toBe(0);
    expect(ppclipRunCreditForDay(metadata, new Date("2026-10-16T00:00:00Z"))).toBe(2);
    expect(ppclipRunCreditForDay(metadata, new Date("2026-10-17T00:00:00Z"))).toBe(0);
    expect(ppclipRunCreditForDay({ runControl: { draining: true, credit: { day: "2026-10-16", runs: 2 } } }, new Date("2026-10-16T00:00:00Z"))).toBe(0);
    const runs = [
      { agentId: "a", startedAt: new Date("2026-10-15T23:30:00Z") },
      { agentId: "a", startedAt: new Date("2026-10-16T09:00:00Z") },
      { agentId: "a", startedAt: new Date("2026-10-16T11:00:00Z") },
      { agentId: "b", startedAt: new Date("2026-10-16T11:00:00Z") },
    ];
    expect(runsStartedSince(runs, "a", "2026-10-15T20:00:00Z", now)).toBe(2);
    expect(runsStartedSince(runs, "a", "2026-10-16T10:00:00Z", now)).toBe(1);
    expect(runsStartedSince(runs, "a", undefined, now)).toBe(0);
  });

  it("protects run-control metadata from ordinary updates and hires", () => {
    const stored = { runControl: { draining: true }, drainAfter: { state: "armed" }, note: "x" };
    expect(preserveRunControlMetadata(stored, { note: "y", drainAfter: { state: "cancelled" } }))
      .toEqual({ note: "y", runControl: { draining: true }, drainAfter: { state: "armed" } });
    expect(preserveRunControlMetadata({ note: "x" }, { drainAfter: { state: "armed" } })).toEqual({});
    expect(preserveRunControlMetadata({}, null)).toBeNull();
    expect(preserveRunControlMetadata(stored, null)).toEqual({ runControl: { draining: true }, drainAfter: { state: "armed" } });
    expect(stripRunControlMetadata({ a: 1, runControl: {}, drainAfter: {} })).toEqual({ a: 1 });
    expect(stripRunControlMetadata(null)).toBeNull();
  });

  it("computes runs left from the official cap plus today's credit", () => {
    const agent = (id: string, metadata: Record<string, unknown>, cap: number | null) =>
      ({ id, metadata, runtimeConfig: { cap } }) as never;
    const readCap = (row: { runtimeConfig: { cap: number | null } }) => row.runtimeConfig.cap;
    const runs = [{ agentId: "a", startedAt: now }, { agentId: "a", startedAt: now }, { agentId: "a", startedAt: now }];
    const live = new Map([["b", 1]]);
    const a = computeAllowance(agent("a", { runControl: { credit: { day: "2026-10-16", runs: 2 } } }, 5), readCap as never, runs, live, now);
    expect(a).toMatchObject({ cap: 5, usedToday: 3, credit: 2, left: 4, drainState: null });
    const b = computeAllowance(agent("b", { runControl: { draining: true } }, 0), readCap as never, [], live, now);
    expect(b).toMatchObject({ left: 0, drainState: "draining" });
    const c = computeAllowance(agent("c", { runControl: { draining: true } }, 0), readCap as never, [], live, now);
    expect(c.drainState).toBe("drained");
    expect(summarizeTeam([b, c]).drain).toBe("draining");
    expect(summarizeTeam([c]).drain).toBe("drained");
    expect(summarizeTeam([a, c]).drain).toBe("mixed");
    expect(summarizeTeam([a]).unlimited).toBe("off");
  });
});
