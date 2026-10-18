// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { appearanceForPalette } from "@paperclipai/shared";
import { AgentCharacter } from "@/components/AgentCharacter";

const player = vi.hoisted(() => ({ create: vi.fn(), setDefinition: vi.fn(), setAnimation: vi.fn(), destroy: vi.fn(), pause: vi.fn(), play: vi.fn(), setStill: vi.fn() }));
vi.mock("@paperclipai/shared/cliplab/runtime", () => ({ createCharacter: player.create }));
vi.mock("@paperclipai/shared/cliplab/definition", () => ({
  animationId: (state: string) => state,
  characterDefinition: (appearance: any) => ({ character: { color: appearance.customColors?.a, color2: appearance.customColors?.b, ...(appearance.gradient ? { gradientAngle: appearance.gradient.angle, gradientCenterX: appearance.gradient.x / 100 - .5, gradientCenterY: .5 - appearance.gradient.y / 100 } : {}) } }),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("keeps header tracking and the dedicated editor canvas live through color and gradient changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  player.create.mockImplementation((host: HTMLElement) => { host.appendChild(document.createElement("canvas")); return player; });
  const host = document.createElement("div"), root = createRoot(host);
  const trackingRegion = { current: document.createElement("div") };
  const appearance = appearanceForPalette("arctic-blue");
  const header = <AgentCharacter appearance={appearance} trackingScope="page" label="Header" />;
  const preview = () => host.querySelector('[aria-label="Preview"]')!;
  try {
    await import("@paperclipai/shared/cliplab/definition");
    await import("@paperclipai/shared/cliplab/runtime");
    await act(async () => root.render(<>{header}</>));
    await vi.waitFor(async () => { await act(async () => {}); expect(player.create).toHaveBeenCalledOnce(); }, { timeout: 5000 });
    await act(async () => root.render(<>{header}<AgentCharacter appearance={appearance} rendering="dedicated" trackingRegion={trackingRegion} label="Preview" /></>));
    await vi.waitFor(async () => { await act(async () => {}); expect(player.create).toHaveBeenCalledTimes(2); }, { timeout: 5000 });
    expect(host.querySelector("canvas")).not.toBeNull();
    expect(preview().querySelector("img")).toBeNull();
    expect(host.querySelector('[aria-label="Header"] canvas')).not.toBeNull();
    for (const color of ["#ff0000", "#00ff00", "#abcdef"]) {
      await act(async () => root.render(<>{header}<AgentCharacter appearance={{ ...appearance, customColors: { a: color, b: "#123456" } }} rendering="dedicated" trackingRegion={trackingRegion} label="Preview" /></>));
    }
    expect(player.create).toHaveBeenCalledTimes(2);
    expect(player.create.mock.calls.some(call => call[2].trackingRegion === trackingRegion.current)).toBe(true);
    expect(player.create.mock.calls.some(call => call[2].trackingScope === "page")).toBe(true);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(player.setDefinition.mock.calls.at(-1)?.[0].character).toMatchObject({ color: "#abcdef", color2: "#123456" });
    for (const gradient of [{ x: 30, y: 70, angle: 20 }, { x: 30, y: 70, angle: 90 }]) {
      await act(async () => root.render(<>{header}<AgentCharacter appearance={{ ...appearance, gradient }} rendering="dedicated" motion="still" state="rest" trackingRegion={trackingRegion} label="Preview" /></>));
      expect(player.create).toHaveBeenCalledTimes(2);
      expect(player.setDefinition.mock.calls.at(-1)?.[0].character).toMatchObject({ gradientAngle: gradient.angle, gradientCenterX: gradient.x / 100 - .5, gradientCenterY: .5 - gradient.y / 100 });
      expect(preview().querySelector("canvas")).not.toBeNull();
      expect(preview().querySelector("img")).toBeNull();
    }
    expect(player.pause).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
  expect(player.destroy).toHaveBeenCalledTimes(2);
}, 15000);
