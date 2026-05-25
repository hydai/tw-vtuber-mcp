import type { VTuberRow, HistoryRow, GroupRow } from "./types";

export interface SearchParams {
  query?: string; // substring match on name
  nationality?: string; // region filter (TW/HK/MY/JP/...); omit = all
  activity?: string; // active / graduate / preparing
  group?: string;
  minSubs?: number;
  maxSubs?: number;
  sortBy?: "subscribers" | "views" | "followers" | "popularity" | "growth_7d" | "growth_30d" | "debut_date";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export type RankingType = "top_subscribers" | "top_views" | "growing_7d" | "growing_30d" | "trending";

export interface RankingParams {
  type: RankingType;
  nationality?: string;
  limit?: number;
}

export interface EventParams {
  type: "debut" | "anniversary" | "graduate";
  window?: "recent" | "upcoming"; // recent = last 7d, upcoming = next 7d
  nationality?: string;
  now?: Date;
  limit?: number;
}

export interface GroupDetail {
  group: GroupRow | null;
  members: VTuberRow[];
}

const SORT_COLUMNS: Record<NonNullable<SearchParams["sortBy"]>, string> = {
  subscribers: "youtube_subs",
  views: "youtube_views",
  followers: "twitch_followers",
  popularity: "popularity",
  growth_7d: "view_growth_7d",
  growth_30d: "view_growth_30d",
  debut_date: "debut_date",
};

const RANKING_COLUMNS: Record<RankingType, string> = {
  top_subscribers: "youtube_subs",
  top_views: "youtube_views",
  growing_7d: "view_growth_7d",
  growing_30d: "view_growth_30d",
  trending: "popularity",
};

const DAY_MS = 86_400_000;

function clampLimit(limit: number | undefined, def: number, max: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return def;
  return Math.max(1, Math.min(Math.floor(limit), max));
}

/** Escape LIKE wildcards so a user's % or _ is treated literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A `now ± i` window of 8 dates (i = 0..7), forward or backward. */
function windowDates(now: Date, dir: "recent" | "upcoming"): Date[] {
  const out: Date[] = [];
  for (let i = 0; i <= 7; i++) out.push(new Date(now.getTime() + (dir === "upcoming" ? i : -i) * DAY_MS));
  return out;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
const isoMonthDay = (d: Date) => d.toISOString().slice(5, 10); // MM-DD

/** Search / filter / sort the current VTuber snapshot. */
export async function searchVTubers(db: D1Database, params: SearchParams): Promise<VTuberRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (params.query) {
    where.push("name LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(params.query)}%`);
  }
  if (params.nationality) {
    where.push("nationality = ?");
    binds.push(params.nationality);
  }
  if (params.activity) {
    where.push("activity = ?");
    binds.push(params.activity);
  }
  if (params.group) {
    where.push("group_name = ?");
    binds.push(params.group);
  }
  if (typeof params.minSubs === "number") {
    where.push("youtube_subs >= ?");
    binds.push(params.minSubs);
  }
  if (typeof params.maxSubs === "number") {
    where.push("youtube_subs <= ?");
    binds.push(params.maxSubs);
  }

  const sortCol = params.sortBy ? SORT_COLUMNS[params.sortBy] : "youtube_subs";
  const dir = params.order === "asc" ? "ASC" : "DESC";
  const limit = clampLimit(params.limit, 20, 100);
  const offset = params.offset && params.offset > 0 ? Math.floor(params.offset) : 0;

  const sql =
    `SELECT * FROM vtuber` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    ` ORDER BY ${sortCol} ${dir} NULLS LAST, id ASC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const { results } = await db.prepare(sql).bind(...binds).all<VTuberRow>();
  return results ?? [];
}

/** Look up one VTuber by id (exact) then by name (exact). */
export async function getVTuber(db: D1Database, idOrName: string): Promise<VTuberRow | null> {
  const byId = await db.prepare("SELECT * FROM vtuber WHERE id = ?").bind(idOrName).first<VTuberRow>();
  if (byId) return byId;
  const byName = await db.prepare("SELECT * FROM vtuber WHERE name = ?").bind(idOrName).first<VTuberRow>();
  return byName ?? null;
}

/** Time-series history for one VTuber, oldest-first. */
export async function getVTuberHistory(
  db: D1Database,
  vtuberId: string,
  opts?: { from?: string; to?: string; limit?: number },
): Promise<HistoryRow[]> {
  const where = ["vtuber_id = ?"];
  const binds: unknown[] = [vtuberId];
  if (opts?.from) {
    where.push("date >= ?");
    binds.push(opts.from);
  }
  if (opts?.to) {
    where.push("date <= ?");
    binds.push(opts.to);
  }
  const limit = clampLimit(opts?.limit, 365, 3650);
  binds.push(limit);

  const { results } = await db
    .prepare(`SELECT * FROM vtuber_history WHERE ${where.join(" AND ")} ORDER BY date ASC LIMIT ?`)
    .bind(...binds)
    .all<HistoryRow>();
  return results ?? [];
}

/** Pre-baked rankings over the current snapshot (unknown metrics excluded). */
export async function listRankings(db: D1Database, params: RankingParams): Promise<VTuberRow[]> {
  const col = RANKING_COLUMNS[params.type];
  const where = [`${col} IS NOT NULL`];
  const binds: unknown[] = [];
  if (params.nationality) {
    where.push("nationality = ?");
    binds.push(params.nationality);
  }
  const limit = clampLimit(params.limit, 20, 100);
  binds.push(limit);

  const { results } = await db
    .prepare(`SELECT * FROM vtuber WHERE ${where.join(" AND ")} ORDER BY ${col} DESC, id ASC LIMIT ?`)
    .bind(...binds)
    .all<VTuberRow>();
  return results ?? [];
}

/** All groups (optionally one region), most popular first. */
export async function listGroups(db: D1Database, nationality?: string): Promise<GroupRow[]> {
  const sql = nationality
    ? "SELECT * FROM vtuber_group WHERE nationality = ? ORDER BY popularity DESC NULLS LAST, name ASC"
    : "SELECT * FROM vtuber_group ORDER BY popularity DESC NULLS LAST, name ASC";
  const stmt = nationality ? db.prepare(sql).bind(nationality) : db.prepare(sql);
  const { results } = await stmt.all<GroupRow>();
  return results ?? [];
}

/** One group with its members (most subscribed first). */
export async function getGroup(db: D1Database, name: string): Promise<GroupDetail> {
  const group = await db.prepare("SELECT * FROM vtuber_group WHERE name = ?").bind(name).first<GroupRow>();
  const { results } = await db
    .prepare("SELECT * FROM vtuber WHERE group_name = ? ORDER BY youtube_subs DESC NULLS LAST, id ASC")
    .bind(name)
    .all<VTuberRow>();
  return { group: group ?? null, members: results ?? [] };
}

/** Debut / anniversary / graduate events, derived from debut_date + activity. */
export async function listEvents(db: D1Database, params: EventParams): Promise<VTuberRow[]> {
  const now = params.now ?? new Date();
  const limit = clampLimit(params.limit, 50, 200);
  const natClause = params.nationality ? " AND nationality = ?" : "";
  const natBind: unknown[] = params.nationality ? [params.nationality] : [];

  if (params.type === "graduate") {
    const { results } = await db
      .prepare(`SELECT * FROM vtuber WHERE activity = 'graduate'${natClause} ORDER BY id ASC LIMIT ?`)
      .bind(...natBind, limit)
      .all<VTuberRow>();
    return results ?? [];
  }

  const days = windowDates(now, params.window === "recent" ? "recent" : "upcoming");

  if (params.type === "anniversary") {
    const mmdd = days.map(isoMonthDay);
    const placeholders = mmdd.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT * FROM vtuber WHERE substr(debut_date,6,5) IN (${placeholders}) AND activity != 'preparing'${natClause} ORDER BY substr(debut_date,6,5) ASC, id ASC LIMIT ?`,
      )
      .bind(...mmdd, ...natBind, limit)
      .all<VTuberRow>();
    return results ?? [];
  }

  // debut: exact debut_date within the window
  const dates = days.map(isoDate);
  const placeholders = dates.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM vtuber WHERE debut_date IN (${placeholders})${natClause} ORDER BY debut_date ASC, id ASC LIMIT ?`)
    .bind(...dates, ...natBind, limit)
    .all<VTuberRow>();
  return results ?? [];
}
