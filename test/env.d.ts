/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from "cloudflare:test";

// Make the test-only TEST_MIGRATIONS binding visible on the `cloudflare:test`
// env (alongside the real bindings from worker-configuration.d.ts).
declare global {
  namespace Cloudflare {
    interface Env {
      // Optional: only present in tests. Keeping it optional means the
      // production `Env` still satisfies the `Cloudflare.Env` constraint
      // (e.g. McpAgent<Env>).
      TEST_MIGRATIONS?: D1Migration[];
    }
  }
}
