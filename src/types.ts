// Upstream JSON shapes (from TaiwanVTuberTrackingDataJson, api/v2) and our
// normalized DB row shapes. Upstream types are intentionally loose where the
// data is inconsistent across files/sources.

/**
 * Upstream subscriber/follower count. A tagged object: when a number is known
 * `tag === "has"` and `count` is set; otherwise the platform hides it and the
 * tag is something like "hidden" / "no" / "none" (the exact string varies
 * between upstream sources, so treat anything that is not "has" as unknown).
 */
export interface UpstreamCount {
  tag: string;
  count?: number;
}

export interface UpstreamYouTube {
  id: string;
  subscriber?: UpstreamCount;
  // present only in view-count-change files:
  totalViewCount?: number;
  _7DaysGrowth?: { diff: number; recordType: string };
  _30DaysGrowth?: { diff: number; recordType: string };
  // present only in trending files:
  popularity?: number;
}

export interface UpstreamTwitch {
  id: string;
  follower?: UpstreamCount;
  popularity?: number;
}

export interface UpstreamVTuber {
  id: string;
  activity: string; // active / graduate / preparing
  name: string;
  imgUrl?: string | null;
  YouTube?: UpstreamYouTube | null;
  Twitch?: UpstreamTwitch | null;
  popularVideo?: { type: string; id: string } | null;
  group?: string | null;
  nationality?: string | null;
  debutDate?: string | null;
  graduateDate?: string | null;
}

export interface UpstreamRosterResponse {
  VTubers: UpstreamVTuber[];
}

export interface UpstreamUpdateTime {
  time: {
    statisticUpdateTime: string;
    VTuberDataUpdateTime: string;
  };
}

export interface UpstreamGroup {
  id: string;
  name: string;
  popularity?: number;
  livestreamPopularity?: number;
  videoPopularity?: number;
  members?: UpstreamVTuber[];
}

export interface UpstreamGroupsResponse {
  groups: UpstreamGroup[];
}

// ── Normalized DB row shapes ───────────────────────────────────────────────

export interface VTuberRow {
  id: string;
  name: string;
  nationality: string | null;
  activity: string | null;
  group_name: string | null;
  img_url: string | null;
  debut_date: string | null;
  graduate_date: string | null;
  youtube_id: string | null;
  youtube_subs: number | null;
  youtube_views: number | null;
  view_growth_7d: number | null;
  view_growth_30d: number | null;
  twitch_id: string | null;
  twitch_followers: number | null;
  popularity: number | null;
  popular_video_type: string | null;
  popular_video_id: string | null;
  updated_at: string;
}

export interface HistoryRow {
  vtuber_id: string;
  date: string;
  youtube_subs: number | null;
  youtube_views: number | null;
  twitch_followers: number | null;
  popularity: number | null;
  group_name: string | null;
  activity: string | null;
}

export interface GroupRow {
  name: string;
  nationality: string | null;
  popularity: number | null;
  livestream_popularity: number | null;
  video_popularity: number | null;
  updated_at: string;
}

export interface UpdateTime {
  vtuberDataUpdateTime: string;
  statisticUpdateTime: string;
}
