import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { handleRest } from "../src/rest";
import { upsertVTubers, upsertGroups } from "../src/ingest";
import type { VTuberRow } from "../src/types";

function v(over: Partial<VTuberRow> & { id: string; name: string }): VTuberRow {
  return {
    nationality: null, activity: "active", group_name: null, img_url: null,
    debut_date: null, graduate_date: null, youtube_id: null, youtube_subs: null,
    youtube_views: null, view_growth_7d: null, view_growth_30d: null,
    twitch_id: null, twitch_followers: null, popularity: null,
    popular_video_type: null, popular_video_id: null, updated_at: "t", ...over,
  };
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM vtuber"), env.DB.prepare("DELETE FROM vtuber_group")]);
  await upsertVTubers(env.DB, [
    v({ id: "alice", name: "Alice 愛麗絲", nationality: "TW", group_name: "GroupA", youtube_subs: 500000 }),
    v({ id: "eve", name: "Eve", nationality: "JP", youtube_subs: 800000 }),
  ]);
  await upsertGroups(env.DB, [{ name: "GroupA", nationality: "TW", popularity: 100, livestream_popularity: 1, video_popularity: 2, updated_at: "t" }]);
});

function req(path: string): Request {
  return new Request(`http://api.local${path}`);
}
async function getJson(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await handleRest(req(path), env);
  return { status: r!.status, body: (await r!.json()) as Record<string, unknown> };
}

describe("handleRest", () => {
  it("GET /v1/vtubers searches and filters by region", async () => {
    const { status, body } = await getJson("/v1/vtubers?region=TW");
    expect(status).toBe(200);
    expect((body.results as VTuberRow[]).map((x) => x.id)).toEqual(["alice"]);
  });

  it("GET /v1/vtubers/:id returns one VTuber", async () => {
    const { body } = await getJson("/v1/vtubers/alice");
    expect((body.vtuber as VTuberRow).id).toBe("alice");
  });

  it("GET /v1/vtubers/:id/history resolves and returns a series array", async () => {
    const { status, body } = await getJson("/v1/vtubers/alice/history");
    expect(status).toBe(200);
    expect(body.vtuber_id).toBe("alice");
    expect(Array.isArray(body.history)).toBe(true);
  });

  it("GET /v1/rankings?type=top_subscribers ranks", async () => {
    const { body } = await getJson("/v1/rankings?type=top_subscribers");
    expect((body.results as VTuberRow[])[0]?.id).toBe("eve");
  });

  it("GET /v1/rankings without a type returns 400", async () => {
    const { status } = await getJson("/v1/rankings");
    expect(status).toBe(400);
  });

  it("GET /v1/groups/:name returns members", async () => {
    const { body } = await getJson("/v1/groups/GroupA");
    expect((body.members as VTuberRow[]).map((m) => m.id)).toEqual(["alice"]);
  });

  it("GET /v1/status reports freshness", async () => {
    const { status, body } = await getJson("/v1/status");
    expect(status).toBe(200);
    expect(body.vtuber_count).toBe(2);
  });

  it("returns null for non-/v1 paths", async () => {
    const r = await handleRest(req("/something"), env);
    expect(r).toBeNull();
  });

  it("sets permissive CORS headers", async () => {
    const r = await handleRest(req("/v1/status"), env);
    expect(r!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
