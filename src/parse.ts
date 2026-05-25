import type {
  UpstreamCount,
  UpstreamUpdateTime,
  UpstreamRosterResponse,
  UpstreamGroupsResponse,
  UpdateTime,
  VTuberRow,
  GroupRow,
  HistoryRow,
} from "./types";

/**
 * Normalize an upstream subscriber/follower count into a DB value.
 *
 *   - `tag === "has"` with a numeric count  ->  that number (including 0)
 *   - anything else                          ->  null   (store "unknown", not 0)
 *
 * Look at `tag` first, then check `count` is a number — so a hidden tag with a
 * stale residual count is rejected, and a real `count: 0` survives (a falsy
 * `|| null` would wrongly drop it).
 */
export function normalizeCount(c: UpstreamCount | null | undefined): number | null {
  if (!c || c.tag !== "has") return null;
  return typeof c.count === "number" ? c.count : null;
}

/** Extract the two update timestamps from upstream `update-time.json`. */
export function parseUpdateTime(json: UpstreamUpdateTime): UpdateTime {
  return {
    vtuberDataUpdateTime: json.time.VTuberDataUpdateTime,
    statisticUpdateTime: json.time.statisticUpdateTime,
  };
}

/** Parse the roster (`vtubers/all.json`) into VTuberRows keyed by id. */
export function parseRoster(
  json: UpstreamRosterResponse,
  updatedAt: string,
): Map<string, VTuberRow> {
  const map = new Map<string, VTuberRow>();
  for (const v of json.VTubers ?? []) {
    map.set(v.id, {
      id: v.id,
      name: v.name,
      nationality: v.nationality ?? null,
      activity: v.activity ?? null,
      group_name: v.group ?? null,
      img_url: v.imgUrl ?? null,
      debut_date: v.debutDate ?? null,
      graduate_date: v.graduateDate ?? null,
      youtube_id: v.YouTube?.id ?? null,
      youtube_subs: normalizeCount(v.YouTube?.subscriber),
      youtube_views: null, // filled by mergeViewCounts
      view_growth_7d: null,
      view_growth_30d: null,
      twitch_id: v.Twitch?.id ?? null,
      twitch_followers: normalizeCount(v.Twitch?.follower),
      popularity: null, // filled by mergeTrending
      popular_video_type: v.popularVideo?.type ?? null,
      popular_video_id: v.popularVideo?.id ?? null,
      updated_at: updatedAt,
    });
  }
  return map;
}

/** Enrich rows with total view count + the matching growth window, keyed by id. */
export function mergeViewCounts(
  map: Map<string, VTuberRow>,
  viewJson: UpstreamRosterResponse,
  range: "7d" | "30d",
): void {
  for (const v of viewJson.VTubers ?? []) {
    const row = map.get(v.id);
    if (!row) continue;
    const yt = v.YouTube;
    if (!yt) continue;
    if (typeof yt.totalViewCount === "number") row.youtube_views = yt.totalViewCount;
    if (range === "7d" && typeof yt._7DaysGrowth?.diff === "number") {
      row.view_growth_7d = yt._7DaysGrowth.diff;
    }
    if (range === "30d" && typeof yt._30DaysGrowth?.diff === "number") {
      row.view_growth_30d = yt._30DaysGrowth.diff;
    }
  }
}

/** Enrich rows with combined (YouTube + Twitch) popularity from trending data. */
export function mergeTrending(
  map: Map<string, VTuberRow>,
  trendingJson: UpstreamRosterResponse,
): void {
  for (const v of trendingJson.VTubers ?? []) {
    const row = map.get(v.id);
    if (!row) continue;
    const yt = v.YouTube?.popularity;
    const tw = v.Twitch?.popularity;
    if (typeof yt === "number" || typeof tw === "number") {
      row.popularity = (typeof yt === "number" ? yt : 0) + (typeof tw === "number" ? tw : 0);
    }
  }
}

/** Parse group-level aggregates from `groups.json`. */
export function parseGroups(json: UpstreamGroupsResponse, updatedAt: string): GroupRow[] {
  return (json.groups ?? []).map((g) => ({
    name: g.name,
    nationality: null, // not provided at group level; members carry their own
    popularity: typeof g.popularity === "number" ? g.popularity : null,
    livestream_popularity: typeof g.livestreamPopularity === "number" ? g.livestreamPopularity : null,
    video_popularity: typeof g.videoPopularity === "number" ? g.videoPopularity : null,
    updated_at: updatedAt,
  }));
}

/** Project current VTuberRows into dated history rows for a given UTC date. */
export function toHistoryRows(rows: Iterable<VTuberRow>, date: string): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const r of rows) {
    out.push({
      vtuber_id: r.id,
      date,
      youtube_subs: r.youtube_subs,
      youtube_views: r.youtube_views,
      twitch_followers: r.twitch_followers,
      popularity: r.popularity,
      group_name: r.group_name,
      activity: r.activity,
    });
  }
  return out;
}
