import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animateScroll, OVERSHOOT_MAX, overshootOf, scrollAt, scrollDuration, type Scroller } from "../src/scroll.js";

/** Défilement animé : spec Scrollspy §6 bis. */

let y = 0;
const scroller: Scroller = {
  target: window,
  position: () => y,
  set: (to) => void (y = to),
  max: () => 10_000,
  area: () => ({ top: 0, height: 900 }),
  paddingTop: () => 0,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance", "requestAnimationFrame", "cancelAnimationFrame"] });
  y = 0;
});
afterEach(() => vi.useRealTimers());

describe("Défilement animé (§6 bis)", () => {
  it("fast est plus court que smooth sur la même distance, dans leurs bornes", () => {
    for (const d of [100, 1500, 50_000]) expect(scrollDuration("fast", d)).toBeLessThan(scrollDuration("smooth", d));
    expect(scrollDuration("smooth", 0)).toBe(400);
    expect(scrollDuration("smooth", 50_000)).toBe(1000);
    expect(scrollDuration("fast", 50_000)).toBe(400);
  });

  it("élasticité : dépassement ≤ 4 % et ≤ 48 px, aucun sans place", () => {
    expect(overshootOf(0, 500, 1, 10_000)).toBe(20);
    expect(overshootOf(0, 5000, 1, 10_000)).toBe(OVERSHOOT_MAX);
    expect(overshootOf(0, 5000, 0.5, 10_000)).toBe(OVERSHOOT_MAX / 2);
    expect(overshootOf(0, 5000, 1, 5000)).toBe(0); // bas de page
    expect(overshootOf(3000, 0, 1, 10_000)).toBe(0); // haut de page
  });

  it("un seul aller-retour : dépasse la cible, puis s'y pose exactement", () => {
    const samples = Array.from({ length: 101 }, (_, i) => scrollAt(i / 100, 0, 1000, 40));
    expect(Math.max(...samples)).toBeCloseTo(1040, 0);
    expect(samples.at(-1)).toBe(1000);
    const peak = samples.indexOf(Math.max(...samples));
    expect(samples.slice(peak).every((v, i, a) => i === 0 || v <= a[i - 1]!)).toBe(true);
  });

  it("arrive sur la cible, puis plus aucune frame", async () => {
    const run = animateScroll(scroller, 2000, "fast");
    await vi.advanceTimersByTimeAsync(1000);
    await run.done;
    expect(y).toBe(2000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("une molette pendant l'animation l'arrête aussitôt, sans retour en arrière", async () => {
    const run = animateScroll(scroller, 3000, "smooth", 1);
    await vi.advanceTimersByTimeAsync(200);
    const at = y;
    window.dispatchEvent(new WheelEvent("wheel"));
    await run.done;
    await vi.advanceTimersByTimeAsync(1000);
    expect(y).toBe(at);
    expect(vi.getTimerCount()).toBe(0);
  });
});
