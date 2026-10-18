import { expect, it } from "vitest";
import { appearanceForPalette } from "@paperclipai/shared";
import { renderAgentSvg } from "@paperclipai/shared/cliplab/static";
import { clampGradientCenter, gradientFromPointer, gradientMidpointColor } from "./MascotGradientGuide";
it("matches the shader's linear-light midpoint color", () => {
  expect(gradientMidpointColor("#000000", "#ffffff")).toBe("#bcbcbc");
  expect(gradientMidpointColor("#ff0000", "#0000ff")).toBe("#bc00bc");
  expect(gradientMidpointColor("#123456", "#123456")).toBe("#123456");
});
it("places the target on the actual outer and inner rendered gradient midpoints", () => {
  for (const gradient of [{ x: 50, y: 50, angle: 20 }, { x: 30, y: 70, angle: 90 }, { x: 65, y: 30, angle: -45 }]) {
    const svg = renderAgentSvg({ ...appearanceForPalette("arctic-blue"), gradient }, 256, 1, "rest");
    const gradients = [...svg.matchAll(/<linearGradient[^>]*x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)];
    expect(gradients).toHaveLength(2);
    const x = 128 + (gradient.x / 100 - .5) * 256 / 1.44;
    const y = 128 + (gradient.y / 100 - .5) * 256 / 1.44;
    for (const match of gradients) {
      const [x1, y1, x2, y2] = match.slice(1).map(Number), dx = x2 - x1, dy = y2 - y1;
      expect(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)).toBeCloseTo(.5, 3);
    }
  }
});
it("maps guide drags to the cap body and clamps outside movement", () => {
  const initial = { x: 50, y: 50, angle: 20 };
  expect(gradientFromPointer("move", 50, 50, initial)).toEqual(initial);
  expect(gradientFromPointer("move", -100, 200, initial)).toEqual({ x: 8, y: 92, angle: 20 });
  expect(gradientFromPointer("rotate", 50, 80, initial).angle).toBe(90);
  expect(gradientFromPointer("rotate", 80, 50, initial).angle).toBe(0);
  expect(gradientFromPointer("rotate", 50, 20, initial).angle).toBe(-90);
});
it("keeps the circle inside the rounded dome and bottom edges across out-of-bounds drags", () => {
  for (let x = -20; x <= 120; x += 5) for (let y = -20; y <= 120; y += 5) {
    const point = clampGradientCenter(x, y);
    expect(point.x).toBeGreaterThanOrEqual(8); expect(point.x).toBeLessThanOrEqual(92);
    expect(point.y).toBeGreaterThanOrEqual(8); expect(point.y).toBeLessThanOrEqual(92);
    if (point.y < 50) expect(Math.hypot(point.x - 50, point.y - 50)).toBeLessThanOrEqual(42);
  }
});
