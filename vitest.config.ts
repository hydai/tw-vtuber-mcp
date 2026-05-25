import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import path from "node:path";

// Read our migrations at config time and hand them to the test runtime as a
// binding; a setup file applies them to the per-test D1 before each suite.
const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      // v8 coverage relies on the Node inspector, which workerd lacks; istanbul
      // instruments via source transforms and works in the Workers pool.
      provider: "istanbul",
      include: ["src/**"],
      reporter: ["text", "html"],
    },
  },
});
