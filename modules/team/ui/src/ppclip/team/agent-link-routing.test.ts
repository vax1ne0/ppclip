import { describe, it, expect } from 'vitest';
import { alignOpposingReportingJunctions, routeReportingBranches, routeAgentLink, routeHasClearance, ROUTE_CARD_CLEARANCE, crossesCard, type RouteBox } from './agent-link-routing';
const ahmed = { x: 0, y: 0, w: 260, h: 200 };
const cards: RouteBox[] = [ahmed, { x: 292, y: 32, w: 260, h: 200 }, { x: 584, y: 32, w: 260, h: 200 }, { x: 380, y: 320, w: 260, h: 190 }, { x: 656, y: 320, w: 260, h: 190 }, { x: 380, y: 526, w: 260, h: 190 }, { x: 656, y: 526, w: 260, h: 190 }];
describe('agent link routing', () => {
  it('reaches both left-column researchers without crossing the advisor or right-column cards', () => {
    for (const target of [cards[3], cards[5]]) {
      const route = routeAgentLink(ahmed, target, cards);
      expect(route.length).toBeGreaterThan(1);
      const end = route.at(-1)!;
      expect(end.x === target.x || end.x === target.x+target.w || end.y === target.y || end.y === target.y+target.h).toBe(true);
      for (let i=1; i<route.length; i++) for (const card of cards) expect(crossesCard(route[i-1], route[i], card)).toBe(false);
    }
  });
  it('routes adjacent cards directly and handles reversed direction', () => {
    for (const [a,b] of [[cards[3],cards[4]],[cards[4],cards[3]]]) {
      const route = routeAgentLink(a,b,cards);
      expect(route).toHaveLength(2);
      expect(route[0].y).toBe(route[1].y);
    }
  });
});


describe('group corridors', () => {
  it('enters Salma only from the exposed right or bottom, aligned to her name', () => {
    const group = {x:380,y:300,w:556,h:436};
    const people = cards.map((c,i)=> i>=3 ? {...c,group,name:{x:c.x+110,y:c.y+42}} : c);
    const salma = people[6];
    const route = routeAgentLink(people[0],salma,[...people,{x:0,y:300,w:348,h:436}]);
    expect(route.some((p,i)=>i>0 && p.y===266 && route[i-1].y===266 && Math.abs(p.x-route[i-1].x)>200)).toBe(true);
    expect(route.length).toBeGreaterThan(1);
    const end = route.at(-1)!;
    expect((end.x===salma.x+salma.w && end.y===salma.y+42) || (end.y===salma.y+salma.h && end.x===salma.x+110)).toBe(true);
    for(let i=1;i<route.length-1;i++) expect(crossesCard(route[i-1],route[i],group)).toBe(false);
    for(let i=1;i<route.length;i++) for(const c of people) expect(crossesCard(route[i-1],route[i],c)).toBe(false);
  });
  it('centres the horizontal route between outlined rows', () => {
    const lead={x:0,y:0,w:200,h:150};
    const advisor={x:240,y:0,w:200,h:180};
    const group={x:240,y:260,w:220,h:220};
    const target={x:250,y:280,w:200,h:180,group,name:{x:340,y:320}};
    // Block the open left approach so this fixture exercises the row corridor.
    const route=routeAgentLink(lead,target,[lead,advisor,target,{x:40,y:270,w:160,h:160}]);
    expect(route).toContainEqual({x:340,y:220});
  });
});

describe('reciprocal work arrows',()=>{
 it('separates opposing paths above and below the advisor without shared segments',()=>{
  const lead={x:0,y:40,w:260,h:200};
  const advisor={x:292,y:72,w:260,h:200};
  const planner={x:584,y:72,w:260,h:200};
  const row={x:0,y:340,w:844,h:300};
  const all=[lead,advisor,planner,row];
  const forward=routeAgentLink(lead,planner,all,{side:'above'});
  const reverse=routeAgentLink(planner,lead,all,{side:'below',occupied:[forward]});
  for(const path of [forward,reverse]) {
   expect(path.length).toBeGreaterThan(1);
   for(let i=1;i<path.length;i++) for(const card of all) expect(crossesCard(path[i-1],path[i],card)).toBe(false);
  }
  const across=(path:typeof forward)=>path.slice(1).filter((p,i)=>p.y===path[i].y && Math.min(p.x,path[i].x)<422 && Math.max(p.x,path[i].x)>422);
  expect(across(forward).every(p=>p.y<advisor.y)).toBe(true);
  expect(across(reverse).every(p=>p.y>advisor.y+advisor.h && p.y<row.y)).toBe(true);
  expect(across(forward).length).toBeGreaterThan(0);
  expect(across(reverse).length).toBeGreaterThan(0);
  for(let i=1;i<forward.length;i++) for(let j=1;j<reverse.length;j++) {
   const a=forward[i-1],b=forward[i],c=reverse[j-1],d=reverse[j];
   const horizontal=a.y===b.y && c.y===d.y && a.y===c.y;
   const vertical=a.x===b.x && c.x===d.x && a.x===c.x;
   if(horizontal) expect(Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))).toBeLessThanOrEqual(0);
   if(vertical) expect(Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))).toBeLessThanOrEqual(0);
  }
 });
});


it('uses a single clear elbow between a top exit and a right entrance', () => {
  const from = {x:600,y:400,w:200,h:200}, to = {x:0,y:0,w:200,h:200};
  const route = routeAgentLink(from,to,[from,to],{ports:{from:'top',to:'right'}});
  expect(route).toEqual([{x:700,y:400},{x:700,y:100},{x:200,y:100}]);
  for(let i=1;i<route.length;i++) for(const card of [from,to]) expect(crossesCard(route[i-1],route[i],card)).toBe(false);
});


describe('card clearance', () => {
  it('takes the open top-to-side elbow instead of squeezing through a saved 20px side gap', () => {
    const from = { x: 0, y: 240, w: 200, h: 240 };
    const to = { x: 220, y: 0, w: 200, h: 200 };
    const route = routeAgentLink(from, to, [from, to], { preferredPorts: { from: 'right', to: 'left' } });
    expect(route).toEqual([{ x: 100, y: 240 }, { x: 100, y: 100 }, { x: 220, y: 100 }]);
    expect(routeHasClearance(route, from, to, [from, to])).toBe(true);
  });
  it.each([0, 1, 2, 3])('keeps the padding from a card border after rotation %s', turns => {
    const rotatePoint = (p: { x: number; y: number }) => {
      for (let i = 0; i < turns; i++) p = { x: -p.y, y: p.x };
      return p;
    };
    const rotateBox = (box: RouteBox) => {
      const corners = [rotatePoint({ x: box.x, y: box.y }), rotatePoint({ x: box.x + box.w, y: box.y + box.h })];
      return { x: Math.min(...corners.map(p => p.x)), y: Math.min(...corners.map(p => p.y)), w: Math.abs(corners[1].x - corners[0].x), h: Math.abs(corners[1].y - corners[0].y) };
    };
    const from = rotateBox({ x: 0, y: 0, w: 80, h: 80 });
    const to = rotateBox({ x: 600, y: 0, w: 80, h: 80 });
    const blocker = rotateBox({ x: 280, y: 40, w: 80, h: 80 });
    const route = routeAgentLink(from, to, [from, to, blocker]);
    expect(route.length).toBeGreaterThan(1);
    expect(routeHasClearance(route, from, to, [from, to, blocker])).toBe(true);
    const padding = { x: blocker.x - ROUTE_CARD_CLEARANCE, y: blocker.y - ROUTE_CARD_CLEARANCE, w: blocker.w + 2 * ROUTE_CARD_CLEARANCE, h: blocker.h + 2 * ROUTE_CARD_CLEARANCE };
    for (let i = 1; i < route.length; i++) expect(crossesCard(route[i - 1], route[i], padding)).toBe(false);
  });
  it('allows normal terminal connections but rejects a turn inside their padding', () => {
    const from = { x: 0, y: 0, w: 200, h: 200 }, to = { x: 400, y: 300, w: 200, h: 200 };
    expect(routeHasClearance([{ x: 100, y: 200 }, { x: 100, y: 210 }, { x: 500, y: 210 }, { x: 500, y: 300 }], from, to, [from, to])).toBe(false);
    expect(routeHasClearance([{ x: 100, y: 200 }, { x: 100, y: 250 }, { x: 500, y: 250 }, { x: 500, y: 300 }], from, to, [from, to])).toBe(true);
  });
  it('keeps shared branches clear of nearby unrelated cards', () => {
    const boxes = new Map([
      ['manager', { x: 400, y: 0, w: 200, h: 200 }],
      ['a', { x: 0, y: 400, w: 200, h: 200 }],
      ['b', { x: 800, y: 400, w: 200, h: 200 }],
      ['blocker', { x: 200, y: 220, w: 180, h: 80 }],
    ]);
    const edges = ['a', 'b'].map(to => ({ id: to, from: 'manager', to }));
    const result = routeReportingBranches(edges, boxes);
    expect(result.size).toBe(2);
    for (const edge of edges) expect(routeHasClearance(result.get(edge.id)!, boxes.get('manager')!, boxes.get(edge.to)!, [...boxes.values()])).toBe(true);
  });
  it('does not fall back to touching cards when every exit is sealed', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 }, to = { x: 400, y: 400, w: 100, h: 100 };
    const blockers = [
      { x: -60, y: 0, w: 40, h: 100 }, { x: 120, y: 0, w: 40, h: 100 },
      { x: 0, y: -60, w: 100, h: 40 }, { x: 0, y: 120, w: 100, h: 40 },
    ];
    expect(routeAgentLink(from, to, [from, to, ...blockers], { preferredPorts: { from: 'right', to: 'left' } })).toEqual([]);
  });
});

describe('adaptive saved connection sides', () => {
  const source = { x: 0, y: 0, w: 200, h: 200 };
  const preferredPorts = { from: 'bottom', to: 'top' } as const;
  it('keeps bottom-to-top for a small horizontal move', () => {
    const target = { x: 24, y: 300, w: 200, h: 200 };
    const route = routeAgentLink(source, target, [source,target], { preferredPorts });
    expect(route[0]).toEqual({x:100,y:200});
    expect(route.at(-1)).toEqual({x:124,y:300});
  });
  it('switches to facing sides when the target moves alongside or above', () => {
    for (const target of [{x:400,y:0,w:200,h:200},{x:0,y:-400,w:200,h:200}]) {
      const route = routeAgentLink(source,target,[source,target],{preferredPorts});
      expect(route).toHaveLength(2);
      expect(route[0]).not.toEqual({x:100,y:200});
      expect(route).toEqual(routeAgentLink(source,target,[source,target],{preferredPorts}));
      for(let i=1;i<route.length;i++) for(const card of [source,target]) expect(crossesCard(route[i-1],route[i],card)).toBe(false);
    }
  });
  it('finds another side when an obstacle blocks the saved exit', () => {
    const target = {x:400,y:0,w:200,h:200}, blocker = {x:50,y:195,w:100,h:100};
    const route = routeAgentLink(source,target,[source,target,blocker],{preferredPorts});
    expect(route.length).toBeGreaterThan(1);
    for(let i=1;i<route.length;i++) for(const card of [source,target,blocker]) expect(crossesCard(route[i-1],route[i],card)).toBe(false);
  });
});

describe('reporting entry preference', () => {
  const parent = { x: 0, y: 0, w: 320, h: 260 };
  const child = { x: 370, y: 285, w: 320, h: 230 };
  const preferredPorts = { from: 'right', to: 'left' } as const;
  it('prefers a single elbow into the lower child’s top over the saved side-entry dogleg', () => {
    const route = routeAgentLink(parent, child, [parent, child], { preferredPorts, preferVerticalEntry: true });
    expect(route).toEqual([{ x: 320, y: 130 }, { x: 530, y: 130 }, { x: 530, y: 285 }]);
  });
  it('mirrors the preference for a lower child on the left', () => {
    const left = { ...child, x: -370 };
    const route = routeAgentLink(parent, left, [parent, left], { preferredPorts: { from: 'left', to: 'right' }, preferVerticalEntry: true });
    expect(route).toEqual([{ x: 0, y: 130 }, { x: -210, y: 130 }, { x: -210, y: 285 }]);
  });
  it('yields to obstacles rather than forcing the preferred elbow through a card', () => {
    const blocker = { x: 400, y: 50, w: 200, h: 240 };
    const cards = [parent, child, blocker];
    const route = routeAgentLink(parent, child, cards, { preferredPorts, preferVerticalEntry: true });
    expect(route.length).toBeGreaterThan(1);
    for (let i = 1; i < route.length; i++) for (const card of cards) expect(crossesCard(route[i - 1], route[i], card)).toBe(false);
  });
  it('keeps aligned peers direct', () => {
    const peer = { ...child, y: 15 };
    const route = routeAgentLink(parent, peer, [parent, peer], { preferredPorts, preferVerticalEntry: true });
    expect(route).toEqual([{ x: 320, y: 130 }, { x: 370, y: 130 }]);
  });
});

it('uses the clear side gap in the reported six-agent layout', () => {
  const manager={x:738,y:423,w:248,h:298}, target={x:414,y:398,w:248,h:262};
  const all=[manager,target,{x:738,y:64,w:248,h:262},{x:378,y:45,w:248,h:281},{x:104,y:398,w:248,h:262},{x:29,y:55,w:248,h:262}];
  const path=routeAgentLink(manager,target,all,{preferredPorts:{from:'right',to:'top'}});
  expect(path[0].x).toBe(manager.x);
  expect(path.at(-1)!.x).toBe(target.x+target.w);
  expect(path.length).toBeLessThanOrEqual(4);
  expect(path.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-path[i].x)+Math.abs(p.y-path[i].y),0)).toBeLessThan(150);
  for(let i=1;i<path.length;i++)for(const card of all)expect(crossesCard(path[i-1],path[i],card)).toBe(false);
});


describe('opposing reporting junctions', () => {
  const left = { id: 'left', from: 'manager', to: 'a', points: [
    { x: 0, y: 0 }, { x: 0, y: 100 }, { x: -200, y: 100 }, { x: -200, y: 200 },
  ] };
  const right = { id: 'right', from: 'manager', to: 'b', points: [
    { x: 0, y: 0 }, { x: 0, y: 140 }, { x: 200, y: 140 }, { x: 200, y: 240 },
  ] };
  const routes = [left, right];
  const cards = [
    { x: -30, y: -50, w: 60, h: 50 },
    { x: -220, y: 200, w: 40, h: 40 },
    { x: 180, y: 240, w: 40, h: 40 },
  ];
  const assertClear = (result: ReturnType<typeof alignOpposingReportingJunctions>, obstacles = cards) => {
    for (const route of routes) {
      const path = result.get(route.id)!;
      expect(path[0]).toEqual(route.points[0]);
      expect(path.at(-1)).toEqual(route.points.at(-1));
      for (let i = 1; i < path.length; i++) {
        expect(path[i - 1].x === path[i].x || path[i - 1].y === path[i].y).toBe(true);
        for (const card of obstacles) expect(crossesCard(path[i - 1], path[i], card)).toBe(false);
      }
    }
  };
  it('aligns left and right elbows at one junction while preserving ports and clear paths', () => {
    const result = alignOpposingReportingJunctions(routes, cards);
    expect(result.get('left')![1].y).toBe(120);
    expect(result.get('right')![1].y).toBe(120);
    assertClear(result);
    expect(left.points[1].y).toBe(100);
    expect(right.points[1].y).toBe(140);
    expect(alignOpposingReportingJunctions([...routes].reverse(), cards)).toEqual(result);
    expect(alignOpposingReportingJunctions(routes.map(route => ({ ...route, points: result.get(route.id)! })), cards)).toEqual(result);
  });
  it('uses another clear common height when the midpoint is blocked', () => {
    const obstacles = [...cards, { x: -120, y: 130, w: 40, h: 20 }];
    const result = alignOpposingReportingJunctions(routes, obstacles);
    expect(result.get('left')![1].y).toBe(100);
    expect(result.get('right')![1].y).toBe(100);
    assertClear(result, obstacles);
  });
  it('leaves both original routes alone when no common height clears the cards', () => {
    const obstacles = [...cards,
      { x: -120, y: 130, w: 40, h: 50 },
      { x: 80, y: 60, w: 40, h: 50 },
    ];
    const result = alignOpposingReportingJunctions(routes, obstacles);
    expect([...result.values()]).toEqual(routes.map(route => route.points));
    assertClear(result, obstacles);
  });
  it('does not change same-side branches or merge different managers and ports', () => {
    const alternatives = [
      { ...right, points: right.points.map(point => ({ ...point, x: -point.x })) },
      { ...right, from: 'another-manager' },
      { ...right, points: right.points.map(point => ({ ...point, x: point.x + 10 })) },
    ];
    for (const other of alternatives) {
      expect([...alignOpposingReportingJunctions([left, other], []).values()]).toEqual([left.points, other.points]);
    }
  });
  it('preserves an existing same-height branch group when joining the opposite arm', () => {
    const extra = { ...left, id: 'extra', to: 'c', points: left.points.map(point => ({ ...point, x: point.x < 0 ? point.x - 100 : point.x })) };
    const result = alignOpposingReportingJunctions([...routes, extra], [...cards, { x: -320, y: 200, w: 40, h: 40 }]);
    expect(new Set([...result.values()].map(path => path[1].y)).size).toBe(1);
    assertClear(result);
  });
  it('also aligns mirrored upward branches', () => {
    const mirrored = routes.map(route => ({ ...route, points: route.points.map(point => ({ ...point, y: -point.y })) }));
    const result = alignOpposingReportingJunctions(mirrored, []);
    expect(result.get('left')![1].y).toBe(-120);
    expect(result.get('right')![1].y).toBe(-120);
  });
});

describe('shared reporting branches', () => {
  const parent = { x: 500, y: 0, w: 200, h: 200 };
  const boxes = new Map([
    ['manager', parent],
    ['a', { x: 0, y: 340, w: 200, h: 200 }],
    ['b', { x: 300, y: 340, w: 200, h: 200 }],
    ['c', { x: 800, y: 360, w: 200, h: 200 }],
  ]);
  const edges = ['a', 'b', 'c'].map(to => ({ id: to, from: 'manager', to }));
  it('centers the common gap with separate arrows and no card crossings', () => {
    const routes = routeReportingBranches(edges, boxes);
    expect(routes.size).toBe(3);
    const heights = [...routes.values()].map(path => path[1].y);
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe(270);
    for (const [id, path] of routes) {
      expect(path.at(-1)).toEqual({ x: boxes.get(id)!.x + 100, y: boxes.get(id)!.y });
      for (let i = 1; i < path.length; i++) for (const card of boxes.values()) expect(crossesCard(path[i-1], path[i], card)).toBe(false);
    }
    expect(routeReportingBranches([...edges].reverse(), boxes)).toEqual(routes);
  });
  it('falls back when an obstacle blocks the common trunk', () => {
    const blocked = new Map(boxes).set('obstacle', { x: 550, y: 210, w: 100, h: 120 });
    expect(routeReportingBranches(edges, blocked).size).toBe(0);
  });
  it('keeps comfortable clearance above near cards when another child is far below', () => {
    const moved = new Map(boxes).set('c', { x: 800, y: 1200, w: 200, h: 200 });
    const routes = routeReportingBranches(edges, moved);
    expect(routes.size).toBe(3);
    expect(routes.get('a')![1].y).toBe(270);
    expect(moved.get('a')!.y - routes.get('a')![1].y).toBe(70);
  });
  it('never combines different managers or hidden reports', () => {
    expect(routeReportingBranches([edges[0], { ...edges[1], from: 'other' }, { id: 'hidden', from: 'manager', to: 'hidden' }], boxes).size).toBe(0);
  });
  it('adapts when a report moves above the manager', () => {
    const moved = new Map(boxes).set('c', { x: 800, y: -400, w: 200, h: 200 });
    const routes = routeReportingBranches(edges, moved);
    expect([...routes.keys()]).toEqual(['a', 'b']);
    expect(routes.get('a')![1].y).toBe(270);
  });
});


it('routes safely while dragged card edges touch', () => {
  const a = { x: 0, y: 0, w: 320, h: 300 };
  for (const b of [{ x: 320, y: 0, w: 320, h: 300 }, { x: 0, y: 300, w: 320, h: 300 }]) {
    expect(() => routeAgentLink(a, b, [a,b], { preferredPorts: { from: 'right', to: 'left' } })).not.toThrow();
  }
});
