# TW VTuber Data — MCP Server + REST API

A **public** [Model Context Protocol](https://modelcontextprotocol.io) server and REST API for Taiwan VTuber data, running on Cloudflare Workers. It lets AI agents (and ordinary HTTP clients) search, filter, and explore Taiwan VTuber stats — including **historical trends** that the upstream source does not publish.

## Data source & attribution

All VTuber data originates from **[TaiwanVtuberData/TaiwanVTuberTrackingDataJson](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson)** (rendered by [taiwanvtuberdata.github.io](https://taiwanvtuberdata.github.io/)). This service caches and re-serves that data, adding a queryable layer and an accumulating daily time-series. **All credit for data collection belongs to the upstream project.** Every API/MCP response links back to the source.

## Architecture (summary)

- **Daily ingestion** (Cron): polls the upstream `update-time.json` as a cheap change-signal, then parses the aggregate JSON into a Cloudflare **D1** (SQLite) database and archives the raw files to **R2**.
- **Query layer**: D1 holds a current snapshot plus a `(vtuber_id, date)` history table.
- **Serving**: a Worker exposes `/mcp` (Streamable HTTP MCP) and `/v1/*` (REST), with per-IP rate limiting and Cache-API response caching. Time-sensitive `livestreams` are passed through to the upstream CDN with a short edge cache.

## Status

Under construction — built in phases. See the implementation plan.

## Development

```bash
npm install
npm run cf-types          # generate Cloudflare binding types
npm test                  # run unit/integration tests
npm run dev               # local dev server (wrangler)
```
