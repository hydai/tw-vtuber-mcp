import { describe, it, expect } from "vitest";
import {
  normalizeCount,
  parseUpdateTime,
  parseRoster,
  mergeViewCounts,
  mergeTrending,
  parseGroups,
  toHistoryRows,
} from "../src/parse";
import type {
  UpstreamRosterResponse,
  UpstreamGroupsResponse,
  UpstreamUpdateTime,
} from "../src/types";

describe("normalizeCount", () => {
  it("returns the count when tag is 'has'", () => {
    expect(normalizeCount({ tag: "has", count: 547000 })).toBe(547000);
  });

  it("returns null when the count is hidden", () => {
    expect(normalizeCount({ tag: "hidden" })).toBeNull();
  });

  it("returns null for other hidden-style tags (no / none)", () => {
    expect(normalizeCount({ tag: "no" })).toBeNull();
    expect(normalizeCount({ tag: "none" })).toBeNull();
  });

  it("returns null when the field is absent", () => {
    expect(normalizeCount(undefined)).toBeNull();
    expect(normalizeCount(null)).toBeNull();
  });

  it("returns null defensively when tag is 'has' but count is missing", () => {
    expect(normalizeCount({ tag: "has" })).toBeNull();
  });

  it("preserves a legitimate zero count (no falsy checks!)", () => {
    expect(normalizeCount({ tag: "has", count: 0 })).toBe(0);
  });
});

describe("parseUpdateTime", () => {
  it("extracts the nested time fields", () => {
    const json: UpstreamUpdateTime = {
      time: {
        statisticUpdateTime: "2026-05-25T14:30:05.0000000+00:00",
        VTuberDataUpdateTime: "2026-05-25T14:01:47.0000000+00:00",
      },
    };
    expect(parseUpdateTime(json)).toEqual({
      vtuberDataUpdateTime: "2026-05-25T14:01:47.0000000+00:00",
      statisticUpdateTime: "2026-05-25T14:30:05.0000000+00:00",
    });
  });
});

const sampleRoster: UpstreamRosterResponse = {
  VTubers: [
    {
      id: "1c5619a4ece046dd8ba68ed343489ca3",
      activity: "active",
      name: "李聽",
      imgUrl: "https://img/lee.jpg",
      YouTube: { subscriber: { tag: "has", count: 547000 }, id: "UCw2CTp01JDHoyH-4tFX9UlA" },
      Twitch: { follower: { tag: "has", count: 32844 }, id: "leelisten2017" },
      popularVideo: { type: "YouTube", id: "IPvKZGh2e04" },
      nationality: "TW",
      debutDate: "2021-10-31",
    },
    {
      id: "hk0000000000000000000000000000aa",
      activity: "active",
      name: "香港V",
      imgUrl: null,
      YouTube: { subscriber: { tag: "hidden" }, id: "UChk" },
      nationality: "HK",
      group: "SomeGroup",
    },
  ],
};

describe("parseRoster", () => {
  it("maps base VTuber fields, flattening platforms", () => {
    const map = parseRoster(sampleRoster, "2026-05-25T00:00:00Z");
    const lee = map.get("1c5619a4ece046dd8ba68ed343489ca3")!;
    expect(lee.name).toBe("李聽");
    expect(lee.nationality).toBe("TW");
    expect(lee.youtube_id).toBe("UCw2CTp01JDHoyH-4tFX9UlA");
    expect(lee.youtube_subs).toBe(547000);
    expect(lee.twitch_followers).toBe(32844);
    expect(lee.popular_video_type).toBe("YouTube");
    expect(lee.popular_video_id).toBe("IPvKZGh2e04");
    expect(lee.updated_at).toBe("2026-05-25T00:00:00Z");
    // not known from the roster alone — filled by later merges
    expect(lee.youtube_views).toBeNull();
    expect(lee.popularity).toBeNull();
  });

  it("handles hidden counts, missing platforms, and optional fields", () => {
    const map = parseRoster(sampleRoster, "t");
    const hk = map.get("hk0000000000000000000000000000aa")!;
    expect(hk.youtube_subs).toBeNull(); // hidden
    expect(hk.twitch_id).toBeNull(); // no Twitch object
    expect(hk.twitch_followers).toBeNull();
    expect(hk.group_name).toBe("SomeGroup");
    expect(hk.img_url).toBeNull();
    expect(hk.popular_video_type).toBeNull(); // no popularVideo
  });
});

describe("mergeViewCounts", () => {
  it("fills total views and the matching growth window, keyed by id", () => {
    const map = parseRoster(sampleRoster, "t");
    const sevenDay: UpstreamRosterResponse = {
      VTubers: [
        {
          id: "1c5619a4ece046dd8ba68ed343489ca3",
          activity: "active",
          name: "李聽",
          YouTube: {
            id: "UCw2CTp01JDHoyH-4tFX9UlA",
            totalViewCount: 164731708,
            _7DaysGrowth: { diff: 1801890, recordType: "full" },
          },
        },
      ],
    };
    mergeViewCounts(map, sevenDay, "7d");
    const lee = map.get("1c5619a4ece046dd8ba68ed343489ca3")!;
    expect(lee.youtube_views).toBe(164731708);
    expect(lee.view_growth_7d).toBe(1801890);
    expect(lee.view_growth_30d).toBeNull(); // not merged in the 7d pass
  });

  it("ignores VTubers absent from the roster", () => {
    const map = parseRoster(sampleRoster, "t");
    const stray: UpstreamRosterResponse = {
      VTubers: [{ id: "zzz", activity: "active", name: "x", YouTube: { id: "u", totalViewCount: 1 } }],
    };
    mergeViewCounts(map, stray, "7d");
    expect(map.has("zzz")).toBe(false);
  });
});

describe("mergeTrending", () => {
  it("sets combined popularity from available platforms", () => {
    const map = parseRoster(sampleRoster, "t");
    const trending: UpstreamRosterResponse = {
      VTubers: [
        {
          id: "1c5619a4ece046dd8ba68ed343489ca3",
          activity: "active",
          name: "李聽",
          YouTube: { id: "u", popularity: 122406 },
          Twitch: { id: "t", popularity: 17985 },
        },
      ],
    };
    mergeTrending(map, trending);
    expect(map.get("1c5619a4ece046dd8ba68ed343489ca3")!.popularity).toBe(122406 + 17985);
  });
});

describe("parseGroups", () => {
  it("maps group aggregates", () => {
    const json: UpstreamGroupsResponse = {
      groups: [
        {
          id: "RenewLive",
          name: "RenewLive",
          popularity: 0,
          livestreamPopularity: 10,
          videoPopularity: 20,
          members: [],
        },
      ],
    };
    const rows = parseGroups(json, "t");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "RenewLive",
      popularity: 0,
      livestream_popularity: 10,
      video_popularity: 20,
    });
  });
});

describe("toHistoryRows", () => {
  it("projects vtuber rows into dated history rows", () => {
    const map = parseRoster(sampleRoster, "t");
    const rows = toHistoryRows(map.values(), "2026-05-25");
    expect(rows).toHaveLength(2);
    const lee = rows.find((r) => r.vtuber_id === "1c5619a4ece046dd8ba68ed343489ca3")!;
    expect(lee).toMatchObject({ date: "2026-05-25", youtube_subs: 547000, twitch_followers: 32844 });
  });
});
