import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Several integration tests spawn their own `next start` server and hit
    // the shared dev Postgres instance; running files in parallel exhausts
    // its connection pool and spawns 5 servers at once. Serialize files —
    // the suite is small enough that this costs seconds, not minutes.
    fileParallelism: false,
  },
});
