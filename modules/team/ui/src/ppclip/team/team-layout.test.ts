import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  layoutTeam,
  parseTeamPreferences,
  serializeTeamPreferences,
  snapTeamPosition,
  teamDepths,
  tidyTeam,
  visibleTeam,
  type Positions,
  type TeamMember,
} from "./team-layout";
import { crossesCard, routeAgentLink } from "./agent-link-routing";
import { roleGroupOf, teamGroupColor } from "./role-groups";

const member = (id: string, reportsTo: string | null = null, role = "engineer"): TeamMember => ({ id, name: id, role, reportsTo });
const metrics = { width: 320, height: 360, gap: 80, padding: 64 };
const byRole = (m: TeamMember) => roleGroupOf(m).key;
const layout = (people: TeamMember[], saved: Positions = {}, sizes = {}) => layoutTeam(people, sizes, saved, "reports", metrics, byRole);
const noOverlaps = (boxes: { x: number; y: number; w: number; h: number }[], gap = 0) =>
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(boxesOverlap(a, b, gap)).toBe(false)));

describe("saved Team preferences", () => {
  it("saves negative coordinates and attachment sides", () => {
    const result = parseTeamPreferences(JSON.stringify({ version: 1, positions: { a: { x: -96, y: -32 } }, ports: { edge: { from: "bottom", to: "top" } } }));
    expect(result.positions.a).toEqual({ x: -96, y: -32 });
    expect(result.ports.edge).toEqual({ from: "bottom", to: "top" });
    expect(snapTeamPosition({ x: -100, y: -40 }, { w: 320, h: 360 }, [], 64).x).toBeLessThan(0);
  });

  it("validates persisted settings and tolerates corrupt data", () => {
    const result = parseTeamPreferences(JSON.stringify({
      version: 1, grouping: "roles", positions: { good: { x: 64, y: 99 }, bad: { x: -100001, y: 9 }, text: { x: "1", y: 2 } },
      palette: { engineer: "bad-css" }, levels: -2, collapsed: ["a", 3], ports: { e: { from: "middle", to: "top" } },
    }));
    expect(result.grouping).toBe("roles");
    expect(result.positions).toEqual({ good: { x: 64, y: 99 } });
    expect(result.palette).toEqual({});
    expect(result.levels).toBe(0);
    expect(result.collapsed).toEqual(["a"]);
    expect(result.ports).toEqual({});
    for (const raw of ["broken", "null", "[]", JSON.stringify({ version: 2, grouping: "roles" }), null]) {
      expect(parseTeamPreferences(raw).grouping).toBe("reports");
    }
    expect(parseTeamPreferences(JSON.stringify({ version: 1, positions: [1, 2], palette: "x" })).positions).toEqual({});
  });

  it("round-trips through the versioned format", () => {
    const saved = parseTeamPreferences(JSON.stringify({ version: 1, snap: false, arrows: false, labels: false, positions: { a: { x: 1, y: 2 } } }));
    expect(parseTeamPreferences(serializeTeamPreferences(saved))).toEqual(saved);
  });

  it("supplies defaults for older saved layouts", () => {
    const old = parseTeamPreferences(JSON.stringify({ version: 1 }));
    expect([old.snap, old.arrows, old.labels, old.reporting, old.work, old.colors]).toEqual([true, true, true, true, true, true]);
    const saved = parseTeamPreferences(JSON.stringify({ version: 1, snap: false, arrows: false, labels: false }));
    expect([saved.snap, saved.arrows, saved.labels]).toEqual([false, false, false]);
  });

  it("restores custom palette colours but rejects invalid CSS values", () => {
    const customColor = "#" + "3a81c4";
    const settings = parseTeamPreferences(JSON.stringify({ version: 1, palette: {
      engineering: customColor, design: "purple", research: "url(external)", other: "#xyz",
    } }));
    expect(settings.palette).toEqual({ engineering: customColor, design: "purple" });
  });
});

describe("group colours", () => {
  it("maps presets and defaults to design tokens and keeps custom colours", () => {
    const customColor = "#" + "123456";
    expect(teamGroupColor("engineering", undefined)).toMatch(/^var\(--/);
    expect(teamGroupColor("engineering", "purple")).toMatch(/^var\(--/);
    expect(teamGroupColor("engineering", "purple")).not.toBe(teamGroupColor("engineering", "default"));
    expect(teamGroupColor("engineering", customColor)).toBe(customColor);
    expect(teamGroupColor("engineering", customColor, false)).toBe(teamGroupColor("x", "neutral"));
  });
  it("derives role families from official roles", () => {
    expect(roleGroupOf({ role: "cto" }).key).toBe("leadership");
    expect(roleGroupOf({ role: "qa" }).key).toBe("quality");
    expect(roleGroupOf({ role: "general" }).key).toBe("other");
    expect(roleGroupOf({ role: "something-new" }).key).toBe("other");
  });
});

describe("reporting structure", () => {
  it("keeps cycles and missing managers visible at the top", () => {
    const depths = teamDepths([member("a", "b"), member("b", "a"), member("c", "missing"), member("d", "c")]);
    expect(depths.get("c")).toBe(0);
    expect(depths.get("d")).toBe(1);
    expect([depths.get("a"), depths.get("b")].sort()).toEqual([0, 1]);
  });

  it("hides descendants without changing their saved coordinates", () => {
    const people = [member("A"), member("B", "A"), member("C", "B")];
    expect(visibleTeam(people, ["B"], 0).map((p) => p.id)).toEqual(["A", "B"]);
    expect(visibleTeam(people, [], 1).map((p) => p.id)).toEqual(["A"]);
    expect(visibleTeam([member("orphan", "missing")], [], 0)).toHaveLength(1);
  });
});

describe("initial layout", () => {
  it.each([1, 2, 12])("lays out %i agents without collisions", (count) => {
    const people = Array.from({ length: count }, (_, i) => member(String(i), i ? "0" : null));
    const result = layout(people);
    expect(Object.keys(result)).toHaveLength(count);
    noOverlaps(people.map((p) => ({ ...result[p.id]!, w: 320, h: 360 })));
  });

  it("groups cards by reporting level, top level first, reports under their manager", () => {
    const people = [member("CEO"), member("Head", "CEO"), member("Senior", "Head"), member("Other", "CEO")];
    const result = layout(people);
    expect(result.CEO!.y).toBeLessThan(result.Head!.y);
    expect(result.Head!.y).toBe(result.Other!.y);
    expect(result.Head!.y).toBeLessThan(result.Senior!.y);
    const boxes = people.map((p) => ({ ...result[p.id]!, w: 320, h: 360 }));
    const route = routeAgentLink(boxes[0]!, boxes[1]!, boxes);
    route.slice(1).forEach((point, i) => boxes.forEach((card) => expect(crossesCard(route[i]!, point, card)).toBe(false)));
  });

  it("groups cards by role family when asked", () => {
    const people = [member("eng", null, "engineer"), member("lead", null, "ceo"), member("qa", "lead", "qa"), member("eng2", "lead", "devops")];
    const result = layoutTeam(people, {}, {}, "roles", metrics, byRole);
    expect(result.lead!.y).toBeLessThan(result.eng!.y);
    expect(result.eng!.y).toBe(result.eng2!.y);
    expect(result.eng!.y).toBeLessThan(result.qa!.y);
  });

  it("keeps measured cards separate and ignores polling order", () => {
    const people = [member("A"), member("B", "A"), member("C", "A"), member("D", "B")];
    const sizes = { A: { w: 320, h: 490 }, B: { w: 320, h: 400 } };
    const result = layout(people, {}, sizes);
    expect(result).toEqual(layout([...people].reverse(), {}, sizes));
    noOverlaps(people.map((p) => ({ ...result[p.id]!, ...(sizes[p.id as keyof typeof sizes] ?? { w: 320, h: 360 }) })));
  });
});

describe("newcomers", () => {
  it("preserves manual placement on join, leave and role/manager change", () => {
    const saved = { A: { x: 500, y: 600 }, B: { x: 64, y: 64 } };
    const result = layout([member("A", "C"), member("C")], saved);
    expect(result.A).toEqual(saved.A);
    expect(result.B).toBeUndefined();
    expect(boxesOverlap({ ...result.A!, w: 320, h: 360 }, { ...result.C!, w: 320, h: 360 })).toBe(false);
  });

  it("places newcomers beside a tall saved team and preserves existing positions", () => {
    const saved = { A: { x: 64, y: 64 }, B: { x: 64, y: 504 } };
    const result = layout([member("A"), member("B"), member("C")], saved);
    expect(result.A).toEqual(saved.A);
    expect(result.B).toEqual(saved.B);
    expect(result.C!.x).toBeGreaterThan(saved.A.x);
    expect(result.C!.y).toBeLessThanOrEqual(saved.B.y);
  });

  it("fills a vacant slot before extending a saved grid", () => {
    const saved = { A: { x: 64, y: 64 }, B: { x: 464, y: 64 }, C: { x: 64, y: 504 } };
    const result = layout([member("A"), member("B"), member("C"), member("D")], saved);
    expect(result.D).toEqual({ x: 464, y: 504 });
  });
});

describe("snapping", () => {
  it("snaps near card edges and centres and otherwise uses the grid", () => {
    const size = { w: 320, h: 360 };
    expect(snapTeamPosition({ x: 470, y: 555 }, size, [{ x: 464, y: 64, w: 320, h: 410 }], 64)).toEqual({ x: 464, y: 560 });
    expect(snapTeamPosition({ x: 64, y: 94 }, size, [{ x: 464, y: 64, w: 320, h: 410 }], 64).y).toBe(89);
    expect(snapTeamPosition({ x: 1000, y: 1000 }, size, [], 64)).toEqual({ x: 1008, y: 1008 });
  });
});

describe("Magic sort", () => {
  const people = ["a", "b", "c", "d"].map((id) => member(id));
  const tidy = (saved: Positions, sizes = {}, team = people, grouping: "reports" | "roles" = "reports") =>
    tidyTeam(team, sizes, saved, grouping, metrics, byRole);

  it("preserves a tidy arrangement even when its order differs from alphabetical order", () => {
    const grid = layout(people);
    const saved = { a: grid.d!, b: grid.c!, c: grid.b!, d: grid.a! };
    expect(tidy(saved)).toEqual(saved);
    expect(tidyTeam([...people].reverse(), {}, saved, "reports", metrics, byRole)).toEqual(saved);
  });

  it("snaps nearby displaced cards back without swapping them and is repeatable", () => {
    const grid = layout(people);
    const saved = { a: { x: grid.d!.x + 10, y: grid.d!.y }, b: { x: grid.c!.x - 10, y: grid.c!.y }, c: grid.b!, d: grid.a! };
    const next = tidy(saved);
    expect(next).toEqual({ a: grid.d, b: grid.c, c: grid.b, d: grid.a });
    expect(tidy(next)).toEqual(next);
  });

  it("stays where the team is instead of jumping back to the origin", () => {
    const far = Object.fromEntries(Object.entries(layout(people)).map(([id, p]) => [id, { x: p.x + 3200, y: p.y + 1600 }]));
    expect(tidy(far)).toEqual(far);
  });

  it("resolves overlaps with unequal card heights without losing agents", () => {
    const sizes = { a: { w: 320, h: 440 }, b: { w: 320, h: 300 } };
    const next = tidy(Object.fromEntries(people.map((m) => [m.id, { x: 0, y: 0 }])), sizes);
    noOverlaps(people.map((m) => ({ ...next[m.id]!, ...(sizes[m.id as keyof typeof sizes] ?? { w: 320, h: 360 }) })), metrics.gap / 2);
    expect(Object.keys(next)).toHaveLength(4);
  });

  it("groups scattered cards by reporting level", () => {
    const team = [member("boss"), member("x", "boss"), member("y", "boss"), member("z", "x")];
    const scattered = { boss: { x: 900, y: 900 }, x: { x: 0, y: 0 }, y: { x: 1800, y: 40 }, z: { x: 400, y: 1600 } };
    const next = tidy(scattered, {}, team);
    expect(next.boss!.y).toBeLessThan(next.x!.y);
    expect(next.x!.y).toBe(next.y!.y);
    expect(next.x!.y).toBeLessThan(next.z!.y);
    expect(next.x!.x).toBeLessThan(next.y!.x); // x started on the left, so it stays on the left
    expect(tidy(next, {}, team)).toEqual(next);
  });
});
