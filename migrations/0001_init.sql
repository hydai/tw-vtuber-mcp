-- TW VTuber Data — initial schema
--
-- Design notes:
--   * `id` is the upstream 32-hex GUID (stable; NOT the YouTube/Twitch id).
--   * subscriber/view/follower columns are NULLABLE: upstream `tag` can be
--     "hidden"/"none", so a count may be absent.
--   * Per-region data (TW/HK/MY) is derived from the `all` ingest via the
--     `nationality` column + indexes — we do not store one table per region.

-- ── Current snapshot (upsert on every successful ingest) ───────────────────
CREATE TABLE vtuber (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  nationality        TEXT,            -- TW / HK / MY
  activity           TEXT,            -- active / graduate / preparing
  group_name         TEXT,
  img_url            TEXT,
  debut_date         TEXT,            -- YYYY-MM-DD
  graduate_date      TEXT,
  youtube_id         TEXT,
  youtube_subs       INTEGER,         -- nullable (tag may be hidden/none)
  youtube_views      INTEGER,         -- nullable (from view-count-change)
  view_growth_7d     INTEGER,         -- official 7-day delta (day-1 ranking)
  view_growth_30d    INTEGER,         -- official 30-day delta
  twitch_id          TEXT,
  twitch_followers   INTEGER,         -- nullable
  popularity         INTEGER,         -- nullable (only top-N have it)
  popular_video_type TEXT,            -- YouTube / Twitch
  popular_video_id   TEXT,
  updated_at         TEXT             -- ISO timestamp of this snapshot
);
CREATE INDEX idx_vtuber_nat      ON vtuber(nationality);
CREATE INDEX idx_vtuber_activity ON vtuber(activity);
CREATE INDEX idx_vtuber_subs     ON vtuber(youtube_subs DESC);
CREATE INDEX idx_vtuber_views    ON vtuber(youtube_views DESC);
CREATE INDEX idx_vtuber_pop      ON vtuber(popularity DESC);
CREATE INDEX idx_vtuber_group    ON vtuber(group_name);

-- ── Daily history time-series (one row per VTuber per UTC date) ────────────
-- Composite PK (vtuber_id, date) is the covering index for per-VTuber series.
CREATE TABLE vtuber_history (
  vtuber_id        TEXT NOT NULL,
  date             TEXT NOT NULL,     -- YYYY-MM-DD (UTC)
  youtube_subs     INTEGER,
  youtube_views    INTEGER,
  twitch_followers INTEGER,
  popularity       INTEGER,
  group_name       TEXT,
  activity         TEXT,
  PRIMARY KEY (vtuber_id, date)
);
CREATE INDEX idx_hist_date ON vtuber_history(date);

-- ── Group-level aggregates (popularity not derivable from members) ─────────
CREATE TABLE vtuber_group (
  name                  TEXT PRIMARY KEY,
  nationality           TEXT,
  popularity            INTEGER,
  livestream_popularity INTEGER,
  video_popularity      INTEGER,
  updated_at            TEXT
);

-- ── Single-row ingest bookkeeping / cheap change-detection ─────────────────
CREATE TABLE ingest_meta (
  k                       TEXT PRIMARY KEY,  -- always 'singleton'
  vtuber_data_update_time TEXT,             -- upstream time.VTuberDataUpdateTime
  statistic_update_time   TEXT,             -- upstream time.statisticUpdateTime
  last_commit_sha         TEXT,
  ingested_at             TEXT,             -- when our ingest last ran
  last_status             TEXT              -- ok / partial / failed
);
