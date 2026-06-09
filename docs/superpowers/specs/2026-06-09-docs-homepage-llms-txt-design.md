# 說明首頁 + `/llms.txt` 設計

- **日期：** 2026-06-09
- **狀態：** 已核可設計，待寫實作計畫
- **範圍：** 在現有 Worker 上新增「給人看的 HTML 說明首頁」與「給 AI 看的 `/llms.txt`」，並引入單一真實來源（catalog）。**所有現有端點與契約完全保留。**

## 背景與動機

本服務（`tw-vtuber-mcp`）是跑在 Cloudflare Workers 上的公開 MCP 伺服器 + REST API。它最重要的既有設計是：`src/tools.ts` 的 `TOOLS` 陣列是唯一真實來源，MCP（`src/mcp.ts`）與 REST（`src/rest.ts`）都只是同一套工具層的兩個「門面」，因此每條 REST 路由都 1:1 對應一個 MCP 工具。

目前端點/服務資訊散落在多個地方：`src/index.ts` 的根 JSON、`src/openapi.ts`、`README.md`、`README-en.md`。本次要新增的 HTML 說明頁與 `llms.txt` 等於是第三、第四個「門面」（給人 + 給 AI），若各自手抄端點清單，會再多出兩份容易過期的副本。

**目標：** 新增兩個門面，且讓伺服端的門面共用同一份結構化資料，避免漂移。

## 目標 / 非目標

**目標**
- `GET /`：對瀏覽器回人類可讀的 HTML 說明頁；對 API client 維持回傳現有 JSON。
- `GET /llms.txt`：依 [llmstxt.org](https://llmstxt.org) 慣例提供 AI 可讀的服務概覽。
- 伺服端三個門面（根 JSON、HTML、`llms.txt`）由單一 catalog 渲染。
- 完整保留 `/mcp`、`/v1/*`、`/openapi.json` 與根 JSON 既有契約。

**非目標（YAGNI）**
- 不做 `/llms-full.txt`。
- HTML 頁不引入 JS、外部資產、build step、CSS 框架或語法高亮套件。
- 不調整任何現有端點的查詢邏輯、回應形狀或限流規則（新增端點除外）。

## 關鍵決策

1. **`GET /` 採內容協商（content negotiation）。** 依 `Accept` header 分流：含 `text/html` → HTML 說明頁；否則 → 現有根 JSON。如此既「把首頁做成說明頁」，又保留既有的機器可讀契約。
2. **共用 catalog 模組為單一真實來源。** 新增 `src/site.ts` 集中服務中繼資料與端點目錄；MCP 工具描述直接重用 `src/tools.ts` 的 `TOOLS`，不另抄。

## 語言決策（請於 spec review 時確認）

- **HTML 說明頁：以繁體中文為主**——對齊專案已將繁中設為預設 README 的決定，以及主要受眾。
- **`/llms.txt`：以英文撰寫**——符合 LLM 工具慣例，且可直接重用 `TOOLS` 既有的英文工具描述與 `openapi.json`，避免中英混雜。

## 模組設計

### `src/site.ts`（資料層，新增）

匯出：

- `SITE`：服務層中繼資料，例如
  - `name`、`title`、`tagline`
  - `baseUrl`（`https://twvtuber.oshi.tw`）
  - `source`（重用 `tools.ts` 的 `SOURCE_REPO`）、`attribution`
  - `rateLimit`（字串，如 `"120 requests / 60s per IP"`）
  - `mcpEndpoint`（`"/mcp"`）、`githubRepo`
- `EndpointDoc` 介面：`{ method: string; path: string; summary: string; tool: string }`
- `ENDPOINTS: EndpointDoc[]`：以下 8 條 REST 路由——
  1. `GET /v1/vtubers` — 搜尋／篩選／排序 — `search_vtubers`
  2. `GET /v1/vtubers/:idOrName` — 單一 VTuber — `get_vtuber`
  3. `GET /v1/vtubers/:idOrName/history` — 每日歷史時間序列 — `get_vtuber_history`
  4. `GET /v1/rankings` — 排行榜 — `list_rankings`
  5. `GET /v1/groups` — 團體列表 — `list_groups`
  6. `GET /v1/groups/:name` — 單一團體＋成員 — `get_group`
  7. `GET /v1/events` — 出道／週年／畢業事件 — `list_events`
  8. `GET /v1/status` — 資料新鮮度 — `get_data_status`

> 註：特殊端點（`/mcp`、`/openapi.json`、`/llms.txt`）屬服務層，放在 `SITE` 中繼資料，不放 `ENDPOINTS`（`ENDPOINTS` 專指 `/v1/*` 資料路由）。

### `src/docs.ts`（呈現層，新增）

兩個純函式，輸入 `SITE` / `ENDPOINTS` / `TOOLS`，輸出字串：

- `renderDocsHtml(): string` — 自包含 HTML（單一字串、內嵌 `<style>`）。區塊順序：
  1. 標題 + 標語
  2. 「這是什麼」+ 資料標註（功勞歸上游、每個回應含 `source`）
  3. MCP 快速上手（`claude mcp add --transport http tw-vtuber <baseUrl>/mcp`）
  4. REST 快速上手（2–3 個 curl 範例）
  5. 端點表（由 `ENDPOINTS` 迭代產生：method / path / summary / 對應 tool）
  6. MCP 工具表（由 `TOOLS` 迭代產生：name / description）
  7. 連結區（`/openapi.json`、`/llms.txt`、GitHub、上游 repo）
  8. 限流與授權說明
  - 風格：乾淨單欄、系統字體堆疊、響應式、`prefers-color-scheme` 深色感知。任何插入 HTML 的動態文字一律經過 escape helper（即便來源為自有常數，仍維持衛生習慣）。
- `renderLlmsTxt(): string` — 依 llmstxt.org 慣例的純文字／Markdown：
  （內容為英文；以下為結構示意，實際摘要文字以英文撰寫）
  ```
  # TW VTuber Data API

  > Public MCP server + REST API for Taiwan VTuber data — search, rankings,
  > groups, events, and a daily history time-series not available upstream.
  > Public + anonymous, rate-limited 120 req/60s per IP.

  Key facts:
  - Base URL / MCP endpoint / data source & attribution / every response has `source`

  ## REST API
  - 逐條由 ENDPOINTS 產生：`GET /v1/...` — summary（maps to MCP tool `...`）

  ## MCP tools
  - 由 TOOLS 產生：`name` — description

  ## Reference
  - OpenAPI spec：<baseUrl>/openapi.json
  - Source & docs：<githubRepo>
  ```

> 檔案邊界：`site.ts` 純資料、`docs.ts` 純呈現。兩個 render 函式彼此獨立；若日後 `docs.ts` 變大，可再拆成 `docs.ts`（HTML）與 `llms.ts`（text）。本次先合在 `docs.ts`。

## 路由改動（`src/index.ts`）

僅新增 `/llms.txt`、改寫 `/` 分支；其餘維持原順序與行為。

```
OPTIONS → 204（現狀）
── 公開中繼資料群組（免限流、可快取）──
  GET /openapi.json → openApiSpec（現狀）
  GET /llms.txt     → renderLlmsTxt()
                      Content-Type: text/plain; charset=utf-8
                      Cache-Control: public, max-age=3600          ★新增
── 限流檢查（現狀）──
  GET /mcp、/mcp/*  → VTuberMCP.serve（現狀）
  GET /v1/*         → handleRest（現狀）
  GET /             → 內容協商：
                        Accept 含 "text/html" → renderDocsHtml()
                          Content-Type: text/html; charset=utf-8
                          Cache-Control: public, max-age=3600
                        否則 → 現有根 JSON（形狀不變；
                               加上 Cache-Control: public, max-age=3600；
                               endpoints 物件新增 llms: "/llms.txt"）
  其餘 → 404（現狀）
```

設計理由：
- `/llms.txt` 與 `/openapi.json` 同屬靜態公開中繼資料，放在限流檢查之前 → 免限流且可被 Cache API 快取；爬蟲/AI 取用不消耗一般請求配額。
- `/` 維持在限流檢查之後（行為與今日一致，仍受限流），僅新增內容協商與 Cache-Control。

## 行為保留保證

- **curl 不受影響：** `curl` 預設送 `Accept: */*`，不含 `text/html` 子字串 → 落入 JSON 分支，回傳與今日相同的 JSON。
- **既有 JSON 契約不變：** `service` / `status` / `endpoints` / `source` / `note` 欄位形狀保留；`endpoints` 僅「新增」`llms` 欄位（純加法、不破壞）。
- **零 subrequest：** `/` 與 `/llms.txt` 皆為 in-memory 字串渲染，不存取 D1、不發 fetch，不影響 Workers 子請求上限。
- **限流不變：** 既有 `/v1/*`、`/mcp` 的每 IP 120 req/60s 規則不動。

## 測試（`test/docs.test.ts`，新增）

- `GET /` 帶 `Accept: text/html` → 200、`Content-Type: text/html`、body 含標題、`/mcp`、`/v1/vtubers`。
- `GET /` 帶 `Accept: */*`（curl 行為）與 `application/json` → 200、JSON 形狀保留（含 `service`、`endpoints`、`source`）→ **契約保留證明**。
- `GET /llms.txt` → 200、`Content-Type: text/plain`、含 `#` H1、`baseUrl`、列出端點。
- **漂移守門：** 斷言 `ENDPOINTS` 內每條 `path` 都出現在 `renderDocsHtml()` 與 `renderLlmsTxt()` 的輸出中。
- 既有測試（`rest.test.ts`、`openapi.test.ts` 等）維持綠燈。

## 連帶更新

- 根 JSON `endpoints` 物件新增 `llms: "/llms.txt"`。
- `README.md` / `README-en.md`：端點參考表補上 `GET /llms.txt`，並註明「`GET /` 對瀏覽器回說明頁、對 API client 回 JSON」。

## 影響的檔案

| 動作 | 檔案 |
|------|------|
| 新增 | `src/site.ts`、`src/docs.ts`、`test/docs.test.ts` |
| 修改 | `src/index.ts`、`README.md`、`README-en.md` |
| 不動 | `src/rest.ts`、`src/tools.ts`、`src/mcp.ts`、`src/openapi.ts`、`src/db.ts`、`src/ingest.ts`、`src/parse.ts` |

## 驗收標準

1. 瀏覽器開 `/` 看到 HTML 說明頁；`curl /` 仍得到既有 JSON。
2. `curl /llms.txt` 得到符合 llmstxt.org 慣例的純文字。
3. `ENDPOINTS` 為端點清單唯一來源，HTML 與 llms.txt 皆由它渲染（漂移守門測試通過）。
4. `npm test` 與 `npm run typecheck` 全綠。
5. 既有端點與 JSON 契約行為無變更（新增 `llms` 欄位除外）。
