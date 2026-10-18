import { describe, it, expect } from 'vitest';
import { routeReportingBranches, routeAgentLink, crossesCard, type RouteBox } from './agent-link-routing';
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
    const route=routeAgentLink(lead,target,[lead,advisor,target]);
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


describe('shared reporting branches', () => {
  const parent = { x: 500, y: 0, w: 200, h: 200 };
  const boxes = new Map([
    ['manager', parent],
    ['a', { x: 0, y: 340, w: 200, h: 200 }],
    ['b', { x: 300, y: 340, w: 200, h: 200 }],
    ['c', { x: 800, y: 360, w: 200, h: 200 }],
  ]);
  const edges = ['a', 'b', 'c'].map(to => ({ id: to, from: 'manager', to }));
  it('shares the average branch height with separate arrows and no card crossings', () => {
    const routes = routeReportingBranches(edges, boxes);
    expect(routes.size).toBe(3);
    const heights = [...routes.values()].map(path => path[1].y);
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeCloseTo(273.3333);
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
  it('keeps clear siblings on the same height when one child needs a detour', () => {
    const blocked = new Map(boxes).set('obstacle', { x: 850, y: 300, w: 100, h: 40 });
    const routes = routeReportingBranches(edges, blocked);
    expect([...routes.keys()]).toEqual(['a', 'b']);
    expect(routes.get('a')![1].y).toBe(routes.get('b')![1].y);
    expect(routeReportingBranches([...edges].reverse(), blocked)).toEqual(routes);
    for (const path of routes.values()) for (let i = 1; i < path.length; i++) {
      for (const card of blocked.values()) expect(crossesCard(path[i - 1], path[i], card)).toBe(false);
    }
  });
  it('prefers aligning every sibling over a closer height that only clears some', () => {
    const blocked = new Map(boxes).set('obstacle', { x: 200, y: 260, w: 100, h: 30 });
    const routes = routeReportingBranches(edges, blocked);
    expect(routes.size).toBe(3);
    expect(new Set([...routes.values()].map(path => path[1].y)).size).toBe(1);
    expect(routes.get('a')![1].y).not.toBeCloseTo(273.3333);
    for (const path of routes.values()) for (let i = 1; i < path.length; i++) {
      for (const card of blocked.values()) expect(crossesCard(path[i - 1], path[i], card)).toBe(false);
    }
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
