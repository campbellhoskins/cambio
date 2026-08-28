import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/adapter.ts", "src/rulesReference.ts", "src/scenarios.ts"],
    },
  },
});
