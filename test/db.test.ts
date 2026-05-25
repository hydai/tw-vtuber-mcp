import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { upsertVTubers, upsertHistory, upsertGroups } from "../src/ingest";
import {
  searchVTubers,
  getVTuber,
  getVTuberHistory,
  listRankings,
  listGroups,
  getGroup,
  listEvents,
} from "../src/db";
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
  v({ id: "alice", name: "Alice 愛麗絲", nationality: "TW", group_name: "GroupA", youtube_subs: 500000, youtube_views: 10_000_000, view_growth_7d: 5000, view_growth_30d: 20000, twitch_followers: 30000, popularity: 9000, debut_date: "2021-05-28" }),
  v({ id: "bob", name: "Bob 鮑伯", nationality: "TW", group_name: "GroupA", youtube_subs: 100000, youtube_views: 2_000_000, view_growth_7d: 50000, view_growth_30d: 100000, popularity: 3000, debut_date: "2023-03-03" }),
  v({ id: "carol", name: "Carol", nationality: "HK", youtube_subs: null, youtube_views: 5_000_000, popularity: 1000, debut_date: "2020-01-01" }),
  v({ id: "dave", name: "Dave", nationality: "TW", activity: "graduate", youtube_subs: 30000, debut_date: "2019-12-31" }),
  v({ id: "eve", name: "Eve", nationality: "JP", youtube_subs: 800000, youtube_views: 50_000_000, popularity: 12000, debut_date: "2022-06-15" }),
  v({ id: "frank", name: "Frank 法蘭克", nationality: "TW", activity: "preparing", youtube_subs: null, debut_date: "2026-05-30" }),
];

const ALICE_HISTORY: HistoryRow[] = [
  { vtuber_id: "alice", date: "2026-05-23", youtube_subs: 498000, youtube_views: 9_800_000, twitch_followers: 29000, popularity: 8800, group_name: "GroupA", activity: "active" },
  { vtuber_id: "alice", date: "2026-05-24", youtube_subs: 499000, youtube_views: 9_900_000, twitch_followers: 29500, popularity: 8900, group_name: "GroupA", activity: "active" },
  { vtuber_id: "alice", date: "2026-05-25", youtube_subs: 500000, youtube_views: 10_000_000, twitch_followers: 30000, popularity: 9000, group_name: "GroupA", activity: "active" },
];

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM vtuber"),
    env.DB.prepare("DELETE FROM vtuber_history"),
    env.DB.prepare("DELETE FROM vtuber_group"),
  ]);
  await upsertVTubers(env.DB, SEED);
  await upsertHistory(env.DB, ALICE_HISTORY);
  await upsertGroups(env.DB, [
    { name: "GroupA", nationality: null, popularity: 12000, livestream_popularity: 5000, video_popularity: 7000, updated_at: "t" },
  ]);
});

describe("searchVTubers", () => {
  it("matches a name substring (incl. CJK)", async () => {
    const r = await searchVTubers(env.DB, { query: "愛麗" });
    expect(r.map((x) => x.id)).toEqual(["alice"]);
  });

  it("filters by nationality, activity, and group", async () => {
    expect((await searchVTubers(env.DB, { nationality: "TW" })).length).toBe(4);
    const active = await searchVTubers(env.DB, { nationality: "TW", activity: "active" });
    expect(active.map((x) => x.id).sort()).toEqual(["alice", "bob"]);
    const grp = await searchVTubers(env.DB, { group: "GroupA" });
    expect(grp.map((x) => x.id).sort()).toEqual(["alice", "bob"]);
  });

  it("filters by subscriber range", async () => {
    const r = await searchVTubers(env.DB, { minSubs: 200000 });
    expect(r.map((x) => x.id).sort()).toEqual(["alice", "eve"]);
  });

  it("sorts by subscribers desc with unknown (null) counts last", async () => {
    const r = await searchVTubers(env.DB, { sortBy: "subscribers", order: "desc" });
    expect(r[0]?.id).toBe("eve"); // 800k
    expect(r[1]?.id).toBe("alice"); // 500k
    expect(r.at(-1)?.youtube_subs).toBeNull(); // carol/frank (null) sorted last
  });

  it("applies limit", async () => {
    expect((await searchVTubers(env.DB, { sortBy: "subscribers", order: "desc", limit: 2 })).length).toBe(2);
  });
});

describe("getVTuber", () => {
  it("finds by id, then by name, else null", async () => {
    expect((await getVTuber(env.DB, "alice"))?.name).toBe("Alice 愛麗絲");
    expect((await getVTuber(env.DB, "Eve"))?.id).toBe("eve");
    expect(await getVTuber(env.DB, "nobody")).toBeNull();
  });
});

describe("getVTuberHistory", () => {
  it("returns the series oldest-first", async () => {
    const h = await getVTuberHistory(env.DB, "alice");
    expect(h.map((x) => x.date)).toEqual(["2026-05-23", "2026-05-24", "2026-05-25"]);
    expect(h[0]?.youtube_subs).toBe(498000);
  });

  it("filters by date range", async () => {
    const h = await getVTuberHistory(env.DB, "alice", { from: "2026-05-24" });
    expect(h.map((x) => x.date)).toEqual(["2026-05-24", "2026-05-25"]);
  });
});

describe("listRankings", () => {
  it("top_subscribers excludes unknown counts and orders desc", async () => {
    const r = await listRankings(env.DB, { type: "top_subscribers" });
    expect(r.map((x) => x.id)).toEqual(["eve", "alice", "bob", "dave"]); // carol/frank (null) excluded
  });

  it("growing_7d orders by 7-day growth", async () => {
    const r = await listRankings(env.DB, { type: "growing_7d", limit: 1 });
    expect(r[0]?.id).toBe("bob"); // 50000
  });

  it("trending orders by popularity", async () => {
    const r = await listRankings(env.DB, { type: "trending", limit: 1 });
    expect(r[0]?.id).toBe("eve"); // 12000
  });
});

describe("groups", () => {
  it("lists groups and fetches members", async () => {
    expect((await listGroups(env.DB)).map((g) => g.name)).toEqual(["GroupA"]);
    const detail = await getGroup(env.DB, "GroupA");
    expect(detail.group?.popularity).toBe(12000);
    expect(detail.members.map((m) => m.id).sort()).toEqual(["alice", "bob"]);
  });

  it("filters by member nationality even when the group's own nationality is null", async () => {
    expect((await listGroups(env.DB, "TW")).map((g) => g.name)).toEqual(["GroupA"]); // alice/bob are TW
    expect(await listGroups(env.DB, "JP")).toEqual([]); // GroupA has no JP members
  });
});

describe("listEvents", () => {
  const now = () => new Date("2026-05-25T00:00:00Z");

  it("anniversary: matches debut month-day in the next 7 days", async () => {
    const r = await listEvents(env.DB, { type: "anniversary", window: "upcoming", now: now() });
    expect(r.map((x) => x.id)).toContain("alice"); // debut 2021-05-28
    expect(r.map((x) => x.id)).not.toContain("bob"); // debut 03-03
  });

  it("graduate: lists graduated VTubers", async () => {
    const r = await listEvents(env.DB, { type: "graduate" });
    expect(r.map((x) => x.id)).toEqual(["dave"]);
  });

  it("debut upcoming: includes a preparing VTuber debuting within 7 days", async () => {
    const r = await listEvents(env.DB, { type: "debut", window: "upcoming", now: now() });
    expect(r.map((x) => x.id)).toContain("frank"); // debut 2026-05-30
  });
});
