import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import {
  hasChanged,
  readIngestMeta,
  writeIngestMeta,
  upsertVTubers,
  upsertHistory,
  upsertGroups,
  runIngest,
} from "../src/ingest";
import type { VTuberRow, HistoryRow, GroupRow } from "../src/types";

function row(over: Partial<VTuberRow> & { id: string; name: string }): VTuberRow {
  return {
    nationality: null,
    activity: null,
    group_name: null,
    img_url: null,
    debut_date: null,
    graduate_date: null,
    youtube_id: null,
    youtube_subs: null,
    youtube_views: null,
    view_growth_7d: null,
    view_growth_30d: null,
    twitch_id: null,
    twitch_followers: null,
    popularity: null,
    popular_video_type: null,
    popular_video_id: null,
    updated_at: "t",
    ...over,
  };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM vtuber"),
    env.DB.prepare("DELETE FROM vtuber_history"),
    env.DB.prepare("DELETE FROM vtuber_group"),
    env.DB.prepare("DELETE FROM ingest_meta"),
  ]);
});

describe("hasChanged", () => {
  const latest = { vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1" };

  it("is true when there is no prior meta", () => {
    expect(hasChanged(latest, null)).toBe(true);
  });

  it("is true when the statistic time advanced", () => {
    expect(hasChanged({ ...latest, statisticUpdateTime: "S2" }, { vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1" })).toBe(true);
  });

  it("is true when the vtuber-data time advanced", () => {
    expect(hasChanged({ ...latest, vtuberDataUpdateTime: "V2" }, { vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1" })).toBe(true);
  });

  it("is false when both are unchanged", () => {
    expect(hasChanged(latest, { vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1" })).toBe(false);
  });
});

describe("upsertVTubers", () => {
  it("inserts, then updates on id conflict (no duplicate)", async () => {
    await upsertVTubers(env.DB, [row({ id: "a", name: "Alice", youtube_subs: 100 })]);
    await upsertVTubers(env.DB, [row({ id: "a", name: "Alice2", youtube_subs: 200 })]);
    const r = await env.DB.prepare("SELECT name, youtube_subs FROM vtuber WHERE id='a'").first<{ name: string; youtube_subs: number }>();
    expect(r).toMatchObject({ name: "Alice2", youtube_subs: 200 });
    const c = await env.DB.prepare("SELECT count(*) AS n FROM vtuber").first<{ n: number }>();
    expect(c?.n).toBe(1);
  });

  it("batches large inputs without parameter overflow", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row({ id: `id${i}`, name: `v${i}` }));
    await upsertVTubers(env.DB, rows);
    const c = await env.DB.prepare("SELECT count(*) AS n FROM vtuber").first<{ n: number }>();
    expect(c?.n).toBe(120);
  });
});

describe("upsertHistory", () => {
  it("is idempotent per (vtuber_id, date) — re-run updates, not duplicates", async () => {
    const h = (subs: number): HistoryRow => ({
      vtuber_id: "a",
      date: "2026-05-25",
      youtube_subs: subs,
      youtube_views: null,
      twitch_followers: null,
      popularity: null,
      group_name: null,
      activity: null,
    });
    await upsertHistory(env.DB, [h(100)]);
    await upsertHistory(env.DB, [h(150)]);
    const c = await env.DB.prepare("SELECT count(*) AS n FROM vtuber_history").first<{ n: number }>();
    expect(c?.n).toBe(1);
    const r = await env.DB.prepare("SELECT youtube_subs FROM vtuber_history WHERE vtuber_id='a' AND date='2026-05-25'").first<{ youtube_subs: number }>();
    expect(r?.youtube_subs).toBe(150);
  });
});

describe("upsertGroups", () => {
  it("inserts group aggregates", async () => {
    const g: GroupRow = { name: "G1", nationality: null, popularity: 42, livestream_popularity: 1, video_popularity: 2, updated_at: "t" };
    await upsertGroups(env.DB, [g]);
    const r = await env.DB.prepare("SELECT popularity FROM vtuber_group WHERE name='G1'").first<{ popularity: number }>();
    expect(r?.popularity).toBe(42);
  });
});

describe("ingest meta round-trip", () => {
  it("reads null before any write, then round-trips", async () => {
    expect(await readIngestMeta(env.DB)).toBeNull();
    await writeIngestMeta(env.DB, {
      vtuberDataUpdateTime: "V1",
      statisticUpdateTime: "S1",
      lastCommitSha: "sha",
      ingestedAt: "t",
      status: "ok",
    });
    expect(await readIngestMeta(env.DB)).toMatchObject({ vtuberDataUpdateTime: "V1", statisticUpdateTime: "S1" });
  });
});

const FIXTURES: Record<string, string> = {
  "update-time.json": JSON.stringify({
    time: { statisticUpdateTime: "2026-05-25T14:30:05Z", VTuberDataUpdateTime: "2026-05-25T14:01:47Z" },
  }),
  "commits/master": JSON.stringify({ sha: "deadbeef" }),
  "vtubers/all.json": JSON.stringify({
    VTubers: [
      { id: "a", activity: "active", name: "Alice", YouTube: { id: "UCa", subscriber: { tag: "has", count: 1000 } }, nationality: "TW" },
      { id: "b", activity: "active", name: "Bob", YouTube: { id: "UCb", subscriber: { tag: "hidden" } }, nationality: "HK", group: "G1" },
    ],
  }),
  "7-days/all.json": JSON.stringify({
    VTubers: [{ id: "a", activity: "active", name: "Alice", YouTube: { id: "UCa", totalViewCount: 500000, _7DaysGrowth: { diff: 1000, recordType: "full" } } }],
  }),
  "30-days/all.json": JSON.stringify({
    VTubers: [{ id: "a", activity: "active", name: "Alice", YouTube: { id: "UCa", totalViewCount: 500000, _30DaysGrowth: { diff: 5000, recordType: "full" } } }],
  }),
  "trending-vtubers/combined/100.json": JSON.stringify({
    VTubers: [{ id: "a", activity: "active", name: "Alice", YouTube: { id: "UCa", popularity: 9000 } }],
  }),
  "groups.json": JSON.stringify({
    groups: [{ id: "G1", name: "G1", popularity: 42, livestreamPopularity: 1, videoPopularity: 2, members: [] }],
  }),
};

function fakeFetch(map: Record<string, string>) {
  return async (url: string): Promise<string> => {
    const key = Object.keys(map).find((k) => url.includes(k));
    if (key === undefined) throw new Error(`unexpected url: ${url}`);
    return map[key]!;
  };
}

describe("runIngest", () => {
  it("fetches, parses, merges, and populates D1 + meta", async () => {
    const res = await runIngest(env, {
      fetchText: fakeFetch(FIXTURES),
      now: () => new Date("2026-05-25T12:00:00Z"),
    });
    expect(res.status).toBe("ok");
    expect(res.vtubers).toBe(2);

    const alice = await env.DB.prepare("SELECT * FROM vtuber WHERE id='a'").first<Record<string, unknown>>();
    expect(alice).toMatchObject({
      name: "Alice",
      youtube_subs: 1000,
      youtube_views: 500000,
      view_growth_7d: 1000,
      view_growth_30d: 5000,
      popularity: 9000,
      nationality: "TW",
    });
    const bob = await env.DB.prepare("SELECT youtube_subs, group_name FROM vtuber WHERE id='b'").first<{ youtube_subs: number | null; group_name: string }>();
    expect(bob).toMatchObject({ youtube_subs: null, group_name: "G1" });

    const hist = await env.DB.prepare("SELECT count(*) AS n FROM vtuber_history WHERE date='2026-05-25'").first<{ n: number }>();
    expect(hist?.n).toBe(2);

    const grp = await env.DB.prepare("SELECT popularity FROM vtuber_group WHERE name='G1'").first<{ popularity: number }>();
    expect(grp?.popularity).toBe(42);

    expect(await readIngestMeta(env.DB)).toMatchObject({ statisticUpdateTime: "2026-05-25T14:30:05Z" });
  });

  it("skips when upstream is unchanged since the last ingest", async () => {
    const deps = { fetchText: fakeFetch(FIXTURES), now: () => new Date("2026-05-25T12:00:00Z") };
    await runIngest(env, deps);
    const res2 = await runIngest(env, { ...deps, now: () => new Date("2026-05-26T12:00:00Z") });
    expect(res2.status).toBe("skipped");
    const c = await env.DB.prepare("SELECT count(*) AS n FROM vtuber_history").first<{ n: number }>();
    expect(c?.n).toBe(2); // no new-day rows added because we skipped
  });
});
