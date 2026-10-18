/**
 * ppclip TEAM-1: orthogonal line router for the Team canvas (pure geometry, no DOM).
 * Reporting lines may share one branch per manager; work arrows route around
 * cards and avoid running along lines drawn earlier. Saved connection sides are
 * soft preferences that give way to a clearly shorter route.
 */
export type RouteBox = { x: number; y: number; w: number; h: number };
export type RoutePoint = { x: number; y: number };
export type PortSide = "top" | "bottom" | "left" | "right";
type RouteCard = RouteBox & { group?: RouteBox; name?: RoutePoint };
const inside = (p: RoutePoint, b: RouteBox) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
export const crossesCard = (a: RoutePoint, b: RoutePoint, c: RouteBox) => a.x === b.x
  ? a.x > c.x && a.x < c.x + c.w && Math.max(a.y, b.y) > c.y && Math.min(a.y, b.y) < c.y + c.h
  : a.y > c.y && a.y < c.y + c.h && Math.max(a.x, b.x) > c.x && Math.min(a.x, b.x) < c.x + c.w;

/** Share a horizontal branch among visible siblings in a clear vertical gap.
 * Missing entries deliberately fall back to the adaptive individual router.
 */
export function routeReportingBranches(
  edges: readonly { id: string; from: string; to: string }[],
  boxes: ReadonlyMap<string, RouteBox>,
): Map<string, RoutePoint[]> {
  const result = new Map<string, RoutePoint[]>();
  const cards = [...boxes.values()];
  const managers = new Map<string, typeof edges[number][]>();
  for (const edge of edges) {
    const siblings = managers.get(edge.from) ?? [];
    siblings.push(edge);
    managers.set(edge.from, siblings);
  }
  for (const [manager, edges] of managers) {
    const parent = boxes.get(manager);
    if (!parent) continue;
    for (const direction of [1, -1]) {
      const start = { x: parent.x + parent.w / 2, y: direction === 1 ? parent.y + parent.h : parent.y };
      const siblings = edges.flatMap(edge => {
        const child = boxes.get(edge.to);
        if (!child) return [];
        const end = { x: child.x + child.w / 2, y: direction === 1 ? child.y : child.y + child.h };
        return (end.y - start.y) * direction >= 32 ? [{ edge, end }] : [];
      });
      if (siblings.length < 2) continue;
      const nearest = direction === 1 ? Math.min(...siblings.map(s => s.end.y)) : Math.max(...siblings.map(s => s.end.y));
      const low = Math.min(start.y, nearest) + 16;
      const high = Math.max(start.y, nearest) - 16;
      // Center the shared gap, not the children: a distant child must not
      // push the branch against a nearer card's top edge.
      const ideal = (start.y + nearest) / 2;
      const candidates = [...new Set([ideal, low, high, ...cards.flatMap(c => [c.y - 16, c.y + c.h + 16])])]
        .filter(y => y >= low && y <= high)
        .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b);
      for (const y of candidates) {
        const paths = siblings.map(({ end }) => [start, { x: start.x, y }, { x: end.x, y }, end]);
        if (paths.some(path => path.slice(1).some((point, i) => cards.some(card => crossesCard(path[i], point, card))))) continue;
        siblings.forEach(({ edge }, i) => result.set(edge.id, paths[i].filter((p, j, path) =>
          j === 0 || p.x !== path[j - 1].x || p.y !== path[j - 1].y)));
        break;
      }
    }
  }
  return result;
}

/** Align opposing elbows on the same reporting trunk without rerouting edges.
 * Only monotone vertical–horizontal–vertical elbows can move, within their
 * original height range. Existing same-height junctions move as one unit.
 */
export function alignOpposingReportingJunctions(
  routes: readonly { id: string; from: string; to: string; points: RoutePoint[] }[],
  cards: readonly RouteBox[],
): Map<string, RoutePoint[]> {
  type Arm = { id: string; segment: number; side: number; low: number; high: number };
  type Junction = { trunk: string; y: number; arms: Arm[] };
  const originals = new Map(routes.map(route => [route.id, route.points]));
  const result = new Map(routes.map(route => [route.id, route.points.map(point => ({ ...point }))]));
  const junctions = new Map<string, Junction>();
  for (const { id, from, to, points } of routes) {
    for (let i = 1; i + 2 < points.length; i++) {
      const [before, a, b, after] = points.slice(i - 1, i + 3);
      if (a.y !== b.y || a.x === b.x || before.x !== a.x || after.x !== b.x) continue;
      // Keep both vertical legs and their direction, with room for arrowheads.
      const low = Math.min(before.y, after.y) + 16;
      const high = Math.max(before.y, after.y) - 16;
      if (a.y < low || a.y > high) continue;
      for (const end of ["from", "to"] as const) {
        if (end === "from" ? i !== 1 : i !== points.length - 3) continue;
        const anchor = end === "from" ? before : after;
        const joint = end === "from" ? a : b;
        const other = end === "from" ? b : a;
        // Same agent AND same port: unrelated vertical lines never merge.
        const trunk = `${end}:${end === "from" ? from : to}:${joint.x}:${anchor.y}`;
        const key = `${trunk}:${joint.y}`;
        const junction = junctions.get(key) ?? { trunk, y: joint.y, arms: [] };
        junction.arms.push({ id, segment: i, side: Math.sign(other.x - joint.x), low, high });
        junctions.set(key, junction);
      }
    }
  }
  const groups = [...junctions.values()];
  const pairs = groups.flatMap((a, i) => groups.slice(i + 1).flatMap(b =>
    a.trunk === b.trunk && a.y !== b.y && a.arms.some(left => b.arms.some(right => left.side === -right.side))
      ? [{ a, b }] : []));
  pairs.sort((p, q) => Math.abs(p.a.y - p.b.y) - Math.abs(q.a.y - q.b.y)
    || p.a.trunk.localeCompare(q.a.trunk) || Math.min(p.a.y, p.b.y) - Math.min(q.a.y, q.b.y));
  const settled = new Set<string>();
  for (const { a, b } of pairs) {
    const arms = [...a.arms, ...b.arms];
    const keyOf = (arm: Arm) => `${arm.id}:${arm.segment}`;
    if (arms.some(arm => settled.has(keyOf(arm)))) continue;
    const low = Math.max(Math.min(a.y, b.y), ...arms.map(arm => arm.low));
    const high = Math.min(Math.max(a.y, b.y), ...arms.map(arm => arm.high));
    if (low > high) continue;
    const ideal = Math.max(low, Math.min(high, (a.y * a.arms.length + b.y * b.arms.length) / arms.length));
    const candidates = [...new Set([ideal, a.y, b.y, low, high, ...cards.flatMap(card => [card.y - 16, card.y + card.h + 16])])]
      .filter(y => y >= low && y <= high)
      .sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal) || x - y);
    for (const y of candidates) {
      const updates = arms.map(arm => {
        const path = result.get(arm.id)!.map((point, i) =>
          i === arm.segment || i === arm.segment + 1 ? { ...point, y } : point);
        return { arm, path };
      });
      if (updates.some(({ arm, path }) => path.slice(1).some((point, i) => {
        const original = originals.get(arm.id)!;
        const dy = original[i + 1].y - original[i].y;
        // A route may participate at both ends. Recheck the complete path so
        // aligning a second junction cannot reverse or pinch an earlier leg.
        return (dy !== 0 && ((point.y - path[i].y) * dy <= 0
          || Math.abs(point.y - path[i].y) < Math.min(16, Math.abs(dy))))
          || cards.some(card => crossesCard(path[i], point, card));
      }))) continue;
      for (const { arm, path } of updates) {
        result.set(arm.id, path);
        settled.add(keyOf(arm));
      }
      break;
    }
  }
  return result;
}

// Whole groups are obstacles. Only exposed card sides may connect through their own group's padding.
export function routeAgentLink(from: RouteCard, to: RouteCard, cards: RouteCard[], options: {
  side?: 'above' | 'below';
  occupied?: RoutePoint[][];
  ports?: { from: PortSide; to: PortSide };
  preferredPorts?: { from: PortSide; to: PortSide };
  /** Reporting arrows prefer entering a lower child's top (or an upper child's bottom). */
  preferVerticalEntry?: boolean;
  shortLeads?: boolean;
} = {}): RoutePoint[] {
  // Saved sides are a soft preference, never a permanent constraint. Compare
  // collision-free alternatives with a deadband so small drags stay calm.
  if (options.preferredPorts) {
    const { preferredPorts, ...rest } = options;
    const preferred = routeAgentLink(from, to, cards, { ...rest, ports: preferredPorts });
    const adaptive = routeAgentLink(from, to, cards, { ...rest, ports: undefined, shortLeads: true });
    const entryPenalty = (path: RoutePoint[]) => {
      if (!options.preferVerticalEntry || !path.length) return 0;
      const centerY = from.y + from.h / 2;
      const entryY = to.y >= centerY + 16 ? to.y : to.y + to.h <= centerY - 16 ? to.y + to.h : null;
      // A bounded preference can beat a small distance saving, but yields to long obstacle detours.
      return entryY !== null && path.at(-1)!.y !== entryY ? Math.min(160, Math.max(64, to.w / 2)) : 0;
    };
    const cost = (path: RoutePoint[]) => path.length < 2 ? Infinity : path.slice(1).reduce((sum, p, i) => {
      const a = path[i];
      const overlap = (options.occupied ?? []).reduce((n, line) => n + line.slice(1).reduce((m, d, j) => {
        const c = line[j];
        const length = a.y === p.y && c.y === d.y && Math.abs(a.y-c.y) < 6
          ? Math.min(Math.max(a.x,p.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,p.x),Math.min(c.x,d.x))
          : a.x === p.x && c.x === d.x && Math.abs(a.x-c.x) < 6
            ? Math.min(Math.max(a.y,p.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,p.y),Math.min(c.y,d.y)) : 0;
        return m + Math.max(0,length)*40;
      },0),0);
      return sum + Math.abs(p.x-a.x) + Math.abs(p.y-a.y) + overlap;
    }, Math.max(0,path.length-2)*24 + entryPenalty(path));
    // Check simple routes across ALL side pairs before trusting the corridor
    // search. Its centering preference can otherwise hide a clear short elbow.
    const portCandidates = (card: RouteCard) => [
      [{x:card.x+card.w/2,y:card.y},{x:0,y:-1}],
      [{x:card.x+card.w/2,y:card.y+card.h},{x:0,y:1}],
      [{x:card.x,y:card.y+card.h/2},{x:-1,y:0}],
      [{x:card.x+card.w,y:card.y+card.h/2},{x:1,y:0}],
    ];
    let bestRoute = adaptive;
    if (!from.group && !to.group && !to.name && !options.side) {
      for (const [start, outward] of portCandidates(from)) for (const [end, inward] of portCandidates(to)) {
        const a={x:start.x+outward.x*16,y:start.y+outward.y*16};
        const b={x:end.x+inward.x*16,y:end.y+inward.y*16};
        const candidates = [
          [start,{x:start.x,y:end.y},end], [start,{x:end.x,y:start.y},end],
          [start,a,{x:a.x,y:b.y},b,end], [start,a,{x:b.x,y:a.y},b,end],
          [start,{x:(start.x+end.x)/2,y:start.y},{x:(start.x+end.x)/2,y:end.y},end],
          [start,{x:start.x,y:(start.y+end.y)/2},{x:end.x,y:(start.y+end.y)/2},end],
        ];
        for (const candidate of candidates) {
          const unique=candidate.filter((p,i)=>!i||p.x!==candidate[i-1].x||p.y!==candidate[i-1].y);
          // Reject reversals before removing collinear points.
          if(unique.some((p,i)=>i>0&&i<unique.length-1&&
            (p.x-unique[i-1].x)*(unique[i+1].x-p.x)+(p.y-unique[i-1].y)*(unique[i+1].y-p.y)<0)) continue;
          const route=unique.filter((p,i)=>!i||i===unique.length-1||!((unique[i-1].x===p.x&&p.x===unique[i+1].x)||(unique[i-1].y===p.y&&p.y===unique[i+1].y)));
          if(route.length<2) continue;
          const next=route[1],prev=route[route.length-2];
          if((next.x-start.x)*outward.x+(next.y-start.y)*outward.y<=0 || (prev.x-end.x)*inward.x+(prev.y-end.y)*inward.y<=0) continue;
          if(route.slice(1).some((p,i)=>cards.some(card=>crossesCard(route[i],p,card)))) continue;
          if(cost(route)<cost(bestRoute)) bestRoute=route;
        }
      }
    }
    const preferredCost = cost(preferred), adaptiveCost = cost(bestRoute);
    return adaptiveCost + Math.max(48, adaptiveCost * 0.15) < preferredCost ? bestRoute : preferred.length ? preferred : bestRoute;
  }
  // Aligned cards should connect directly, without a detour through the corridor grid.
  if (!options.ports && !options.side && !from.group && !to.group && !to.name && !options.occupied?.length) {
    const ax = from.x + from.w / 2, bx = to.x + to.w / 2;
    const ay = from.y + from.h / 2, by = to.y + to.h / 2;
    const direct = Math.abs(ax - bx) < 0.01 && (from.y + from.h <= to.y || to.y + to.h <= from.y)
      ? [{ x: ax, y: ay < by ? from.y + from.h : from.y }, { x: bx, y: ay < by ? to.y : to.y + to.h }]
      : Math.abs(ay - by) < 0.01 && (from.x + from.w <= to.x || to.x + to.w <= from.x)
        ? [{ x: ax < bx ? from.x + from.w : from.x, y: ay }, { x: ax < bx ? to.x : to.x + to.w, y: by }]
        : null;
    if (direct && !cards.some(card => crossesCard(direct[0], direct[1], card))) return direct;
  }
  const obstacles = [...new Map(cards.map(c => { const g = c.group ?? c; return [JSON.stringify([g.x,g.y,g.w,g.h]), g]; })).values()];
  const fromX = from.x+from.w/2, toX = to.x+to.w/2;
  const divider = (fromX+toX)/2;
  const between = obstacles.filter(b => b.x < Math.max(fromX,toX) && b.x+b.w > Math.min(fromX,toX)
    && b.y < Math.max(from.y+from.h,to.y+to.h) && b.y+b.h > Math.min(from.y,to.y));
  const above = Math.min(...between.map(b=>b.y));
  const below = Math.max(...between.map(b=>b.y+b.h));
  const allowed = (a: RoutePoint,b: RoutePoint) => !options.side || a.y!==b.y
    || Math.min(a.x,b.x)>divider || Math.max(a.x,b.x)<=divider
    || (options.side==='above' ? a.y<above : a.y>below);
  const overlapCost = (a: RoutePoint,b: RoutePoint) => (options.occupied??[]).reduce((cost,path) => cost+path.slice(1).reduce((sum,d,i)=>{
    const c=path[i];
    const horizontal=a.y===b.y && c.y===d.y && Math.abs(a.y-c.y)<6;
    const vertical=a.x===b.x && c.x===d.x && Math.abs(a.x-c.x)<6;
    const overlap=horizontal ? Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))
      : vertical ? Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y)) : 0;
    return sum+Math.max(0,overlap)*40;
  },0),0);
  const left = Math.min(...obstacles.map(b => b.x)) - 32, right = Math.max(...obstacles.map(b => b.x+b.w)) + 32;
  const top = Math.min(...obstacles.map(b => b.y))-24, bottom = Math.max(...obstacles.map(b => b.y+b.h))+24;
  const ports = (b: RouteCard, target: boolean) => {
    const g = b.group ?? b;
    const center = target && b.name ? b.name : { x:b.x+b.w/2, y:b.y+b.h/2 };
    const candidates = [
      { port:{x:center.x,y:b.y}, edge:{x:center.x,y:g.y}, axis:'y', direction:-1 },
      { port:{x:center.x,y:b.y+b.h}, edge:{x:center.x,y:g.y+g.h}, axis:'y', direction:1 },
      { port:{x:b.x,y:center.y}, edge:{x:g.x,y:center.y}, axis:'x', direction:-1 },
      { port:{x:b.x+b.w,y:center.y}, edge:{x:g.x+g.w,y:center.y}, axis:'x', direction:1 },
    ] as const;
    return candidates.flatMap(({port,edge,axis,direction}, index) => {
      if (options.ports && ["top", "bottom", "left", "right"][index] !== options.ports[target ? "to" : "from"]) return [];
      // A side facing another member of this group is not an entrance or exit.
      if (cards.some(c => c !== b && crossesCard(port,edge,c))) return [];
      const others = obstacles.filter(c => c !== g);
      let coordinate: number;
      if (axis === 'x') {
        const facing = others.filter(c => edge.y > c.y && edge.y < c.y+c.h);
        const near = direction < 0 ? Math.max(-Infinity,...facing.filter(c=>c.x+c.w<=edge.x).map(c=>c.x+c.w)) : Math.min(Infinity,...facing.filter(c=>c.x>=edge.x).map(c=>c.x));
        coordinate = (options.ports || options.shortLeads) ? edge.x + direction * Math.min(24, Number.isFinite(near) ? Math.abs(near-edge.x)/2 : 24) : Number.isFinite(near) ? (edge.x+near)/2 : direction < 0 ? left : right;
      } else {
        const facing = others.filter(c => edge.x > c.x && edge.x < c.x+c.w);
        const near = direction < 0 ? Math.max(-Infinity,...facing.filter(c=>c.y+c.h<=edge.y).map(c=>c.y+c.h)) : Math.min(Infinity,...facing.filter(c=>c.y>=edge.y).map(c=>c.y));
        coordinate = (options.ports || options.shortLeads) ? edge.y + direction * Math.min(24, Number.isFinite(near) ? Math.abs(near-edge.y)/2 : 24) : Number.isFinite(near) ? (edge.y+near)/2 : direction < 0 ? top : bottom;
      }
      const outside = axis === 'x' ? { x:coordinate,y:edge.y } : { x:edge.x,y:coordinate };
      if (!allowed(port,outside) || others.some(c=>crossesCard(port,outside,c))) return [];
      return [[port,outside]];
    });
  };
  const starts = ports(from,false), ends = ports(to,true);
  const xGaps:number[] = [left,right], yGaps:number[] = [top,bottom];
  for (const a of obstacles) for (const b of obstacles) {
    if (a.x+a.w < b.x && a.y < b.y+b.h && b.y < a.y+a.h) xGaps.push((a.x+a.w+b.x)/2);
    if (a.y+a.h < b.y && a.x < b.x+b.w && b.x < a.x+a.w) yGaps.push((a.y+a.h+b.y)/2);
  }
  const xs = [...new Set([...xGaps, ...[...starts,...ends].map(p=>p[1].x)])].sort((a,b)=>a-b);
  const ys = [...new Set([...yGaps, ...[...starts,...ends].map(p=>p[1].y)])].sort((a,b)=>a-b);
  const points = ys.flatMap(y => xs.map(x => ({ x, y })));
  const valid = points.map(p => !obstacles.some(b => inside(p, b)));
  const index = (p: RoutePoint) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  type Step = { node: number; axis: number; cost: number; prev?: Step; port?: RoutePoint };
  const queue: Step[] = starts.map(([port, p]) => ({ node: index(p), axis: port.x === p.x ? 2 : 1, cost: Math.abs(port.x-p.x)+Math.abs(port.y-p.y)+overlapCost(port,p), port })).filter(s => valid[s.node]);
  const best = new Map<number, number>();
  let winner: Step | undefined, finish: RoutePoint | undefined, total = Infinity;
  while (queue.length) {
    queue.sort((a,b) => b.cost-a.cost);
    const step = queue.pop()!;
    if (step.cost >= total) break;
    const key = step.node * 3 + step.axis;
    if ((best.get(key) ?? Infinity) <= step.cost) continue;
    best.set(key, step.cost);
    const p = points[step.node];
    const end = ends.find(([, e]) => e.x === p.x && e.y === p.y);
    if (end) {
      const score=step.cost+Math.abs(p.x-end[0].x)+Math.abs(p.y-end[0].y)+overlapCost(p,end[0]);
      if(score<total) { winner=step; finish=end[0]; total=score; }
    }
    const col = step.node % xs.length;
    const neighbors = [col ? step.node-1 : -1, col < xs.length-1 ? step.node+1 : -1, step.node-xs.length, step.node+xs.length];
    for (const node of neighbors) {
      if (node < 0 || node >= points.length || !valid[node]) continue;
      const q = points[node], axis = p.x === q.x ? 2 : 1;
      if (!allowed(p,q) || obstacles.some(b => crossesCard(p, q, b))) continue;
      const distance = Math.abs(p.x-q.x)+Math.abs(p.y-q.y);
      const middle = {x:(p.x+q.x)/2,y:(p.y+q.y)/2};
      const facing = obstacles.filter(b=>axis===1 ? middle.x>b.x && middle.x<b.x+b.w : middle.y>b.y && middle.y<b.y+b.h);
      const position = axis===1 ? middle.y : middle.x;
      const low = Math.max(-Infinity,...facing.map(b=>axis===1 ? b.y+b.h : b.x+b.w).filter(n=>n<=position));
      const high = Math.min(Infinity,...facing.map(b=>axis===1 ? b.y : b.x).filter(n=>n>=position));
      // A shorter neighbouring group must not pull a shared route against a taller group's outline.
      const offCenter = Number.isFinite(low) && Number.isFinite(high) && high>low ? Math.abs(position-(low+high)/2)/(high-low) : 0;
      const cost = step.cost + distance*(1+offCenter*4) + (axis === step.axis ? 0 : 24) + overlapCost(p,q);
      if (cost < (best.get(node*3+axis) ?? Infinity)) queue.push({ node, axis, cost, prev: step });
    }
  }
  // Tight/collapsed layouts may have no corridor on the preferred side.
  if (!winner || !finish) return options.side ? routeAgentLink(from,to,cards,{occupied:options.occupied, ports: options.ports, shortLeads: options.shortLeads}) : [];
  const result: RoutePoint[] = [finish];
  let cursor: Step | undefined = winner;
  while (cursor) { result.push(points[cursor.node]); if (cursor.port) result.push(cursor.port); cursor = cursor.prev; }
  result.reverse();
  const simplify = (path: RoutePoint[]) => {
    const unique = path.filter((p, i) => !i || p.x !== path[i-1].x || p.y !== path[i-1].y);
    return unique.filter((p,i)=> !i || i===unique.length-1 || !((unique[i-1].x===p.x && p.x===unique[i+1].x) || (unique[i-1].y===p.y && p.y===unique[i+1].y)));
  };
  const score = (path: RoutePoint[]) => path.slice(1).reduce((sum,p,i) => sum + Math.abs(p.x-path[i].x) + Math.abs(p.y-path[i].y) + overlapCost(path[i],p), Math.max(0,path.length-2)*24);
  let chosen = simplify(result);
  // The corridor grid can overvalue centering and introduce a staircase at a port.
  // Compare clear, simple elbows using the same fixed ports and collision checks.
  if (options.ports || options.shortLeads) for (const [start,a] of starts) for (const [end,b] of ends) {
    const candidates = [
      [start,{x:start.x,y:end.y},end],
      [start,{x:end.x,y:start.y},end],
      [start,a,{x:a.x,y:b.y},b,end],
      [start,a,{x:b.x,y:a.y},b,end],
      [start,a,{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y},b,end],
      [start,a,{x:a.x,y:(a.y+b.y)/2},{x:b.x,y:(a.y+b.y)/2},b,end],
    ];
    for (const raw of candidates) {
      const path = simplify(raw);
      if (path.length < 2) continue;
      // Simplification must never reverse a port's outward/inward direction.
      const next = path[1], prev = path[path.length-2];
      if ((next.x-start.x)*(a.x-start.x)+(next.y-start.y)*(a.y-start.y) <= 0 ||
          (prev.x-end.x)*(b.x-end.x)+(prev.y-end.y)*(b.y-end.y) <= 0) continue;
      if (path.slice(1).some((p,i) => !allowed(path[i],p) || obstacles.some(card => crossesCard(path[i],p,card)))) continue;
      if (score(path) < score(chosen)) chosen = path;
    }
  }
  return chosen;
}
