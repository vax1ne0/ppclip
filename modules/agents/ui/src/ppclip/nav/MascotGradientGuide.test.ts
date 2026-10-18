import { expect, it } from "vitest";
import { clampGradientCenter, gradientFromPointer } from "./MascotGradientGuide";
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
