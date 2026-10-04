import { describe, expect, it } from "vitest";
import { getEffect, sampleEffect, MAX_LOOP_DURATION } from "../src/index.js";

describe("sampleEffect", () => {
  it("éteint complètement un effet à sa fin", () => {
    for (const name of ["error", "success", "pulse", "sweep", "ripple"]) {
      const def = getEffect(name)!;
      expect(sampleEffect(def, def.duration).intensity).toBeCloseTo(0);
      expect(sampleEffect(def, def.duration).done).toBe(true);
    }
  });

  it("décélère : la tête parcourt plus de chemin au début qu'à la fin", () => {
    const def = getEffect("sweep")!;
    const early = sampleEffect(def, def.duration * 0.2).progress;
    const late = sampleEffect(def, def.duration).progress - sampleEffect(def, def.duration * 0.8).progress;
    expect(early).toBeGreaterThan(late * 3);
  });

  it("limite une boucle à 5 s (WCAG 2.2.2), même si on demande plus", () => {
    const def = { ...getEffect("loading")!, maxLoopDuration: 60_000 };
    expect(sampleEffect(def, MAX_LOOP_DURATION - 1).done).toBe(false);
    expect(sampleEffect(def, MAX_LOOP_DURATION).done).toBe(true);
  });

  it("éteint une boucle arrêtée en fondu", () => {
    const def = getEffect("loading")!;
    expect(sampleEffect(def, 1000, 1000).intensity).toBeCloseTo(1);
    expect(sampleEffect(def, 1150, 1000).intensity).toBeLessThan(1);
    expect(sampleEffect(def, 1300, 1000).done).toBe(true);
  });
});
