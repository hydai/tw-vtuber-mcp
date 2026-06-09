import { SOURCE_REPO } from "./tools";

/** Service-level metadata. Single source of truth for the served surfaces. */
export const SITE = {
  name: "tw-vtuber-mcp",
  title: "TW VTuber Data — MCP 伺服器 + REST API",
  tagline:
    "公開的 MCP 伺服器與 REST API，提供台灣 VTuber 資料——含上游來源未發布的每日歷史趨勢。",
  baseUrl: "https://twvtuber.oshi.tw",
  source: SOURCE_REPO,
  githubRepo: "https://github.com/hydai/tw-vtuber-mcp",
  attribution:
    "所有 VTuber 資料皆源自上游專案 TaiwanVtuberData/TaiwanVTuberTrackingDataJson，本服務快取並重新提供，蒐集功勞歸於上游。每個回應都帶有 source 欄位連回來源。",
  rateLimit: "120 requests / 60s per IP",
  mcpEndpoint: "/mcp",
} as const;

/** One served REST route. `summary` is zh-Hant (HTML page only); `path`/`tool` are language-neutral. */
export interface EndpointDoc {
  method: string;
  path: string;
  summary: string;
  tool: string;
}

/** The 8 `/v1/*` routes, 1:1 with the MCP tools in `src/tools.ts`. */
export const ENDPOINTS: EndpointDoc[] = [
  { method: "GET", path: "/v1/vtubers", summary: "搜尋／篩選／排序 VTuber", tool: "search_vtubers" },
  { method: "GET", path: "/v1/vtubers/:idOrName", summary: "依 id（32-hex）或精確名稱取單一 VTuber", tool: "get_vtuber" },
  { method: "GET", path: "/v1/vtubers/:idOrName/history", summary: "單一 VTuber 的每日歷史時間序列（本服務獨有）", tool: "get_vtuber_history" },
  { method: "GET", path: "/v1/rankings", summary: "依指標的排行榜", tool: "list_rankings" },
  { method: "GET", path: "/v1/groups", summary: "團體／事務所列表", tool: "list_groups" },
  { method: "GET", path: "/v1/groups/:name", summary: "單一團體與其成員", tool: "get_group" },
  { method: "GET", path: "/v1/events", summary: "出道／週年／畢業事件", tool: "list_events" },
  { method: "GET", path: "/v1/status", summary: "資料新鮮度與數量", tool: "get_data_status" },
];
