import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// vitest-pool-workers v0.16 (for vitest 4) uses a plugin, not the old
// `defineWorkersConfig` from "@cloudflare/vitest-pool-workers/config".
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
