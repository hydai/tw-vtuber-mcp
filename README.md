# TW VTuber Data — MCP 伺服器 + REST API

**繁體中文** | [English](README-en.md)

[![CI](https://github.com/hydai/tw-vtuber-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hydai/tw-vtuber-mcp/actions/workflows/ci.yml)

一個跑在 Cloudflare Workers 上、**公開**的 [Model Context Protocol](https://modelcontextprotocol.io) 伺服器與 REST API，提供台灣 VTuber 資料。讓 AI agent（以及一般 HTTP 用戶端）搜尋、篩選、探索台灣 VTuber 數據——包含上游來源未發布的**歷史趨勢**。

**線上服務：** `https://twvtuber.oshi.tw` — MCP 在 `/mcp`，REST 在 `/v1/*`（目前收錄 3,000+ 位 VTuber）。

## 資料來源與標註

所有 VTuber 資料皆源自 **[TaiwanVtuberData/TaiwanVTuberTrackingDataJson](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson)**（由 [taiwanvtuberdata.github.io](https://taiwanvtuberdata.github.io/) 呈現）。本服務快取並重新提供這些資料，額外加上可查詢層與每日累積的時間序列。**資料蒐集的所有功勞歸於上游專案。** 每個回應都帶有 `source` 欄位連回來源。

## 快速開始

### MCP（AI agent）

Streamable HTTP，免驗證。使用 Claude Code：

```bash
claude mcp add --transport http tw-vtuber https://twvtuber.oshi.tw/mcp
```

接著就能問，例如：*「本週哪些台灣 VTuber 觀看數成長最多？」* 或 *「顯示李聽的訂閱數歷史。」*——agent 會呼叫下方的[工具](#mcp-工具)。任何 MCP 用戶端都適用，指向 `https://twvtuber.oshi.tw/mcp` 即可。

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
# 訂閱數最高的台灣 VTuber
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

更多範例：

```bash
# 用名稱（需 URL 編碼）或 id 查單一 VTuber
curl "https://twvtuber.oshi.tw/v1/vtubers/%E6%9D%8E%E8%81%BD"          # 李聽
curl "https://twvtuber.oshi.tw/v1/vtubers/1c5619a4ece046dd8ba68ed343489ca3"

# 每日歷史時間序列——本服務獨有
curl "https://twvtuber.oshi.tw/v1/vtubers/李聽/history?from=2026-05-01"

# 搜尋：訂閱數 >10 萬、活躍的台灣 VTuber，依 7 日觀看成長排序
curl "https://twvtuber.oshi.tw/v1/vtubers?region=TW&activity=active&min_subscribers=100000&sort_by=growth_7d&order=desc&limit=10"

# 即將到來的出道週年
curl "https://twvtuber.oshi.tw/v1/events?type=anniversary&window=upcoming&region=TW"
```

`vtuber` 物件：

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

> 注意：當平台隱藏數字時，訂閱／觀看／追蹤欄位為 `null`。公開匿名存取，每個 IP 限流 120 requests/60s。

## MCP 工具

| 工具 | 用途 | 主要參數 |
|------|------|----------|
| `search_vtubers` | 搜尋 / 篩選 / 排序 | `query`、`region`、`activity`、`group`、`min_subscribers`、`sort_by`、`order`、`limit` |
| `get_vtuber` | 單一 VTuber | `id_or_name` |
| `get_vtuber_history` | 每日時間序列（獨有） | `id_or_name`、`from`、`to` |
| `list_rankings` | 排行榜 | `type`（`top_subscribers`/`top_views`/`growing_7d`/`growing_30d`/`trending`）、`region`、`limit` |
| `list_groups`、`get_group` | 團體／事務所 + 成員 | `region` / `name` |
| `list_events` | 出道 / 週年 / 畢業 | `type`、`window`（`recent`/`upcoming`）、`region` |
| `get_data_status` | 資料新鮮度 + 數量 | — |

## REST 參考

| 端點 | 對應工具 |
|------|---------|
| `GET /v1/vtubers?query=&region=&activity=&group=&min_subscribers=&sort_by=&order=&limit=&offset=` | `search_vtubers` |
| `GET /v1/vtubers/:idOrName` | `get_vtuber` |
| `GET /v1/vtubers/:idOrName/history?from=&to=` | `get_vtuber_history` |
| `GET /v1/rankings?type=&region=&limit=` | `list_rankings` |
| `GET /v1/groups?region=` · `GET /v1/groups/:name` | `list_groups` / `get_group` |
| `GET /v1/events?type=&window=&region=` | `list_events` |
| `GET /v1/status` | `get_data_status` |

**互動 API 文件：** `https://twvtuber.oshi.tw/docs` — 使用 Scalar 瀏覽所有 REST endpoint、輸入參數並直接向正式 API 發送請求。測試請求仍受每 IP 120 requests / 60s 限制。

**OpenAPI spec：** `https://twvtuber.oshi.tw/openapi.json` — 給 Postman、codegen 或其他 OpenAPI 工具使用的 machine-readable 規格。（原始碼：[`src/openapi.ts`](src/openapi.ts)，即時提供。）

**首頁與 llms.txt：** 用瀏覽器開 `https://twvtuber.oshi.tw/` 會看到 HTML 說明頁；API 用戶端（如 `curl`，預設 `Accept: */*`）對同一網址仍取得原本的 JSON。`https://twvtuber.oshi.tw/llms.txt` 提供給 AI 的精簡服務概覽（[llms.txt](https://llmstxt.org) 慣例）。

## 架構

- **每日攝取**（Cron，`scheduled()`）：輪詢上游 `update-time.json` 作為低成本的變更訊號，接著抓取 `all` 區的聚合 JSON，解析／合併後 upsert 進 **D1**（SQLite）。各地區資料透過 `nationality` 欄位推導。原始檔封存至 **R2**。每位 VTuber 每天一列歷史，累積成時間序列。
- **查詢層**（D1）：一張現況快照表 + 一張 `(vtuber_id, date)` 歷史表，並建立索引以支援搜尋／排序／排行榜。
- **服務**（`fetch()`）：`/mcp`（透過 `McpAgent` 的 Streamable HTTP MCP）與 `/v1/*`（REST）共用同一套工具層。每 IP 限流 + Cache API 回應快取。

## 歷史回填

每日 Cron 只會從現在開始往後累積歷史。為了補齊時間序列，[`scripts/backfill.ts`](scripts/backfill.ts) 會從上游 repo 的 **git 歷史**重建——每個 commit 都是一份過去的快照。它列舉動到 roster 檔的 commit，每個 UTC 日取一份快照，抓取該 commit SHA 下當天的四個 `all` 區檔案，重用與 Cron 相同的解析器，再透過 `wrangler` 將冪等 upsert 寫入 `vtuber_history`。

```bash
npm run backfill -- --dry-run --limit 3   # 抓取最近幾天、印出 SQL 範例、不寫入
npm run backfill                          # 完整執行：所有可取得的天數 -> 遠端 D1
npm run backfill -- --from 2026-03-01     # 限定區間；也支援 --to / --limit / --no-apply
```

它在本地執行（不在 Worker 內），因此 subrequest／CPU 限制不適用；upsert 為冪等，可安全重跑或續跑。需要已登入的 `gh` 與 `wrangler`。

> **可回溯範圍：** 上游 repo 在 2025-12-24 重置了 git 歷史（「Initial commit」），所以從 commit 只能回溯約 5 個月——更早的資料無法取得。回填後，每日 Cron 會持續延長序列（使本服務成為長期存檔）；未來上游若再次重置，重跑此腳本即可補上缺口。

## 開發

```bash
npm install
npm run cf-types     # 產生 Cloudflare binding 型別
npm test             # 單元／整合測試（vitest + workers pool）
npm run dev          # 本地開發伺服器
```

## 部署

前置需求：
1. 帳號已**啟用 R2**（供原始檔封存）。
2. 一個指向 Worker 的**自訂網域**——Cache API 運作所必需（`*.workers.dev` 的快取無效）。可在 `wrangler.jsonc` 的 `routes` + `custom_domain` 或儀表板設定。

```bash
npm run db:migrate:remote        # 套用 D1 schema 到遠端資料庫
npm run deploy                   # wrangler deploy
```

之後每日 Cron（`0 21 * * *` UTC）會自動攝取。可從儀表板手動觸發第一次攝取，或等待排程。

## 成本

在 Workers Paid 方案的內含額度內運作（約 $5／月固定費），可支撐到每月約 100 萬次請求；D1／R2／Cache／限流皆落在免費／內含層級。攝取需要 Paid 方案的 CPU（解析約 1 MB 的 JSON 會超過免費的 10 ms 限制）。

## 授權

原始碼採用 [MIT](LICENSE) 授權。VTuber 資料屬於[上游專案](https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson)。
