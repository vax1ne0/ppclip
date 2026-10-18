import { useRef, type PointerEvent } from "react";
import type { AgentAppearance } from "@paperclipai/shared";

export type MascotGradient = NonNullable<AgentAppearance["gradient"]>;
const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
// The cap's unit body occupies 1 / (2 * .72) of the still portrait's camera view.
const bodySpan = 100 / 1.44, inset = (100 - bodySpan) / 2;
export function gradientFromPointer(mode: "move" | "rotate", x: number, y: number, current: MascotGradient): MascotGradient {
  if (mode === "move") return { ...current, x: clamp((x - inset) / bodySpan * 100), y: clamp((y - inset) / bodySpan * 100) };
  const cx = inset + bodySpan * current.x / 100, cy = inset + bodySpan * current.y / 100;
  return { ...current, angle: Math.round(Math.atan2(y - cy, x - cx) * 180 / Math.PI) };
}

/** Visual handles have matching native range controls for keyboard and touch access. */
export function MascotGradientGuide({ value, onChange }: { value: MascotGradient; onChange: (value: MascotGradient) => void }) {
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
      const target = event.target as SVGElement;
      mode.current = target.dataset.handle === "rotate" ? "rotate" : "move";
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      update(event);
    }}>
    <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--background)" strokeWidth="2.5" />
    <line data-handle="move" x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--foreground)" strokeWidth="1" strokeDasharray="2 1" className="pointer-events-auto cursor-move" />
    <circle data-handle="move" cx={cx} cy={cy} r="3" fill="var(--background)" stroke="var(--foreground)" strokeWidth="1" className="pointer-events-auto cursor-move" />
    <circle data-handle="rotate" cx={cx + dx} cy={cy + dy} r="3" fill="var(--foreground)" stroke="var(--background)" strokeWidth="1" className="pointer-events-auto cursor-crosshair" />
  </svg>;
}
