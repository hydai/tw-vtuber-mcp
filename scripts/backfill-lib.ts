// Pure helpers for the historical backfill (scripts/backfill.ts).
//
// Deliberately free of node:fs / child_process / CF globals: the orchestrator
// is the only place that does I/O. Keeping this module pure means it is both
// unit-testable inside vitest's workerd pool and importable from a plain Node
// script, mirroring how src/parse.ts stays side-effect free.

import type { HistoryRow } from "../src/types";

/** A commit as returned by the GitHub commits API (sha + ISO timestamp). */
export interface CommitRef {
  sha: string;
  date: string;
}

/** One chosen snapshot: the UTC day (YYYY-MM-DD) and the commit to read it from. */
export interface DailyCommit {
  date: string;
  sha: string;
}

/** vtuber_history columns, in the same order as ingest.ts HISTORY_UPSERT. */
export const HISTORY_COLUMNS = [
  "vtuber_id",
  "date",
  "youtube_subs",
  "youtube_views",
  "twitch_followers",
  "popularity",
  "group_name",
  "activity",
] as const;

const PK_COLUMNS = new Set<string>(["vtuber_id", "date"]);

/**
 * The four `all`-region files needed to fill every history metric:
 * roster (subs + followers), 7d/30d view-count (total views), trending (popularity).
 * Paths are relative to `api/v2/all/`.
 */
export const UPSTREAM_FILES = [
  "vtubers/all.json",
  "vtubers-view-count-change/7-days/all.json",
  "vtubers-view-count-change/30-days/all.json",
  "trending-vtubers/combined/100.json",
] as const;

const API_PREFIX = "api/v2/all";

/**
 * Reduce many same-day commits to one snapshot per UTC day, keeping the LATEST
 * commit of each day (subscriber/view counts are cumulative, so end-of-day is
 * the most complete). Returns ascending by date; input order is irrelevant.
 */
export function pickDailyCommits(commits: CommitRef[]): DailyCommit[] {
  const best = new Map<string, { sha: string; ts: number }>();
  for (const c of commits) {
    const ts = Date.parse(c.date);
    const day = new Date(ts).toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const cur = best.get(day);
    if (!cur || ts > cur.ts) best.set(day, { sha: c.sha, ts });
  }
  return [...best.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, v]) => ({ date, sha: v.sha }));
}

/** Render a value as a SQLite literal: NULL / integer / single-quote-escaped text. */
export function serializeValue(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Build one idempotent multi-row upsert for a batch of history rows. Column
 * order and the ON CONFLICT clause mirror ingest.ts so backfill and the daily
 * cron write identical rows. Returns "" for an empty batch.
 */
export function historyRowsToSql(rows: HistoryRow[]): string {
  if (rows.length === 0) return "";
  const cols = HISTORY_COLUMNS.join(",");
  const tuples = rows
    .map((r) => `(${HISTORY_COLUMNS.map((c) => serializeValue(r[c])).join(",")})`)
    .join(",\n");
  const updates = HISTORY_COLUMNS.filter((c) => !PK_COLUMNS.has(c))
    .map((c) => `${c}=excluded.${c}`)
    .join(",");
  return `INSERT INTO vtuber_history (${cols}) VALUES\n${tuples}\nON CONFLICT(vtuber_id,date) DO UPDATE SET ${updates};`;
}

/** raw.githubusercontent.com URL for a file pinned at a commit SHA (`/<sha>/`). */
export function rawUrl(rawBase: string, sha: string, file: string): string {
  return `${rawBase}/${sha}/${API_PREFIX}/${file}`;
}

/** jsDelivr URL for a file pinned at a commit SHA (`@<sha>`). */
export function cdnUrl(cdnBase: string, sha: string, file: string): string {
  return `${cdnBase}@${sha}/${API_PREFIX}/${file}`;
}
