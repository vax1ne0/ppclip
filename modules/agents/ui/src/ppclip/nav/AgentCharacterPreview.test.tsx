// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { appearanceForPalette } from "@paperclipai/shared";
import { AgentCharacter } from "@/components/AgentCharacter";

const player = vi.hoisted(() => ({ create: vi.fn(), setDefinition: vi.fn(), setAnimation: vi.fn(), destroy: vi.fn() }));
vi.mock("@paperclipai/shared/cliplab/runtime", () => ({ createCharacter: player.create }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("keeps one player while colors change live and stops requesting hidden PNG fallbacks", async () => {
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
  const header = <AgentCharacter appearance={appearance} motion="still" label="Header" />;
  const preview = () => host.querySelector('[aria-label="Preview"]')!;
  try {
    await import("@paperclipai/shared/cliplab/definition");
    await act(async () => root.render(<>{header}<AgentCharacter appearance={appearance} trackingRegion={trackingRegion} label="Preview" /></>));
    await vi.waitFor(async () => { await act(async () => {}); expect(player.create).toHaveBeenCalledOnce(); }, { timeout: 5000 });
    expect(host.querySelector("canvas")).not.toBeNull();
    expect(preview().querySelector("img")).toBeNull();
    expect(host.querySelector('[aria-label="Header"] canvas')).toBeNull();
    for (const color of ["#ff0000", "#00ff00", "#abcdef"]) {
      await act(async () => root.render(<>{header}<AgentCharacter appearance={{ ...appearance, customColors: { a: color, b: "#123456" } }} trackingRegion={trackingRegion} label="Preview" /></>));
    }
    expect(player.create).toHaveBeenCalledOnce();
    expect(player.create.mock.calls[0]?.[2].trackingRegion).toBe(trackingRegion.current);
    expect(player.destroy).not.toHaveBeenCalled();
    expect(player.setDefinition.mock.calls.at(-1)?.[0].character).toMatchObject({ color: "#abcdef", color2: "#123456" });
    expect(preview().querySelector("img")).toBeNull();
  } finally { await act(async () => root.unmount()); }
  expect(player.destroy).toHaveBeenCalledOnce();
});
