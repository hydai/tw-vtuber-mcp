import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { callTool, getDataStatus, TOOLS, SOURCE_REPO } from "../src/tools";
import { upsertVTubers, upsertHistory, writeIngestMeta } from "../src/ingest";
import type { VTuberRow, HistoryRow } from "../src/types";

function v(over: Partial<VTuberRow> & { id: string; name: string }): VTuberRow {
  return {
    nationality: null, activity: "active", group_name: null, img_url: null,
    debut_date: null, graduate_date: null, youtube_id: null, youtube_subs: null,
    youtube_views: null, view_growth_7d: null, view_growth_30d: null,
    twitch_id: null, twitch_followers: null, popularity: null,
    popular_video_type: null, popular_video_id: null, updated_at: "t", ...over,
  };
}

const SEED: VTuberRow[] = [
  v({ id: "alice", name: "Alice 愛麗絲", nationality: "TW", youtube_subs: 500000, popularity: 9000 }),
  v({ id: "bob", name: "Bob", nationality: "TW", youtube_subs: 100000 }),
  v({ id: "eve", name: "Eve", nationality: "JP", youtube_subs: 800000, popularity: 12000 }),
];
const ALICE_HIST: HistoryRow[] = [
  { vtuber_id: "alice", date: "2026-05-24", youtube_subs: 499000, youtube_views: null, twitch_followers: null, popularity: null, group_name: null, activity: "active" },
  { vtuber_id: "alice", date: "2026-05-25", youtube_subs: 500000, youtube_views: null, twitch_followers: null, popularity: null, group_name: null, activity: "active" },
];

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM vtuber"), env.DB.prepare("DELETE FROM vtuber_history"), env.DB.prepare("DELETE FROM ingest_meta")]);
  await upsertVTubers(env.DB, SEED);
  await upsertHistory(env.DB, ALICE_HIST);
});

describe("tools", () => {
  it("exposes a stable set of tool names", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "get_data_status", "get_group", "get_vtuber", "get_vtuber_history",
      "list_events", "list_groups", "list_rankings", "search_vtubers",
    ]);
  });

  it("search_vtubers wraps results with source and maps region -> nationality", async () => {
    const r = (await callTool(env.DB, "search_vtubers", { region: "TW", sort_by: "subscribers", order: "desc" })) as {
      source: string; count: number; results: VTuberRow[];
    };
    expect(r.source).toBe(SOURCE_REPO);
    expect(r.results[0]?.id).toBe("alice"); // top TW
    expect(r.count).toBe(2); // eve is JP, excluded
  });

  it("get_vtuber finds by name", async () => {
    const r = (await callTool(env.DB, "get_vtuber", { id_or_name: "Eve" })) as { vtuber: VTuberRow | null };
    expect(r.vtuber?.id).toBe("eve");
  });

  it("get_vtuber_history resolves name -> id and returns the series", async () => {
    const r = (await callTool(env.DB, "get_vtuber_history", { id_or_name: "alice" })) as { vtuber_id: string; history: HistoryRow[] };
    expect(r.vtuber_id).toBe("alice");
    expect(r.history.length).toBe(2);
  });

  it("list_rankings returns ranked results", async () => {
    const r = (await callTool(env.DB, "list_rankings", { type: "top_subscribers", limit: 2 })) as { results: VTuberRow[] };
    expect(r.results[0]?.id).toBe("eve"); // 800k
  });

  it("rejects invalid enum args via zod", async () => {
    await expect(callTool(env.DB, "list_rankings", { type: "bogus" })).rejects.toThrow();
  });

  it("list_events applies the limit", async () => {
    await upsertVTubers(env.DB, [
      v({ id: "g1", name: "Grad1", activity: "graduate" }),
      v({ id: "g2", name: "Grad2", activity: "graduate" }),
    ]);
    const r = (await callTool(env.DB, "list_events", { type: "graduate", limit: 1 })) as { count: number; results: unknown[] };
    expect(r.results.length).toBe(1);
    expect(r.count).toBe(1);
  });

  it("get_data_status reports counts and freshness", async () => {
    await writeIngestMeta(env.DB, { vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1", lastCommitSha: "sha", ingestedAt: "t", status: "ok" });
    const r = (await getDataStatus(env.DB)) as { vtuber_count: number; statistic_updated_at: string | null; source: string };
    expect(r.vtuber_count).toBe(3);
    expect(r.statistic_updated_at).toBe("S1");
    expect(r.source).toBe(SOURCE_REPO);
  });
});
