import type {
  UpdateTime,
  VTuberRow,
  HistoryRow,
  GroupRow,
  UpstreamUpdateTime,
  UpstreamRosterResponse,
  UpstreamGroupsResponse,
} from "./types";
import {
  parseUpdateTime,
  parseRoster,
  mergeViewCounts,
  mergeTrending,
  parseGroups,
  toHistoryRows,
} from "./parse";

export interface StoredMeta {
  vtuberDataUpdateTime: string | null;
  statisticUpdateTime: string | null;
}

export interface IngestMetaWrite {
  vtuberDataUpdateTime: string;
  statisticUpdateTime: string;
  lastCommitSha: string | null;
  ingestedAt: string;
  status: string;
}

export interface IngestEnv {
  DB: D1Database;
  RAW_ARCHIVE?: R2Bucket;
  DATA_RAW_URL: string;
  DATA_CDN_URL: string;
}

export interface IngestDeps {
  fetchText: (url: string) => Promise<string>;
  now: () => Date;
}

export interface IngestResult {
  status: "ok" | "partial" | "skipped" | "failed";
  vtubers?: number;
  groups?: number;
  date?: string;
  error?: string;
}

const API = "/api/v2";
const COMMITS_URL =
  "https://api.github.com/repos/TaiwanVtuberData/TaiwanVTuberTrackingDataJson/commits/master";

/** True if upstream advanced (either timestamp) since our last ingest. */
export function hasChanged(latest: UpdateTime, stored: StoredMeta | null): boolean {
  if (!stored) return true;
  return (
    latest.vtuberDataUpdateTime !== stored.vtuberDataUpdateTime ||
    latest.statisticUpdateTime !== stored.statisticUpdateTime
  );
}

export async function readIngestMeta(db: D1Database): Promise<StoredMeta | null> {
  const r = await db
    .prepare("SELECT vtuber_data_update_time, statistic_update_time FROM ingest_meta WHERE k='singleton'")
    .first<{ vtuber_data_update_time: string | null; statistic_update_time: string | null }>();
  if (!r) return null;
  return { vtuberDataUpdateTime: r.vtuber_data_update_time, statisticUpdateTime: r.statistic_update_time };
}

export async function writeIngestMeta(db: D1Database, meta: IngestMetaWrite): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ingest_meta (k, vtuber_data_update_time, statistic_update_time, last_commit_sha, ingested_at, last_status)
       VALUES ('singleton', ?, ?, ?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET
         vtuber_data_update_time=excluded.vtuber_data_update_time,
         statistic_update_time=excluded.statistic_update_time,
         last_commit_sha=excluded.last_commit_sha,
         ingested_at=excluded.ingested_at,
         last_status=excluded.last_status`,
    )
    .bind(meta.vtuberDataUpdateTime, meta.statisticUpdateTime, meta.lastCommitSha, meta.ingestedAt, meta.status)
    .run();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const VTUBER_UPSERT = `INSERT INTO vtuber (id,name,nationality,activity,group_name,img_url,debut_date,graduate_date,youtube_id,youtube_subs,youtube_views,view_growth_7d,view_growth_30d,twitch_id,twitch_followers,popularity,popular_video_type,popular_video_id,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name,nationality=excluded.nationality,activity=excluded.activity,group_name=excluded.group_name,img_url=excluded.img_url,debut_date=excluded.debut_date,graduate_date=excluded.graduate_date,youtube_id=excluded.youtube_id,youtube_subs=excluded.youtube_subs,youtube_views=excluded.youtube_views,view_growth_7d=excluded.view_growth_7d,view_growth_30d=excluded.view_growth_30d,twitch_id=excluded.twitch_id,twitch_followers=excluded.twitch_followers,popularity=excluded.popularity,popular_video_type=excluded.popular_video_type,popular_video_id=excluded.popular_video_id,updated_at=excluded.updated_at`;

export async function upsertVTubers(db: D1Database, rows: VTuberRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmt = db.prepare(VTUBER_UPSERT);
  const bound = rows.map((r) =>
    stmt.bind(
      r.id, r.name, r.nationality, r.activity, r.group_name, r.img_url, r.debut_date, r.graduate_date,
      r.youtube_id, r.youtube_subs, r.youtube_views, r.view_growth_7d, r.view_growth_30d,
      r.twitch_id, r.twitch_followers, r.popularity, r.popular_video_type, r.popular_video_id, r.updated_at,
    ),
  );
  for (const c of chunk(bound, 50)) await db.batch(c);
}

const HISTORY_UPSERT = `INSERT INTO vtuber_history (vtuber_id,date,youtube_subs,youtube_views,twitch_followers,popularity,group_name,activity)
VALUES (?,?,?,?,?,?,?,?)
ON CONFLICT(vtuber_id,date) DO UPDATE SET youtube_subs=excluded.youtube_subs,youtube_views=excluded.youtube_views,twitch_followers=excluded.twitch_followers,popularity=excluded.popularity,group_name=excluded.group_name,activity=excluded.activity`;

export async function upsertHistory(db: D1Database, rows: HistoryRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmt = db.prepare(HISTORY_UPSERT);
  const bound = rows.map((r) =>
    stmt.bind(r.vtuber_id, r.date, r.youtube_subs, r.youtube_views, r.twitch_followers, r.popularity, r.group_name, r.activity),
  );
  for (const c of chunk(bound, 50)) await db.batch(c);
}

const GROUP_UPSERT = `INSERT INTO vtuber_group (name,nationality,popularity,livestream_popularity,video_popularity,updated_at)
VALUES (?,?,?,?,?,?)
ON CONFLICT(name) DO UPDATE SET nationality=excluded.nationality,popularity=excluded.popularity,livestream_popularity=excluded.livestream_popularity,video_popularity=excluded.video_popularity,updated_at=excluded.updated_at`;

export async function upsertGroups(db: D1Database, rows: GroupRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmt = db.prepare(GROUP_UPSERT);
  const bound = rows.map((r) =>
    stmt.bind(r.name, r.nationality, r.popularity, r.livestream_popularity, r.video_popularity, r.updated_at),
  );
  for (const c of chunk(bound, 50)) await db.batch(c);
}

/** Orchestrate a full ingest: change-detect -> fetch -> parse -> upsert -> archive. */
export async function runIngest(env: IngestEnv, deps?: Partial<IngestDeps>): Promise<IngestResult> {
  const fetchText =
    deps?.fetchText ??
    (async (url: string) => {
      const r = await fetch(url, {
        headers: { "User-Agent": "tw-vtuber-mcp (+https://github.com/TaiwanVtuberData)" },
      });
      if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`);
      return r.text();
    });
  const now = deps?.now ?? (() => new Date());
  const ts = now().toISOString();
  const date = ts.slice(0, 10);

  // 1. Cheap change-detection via the raw update-time.json (not rate-limited).
  const latest = parseUpdateTime(
    JSON.parse(await fetchText(`${env.DATA_RAW_URL}/master${API}/update-time.json`)) as UpstreamUpdateTime,
  );
  const stored = await readIngestMeta(env.DB);
  if (!hasChanged(latest, stored)) return { status: "skipped" };

  // 2. Resolve the commit SHA once and pin bulk fetches for a consistent snapshot.
  let sha = "master";
  try {
    const parsed = JSON.parse(await fetchText(COMMITS_URL)) as { sha?: string };
    if (parsed.sha) sha = parsed.sha;
  } catch {
    // fall back to master
  }
  const cdn = (file: string) => `${env.DATA_CDN_URL}@${sha}${API}${file}`;

  const writeMeta = (status: string) =>
    writeIngestMeta(env.DB, {
      vtuberDataUpdateTime: latest.vtuberDataUpdateTime,
      statisticUpdateTime: latest.statisticUpdateTime,
      lastCommitSha: sha,
      ingestedAt: ts,
      status,
    });

  // 3. Fetch bulk files. The roster is critical; the rest are best-effort.
  let rosterRaw: string;
  try {
    rosterRaw = await fetchText(cdn("/all/vtubers/all.json"));
  } catch (e) {
    await writeMeta("failed");
    return { status: "failed", error: String(e) };
  }
  const map = parseRoster(JSON.parse(rosterRaw) as UpstreamRosterResponse, ts);

  let status: IngestResult["status"] = "ok";
  const enrich: Array<[string, (raw: string) => void]> = [
    ["/all/vtubers-view-count-change/7-days/all.json", (raw) => mergeViewCounts(map, JSON.parse(raw) as UpstreamRosterResponse, "7d")],
    ["/all/vtubers-view-count-change/30-days/all.json", (raw) => mergeViewCounts(map, JSON.parse(raw) as UpstreamRosterResponse, "30d")],
    ["/all/trending-vtubers/combined/100.json", (raw) => mergeTrending(map, JSON.parse(raw) as UpstreamRosterResponse)],
  ];
  for (const [file, apply] of enrich) {
    try {
      apply(await fetchText(cdn(file)));
    } catch {
      status = "partial";
    }
  }

  let groupRows: GroupRow[] = [];
  try {
    groupRows = parseGroups(JSON.parse(await fetchText(cdn("/all/groups.json"))) as UpstreamGroupsResponse, ts);
  } catch {
    status = "partial";
  }

  // 4. Upsert into D1.
  const vtuberRows = [...map.values()];
  await upsertVTubers(env.DB, vtuberRows);
  await upsertHistory(env.DB, toHistoryRows(vtuberRows, date));
  await upsertGroups(env.DB, groupRows);

  // 5. Archive the raw roster (best-effort insurance for re-derivation).
  if (env.RAW_ARCHIVE) {
    try {
      await env.RAW_ARCHIVE.put(`raw/${date}/vtubers-all.json`, rosterRaw);
    } catch {
      // best-effort; ingestion success does not depend on the archive
    }
  }

  // 6. Record bookkeeping / change-detection state.
  await writeMeta(status);

  return { status, vtubers: vtuberRows.length, groups: groupRows.length, date };
}
