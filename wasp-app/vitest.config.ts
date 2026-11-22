// Separate from vite.config.ts so the Wasp vite plugin isn't loaded for unit tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
