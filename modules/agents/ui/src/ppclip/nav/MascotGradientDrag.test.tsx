// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MascotGradientGuide } from "./MascotGradientGuide";

it("coalesces pointer movement per frame and flushes the final position on release", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const frames = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const host = document.createElement("div"), root = createRoot(host), change = vi.fn();
  try {
    await act(async () => root.render(<MascotGradientGuide mode="center" value={{ x: 50, y: 50, angle: 20 }} onChange={change} />));
    const svg = host.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    svg.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number) => svg.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: 50, pointerId: 1 }));
    await act(async () => { pointer("pointerdown", 50); for (let x = 51; x <= 60; x++) pointer("pointermove", x); });
    expect(frames.size).toBe(1); expect(change).not.toHaveBeenCalled();
    await act(async () => { const [key, callback] = [...frames][0]; frames.delete(key); callback(16); });
    expect(change).toHaveBeenCalledOnce(); expect(change.mock.calls[0][0].x).toBe(64);
    await act(async () => { pointer("pointermove", 65); pointer("pointerup", 65); });
    expect(change).toHaveBeenCalledTimes(2); expect(change.mock.calls[1][0].x).toBe(72);
    expect(frames.size).toBe(0);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
