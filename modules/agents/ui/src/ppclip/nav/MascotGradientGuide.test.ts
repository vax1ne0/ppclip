import { expect, it } from "vitest";
import { gradientFromPointer } from "./MascotGradientGuide";
it("maps guide drags to the cap body and clamps outside movement", () => {
  const initial = { x: 50, y: 50, angle: 20 };
  expect(gradientFromPointer("move", 50, 50, initial)).toEqual(initial);
  expect(gradientFromPointer("move", -100, 200, initial)).toEqual({ x: 0, y: 100, angle: 20 });
  expect(gradientFromPointer("rotate", 50, 80, initial).angle).toBe(90);
  expect(gradientFromPointer("rotate", 80, 50, initial).angle).toBe(0);
  expect(gradientFromPointer("rotate", 50, 20, initial).angle).toBe(-90);
});
