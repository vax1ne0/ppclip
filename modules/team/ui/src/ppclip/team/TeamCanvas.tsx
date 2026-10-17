import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { GripVertical, Maximize2, Minus, Move, Plus, Undo2, WandSparkles } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { routeAgentLink, routeReportingBranches, type RoutePoint } from "./agent-link-routing";
import type { AgentLink } from "./agent-links";
import { roleGroupOf, TEAM_ROLE_GROUPS, teamGroupColor } from "./role-groups";
import {
  clampCoordinate,
  defaultTeamPreferences,
  layoutTeam,
  parseTeamPreferences,
  serializeTeamPreferences,
  snapTeamPosition,
  teamDepths,
  teamStorageKey,
  tidyTeam,
  visibleTeam,
  type Positions,
  type Sizes,
  type TeamMember,
  type TeamMetrics,
  type TeamPreferences,
} from "./team-layout";
import type { TeamCardPresentation } from "./TeamAgentCard";
import { describeRelationships, TeamRelationships } from "./TeamRelationships";
import { TeamViewSettings } from "./TeamViewSettings";

/** Card width matches the `w-80` card class; height is a first guess until cards are measured. */
const METRICS: TeamMetrics = { width: 320, height: 280, gap: 64, padding: 64 };
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 1.2;
const KEY_STEP = 32;
const KEY_STEP_LARGE = 48;
const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
const KEY_DELTAS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const LINE_STYLES = {
  report: { stroke: "var(--muted-foreground)", dash: undefined, opacity: 0.55 },
  waiting: { stroke: "var(--status-agent-paused)", dash: "6 5", opacity: 0.9 },
  loop: { stroke: "var(--status-task-in_review)", dash: "1.5 4.5", opacity: 0.9 },
} as const;

function loadPreferences(key: string): TeamPreferences {
  try {
    return parseTeamPreferences(window.localStorage.getItem(key));
  } catch {
    return defaultTeamPreferences();
  }
}

const roleKey = (member: TeamMember) => roleGroupOf(member).key;

/**
 * ppclip TEAM-1: the Team canvas. Cards are free-placed on a pan/zoom board;
 * positions and view settings are saved per browser and company. Edit mode is
 * off by default; when on, each card header becomes a move-only drag handle.
 */
export function TeamCanvas({ companyId, agents, links, renderCard, evidenceStatus }: {
  companyId: string;
  agents: Agent[];
  links: AgentLink[];
  renderCard: (agent: Agent, presentation: TeamCardPresentation) => ReactNode;
  evidenceStatus?: string;
}) {
  const storageKey = teamStorageKey(companyId);
  const [settings, setSettings] = useState<TeamPreferences>(() => loadPreferences(storageKey));
  const [saveError, setSaveError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<TeamPreferences | null>(null);
  const [sizes, setSizes] = useState<Sizes>({});
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [camera, setCamera] = useState<RoutePoint | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const marker = `team-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const drag = useRef<{ id: string; x: number; y: number; point: RoutePoint; original: Positions } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // A company switch loads that company's saved view.
  const loadedKey = useRef(storageKey);
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    setSettings(loadPreferences(storageKey));
    setUndo(null);
    setZoom(null);
    setCamera(null);
  }, [storageKey]);

  useEffect(() => {
    if (loadedKey.current !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, serializeTeamPreferences(settings));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [storageKey, settings]);

  const members = agents;
  const depths = useMemo(() => teamDepths(members), [members]);
  const visible = useMemo(() => visibleTeam(members, settings.collapsed, settings.levels), [members, settings.collapsed, settings.levels]);
  const positions = useMemo(
    () => layoutTeam(members, sizes, settings.positions, settings.grouping, METRICS, roleKey),
    [members, sizes, settings.positions, settings.grouping],
  );
  const sizeOf = useCallback((id: string) => sizes[id] ?? { w: METRICS.width, h: METRICS.height }, [sizes]);
  const boxes = useMemo(
    () => new Map(visible.map((member) => [member.id, { ...positions[member.id]!, ...sizeOf(member.id) }])),
    [visible, positions, sizeOf],
  );

  const bounds = [...boxes.values()];
  const minX = bounds.length ? Math.min(...bounds.map((box) => box.x)) : 0;
  const minY = bounds.length ? Math.min(...bounds.map((box) => box.y)) : 0;
  const width = bounds.length ? Math.max(...bounds.map((box) => box.x + box.w)) - minX : METRICS.width;
  const height = bounds.length ? Math.max(...bounds.map((box) => box.y + box.h)) - minY : METRICS.height;
  const fitScale = viewSize.w > 0 && viewSize.h > 0
    ? clampZoom(Math.min(1, viewSize.w / (width + METRICS.padding * 2), viewSize.h / (height + METRICS.padding * 2)))
    : 1;
  const scale = zoom ?? fitScale;
  const offset = camera ?? { x: (viewSize.w - width * scale) / 2 - minX * scale, y: (viewSize.h - height * scale) / 2 - minY * scale };
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const viewSizeRef = useRef(viewSize);
  viewSizeRef.current = viewSize;

  const zoomTo = useCallback((next: number) => {
    const previous = scaleRef.current, origin = offsetRef.current, view = viewSizeRef.current;
    setCamera({ x: view.w / 2 - (view.w / 2 - origin.x) * next / previous, y: view.h / 2 - (view.h / 2 - origin.y) * next / previous });
    setZoom(next);
  }, []);
  const fit = useCallback(() => { setZoom(null); setCamera(null); }, []);
  /** Freeze the current view so later layout changes do not re-fit under the pointer. */
  const holdView = () => { setZoom(scaleRef.current); setCamera(offsetRef.current); };

  // Measure the viewport and every rendered card.
  const visibleIds = visible.map((member) => member.id).join("|");
  useLayoutEffect(() => {
    const view = viewport.current, cards = layer.current;
    if (!view || !cards) return;
    const measure = () => {
      setViewSize((old) => old.w === view.clientWidth && old.h === view.clientHeight ? old : { w: view.clientWidth, h: view.clientHeight });
      const measured: Sizes = {};
      cards.querySelectorAll<HTMLElement>("[data-team-card]").forEach((card) => {
        if (card.offsetWidth && card.offsetHeight) measured[card.dataset.teamCard!] = { w: card.offsetWidth, h: card.offsetHeight };
      });
      setSizes((old) => {
        const next = { ...old, ...measured };
        return Object.keys(next).every((id) => old[id]?.w === next[id]!.w && old[id]?.h === next[id]!.h) ? old : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(view);
    cards.querySelectorAll("[data-team-card]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [visibleIds]);

  // Once cards are measured, lock everyone's place (newcomers included) so polling never reshuffles the board.
  useEffect(() => {
    if (!visible.length || visible.some((member) => !sizes[member.id])) return;
    setSettings((old) => members.every((member) => old.positions[member.id])
      ? old
      : { ...old, positions: { ...old.positions, ...Object.fromEntries(members.filter((member) => !old.positions[member.id]).map((member) => [member.id, positions[member.id]!])) } });
  }, [positions, sizes, visible, members]);

  // Ctrl/Cmd + wheel zooms; a plain wheel pans. Native listener so the page itself does not scroll.
  useEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomTo(clampZoom(scaleRef.current * Math.exp(-event.deltaY * 0.005)));
      else {
        setCamera({ x: offsetRef.current.x - event.deltaX, y: offsetRef.current.y - event.deltaY });
        setZoom(scaleRef.current);
      }
    };
    view.addEventListener("wheel", wheel, { passive: false });
    return () => view.removeEventListener("wheel", wheel);
  }, [zoomTo]);

  const relationships = useMemo(() => describeRelationships(members, links), [members, links]);
  const edgePorts = useMemo(() => Object.fromEntries(relationships.flatMap((edge) => {
    const from = boxes.get(edge.from), to = boxes.get(edge.to);
    if (!from || !to) return [];
    const ports = settings.ports[edge.id] ?? (from.y + from.h <= to.y ? { from: "bottom", to: "top" }
      : to.y + to.h <= from.y ? { from: "top", to: "bottom" }
        : from.x < to.x ? { from: "right", to: "left" } : { from: "left", to: "right" });
    return [[edge.id, ports]];
  })) as TeamPreferences["ports"], [relationships, boxes, settings.ports]);
  useEffect(() => {
    if (Object.keys(edgePorts).some((id) => !settings.ports[id])) setSettings((old) => ({ ...old, ports: { ...edgePorts, ...old.ports } }));
  }, [edgePorts, settings.ports]);

  const routes = useMemo(() => {
    const cards = [...boxes.values()];
    const occupied: RoutePoint[][] = [];
    const shown = relationships.filter((edge) => edge.kind === "report" ? settings.reporting : settings.work);
    const branches = routeReportingBranches(shown.filter((edge) => edge.kind === "report"), boxes);
    return new Map(shown.map((edge) => {
      const from = boxes.get(edge.from), to = boxes.get(edge.to);
      if (!from || !to) return [edge.id, { ...edge, d: "", hidden: true }];
      const reciprocal = relationships.some((other) => other.from === edge.to && other.to === edge.from);
      const points = branches.get(edge.id) ?? routeAgentLink(from, to, cards, {
        occupied: edge.kind === "report" ? [] : occupied,
        preferredPorts: edgePorts[edge.id],
        side: reciprocal ? (edge.from < edge.to ? "above" : "below") : undefined,
      });
      occupied.push(points);
      return [edge.id, { ...edge, d: points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" "), hidden: false }];
    }));
  }, [boxes, relationships, settings.reporting, settings.work, edgePorts]);

  const annotated = relationships.map((edge) => {
    const route = routes.get(edge.id);
    const note = !boxes.has(edge.from) || !boxes.has(edge.to) ? "one of them is hidden"
      : route && !route.hidden && !route.d ? "no clear route; move a card or use Magic sort" : undefined;
    return note ? { ...edge, note } : edge;
  });

  function update<K extends keyof TeamPreferences>(key: K, value: TeamPreferences[K]) {
    setSettings((old) => ({ ...old, [key]: value }));
  }
  function move(id: string, point: RoutePoint) {
    const others = [...boxes].filter(([other]) => other !== id).map(([, box]) => box);
    const next = settings.snap ? snapTeamPosition(point, sizeOf(id), others, METRICS.padding) : point;
    setSettings((old) => ({
      ...old,
      positions: { ...positions, ...old.positions, [id]: { x: clampCoordinate(next.x), y: clampCoordinate(next.y) } },
    }));
  }
  function restore(original: Positions) {
    setSettings((old) => ({ ...old, positions: original }));
  }
  function sort(reset = false) {
    setUndo(settings);
    const base = reset ? defaultTeamPreferences() : { ...settings, ports: {} };
    // Hidden agents are sorted too, so expanding a branch never brings back stale coordinates.
    base.positions = reset
      ? layoutTeam(members, sizes, {}, base.grouping, METRICS, roleKey)
      : tidyTeam(members, sizes, positions, base.grouping, METRICS, roleKey);
    setSettings(base);
    fit();
    setNotice(reset ? "Default view restored. Undo is available." : "Team tidied. Undo is available.");
  }
  function toggleEditing() {
    drag.current = null;
    setEditing((value) => !value);
    setNotice(editing ? "Layout locked. Your positions are saved." : "Edit mode on. Drag a card by its header, or focus it and use the arrow keys.");
  }

  const groups = TEAM_ROLE_GROUPS.filter((group) => members.some((member) => roleGroupOf(member).key === group.key));
  const maxDepth = Math.max(0, ...depths.values());
  const hiddenCount = members.length - visible.length;

  const handle = (member: Agent) => {
    const position = positions[member.id]!;
    return (children: ReactNode) => {
      if (!editing) return <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1">{children}</div></div>;
      const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { id: member.id, x: event.clientX, y: event.clientY, point: position, original: settings.positions };
        holdView();
      };
      const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        if (current?.id !== member.id) return;
        move(member.id, { x: current.point.x + (event.clientX - current.x) / scaleRef.current, y: current.point.y + (event.clientY - current.y) / scaleRef.current });
      };
      const onPointerUp = () => {
        if (drag.current?.id === member.id) setNotice(`${member.name} moved. Position saved.`);
        drag.current = null;
      };
      const onPointerCancel = () => {
        if (drag.current?.id === member.id) restore(drag.current.original);
        drag.current = null;
      };
      const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && drag.current?.id === member.id) {
          restore(drag.current.original);
          drag.current = null;
          return;
        }
        const delta = KEY_DELTAS[event.key];
        if (!delta) return;
        event.preventDefault();
        const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
        holdView();
        move(member.id, { x: position.x + delta[0] * step, y: position.y + delta[1] * step });
        setNotice(`${member.name} moved. Position saved.`);
      };
      return (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Move ${member.name}`}
          aria-roledescription="movable card"
          title="Drag, or use the arrow keys, to move this card"
          className="-m-1.5 flex min-w-0 cursor-grab touch-none items-center gap-2 rounded-md p-1.5 outline-none select-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
        >
          <div className="min-w-0 flex-1" inert>{children}</div>
          <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      );
    };
  };

  const onViewportPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-team-card],button,a,[role=button]")) return;
    pan.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y };
    holdView();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Team canvas" data-editing={editing}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {members.length} agent{members.length === 1 ? "" : "s"}
          {hiddenCount ? ` · ${hiddenCount} hidden` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => sort()}>
                <WandSparkles />
                Magic sort
              </Button>
              <Button size="sm" variant="outline" disabled={!undo} onClick={() => {
                if (undo) setSettings(undo);
                setUndo(null);
                fit();
                setNotice("Previous layout restored.");
              }}>
                <Undo2 />
                Undo sort
              </Button>
            </>
          ) : null}
          <Button size="sm" variant={editing ? "secondary" : "outline"} aria-pressed={editing} onClick={toggleEditing}>
            <Move />
            Edit mode
          </Button>
          <TeamViewSettings
            settings={settings}
            update={update}
            editing={editing}
            maxDepth={maxDepth}
            groups={groups}
            onShowAll={() => { setSettings((old) => ({ ...old, collapsed: [], levels: 0 })); fit(); }}
            onRestoreDefault={() => sort(true)}
          />
        </div>
      </div>
      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          Browser storage is unavailable. Your layout works for this visit but will not survive a refresh.
        </p>
      ) : null}
      <span role="status" className="sr-only">{notice}</span>

      <div
        ref={viewport}
        data-testid="team-canvas-viewport"
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden rounded-lg border border-border bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
        tabIndex={0}
        aria-label="Team workspace"
        onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("[data-team-card]")) fit(); }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={(event) => {
          const start = pan.current;
          if (start) setCamera({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y });
        }}
        onPointerUp={() => { pan.current = null; }}
        onPointerCancel={() => { pan.current = null; }}
      >
        <div
          ref={layer}
          data-testid="team-canvas-layer"
          className="absolute top-0 left-0 size-px origin-top-left"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          <svg className="pointer-events-none absolute top-0 left-0 size-px overflow-visible" aria-hidden="true">
            <defs>
              <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {[...routes.values()].filter((route) => route.d).map((route) => {
              const style = LINE_STYLES[route.kind];
              return (
                <path
                  key={route.id}
                  data-kind={route.kind}
                  d={route.d}
                  fill="none"
                  stroke={style.stroke}
                  strokeOpacity={style.opacity}
                  strokeWidth={route.kind === "report" ? 1.5 : 2}
                  strokeDasharray={style.dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd={settings.arrows ? `url(#${marker})` : undefined}
                />
              );
            })}
          </svg>
          {visible.map((member) => {
            const group = roleGroupOf(member);
            const position = positions[member.id]!;
            const reports = members.filter((other) => other.reportsTo === member.id && other.id !== member.id);
            const collapsed = settings.collapsed.includes(member.id);
            const presentation: TeamCardPresentation = {
              level: (depths.get(member.id) ?? 0) + 1,
              groupLabel: group.label,
              groupColor: teamGroupColor(group.key, settings.palette[group.key], settings.colors),
              showLabels: settings.labels,
              managerName: members.find((other) => other.id === member.reportsTo)?.name,
              header: handle(member),
              reportsToggle: reports.length ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="self-start text-muted-foreground"
                  aria-expanded={!collapsed}
                  onClick={() => update("collapsed", collapsed ? settings.collapsed.filter((id) => id !== member.id) : [...settings.collapsed, member.id])}
                >
                  {collapsed ? "Show" : "Hide"} {reports.length} direct report{reports.length === 1 ? "" : "s"}
                </Button>
              ) : undefined,
            };
            return (
              <Card
                key={member.id}
                data-team-card={member.id}
                data-role-group={group.key}
                className={cn("absolute w-80 cursor-default gap-0 overflow-hidden py-0 shadow-xs", editing && "ring-1 ring-border")}
                style={{ left: position.x, top: position.y }}
              >
                {renderCard(member, presentation)}
              </Card>
            );
          })}
        </div>

        <p className="absolute bottom-3 left-3 hidden max-w-xs text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground md:block">
          Drag empty space to pan; Ctrl or ⌘ + scroll to zoom; double-click to fit.
          {editing ? " Drag a card by its header, or focus it and use the arrow keys." : ""}
        </p>
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-background/80 p-1 shadow-sm backdrop-blur-sm" role="group" aria-label="Zoom">
          <Button size="icon-xs" variant="ghost" aria-label="Zoom out" disabled={scale <= MIN_ZOOM} onClick={() => zoomTo(clampZoom(scale / ZOOM_STEP))}>
            <Minus />
          </Button>
          <span className="w-10 text-center font-mono text-xs">{Math.round(scale * 100)}%</span>
          <Button size="icon-xs" variant="ghost" aria-label="Zoom in" disabled={scale >= MAX_ZOOM} onClick={() => zoomTo(clampZoom(scale * ZOOM_STEP))}>
            <Plus />
          </Button>
          <Button size="xs" variant="ghost" onClick={fit} aria-label="Fit to screen">
            <Maximize2 />
            Fit
          </Button>
        </div>
        <div className="absolute right-3 bottom-3">
          <TeamRelationships relationships={annotated} evidenceStatus={evidenceStatus} />
        </div>
      </div>
    </section>
  );
}
