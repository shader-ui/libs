import { describe, expect, it } from "vitest";
import { getEffect, sampleEffect } from "../src/index.js";

describe("sampleEffect", () => {
  it("éteint complètement un effet à sa fin", () => {
    for (const name of ["error", "success", "pulse", "sweep", "ripple"]) {
      const def = getEffect(name)!;
      expect(sampleEffect(def, def.duration).intensity).toBeCloseTo(0);
      expect(sampleEffect(def, def.duration).done).toBe(true);
    }
  });

});
