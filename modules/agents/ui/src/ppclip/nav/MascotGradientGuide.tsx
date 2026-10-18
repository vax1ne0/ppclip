import { useEffect, useId, useRef, type PointerEvent } from "react";
import type { AgentAppearance } from "@paperclipai/shared";

export type MascotGradient = NonNullable<AgentAppearance["gradient"]>;
const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
// The cap's unit body occupies 1 / (2 * .72) of the still portrait's camera view.
const bodySpan = 100 / 1.44, inset = (100 - bodySpan) / 2;
const silhouette = "M50 0 A50 50 0 0 1 100 50 L100 93 A7 7 0 0 1 93 100 L7 100 A7 7 0 0 1 0 93 L0 50 A50 50 0 0 1 50 0 Z";
/** Match the renderer's linear-light 50/50 color, rather than averaging encoded hex bytes. */
export function gradientMidpointColor(a: string, b: string) {
  const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  const encoded = (value: number) => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
  return `#${[1, 3, 5].map(start => {
    const value = (linear(parseInt(a.slice(start, start + 2), 16) / 255) + linear(parseInt(b.slice(start, start + 2), 16) / 255)) / 2;
    return Math.round(encoded(value) * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}
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
export function MascotGradientGuide({ value, onChange, mode: guideMode = "rotate", colors }: { value: MascotGradient; onChange: (value: MascotGradient) => void; mode?: "center" | "rotate"; colors?: { a: string; b: string } }) {
  const clipId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const mode = useRef<"move" | "rotate" | null>(null);
  const frame = useRef<number | null>(null), pending = useRef<MascotGradient | null>(null);
  const change = useRef(onChange); change.current = onChange;
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  function flush() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current) { const next = pending.current; pending.current = null; change.current(next); }
  }
  function finish() { flush(); mode.current = null; }
  const cx = inset + bodySpan * value.x / 100, cy = inset + bodySpan * value.y / 100;
  const radians = value.angle * Math.PI / 180, dx = Math.cos(radians) * 28, dy = Math.sin(radians) * 28;
  function update(event: PointerEvent<SVGSVGElement>) {
    if (!mode.current || !svg.current) return;
    const rect = svg.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pending.current = gradientFromPointer(mode.current, (event.clientX - rect.left) / rect.width * 100, (event.clientY - rect.top) / rect.height * 100, value);
    // Pointer hardware can deliver many events per display frame. Render only the latest one.
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }
  const handle = "pointer-events-auto cursor-grab active:cursor-grabbing";
  return <svg ref={svg} viewBox="0 0 100 100" aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 size-full touch-none overflow-visible select-none"
    onPointerMove={update} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onPointerDown={event => {
      mode.current = guideMode === "center" ? "move" : "rotate";
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      update(event);
    }}>
    {guideMode === "center" ? <>
      <defs><clipPath id={clipId}><path d={silhouette} transform={`translate(${inset} ${inset}) scale(${bodySpan / 100})`} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <line x1={cx - dx * 4} y1={cy - dy * 4} x2={cx + dx * 4} y2={cy + dy * 4} stroke="var(--background)" strokeWidth="1.2" opacity="0.65" />
        <line x1={cx - dx * 4} y1={cy - dy * 4} x2={cx + dx * 4} y2={cy + dy * 4} stroke="var(--foreground)" strokeWidth="0.4" strokeDasharray="1 1.5" />
      </g>
      <g transform={`translate(${inset} ${inset}) scale(${bodySpan / 100})`}>
        <path data-handle="move" d={silhouette} fill="transparent" className="pointer-events-auto cursor-crosshair" />
      </g>
      <circle cx={cx} cy={cy} r="4.5" fill={colors ? gradientMidpointColor(colors.a, colors.b) : "var(--popover)"} stroke="var(--background)" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="4.5" fill="none" stroke="var(--foreground)" strokeWidth="0.65" />
      <path d={`M${cx - 2} ${cy}h4 M${cx} ${cy - 2}v4`} stroke="var(--foreground)" strokeWidth="0.65" strokeLinecap="round" />
      <circle data-handle="move" cx={cx} cy={cy} r="8" fill="transparent" className={handle} />
    </> : <>
      <circle cx={cx} cy={cy} r="28" fill="none" stroke="var(--background)" strokeWidth="1.5" opacity="0.5" />
      <circle cx={cx} cy={cy} r="28" fill="none" stroke="var(--foreground)" strokeWidth="0.35" strokeDasharray="1 2" opacity="0.7" />
      <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--background)" strokeWidth="2" strokeLinecap="round" />
      <line x1={cx - dx} y1={cy - dy} x2={cx + dx} y2={cy + dy} stroke="var(--foreground)" strokeWidth="0.6" strokeLinecap="round" />
      <circle cx={cx - dx} cy={cy - dy} r="1.5" fill="var(--foreground)" stroke="var(--background)" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r="1.7" fill="var(--popover)" stroke="var(--foreground)" strokeWidth="0.6" />
      <g transform={`translate(${cx + dx} ${cy + dy})`}>
        <circle r="4.5" fill="var(--popover)" stroke="var(--background)" strokeWidth="2" />
        <circle r="4.5" fill="none" stroke="var(--foreground)" strokeWidth="0.65" />
        <path d="M-2 0a2 2 0 0 1 3.4-1.4M2 0a2 2 0 0 1-3.4 1.4M1.4-2.5v1.1H.3M-1.4 2.5V1.4H-.3" fill="none" stroke="var(--foreground)" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle data-handle="rotate" cx={cx + dx} cy={cy + dy} r="8" fill="transparent" className={handle} />
    </>}
    <rect x="31" y="94" width="38" height="8" rx="2" fill="var(--popover)" stroke="var(--border)" strokeWidth="0.4" />
    <text x="50" y="99.2" textAnchor="middle" fill="var(--popover-foreground)" fontSize="3.7" className="font-sans tabular-nums">{guideMode === "center" ? `X ${value.x}% · Y ${value.y}%` : `${value.angle}°`}</text>
  </svg>;
}
