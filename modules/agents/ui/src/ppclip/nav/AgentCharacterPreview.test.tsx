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
  const appearance = appearanceForPalette("arctic-blue");
  try {
    await act(async () => root.render(<AgentCharacter appearance={appearance} />));
    await vi.waitFor(async () => { await act(async () => {}); expect(player.create).toHaveBeenCalledOnce(); });
    expect(host.querySelector("canvas")).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
    for (const color of ["#ff0000", "#00ff00", "#abcdef"]) {
      await act(async () => root.render(<AgentCharacter appearance={{ ...appearance, customColors: { a: color, b: "#123456" } }} />));
    }
    expect(player.create).toHaveBeenCalledOnce();
    expect(player.destroy).not.toHaveBeenCalled();
    expect(player.setDefinition.mock.calls.at(-1)?.[0].character).toMatchObject({ color: "#abcdef", color2: "#123456" });
    expect(host.querySelector("img")).toBeNull();
  } finally { await act(async () => root.unmount()); }
  expect(player.destroy).toHaveBeenCalledOnce();
});
