import { applyD1Migrations, env } from "cloudflare:test";

// Apply our D1 schema to the isolated per-test database before tests run.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
