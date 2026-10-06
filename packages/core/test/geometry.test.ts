import { describe, expect, it } from "vitest";
import { perimeterAt } from "../src/index.js";

describe("perimeterAt", () => {
  it.each([0, 10])("parcourt le contour dans le sens horaire (rayon %i)", (r) => {
    expect(perimeterAt(50, 0, 100, 40, r)).toBeCloseTo(0);
    expect(perimeterAt(100, 20, 100, 40, r)).toBeCloseTo(0.25);
    expect(perimeterAt(50, 40, 100, 40, r)).toBeCloseTo(0.5);
    expect(perimeterAt(0, 20, 100, 40, r)).toBeCloseTo(0.75);
  });

  it("est continu à la jonction (juste avant le milieu du bord haut)", () => {
    expect(perimeterAt(49.9, 0, 100, 40, 8)).toBeGreaterThan(0.99);
  });

});
