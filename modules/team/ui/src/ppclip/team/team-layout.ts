/**
 * ppclip TEAM-1: Team canvas layout logic. Pure functions, no DOM.
 *
 * - Preferences are versioned and validated: browser storage is untrusted, so a
 *   corrupt or old value always falls back to a usable view.
 * - Saved positions never move on their own; newcomers take a free slot beside
 *   the existing cards.
 * - Magic sort builds a compact grid grouped by reporting level or role family,
 *   then assigns cards to slots inside each group with minimum total movement.
 */
import type { PortSide, RouteBox, RoutePoint } from "./agent-link-routing";
import { isTeamPaletteValue, TEAM_ROLE_GROUP_ORDER } from "./role-groups";

export type TeamMember = { id: string; name: string; role: string; reportsTo: string | null };
export type Positions = Record<string, RoutePoint>;
export type Sizes = Record<string, { w: number; h: number }>;
export type TeamGrouping = "reports" | "roles";
export type TeamMetrics = { width: number; height: number; gap: number; padding: number };
export type TeamPreferences = {
  grouping: TeamGrouping;
  levels: number;
  reporting: boolean;
  work: boolean;
  snap: boolean;
  arrows: boolean;
  labels: boolean;
  colors: boolean;
  palette: Record<string, string>;
  collapsed: string[];
  positions: Positions;
  ports: Record<string, { from: PortSide; to: PortSide }>;
};

/** Same key and format as the earlier ppclip Team page, so saved layouts carry over. */
const TEAM_STORAGE_VERSION = 1;
export const teamStorageKey = (companyId: string) => `paperclip:team-view:v${TEAM_STORAGE_VERSION}:${companyId}`;
const TEAM_GRID = 16;
const SNAP_DISTANCE = 16;
const COORDINATE_LIMIT = 100000;
const SIDES: readonly PortSide[] = ["top", "bottom", "left", "right"];
const TOGGLES = ["reporting", "work", "colors", "snap", "arrows", "labels"] as const;

export const defaultTeamPreferences = (): TeamPreferences => ({
  grouping: "reports",
  levels: 0,
  reporting: true,
  work: true,
  colors: true,
  snap: true,
  arrows: true,
  labels: true,
  palette: {},
  collapsed: [],
  positions: {},
  ports: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validPoint = (point: unknown): point is RoutePoint =>
  isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y)
  && Math.abs(point.x as number) <= COORDINATE_LIMIT && Math.abs(point.y as number) <= COORDINATE_LIMIT;
export const clampCoordinate = (value: number) => Math.max(-COORDINATE_LIMIT, Math.min(COORDINATE_LIMIT, value));

export function parseTeamPreferences(raw: string | null): TeamPreferences {
  const result = defaultTeamPreferences();
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!isRecord(value) || value.version !== TEAM_STORAGE_VERSION) return result;
    if (value.grouping === "roles") result.grouping = "roles";
    if (Number.isInteger(value.levels) && (value.levels as number) >= 0 && (value.levels as number) <= 100) result.levels = value.levels as number;
    for (const key of TOGGLES) if (typeof value[key] === "boolean") result[key] = value[key] as boolean;
    if (Array.isArray(value.collapsed)) result.collapsed = value.collapsed.filter((id): id is string => typeof id === "string");
    if (isRecord(value.positions)) {
      for (const [id, point] of Object.entries(value.positions)) if (validPoint(point)) result.positions[id] = { x: point.x, y: point.y };
    }
    if (isRecord(value.palette)) {
      for (const [group, color] of Object.entries(value.palette)) if (isTeamPaletteValue(color)) result.palette[group] = color;
    }
    if (isRecord(value.ports)) {
      for (const [id, ports] of Object.entries(value.ports)) {
        if (isRecord(ports) && SIDES.includes(ports.from as PortSide) && SIDES.includes(ports.to as PortSide)) {
          result.ports[id] = { from: ports.from as PortSide, to: ports.to as PortSide };
        }
      }
    }
  } catch {
    // Old or invalid storage falls back to a usable view.
  }
  return result;
}

export const serializeTeamPreferences = (preferences: TeamPreferences) =>
  JSON.stringify({ version: TEAM_STORAGE_VERSION, ...preferences });

/** Reporting depth from the top (0). Cycles and missing managers stay visible at the top. */
export function teamDepths(members: TeamMember[]): Map<string, number> {
  const byId = new Map(members.map((member) => [member.id, member]));
  const parentOf = (id: string) => {
    const parent = byId.get(id)?.reportsTo;
    return parent && parent !== id && byId.has(parent) ? parent : null;
  };
  // In a reporting cycle, the member with the smallest id is treated as the top.
  const cycleRoots = new Set<string>();
  for (const id of byId.keys()) {
    const path: string[] = [];
    for (let cursor: string | null = id; cursor; cursor = parentOf(cursor)) {
      const seen = path.indexOf(cursor);
      if (seen >= 0) {
        cycleRoots.add(path.slice(seen).sort()[0]!);
        break;
      }
      path.push(cursor);
    }
  }
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const parent = cycleRoots.has(id) ? null : parentOf(id);
    const value = parent ? 1 + depth(parent) : 0;
    depths.set(id, value);
    return value;
  };
  [...byId.keys()].sort().forEach(depth);
  return depths;
}

/** Hide collapsed branches and levels below the chosen depth; relationships themselves never change. */
export function visibleTeam<T extends TeamMember>(members: T[], collapsed: string[], levels: number): T[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const depths = teamDepths(members);
  return members.filter((member) => {
    if (levels && (depths.get(member.id) ?? 0) >= levels) return false;
    const visited = new Set([member.id]);
    let parent = member.reportsTo;
    while (parent && !visited.has(parent)) {
      if (collapsed.includes(parent)) return false;
      visited.add(parent);
      parent = byId.get(parent)?.reportsTo ?? null;
    }
    return true;
  });
}

export function boxesOverlap(a: RouteBox, b: RouteBox, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Snap to nearby card edges/centres so connected cards line up, otherwise to the grid. */
export function snapTeamPosition(point: RoutePoint, size: { w: number; h: number }, others: RouteBox[], padding: number): RoutePoint {
  const snapAxis = (value: number, length: number, axis: "x" | "y") => {
    const candidates = others.flatMap((box) => {
      const otherLength = axis === "x" ? box.w : box.h;
      return [box[axis], box[axis] + (otherLength - length) / 2, box[axis] + otherLength - length];
    });
    const nearest = candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value) || a - b)[0];
    return nearest !== undefined && Math.abs(nearest - value) <= SNAP_DISTANCE
      ? nearest
      : padding + Math.round((value - padding) / TEAM_GRID) * TEAM_GRID;
  };
  return { x: snapAxis(point.x, size.w, "x"), y: snapAxis(point.y, size.h, "y") };
}

type Slot = { id: string; group: string; x: number; y: number; w: number; h: number };

const byName = (a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Group key and order for each member: reporting level, or role family (then level). */
function orderedGroups(members: TeamMember[], grouping: TeamGrouping, roleGroup: (member: TeamMember) => string) {
  const depths = teamDepths(members);
  const groups = new Map<string, TeamMember[]>();
  const keyOf = (member: TeamMember) => grouping === "roles" ? roleGroup(member) : String(depths.get(member.id) ?? 0);
  for (const member of members) {
    const key = keyOf(member);
    groups.set(key, [...(groups.get(key) ?? []), member]);
  }
  const rank = (key: string) => {
    if (grouping === "reports") return Number(key);
    const index = TEAM_ROLE_GROUP_ORDER.indexOf(key);
    return index < 0 ? TEAM_ROLE_GROUP_ORDER.length : index;
  };
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  // Reports sit under their manager's position in the row above; role rows keep seniority first.
  const order = new Map<string, number>();
  return keys.map((key) => {
    const people = groups.get(key)!.sort((a, b) => {
      if (grouping === "reports") {
        const parentA = a.reportsTo ? order.get(a.reportsTo) ?? -1 : -1;
        const parentB = b.reportsTo ? order.get(b.reportsTo) ?? -1 : -1;
        return parentA - parentB || byName(a, b);
      }
      return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0) || byName(a, b);
    });
    people.forEach((member, index) => order.set(member.id, index));
    return { key, people };
  });
}

/** One row (or more, when wrapping) per group; rows are centred on the widest row. */
function groupedGrid(members: TeamMember[], sizes: Sizes, grouping: TeamGrouping, metrics: TeamMetrics, roleGroup: (member: TeamMember) => string): Slot[] {
  if (!members.length) return [];
  const size = (id: string) => sizes[id] ?? { w: metrics.width, h: metrics.height };
  const groups = orderedGroups(members, grouping, roleGroup);
  const cellWidth = Math.max(metrics.width, ...members.map((member) => size(member.id).w));
  const rowsFor = (columns: number) => groups.flatMap(({ key, people }) =>
    Array.from({ length: Math.ceil(people.length / columns) }, (_, row) => ({ key, people: people.slice(row * columns, (row + 1) * columns) })));
  const extent = (columns: number) => {
    const rows = rowsFor(columns);
    const width = Math.max(...rows.map((row) => row.people.length)) * (cellWidth + metrics.gap) - metrics.gap;
    const height = rows.reduce((sum, row) => sum + Math.max(...row.people.map((member) => size(member.id).h)) + metrics.gap, -metrics.gap);
    return width * height + (width - height) ** 2 / 2;
  };
  const widest = Math.max(...groups.map((group) => group.people.length));
  const columns = Array.from({ length: widest }, (_, index) => index + 1).sort((a, b) => extent(a) - extent(b) || a - b)[0]!;
  const rows = rowsFor(columns);
  const fullWidth = Math.max(...rows.map((row) => row.people.length)) * (cellWidth + metrics.gap) - metrics.gap;
  const slots: Slot[] = [];
  let y = metrics.padding;
  for (const row of rows) {
    const rowHeight = Math.max(...row.people.map((member) => size(member.id).h));
    const rowWidth = row.people.length * (cellWidth + metrics.gap) - metrics.gap;
    const left = metrics.padding + Math.round((fullWidth - rowWidth) / 2 / TEAM_GRID) * TEAM_GRID;
    row.people.forEach((member, index) => {
      const { w, h } = size(member.id);
      slots.push({ id: member.id, group: row.key, x: left + index * (cellWidth + metrics.gap) + (cellWidth - w) / 2, y: y + (rowHeight - h) / 2, w, h });
    });
    y += rowHeight + metrics.gap;
  }
  return slots;
}

/** Saved cards stay put; newcomers fill a free slot next to them. With nothing saved, a grouped grid. */
export function layoutTeam(members: TeamMember[], sizes: Sizes, saved: Positions, grouping: TeamGrouping, metrics: TeamMetrics, roleGroup: (member: TeamMember) => string): Positions {
  const size = (id: string) => sizes[id] ?? { w: metrics.width, h: metrics.height };
  const result: Positions = {};
  const occupied: RouteBox[] = [];
  for (const member of members) {
    const point = saved[member.id];
    if (!point) continue;
    result[member.id] = point;
    occupied.push({ ...point, ...size(member.id) });
  }
  if (!occupied.length) {
    for (const slot of groupedGrid(members, sizes, grouping, metrics, roleGroup)) result[slot.id] = { x: slot.x, y: slot.y };
    return result;
  }
  const newcomers = groupedGrid(members.filter((member) => !result[member.id]), sizes, grouping, metrics, roleGroup);
  for (const { id } of newcomers) {
    const dimensions = size(id);
    const left = Math.min(...occupied.map((box) => box.x));
    const top = Math.min(...occupied.map((box) => box.y));
    const right = Math.max(...occupied.map((box) => box.x + box.w));
    const bottom = Math.max(...occupied.map((box) => box.y + box.h));
    const candidates = occupied.flatMap((box) => [
      { x: box.x + box.w + metrics.gap, y: box.y },
      { x: box.x - dimensions.w - metrics.gap, y: box.y },
      { x: box.x, y: box.y + box.h + metrics.gap },
      { x: box.x, y: box.y - dimensions.h - metrics.gap },
    ]).map((point) => ({ ...point, ...dimensions }))
      .filter((box) => !occupied.some((other) => boxesOverlap(box, other, metrics.gap / 2)));
    // Prefer the slot that keeps the whole team compact and roughly square.
    const score = (box: RouteBox) => {
      const w = Math.max(right, box.x + box.w) - Math.min(left, box.x);
      const h = Math.max(bottom, box.y + box.h) - Math.min(top, box.y);
      return w * h + (w - h) ** 2 / 2;
    };
    candidates.sort((a, b) => score(a) - score(b)
      || Number(a.x < left) - Number(b.x < left) || Number(a.y < top) - Number(b.y < top) || a.y - b.y || a.x - b.x);
    const box = candidates[0]!; // The outermost right/bottom side always has a free candidate.
    result[id] = { x: box.x, y: box.y };
    occupied.push(box);
  }
  return result;
}

/** Minimum-cost assignment (Hungarian algorithm). Returns, for each row, its column. */
function assign(costs: number[][]): number[] {
  const n = costs.length;
  const u = Array(n + 1).fill(0), v = Array(n + 1).fill(0);
  const owner = Array(n + 1).fill(0), previous = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let column = 0;
    const best = Array(n + 1).fill(Infinity), used = Array(n + 1).fill(false);
    do {
      used[column] = true;
      const row = owner[column];
      let delta = Infinity, next = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cost = costs[row - 1]![j - 1]! - u[row] - v[j];
        if (cost < best[j]) { best[j] = cost; previous[j] = column; }
        if (best[j] < delta) { delta = best[j]; next = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[owner[j]] += delta; v[j] -= delta; } else best[j] -= delta;
      }
      column = next;
    } while (owner[column]);
    do { const next = previous[column]; owner[column] = owner[next]; column = next; } while (column);
  }
  const result = Array(n).fill(0);
  for (let j = 1; j <= n; j++) result[owner[j] - 1] = j - 1;
  return result;
}

/**
 * Magic sort: a compact grid grouped by reporting level or role family, placed
 * where the team already is, with each card taking the nearest free slot of its
 * own group (globally minimum squared travel). Repeating it changes nothing.
 */
export function tidyTeam(members: TeamMember[], sizes: Sizes, current: Positions, grouping: TeamGrouping, metrics: TeamMetrics, roleGroup: (member: TeamMember) => string): Positions {
  if (!members.length) return {};
  const ordered = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const dimensions = (id: string) => sizes[id] ?? { w: metrics.width, h: metrics.height };
  // Uniform slots use the largest card, so any assignment inside a group cannot overlap.
  const w = Math.max(...ordered.map((member) => dimensions(member.id).w));
  const h = Math.max(...ordered.map((member) => dimensions(member.id).h));
  const uniform = Object.fromEntries(ordered.map((member) => [member.id, { w, h }]));
  const slots = groupedGrid(ordered, uniform, grouping, metrics, roleGroup);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const center = (member: TeamMember) => {
    const slot = slotById.get(member.id)!;
    const point = current[member.id] ?? slot;
    const size = dimensions(member.id);
    return { x: point.x + size.w / 2, y: point.y + size.h / 2 };
  };
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const centers = ordered.map(center);
  const shift = (axis: "x" | "y") =>
    Math.round((mean(centers.map((point) => point[axis])) - mean(slots.map((slot) => slot[axis] + (axis === "x" ? w : h) / 2))) / TEAM_GRID) * TEAM_GRID;
  const dx = shift("x"), dy = shift("y");
  const result: Positions = {};
  for (const group of new Set(slots.map((slot) => slot.group))) {
    const groupSlots = slots.filter((slot) => slot.group === group);
    const people = groupSlots.map((slot) => ordered.find((member) => member.id === slot.id)!).sort((a, b) => a.id.localeCompare(b.id));
    const targets = groupSlots.map((slot) => ({ x: slot.x + w / 2 + dx, y: slot.y + h / 2 + dy }));
    const choice = assign(people.map((member) => {
      const point = center(member);
      return targets.map((target) => (point.x - target.x) ** 2 + (point.y - target.y) ** 2);
    }));
    people.forEach((member, index) => {
      const target = targets[choice[index]!]!;
      const size = dimensions(member.id);
      result[member.id] = { x: target.x - size.w / 2, y: target.y - size.h / 2 };
    });
  }
  return result;
}
