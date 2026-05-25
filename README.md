# TW VTuber Data — MCP Server + REST API

A **public** [Model Context Protocol](https://modelcontextprotocol.io) server and REST API for Taiwan VTuber data on Cloudflare Workers. It lets AI agents (and ordinary HTTP clients) search, filter, and explore Taiwan VTuber stats — including **historical trends** that the upstream source does not publish.

## Data source & attribution

All VTuber data originates from **[TaiwanVtuberData/TaiwanVTuberTrackingDataJson](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson)** (rendered by [taiwanvtuberdata.github.io](https://taiwanvtuberdata.github.io/)). This service caches and re-serves that data, adding a queryable layer and an accumulating daily time-series. **All credit for data collection belongs to the upstream project.** Every response carries a `source` field linking back.

## Architecture

- **Daily ingestion** (Cron, `scheduled()`): polls the upstream `update-time.json` as a cheap change-signal, then fetches the `all`-region aggregate JSON, parses/merges it, and upserts into **D1** (SQLite). Per-region data is derived via the `nationality` column. Raw files are archived to **R2**. A history row per VTuber per day accumulates the time-series.
- **Query layer** (D1): a current snapshot table + a `(vtuber_id, date)` history table, indexed for search/sort/rankings.
- **Serving** (`fetch()`): `/mcp` (Streamable HTTP MCP via `McpAgent`) and `/v1/*` (REST) share one tool layer. Per-IP rate limiting + Cache-API response caching. Time-sensitive `/v1/livestreams` is passed through to the upstream CDN with a short edge cache.

## MCP

Connect an MCP client to `https://<your-domain>/mcp` (Streamable HTTP, authless). Tools:

| Tool | Purpose |
|------|---------|
| `search_vtubers` | name / region / activity / group / subscriber filters, sortable |
| `get_vtuber` | one VTuber by id or name |
| `get_vtuber_history` | daily time-series (the unique value-add) |
| `list_rankings` | top_subscribers / top_views / growing_7d / growing_30d / trending |
| `list_groups`, `get_group` | groups/agencies and members |
| `list_events` | debut / anniversary / graduate (recent or upcoming) |
| `get_data_status` | data freshness + counts |

## REST

| Endpoint | Maps to |
|----------|---------|
| `GET /v1/vtubers?query=&region=&activity=&group=&min_subscribers=&sort_by=&order=&limit=` | search |
| `GET /v1/vtubers/:idOrName` | one VTuber |
| `GET /v1/vtubers/:idOrName/history?from=&to=` | history |
| `GET /v1/rankings?type=&region=&limit=` | rankings |
| `GET /v1/groups?region=` · `GET /v1/groups/:name` | groups |
| `GET /v1/events?type=&window=&region=` | events |
| `GET /v1/livestreams?region=&debut=&no_title=` | live now (real-time pass-through) |
| `GET /v1/status` | data freshness |

## Development

```bash
npm install
npm run cf-types     # generate Cloudflare binding types
npm test             # 60 unit/integration tests (vitest + workers pool)
npm run dev          # local dev server
```

## Deployment

Prerequisites:
1. **R2 enabled** on the account (for the raw archive).
2. **A custom domain** routed to the Worker — required for the Cache API to function (`*.workers.dev` caching is a no-op). Configure a route/custom domain in `wrangler.jsonc` or the dashboard.

```bash
npm run db:migrate:remote        # apply D1 schema to the remote database
npm run deploy                   # wrangler deploy
```

The daily Cron (`0 21 * * *` UTC) then ingests automatically. Trigger the first ingest manually from the dashboard, or wait for the schedule.

## Cost

Runs within the Workers Paid plan's included allowances (~$5/month flat) up to ~1M requests/month; D1/R2/Cache/rate-limiting stay inside free/included tiers. Ingestion needs the Paid plan's CPU (parsing ~1 MB JSON exceeds the free 10 ms limit).
