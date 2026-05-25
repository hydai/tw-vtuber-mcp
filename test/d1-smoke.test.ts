import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("d1 test harness", () => {
  it("applies migrations so tables exist and start empty", async () => {
    const row = await env.DB.prepare("SELECT count(*) AS n FROM vtuber").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
