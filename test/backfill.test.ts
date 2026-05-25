import { describe, it, expect } from "vitest";
import {
  pickDailyCommits,
  serializeValue,
  historyRowsToSql,
  rawUrl,
  cdnUrl,
  UPSTREAM_FILES,
} from "../scripts/backfill-lib";
import type { HistoryRow } from "../src/types";

describe("pickDailyCommits", () => {
  it("maps a single commit to its UTC day + sha", () => {
    expect(pickDailyCommits([{ sha: "a", date: "2026-03-10T09:00:00Z" }])).toEqual([
      { date: "2026-03-10", sha: "a" },
    ]);
  });

  it("keeps the latest commit of each UTC day", () => {
    const picked = pickDailyCommits([
      { sha: "early", date: "2026-03-10T02:00:00Z" },
      { sha: "late", date: "2026-03-10T18:00:00Z" },
      { sha: "mid", date: "2026-03-10T09:00:00Z" },
    ]);
    expect(picked).toEqual([{ date: "2026-03-10", sha: "late" }]);
  });

  it("returns one entry per day, ascending by date, regardless of input order", () => {
    const picked = pickDailyCommits([
      { sha: "d3", date: "2026-01-03T10:00:00Z" },
      { sha: "d1", date: "2026-01-01T10:00:00Z" },
      { sha: "d2", date: "2026-01-02T10:00:00Z" },
    ]);
    expect(picked).toEqual([
      { date: "2026-01-01", sha: "d1" },
      { date: "2026-01-02", sha: "d2" },
      { date: "2026-01-03", sha: "d3" },
    ]);
  });

  it("buckets by UTC, not local time (offset timestamps normalized)", () => {
    // 2026-05-26T05:00+08:00 == 2026-05-25T21:00Z -> belongs to 2026-05-25
    const picked = pickDailyCommits([{ sha: "x", date: "2026-05-26T05:00:00+08:00" }]);
    expect(picked).toEqual([{ date: "2026-05-25", sha: "x" }]);
  });

  it("splits commits straddling the UTC midnight boundary", () => {
    const picked = pickDailyCommits([
      { sha: "before", date: "2026-01-01T23:30:00Z" },
      { sha: "after", date: "2026-01-02T00:10:00Z" },
    ]);
    expect(picked).toEqual([
      { date: "2026-01-01", sha: "before" },
      { date: "2026-01-02", sha: "after" },
    ]);
  });

  it("returns empty for empty input", () => {
    expect(pickDailyCommits([])).toEqual([]);
  });
});

describe("serializeValue", () => {
  it("renders null as NULL", () => {
    expect(serializeValue(null)).toBe("NULL");
  });

  it("renders integers verbatim, including zero", () => {
    expect(serializeValue(547000)).toBe("547000");
    expect(serializeValue(0)).toBe("0");
  });

  it("quotes strings", () => {
    expect(serializeValue("active")).toBe("'active'");
  });

  it("escapes single quotes by doubling (SQLite literal)", () => {
    expect(serializeValue("O'Brien")).toBe("'O''Brien'");
  });

  it("preserves unicode and empty strings", () => {
    expect(serializeValue("ホロライブ")).toBe("'ホロライブ'");
    expect(serializeValue("")).toBe("''");
  });
});

describe("historyRowsToSql", () => {
  const row: HistoryRow = {
    vtuber_id: "abc",
    date: "2026-01-02",
    youtube_subs: 100,
    youtube_views: null,
    twitch_followers: 5,
    popularity: null,
    group_name: "ホロ",
    activity: "active",
  };

  it("returns empty string for no rows", () => {
    expect(historyRowsToSql([])).toBe("");
  });

  it("emits an idempotent multi-row upsert matching the schema column order", () => {
    const expected =
      "INSERT INTO vtuber_history (vtuber_id,date,youtube_subs,youtube_views,twitch_followers,popularity,group_name,activity) VALUES\n" +
      "('abc','2026-01-02',100,NULL,5,NULL,'ホロ','active')\n" +
      "ON CONFLICT(vtuber_id,date) DO UPDATE SET youtube_subs=excluded.youtube_subs,youtube_views=excluded.youtube_views,twitch_followers=excluded.twitch_followers,popularity=excluded.popularity,group_name=excluded.group_name,activity=excluded.activity;";
    expect(historyRowsToSql([row])).toBe(expected);
  });

  it("joins multiple rows with comma-newline and a single trailing conflict clause", () => {
    const sql = historyRowsToSql([row, { ...row, vtuber_id: "def", group_name: null }]);
    expect(sql).toContain("('abc','2026-01-02',100,NULL,5,NULL,'ホロ','active'),\n('def','2026-01-02',100,NULL,5,NULL,NULL,'active')");
    // exactly one ON CONFLICT clause for the whole batch
    expect(sql.match(/ON CONFLICT/g)).toHaveLength(1);
    expect(sql.endsWith(";")).toBe(true);
  });

  it("escapes single quotes inside group_name", () => {
    const sql = historyRowsToSql([{ ...row, group_name: "Idol's" }]);
    expect(sql).toContain("'Idol''s'");
  });
});

describe("URL builders", () => {
  const RAW = "https://raw.githubusercontent.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson";
  const CDN = "https://cdn.jsdelivr.net/gh/TaiwanVtuberData/TaiwanVTuberTrackingDataJson";

  it("builds raw.githubusercontent URLs pinned by /<sha>/", () => {
    expect(rawUrl(RAW, "SHA1", "vtubers/all.json")).toBe(
      "https://raw.githubusercontent.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson/SHA1/api/v2/all/vtubers/all.json",
    );
  });

  it("builds jsDelivr URLs pinned by @<sha>", () => {
    expect(cdnUrl(CDN, "SHA1", "trending-vtubers/combined/100.json")).toBe(
      "https://cdn.jsdelivr.net/gh/TaiwanVtuberData/TaiwanVTuberTrackingDataJson@SHA1/api/v2/all/trending-vtubers/combined/100.json",
    );
  });

  it("lists the four upstream files needed for all four history metrics", () => {
    expect(UPSTREAM_FILES).toEqual([
      "vtubers/all.json",
      "vtubers-view-count-change/7-days/all.json",
      "vtubers-view-count-change/30-days/all.json",
      "trending-vtubers/combined/100.json",
    ]);
  });
});
