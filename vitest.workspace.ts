import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "engine",
      root: "./packages/engine",
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts"
      ],
      environment: "node"
    }
  },
  {
    test: {
      name: "protocol",
      root: "./packages/protocol",
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts"
      ],
      environment: "node"
    }
  },
  {
    test: {
      name: "ui",
      root: "./packages/ui",
      include: [
        "src/**/*.test.{ts,tsx}",
        "test/**/*.test.{ts,tsx}"
      ],
      environment: "jsdom"
    }
  },
  {
    test: {
      name: "tutorial",
      root: "./packages/tutorial",
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts"
      ],
      environment: "node"
    }
  },
  {
    test: {
      name: "testkit",
      root: "./packages/testkit",
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts"
      ],
      environment: "node"
    }
  },
  {
    test: {
      name: "server",
      root: "./apps/server",
      include: [
        "src/**/*.test.ts",
        "test/**/*.test.ts"
      ],
      environment: "node"
    }
  },
  {
    test: {
      name: "web",
      root: "./apps/web",
      include: [
        "src/**/*.test.{ts,tsx}",
        "test/**/*.test.{ts,tsx}"
      ],
      environment: "jsdom"
    }
  }
]);
