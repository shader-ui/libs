// @vitest-environment node
import { expect, it } from "vitest";
import { getEnvironment } from "../src/index.js";

it("SSR : rien n'est lu côté serveur, getEnvironment() renvoie undefined", () => {
  expect(getEnvironment()).toBeUndefined();
});
