import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/server/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 20000,
  },
});
