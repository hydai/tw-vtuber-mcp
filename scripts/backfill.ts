// One-time (re-runnable) historical backfill of vtuber_history.
//
// The upstream "current snapshot" API has no history, but every git commit in
// TaiwanVTuberTrackingDataJson IS a snapshot. We enumerate the commits that
// touched the roster file, take one snapshot per UTC day, fetch that day's four
// `all`-region files pinned at the commit SHA, reuse the production parsers to
// build HistoryRow[], and write idempotent upsert SQL applied via wrangler.
//
// Runs locally (not in a Worker) so the 1000-subrequest / CPU limits don't
// apply. Idempotent (ON CONFLICT DO UPDATE) -> safe to re-run / resume.
//
// Usage:
//   npm run backfill -- --dry-run [--limit N]   generate SQL only, print a sample
//   npm run backfill -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]
//   npm run backfill -- --no-apply              generate SQL, don't touch D1
//
// Note: the reachable upstream history starts at the 2025-12-24 "Initial
// commit" (the repo's git history was reset then), so depth is ~5 months.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  pickDailyCommits,
  historyRowsToSql,
  rawUrl,
  cdnUrl,
  UPSTREAM_FILES,
  type CommitRef,
  type DailyCommit,
} from "./backfill-lib";
import { parseRoster, mergeViewCounts, mergeTrending, toHistoryRows } from "../src/parse";
import type { HistoryRow, UpstreamRosterResponse, VTuberRow } from "../src/types";

const REPO = "TaiwanVtuberData/TaiwanVTuberTrackingDataJson";
const ROSTER_PATH = "api/v2/all/vtubers/all.json";
// Base URLs mirror wrangler.jsonc vars DATA_RAW_URL / DATA_CDN_URL.
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}`;
const CDN_BASE = `https://cdn.jsdelivr.net/gh/${REPO}`;
const OUT_DIR = ".backfill";
const DB_NAME = "tw-vtuber";
const FETCH_CONCURRENCY = 5;
const SQL_BATCH = 500; // rows per INSERT statement

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const opt = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dryRun = flag("--dry-run");
const noApply = flag("--no-apply");
const apply = !dryRun && !noApply;
const limit = opt("--limit") ? Number.parseInt(opt("--limit")!, 10) : undefined;
const from = opt("--from");
const to = opt("--to");

// ── small async helpers ──────────────────────────────────────────────────────
function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdin ignored -> non-interactive; any prompt gets EOF instead of hanging.
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`)),
    );
  });
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]!);
    }
  });
  await Promise.all(workers);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "tw-vtuber-backfill" } });
      if (res.ok) return await res.text();
      if (res.status === 404) throw new Error(`HTTP 404 ${url}`); // absent at this SHA, don't retry
      lastErr = new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && e.message.startsWith("HTTP 404")) throw e;
    }
    await sleep(300 * (i + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Fetch a file pinned at a SHA: raw.githubusercontent first, jsDelivr fallback. */
async function fetchFile(sha: string, file: string): Promise<string> {
  try {
    return await fetchText(rawUrl(RAW_BASE, sha, file));
  } catch {
    return await fetchText(cdnUrl(CDN_BASE, sha, file));
  }
}

// ── pipeline ─────────────────────────────────────────────────────────────────
async function enumerateRosterCommits(): Promise<CommitRef[]> {
  const out = await runCmd("gh", [
    "api",
    "--paginate",
    `repos/${REPO}/commits?path=${ROSTER_PATH}&per_page=100`,
    "--jq",
    ".[] | {sha: .sha, date: .commit.committer.date}",
  ]);
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CommitRef);
}

type DayResult =
  | { status: "ok" | "partial"; rows: HistoryRow[] }
  | { status: "skip"; reason: string };

async function buildDay(dc: DailyCommit): Promise<DayResult> {
  const ts = `${dc.date}T00:00:00.000Z`; // only feeds VTuberRow.updated_at; history uses dc.date
  let rosterText: string;
  try {
    rosterText = await fetchFile(dc.sha, UPSTREAM_FILES[0]);
  } catch (e) {
    return { status: "skip", reason: `roster fetch: ${(e as Error).message}` };
  }

  let map: Map<string, VTuberRow>;
  try {
    map = parseRoster(JSON.parse(rosterText) as UpstreamRosterResponse, ts);
  } catch (e) {
    return { status: "skip", reason: `roster parse: ${(e as Error).message}` };
  }

  // Enrichment files are best-effort: a failure leaves views/popularity null.
  let partial = false;
  const enrich = async (file: string, merge: (json: UpstreamRosterResponse) => void) => {
    try {
      merge(JSON.parse(await fetchFile(dc.sha, file)) as UpstreamRosterResponse);
    } catch {
      partial = true;
    }
  };
  await enrich(UPSTREAM_FILES[1], (j) => mergeViewCounts(map, j, "7d"));
  await enrich(UPSTREAM_FILES[2], (j) => mergeViewCounts(map, j, "30d"));
  await enrich(UPSTREAM_FILES[3], (j) => mergeTrending(map, j));

  return { status: partial ? "partial" : "ok", rows: toHistoryRows(map.values(), dc.date) };
}

function rowsToSqlFile(rows: HistoryRow[]): string {
  let sql = "";
  for (let i = 0; i < rows.length; i += SQL_BATCH) {
    sql += historyRowsToSql(rows.slice(i, i + SQL_BATCH)) + "\n";
  }
  return sql;
}

async function main(): Promise<void> {
  log(`mode: ${dryRun ? "dry-run" : apply ? "apply" : "generate-only"}`);
  log("enumerating roster commits via gh…");
  const commits = await enumerateRosterCommits();
  let days = pickDailyCommits(commits);
  log(`${commits.length} roster commits -> ${days.length} daily snapshots`);

  if (from) days = days.filter((d) => d.date >= from);
  if (to) days = days.filter((d) => d.date <= to);
  if (limit && Number.isFinite(limit)) days = days.slice(-limit); // most recent N
  if (days.length === 0) {
    log("no days to process after filtering");
    return;
  }
  log(`processing ${days.length} days (${days[0]!.date} … ${days[days.length - 1]!.date})`);

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const planned = days.map((d, idx) => ({ ...d, idx }));
  const stats = { ok: 0, partial: 0, skip: 0, rows: 0 };
  const files: string[] = [];
  const skips: string[] = [];

  await mapLimit(planned, FETCH_CONCURRENCY, async (d) => {
    const r = await buildDay(d);
    if (r.status === "skip") {
      stats.skip++;
      skips.push(`${d.date}: ${r.reason}`);
      return;
    }
    const file = path.join(OUT_DIR, `${String(d.idx).padStart(4, "0")}_${d.date}.sql`);
    writeFileSync(file, rowsToSqlFile(r.rows));
    files.push(file);
    stats[r.status]++;
    stats.rows += r.rows.length;
  });
  files.sort(); // zero-padded idx prefix => chronological

  log(`built: ${stats.ok} ok, ${stats.partial} partial, ${stats.skip} skipped; ${stats.rows} rows total`);
  for (const s of skips) log(`  skip ${s}`);

  if (dryRun && files.length) {
    const sample = readFileSync(files[0]!, "utf8").split("\n").slice(0, 6).join("\n");
    log(`sample SQL (${path.basename(files[0]!)}):\n${sample}\n…`);
  }

  if (!apply) {
    log(`generate-only: ${files.length} SQL files in ${OUT_DIR}/ (not applied)`);
    return;
  }

  log(`applying ${files.length} files to D1 "${DB_NAME}" (remote)…`);
  const failed: string[] = [];
  for (let i = 0; i < files.length; i++) {
    log(`[${i + 1}/${files.length}] ${path.basename(files[i]!)}`);
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await runCmd("npx", ["wrangler", "d1", "execute", DB_NAME, "--remote", "--file", files[i]!]);
        ok = true;
      } catch (e) {
        // D1's API 7403s transiently; the upsert is idempotent, so just retry.
        log(`  attempt ${attempt}/3 failed: ${(e as Error).message.slice(0, 160)}`);
        if (attempt < 3) await sleep(1500 * attempt);
      }
    }
    if (!ok) failed.push(files[i]!);
  }
  if (failed.length) {
    log(`${failed.length} file(s) failed after retries; re-run (idempotent) to finish: ${failed.map((f) => path.basename(f)).join(", ")}`);
    process.exitCode = 1;
  } else {
    log("done.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
