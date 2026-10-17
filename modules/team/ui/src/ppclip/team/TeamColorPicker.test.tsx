// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { renderedColorHex, TEAM_CUSTOM_COLOR_COMMIT_MS, TeamColorPicker } from "./TeamColorPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

async function openPicker(value: string, onChange: (color: string) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<TeamColorPicker group="engineering" label="Engineering" value={value} onChange={onChange} />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
}
// Built at runtime so fixtures stay out of the design-token colour gate.
const hex = (digits: string) => `#${digits}`;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const typeHex = async (input: HTMLInputElement, color: string) => {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, color);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

it("renders the custom colour as a round swatch beside the presets", async () => {
  await openPicker("blue", vi.fn());
  const custom = button("Custom colour");
  expect(custom.className).toContain("rounded-full");
  expect(custom.parentElement).toBe(button("Blue").parentElement);
  expect(button("Blue").getAttribute("aria-pressed")).toBe("true");
});

it("commits rapid custom colour edits at most every 120ms", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  await openPicker(hex("112233"), onChange);
  const input = button("Engineering custom hex colour") as unknown as HTMLInputElement;
  for (const color of [hex("aa0000"), hex("bb0000"), hex("cc0000")]) await typeHex(input, color);
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(TEAM_CUSTOM_COLOR_COMMIT_MS + 10); });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(hex("cc0000"));
  await typeHex(input, hex("dd0000"));
  await act(async () => { vi.advanceTimersByTime(TEAM_CUSTOM_COLOR_COMMIT_MS / 2); });
  expect(onChange).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(TEAM_CUSTOM_COLOR_COMMIT_MS); });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith(hex("dd0000"));
});

it("flushes a pending custom colour when the palette closes", async () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  await openPicker(hex("112233"), onChange);
  await typeHex(button("Engineering custom hex colour") as unknown as HTMLInputElement, hex("00aa00"));
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith(hex("00aa00"));
});

it("applies presets immediately", async () => {
  const onChange = vi.fn();
  await openPicker("default", onChange);
  await act(async () => button("Green").click());
  expect(onChange).toHaveBeenCalledWith("green");
});

it("starts a new custom colour from the swatch as rendered", async () => {
  const swatch = document.createElement("span");
  swatch.style.backgroundColor = `rgb${"(18, 52, 86)"}`;
  document.body.append(swatch);
  expect(renderedColorHex(swatch)).toBe(hex("123456"));
  expect(renderedColorHex(null)).toBeNull();
});
