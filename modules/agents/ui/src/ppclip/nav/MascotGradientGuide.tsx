import { useRef, type PointerEvent } from "react";
import type { AgentAppearance } from "@paperclipai/shared";

export type MascotGradient = NonNullable<AgentAppearance["gradient"]>;
const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
// The cap's unit body occupies 1 / (2 * .72) of the still portrait's camera view.
const bodySpan = 100 / 1.44, inset = (100 - bodySpan) / 2;
/** Keep the whole circular handle inside the cap, including its rounded dome. */
export function clampGradientCenter(x: number, y: number) {
  // The handle radius is 7.2% of the body; an 8% inset also clears its 7% bottom corners.
  x = Math.max(8, Math.min(92, clamp(x))); y = Math.max(8, Math.min(92, clamp(y)));
  const project = (cx: number, cy: number, radius: number) => {
    const dx = x - cx, dy = y - cy, length = Math.hypot(dx, dy);
    if (length <= radius) return;
    x = Math.round(cx + dx / length * radius); y = Math.round(cy + dy / length * radius);
    // Rounding must not put an integer coordinate back outside the silhouette.
    while (Math.hypot(x - cx, y - cy) > radius) {
      if (Math.abs(x - cx) > Math.abs(y - cy)) x += Math.sign(cx - x);
      else y += Math.sign(cy - y);
    }
  };
  if (y < 50) project(50, 50, 42);
  return { x, y };
}
export function gradientFromPointer(mode: "move" | "rotate", x: number, y: number, current: MascotGradient): MascotGradient {
  if (mode === "move") return { ...current, ...clampGradientCenter((x - inset) / bodySpan * 100, (y - inset) / bodySpan * 100) };
  const cx = inset + bodySpan * current.x / 100, cy = inset + bodySpan * current.y / 100;
  return { ...current, angle: Math.round(Math.atan2(y - cy, x - cx) * 180 / Math.PI) };
}

/** Visual handles have matching native range controls for keyboard and touch access. */
export function MascotGradientGuide({ value, onChange, mode: guideMode = "rotate" }: { value: MascotGradient; onChange: (value: MascotGradient) => void; mode?: "center" | "rotate" }) {
  const svg = useRef<SVGSVGElement>(null);
  const mode = useRef<"move" | "rotate" | null>(null);
  const cx = inset + bodySpan * value.x / 100, cy = inset + bodySpan * value.y / 100;
  const radians = value.angle * Math.PI / 180, dx = Math.cos(radians) * 28, dy = Math.sin(radians) * 28;
  function update(event: PointerEvent<SVGSVGElement>) {
    if (!mode.current || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    onChange(gradientFromPointer(mode.current, (event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100, value));
  }
  return <svg ref={svg} viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
    onPointerMove={update} onPointerUp={() => { mode.current = null; }} onPointerCancel={() => { mode.current = null; }} onLostPointerCapture={() => { mode.current = null; }}
    onPointerDown={event => {
      mode.current = guideMode === "center" ? "move" : "rotate";
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      update(event);
    }}>
    {guideMode === "center" ? <>
      <g transform={`translate(${inset} ${inset}) scale(${bodySpan / 100})`}>
        <path data-handle="move" d="M50 0 A50 50 0 0 1 100 50 L100 93 A7 7 0 0 1 93 100 L7 100 A7 7 0 0 1 0 93 L0 50 A50 50 0 0 1 50 0 Z" fill="transparent" className="pointer-events-auto cursor-crosshair" />
      </g>
      <circle data-handle="move" cx={cx} cy={cy} r="5" fill="var(--background)" fillOpacity="0.8" stroke="var(--foreground)" strokeWidth="1" className="pointer-events-auto cursor-move" />
      <path d={`M${cx - 2} ${cy}h4 M${cx} ${cy - 2}v4`} stroke="var(--foreground)" strokeWidth="0.75" />
    </> : <>
      <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--background)" strokeWidth="2.5" />
      <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--foreground)" strokeWidth="1" strokeDasharray="2 1" />
      <circle cx={cx} cy={cy} r="2" fill="var(--background)" stroke="var(--foreground)" strokeWidth="1" />
      <circle data-handle="rotate" cx={cx + dx} cy={cy + dy} r="4" fill="var(--foreground)" stroke="var(--background)" strokeWidth="1" className="pointer-events-auto cursor-crosshair" />
    </>}
  </svg>;
}
