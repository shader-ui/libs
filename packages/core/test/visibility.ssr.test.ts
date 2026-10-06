// @vitest-environment node
import { expect, it } from "vitest";
import { canBeSeen, canBeSeenAll, getVisibility, observeVisibility } from "../src/index.js";

it("SSR : unknown, canBeSeen et canBeSeenAll faux, observeVisibility sans effet", () => {
  const el = {} as Element;
  expect(getVisibility(el).state).toBe("unknown");
  expect(canBeSeen(el)).toBe(false);
  expect(canBeSeenAll([el, el])).toEqual([false, false]);
  expect(() => observeVisibility(el, () => {})()).not.toThrow();
});
