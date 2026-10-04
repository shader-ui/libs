import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Les tests lisent les sources : pas besoin de compiler le cœur avant de tester React
    alias: { "@shader-ui/core": fileURLToPath(new URL("packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
  },
});
