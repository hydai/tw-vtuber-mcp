# TW VTuber Data — MCP Server + REST API

[![CI](https://github.com/hydai/tw-vtuber-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hydai/tw-vtuber-mcp/actions/workflows/ci.yml)

A **public** [Model Context Protocol](https://modelcontextprotocol.io) server and REST API for Taiwan VTuber data on Cloudflare Workers. It lets AI agents (and ordinary HTTP clients) search, filter, and explore Taiwan VTuber stats — including **historical trends** that the upstream source does not publish.

**Live instance:** `https://twvtuber.oshi.tw` — MCP at `/mcp`, REST at `/v1/*` (currently serving 3,000+ VTubers).

## Data source & attribution

All VTuber data originates from **[TaiwanVtuberData/TaiwanVTuberTrackingDataJson](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson)** (rendered by [taiwanvtuberdata.github.io](https://taiwanvtuberdata.github.io/)). This service caches and re-serves that data, adding a queryable layer and an accumulating daily time-series. **All credit for data collection belongs to the upstream project.** Every response carries a `source` field linking back.

## Quick start

### MCP (AI agents)

Streamable HTTP, authless. With Claude Code:

```bash
claude mcp add --transport http tw-vtuber https://twvtuber.oshi.tw/mcp
```

Then ask, e.g. *"Which Taiwan VTubers gained the most views this week?"* or *"Show 李聽's subscriber history."* — the agent calls the [tools](#mcp-tools) below. Any MCP client works; point it at `https://twvtuber.oshi.tw/mcp`.

### REST

```bash
curl https://twvtuber.oshi.tw/v1/status
```

```json
{
  "source": "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson",
  "vtuber_count": 3039,
  "statistic_updated_at": "2026-05-25T16:30:04...",
  "last_ingest_at": "2026-05-25T17:29:16.935Z",
  "last_ingest_status": "ok"
}
```

```bash
# Top Taiwan VTubers by subscribers
curl "https://twvtuber.oshi.tw/v1/rankings?type=top_subscribers&region=TW&limit=2"
```

```json
{
  "source": "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson",
  "type": "top_subscribers",
  "count": 2,
  "results": [
    { "id": "1c5619a4ece046dd8ba68ed343489ca3", "name": "李聽", "nationality": "TW", "youtube_subs": 547000, "youtube_id": "UCw2CTp01JDHoyH-4tFX9UlA" },
    { "id": "f6a4e7aa8d0c4e5cb39d199845ec4d02", "name": "杏仁ミル", "nationality": "TW", "youtube_subs": 446000, "youtube_id": "UCFahBR2wixu0xOex84bXFvg" }
  ]
}
```

More examples:

```bash
# One VTuber by name (URL-encoded) or id
curl "https://twvtuber.oshi.tw/v1/vtubers/%E6%9D%8E%E8%81%BD"          # 李聽
curl "https://twvtuber.oshi.tw/v1/vtubers/1c5619a4ece046dd8ba68ed343489ca3"

# Daily history time-series — unique to this service
curl "https://twvtuber.oshi.tw/v1/vtubers/李聽/history?from=2026-05-01"

# Search: active TW VTubers with >100k subscribers, by 7-day view growth
curl "https://twvtuber.oshi.tw/v1/vtubers?region=TW&activity=active&min_subscribers=100000&sort_by=growth_7d&order=desc&limit=10"

# Upcoming debut anniversaries
curl "https://twvtuber.oshi.tw/v1/events?type=anniversary&window=upcoming&region=TW"
```

A `vtuber` object:

```json
{
  "id": "1c5619a4ece046dd8ba68ed343489ca3",
  "name": "李聽",
  "nationality": "TW",
  "activity": "active",
  "youtube_subs": 547000,
  "youtube_views": 100988110,
  "twitch_followers": 32844,
  "popularity": 20827,
  "debut_date": "2021-10-31"
}
```

> Note: subscriber/view/follower fields are `null` when the platform hides the count. Public, anonymous access is rate-limited to 120 requests/60s per IP.

## MCP tools

| Tool | Purpose | Key args |
|------|---------|----------|
| `search_vtubers` | search / filter / sort | `query`, `region`, `activity`, `group`, `min_subscribers`, `sort_by`, `order`, `limit` |
| `get_vtuber` | one VTuber | `id_or_name` |
| `get_vtuber_history` | daily time-series (unique) | `id_or_name`, `from`, `to` |
| `list_rankings` | rankings | `type` (`top_subscribers`/`top_views`/`growing_7d`/`growing_30d`/`trending`), `region`, `limit` |
| `list_groups`, `get_group` | groups/agencies + members | `region` / `name` |
| `list_events` | debut / anniversary / graduate | `type`, `window` (`recent`/`upcoming`), `region` |
| `get_data_status` | data freshness + counts | — |

## REST reference

| Endpoint | Maps to |
|----------|---------|
| `GET /v1/vtubers?query=&region=&activity=&group=&min_subscribers=&sort_by=&order=&limit=&offset=` | `search_vtubers` |
| `GET /v1/vtubers/:idOrName` | `get_vtuber` |
| `GET /v1/vtubers/:idOrName/history?from=&to=` | `get_vtuber_history` |
| `GET /v1/rankings?type=&region=&limit=` | `list_rankings` |
| `GET /v1/groups?region=` · `GET /v1/groups/:name` | `list_groups` / `get_group` |
| `GET /v1/events?type=&window=&region=` | `list_events` |
| `GET /v1/status` | `get_data_status` |

**OpenAPI spec:** `https://twvtuber.oshi.tw/openapi.json` — import into Swagger UI, Postman, or any codegen tool. (Source: [`src/openapi.ts`](src/openapi.ts), served live.)

## Architecture

- **Daily ingestion** (Cron, `scheduled()`): polls the upstream `update-time.json` as a cheap change-signal, then fetches the `all`-region aggregate JSON, parses/merges it, and upserts into **D1** (SQLite). Per-region data is derived via the `nationality` column. Raw files are archived to **R2**. A history row per VTuber per day accumulates the time-series.
- **Query layer** (D1): a current snapshot table + a `(vtuber_id, date)` history table, indexed for search/sort/rankings.
- **Serving** (`fetch()`): `/mcp` (Streamable HTTP MCP via `McpAgent`) and `/v1/*` (REST) share one tool layer. Per-IP rate limiting + Cache-API response caching.

## Historical backfill

The daily Cron only accumulates history going forward. To bootstrap the time-series, [`scripts/backfill.ts`](scripts/backfill.ts) reconstructs it from the upstream repo's **git history** — every commit is a past snapshot. It enumerates the commits that touched the roster file, takes one snapshot per UTC day, fetches that day's four `all`-region files pinned at the commit SHA, reuses the same parsers as the Cron, and writes idempotent upserts into `vtuber_history` via `wrangler`.

```bash
npm run backfill -- --dry-run --limit 3   # fetch a few recent days, print sample SQL, no writes
npm run backfill                          # full run: every reachable day -> remote D1
npm run backfill -- --from 2026-03-01     # bounded window; also --to / --limit / --no-apply
```

It runs locally (not in a Worker), so the subrequest/CPU limits don't apply, and the upserts are idempotent, so it is safe to re-run or resume. Requires an authenticated `gh` and `wrangler`.

> **Reach:** the upstream repo reset its git history on 2025-12-24 ("Initial commit"), so only ~5 months are recoverable from commits — earlier data is unavailable. Once backfilled, the daily Cron keeps extending the series (making this service the durable long-term archive); re-running the script after any future upstream reset tops up the gap.

## Development

```bash
npm install
npm run cf-types     # generate Cloudflare binding types
npm test             # unit/integration tests (vitest + workers pool)
npm run dev          # local dev server
```

## Deployment

Prerequisites:
1. **R2 enabled** on the account (for the raw archive).
2. **A custom domain** routed to the Worker — required for the Cache API to function (`*.workers.dev` caching is a no-op). Set it via `routes` + `custom_domain` in `wrangler.jsonc` or the dashboard.

```bash
npm run db:migrate:remote        # apply D1 schema to the remote database
npm run deploy                   # wrangler deploy
```

The daily Cron (`0 21 * * *` UTC) then ingests automatically. Trigger the first ingest manually from the dashboard, or wait for the schedule.

## Cost

Runs within the Workers Paid plan's included allowances (~$5/month flat) up to ~1M requests/month; D1/R2/Cache/rate-limiting stay inside free/included tiers. Ingestion needs the Paid plan's CPU (parsing ~1 MB JSON exceeds the free 10 ms limit).

## License

[MIT](LICENSE) for the source code. The VTuber data belongs to the [upstream project](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson).
