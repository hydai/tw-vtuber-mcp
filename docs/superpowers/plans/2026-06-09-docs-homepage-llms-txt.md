# HTML Homepage + `/llms.txt` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a human-readable HTML docs page at `/` (content-negotiated) and an AI-readable `/llms.txt`, both rendered from a new shared catalog, while preserving every existing endpoint and the root JSON contract.

**Architecture:** A new data module `src/site.ts` becomes the single source of truth for served service metadata + the REST endpoint catalog (reusing `TOOLS`/`SOURCE_REPO` from `src/tools.ts`). A new presentation module `src/docs.ts` renders that catalog into HTML and llms.txt. `src/index.ts` adds a rate-limit-exempt `/llms.txt` route and content-negotiates `/` (browsers → HTML, everyone else → today's JSON).

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest (`@cloudflare/vitest-pool-workers`). No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-09-docs-homepage-llms-txt-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/site.ts` | Data only: `SITE` metadata + `ENDPOINTS` catalog. Imports `SOURCE_REPO` from `tools.ts`. |
| Create | `src/docs.ts` | Presentation only: `renderDocsHtml()` (zh-Hant) + `renderLlmsTxt()` (English). Imports `SITE`/`ENDPOINTS` + `TOOLS`. |
| Modify | `src/index.ts` | Add `/llms.txt` route (rate-limit-exempt); content-negotiate `/`; add `llms` to root JSON. |
| Create | `test/docs.test.ts` | Catalog shape, render output + drift guards, and worker routing/content-negotiation. |
| Modify | `README.md`, `README-en.md` | Document the `/` docs page and `/llms.txt`. |
| Untouched | `src/rest.ts`, `src/tools.ts`, `src/mcp.ts`, `src/openapi.ts`, `src/db.ts`, `src/ingest.ts`, `src/parse.ts` | No endpoint logic changes. |

**Language split (from spec):** HTML page = Traditional Chinese (audience + project default). `llms.txt` = English (LLM convention; reuses English `TOOLS` descriptions + `openapi.json`). `ENDPOINTS.summary` is Chinese and used **only** by the HTML page; `llms.txt` lists each endpoint by path → tool name (language-neutral) and relies on the `## MCP tools` section for English descriptions.

---

## Task 1: Shared catalog `src/site.ts`

**Files:**
- Create: `test/docs.test.ts`
- Create: `src/site.ts`

- [ ] **Step 1: Write the failing test**

Create `test/docs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SITE, ENDPOINTS } from "../src/site";
import { TOOLS } from "../src/tools";

describe("site catalog", () => {
  it("has the 8 REST endpoints, each mapping to a real MCP tool", () => {
    const toolNames = new Set(TOOLS.map((t) => t.name));
    expect(ENDPOINTS).toHaveLength(8);
    for (const e of ENDPOINTS) {
      expect(e.method).toBe("GET");
      expect(e.path.startsWith("/v1/")).toBe(true);
      expect(e.summary.length).toBeGreaterThan(0);
      expect(toolNames.has(e.tool)).toBe(true);
    }
  });

  it("exposes service metadata", () => {
    expect(SITE.baseUrl).toMatch(/^https:\/\//);
    expect(SITE.mcpEndpoint).toBe("/mcp");
    expect(SITE.source).toContain("TaiwanVtuberData");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/docs.test.ts`
Expected: FAIL — cannot resolve module `../src/site`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/site.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/docs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck, lint, commit, push**

```bash
npm run typecheck
lineguard src/site.ts test/docs.test.ts
git add src/site.ts test/docs.test.ts
git commit -m "feat: add shared site catalog as single source for served metadata"
git push
```

---

## Task 2: Renderers `src/docs.ts`

**Files:**
- Modify: `test/docs.test.ts` (append render tests)
- Create: `src/docs.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/docs.test.ts` (the `SITE`, `ENDPOINTS`, `TOOLS` imports already exist from Task 1; add the `docs` import at the top with the others):

```ts
import { renderDocsHtml, renderLlmsTxt } from "../src/docs";
```

Then append these describe blocks at the end of the file:

```ts
describe("renderLlmsTxt", () => {
  const out = renderLlmsTxt();

  it("is an llms.txt-style document in English", () => {
    expect(out.startsWith("# ")).toBe(true);
    expect(out).toContain(SITE.baseUrl);
    expect(out).toContain(`${SITE.baseUrl}/mcp`);
    expect(out).toContain("## REST API");
    expect(out).toContain("## MCP tools");
    expect(out).toContain(`${SITE.baseUrl}/openapi.json`);
  });

  it("lists every endpoint path and every tool name (drift guard)", () => {
    for (const e of ENDPOINTS) expect(out).toContain(e.path);
    for (const t of TOOLS) expect(out).toContain(t.name);
  });
});

describe("renderDocsHtml", () => {
  const html = renderDocsHtml();

  it("is a self-contained HTML document", () => {
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("<title>");
    expect(html).toContain(SITE.title);
    expect(html).toContain("/mcp");
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/openapi.json"');
  });

  it("renders every endpoint path (drift guard)", () => {
    for (const e of ENDPOINTS) expect(html).toContain(e.path);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/docs.test.ts`
Expected: FAIL — cannot resolve module `../src/docs`.

- [ ] **Step 3: Write the implementation**

Create `src/docs.ts`:

```ts
import { SITE, ENDPOINTS } from "./site";
import { TOOLS } from "./tools";

/** Escape text interpolated into HTML. Catalog values are trusted, but this keeps the surface clean. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLE = `
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fff; --muted:#666; --border:#e3e3e3; --code-bg:#f5f5f5; --link:#0061d5; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --bg:#161616; --muted:#9b9b9b; --border:#333; --code-bg:#242424; --link:#62a8ff; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC","PingFang TC",sans-serif; color:var(--fg); background:var(--bg); }
  main { max-width:820px; margin:0 auto; padding:2.5rem 1.25rem 4rem; }
  h1 { font-size:1.7rem; margin:0 0 .25rem; }
  h2 { font-size:1.2rem; margin:2.2rem 0 .6rem; border-bottom:1px solid var(--border); padding-bottom:.3rem; }
  p.tagline { color:var(--muted); margin-top:0; }
  a { color:var(--link); }
  code { background:var(--code-bg); padding:.1em .35em; border-radius:4px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9em; }
  pre { background:var(--code-bg); padding:.9rem 1rem; border-radius:8px; overflow-x:auto; }
  pre code { background:none; padding:0; }
  table { border-collapse:collapse; width:100%; margin:.5rem 0; font-size:.92rem; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--border); vertical-align:top; }
  th { color:var(--muted); font-weight:600; }
  ul.links { list-style:none; padding:0; }
  ul.links li { margin:.35rem 0; }
  footer { margin-top:3rem; color:var(--muted); font-size:.85rem; }
`;

/** Human-facing HTML docs page (zh-Hant). Self-contained: inline CSS, no JS, no external assets. */
export function renderDocsHtml(): string {
  const base = SITE.baseUrl;
  const endpointRows = ENDPOINTS.map(
    (e) =>
      `<tr><td><code>${escapeHtml(e.method)} ${escapeHtml(e.path)}</code></td>` +
      `<td>${escapeHtml(e.summary)}</td>` +
      `<td><code>${escapeHtml(e.tool)}</code></td></tr>`,
  ).join("\n");
  const toolRows = TOOLS.map(
    (t) => `<tr><td><code>${escapeHtml(t.name)}</code></td><td>${escapeHtml(t.description)}</td></tr>`,
  ).join("\n");

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(SITE.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(SITE.title)}</h1>
<p class="tagline">${escapeHtml(SITE.tagline)}</p>
<p>${escapeHtml(SITE.attribution)}</p>

<h2>MCP（給 AI agent）</h2>
<p>Streamable HTTP、免驗證。以 Claude Code 為例：</p>
<pre><code>claude mcp add --transport http tw-vtuber ${escapeHtml(base + SITE.mcpEndpoint)}</code></pre>
<p>任何 MCP 用戶端指向 <code>${escapeHtml(base + SITE.mcpEndpoint)}</code> 即可。</p>

<h2>REST（給一般 HTTP 用戶端）</h2>
<pre><code>curl ${escapeHtml(base)}/v1/status
curl "${escapeHtml(base)}/v1/rankings?type=top_subscribers&amp;region=TW&amp;limit=5"</code></pre>

<h2>REST 端點</h2>
<table>
<thead><tr><th>端點</th><th>說明</th><th>對應 MCP 工具</th></tr></thead>
<tbody>
${endpointRows}
</tbody>
</table>

<h2>MCP 工具</h2>
<table>
<thead><tr><th>工具</th><th>說明</th></tr></thead>
<tbody>
${toolRows}
</tbody>
</table>

<h2>其他資源</h2>
<ul class="links">
<li><a href="/openapi.json">/openapi.json</a> — OpenAPI 3.0 規格（可匯入 Swagger UI、Postman）</li>
<li><a href="/llms.txt">/llms.txt</a> — 給 AI 的服務概覽</li>
<li><a href="${escapeHtml(SITE.githubRepo)}">原始碼與文件（GitHub）</a></li>
<li><a href="${escapeHtml(SITE.source)}">上游資料來源</a></li>
</ul>

<footer>
<p>公開匿名存取，限流 ${escapeHtml(SITE.rateLimit)}。原始碼採 MIT 授權；VTuber 資料屬於上游專案。</p>
</footer>
</main>
</body>
</html>`;
}

/** AI-facing service overview following the llms.txt convention (English). */
export function renderLlmsTxt(): string {
  const base = SITE.baseUrl;
  const restLines = ENDPOINTS.map((e) => `- \`${e.method} ${e.path}\` — maps to MCP tool \`${e.tool}\``).join("\n");
  const toolLines = TOOLS.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n");

  return `# TW VTuber Data API

> Public MCP server + REST API for Taiwan VTuber data — search, filter, rankings, groups, events, and a daily history time-series not available upstream. Public and anonymous; rate-limited ${SITE.rateLimit}.

Key facts:
- Base URL: ${base}
- MCP endpoint (Streamable HTTP, authless): ${base}${SITE.mcpEndpoint}
- Data source: ${SITE.source} — cached and re-served here with attribution; all credit to the upstream project.
- Every JSON response includes a \`source\` field linking back to the upstream repo.
- Names support CJK; subscriber/view/follower fields are null when the platform hides them.

## REST API
Base path \`/v1\`. All endpoints are GET and return JSON. Full machine-readable schema at ${base}/openapi.json.
${restLines}

## MCP tools
${toolLines}

## Reference
- OpenAPI spec: ${base}/openapi.json
- Source & docs: ${SITE.githubRepo}
- Upstream data: ${SITE.source}
`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/docs.test.ts`
Expected: PASS (catalog + 4 render tests).

- [ ] **Step 5: Typecheck, lint, commit, push**

```bash
npm run typecheck
lineguard src/docs.ts test/docs.test.ts
git add src/docs.ts test/docs.test.ts
git commit -m "feat: render docs HTML and llms.txt from the shared catalog"
git push
```

---

## Task 3: Wire routing in `src/index.ts`

**Files:**
- Modify: `src/index.ts` (add import; add `/llms.txt` route; content-negotiate `/`)
- Modify: `test/docs.test.ts` (append worker-routing tests)

- [ ] **Step 1: Write the failing tests**

Append to `test/docs.test.ts`. Add these imports at the top alongside the existing ones:

```ts
import worker from "../src/index";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
```

Append this describe block at the end of the file:

```ts
async function hit(path: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://api.local${path}`, { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("worker routing: docs surface", () => {
  it("GET / with Accept: text/html serves the HTML docs page", async () => {
    const res = await hit("/", { Accept: "text/html" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain(SITE.title);
  });

  it("GET / for non-browser clients keeps the JSON contract", async () => {
    const res = await hit("/"); // no Accept header → JSON branch (mirrors curl's */*)
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as {
      service: string;
      endpoints: Record<string, string>;
      source: string;
    };
    expect(body.service).toBe("tw-vtuber-mcp");
    expect(body.endpoints.llms).toBe("/llms.txt");
    expect(body.endpoints.mcp).toBe("/mcp");
    expect(body.source).toContain("TaiwanVtuberData");
  });

  it("GET /llms.txt serves text/plain and is rate-limit-exempt", async () => {
    const res = await hit("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).startsWith("# ")).toBe(true);
  });
});
```

> Note: `GET /` runs after the rate-limit check, so this exercises `env.RATE_LIMITER` (the `ratelimits` binding declared in `wrangler.jsonc`); the pooled-workers runtime returns `{ success: true }` for the first calls. If a future runtime lacks that binding, drive these via `SELF.fetch` from `cloudflare:test` instead.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/docs.test.ts`
Expected: FAIL — `/llms.txt` currently 404s, `/` returns JSON for `text/html`, and `endpoints.llms` is undefined.

- [ ] **Step 3: Apply the implementation**

In `src/index.ts`, add this import after the existing `import { openApiSpec } from "./openapi";` line:

```ts
import { renderDocsHtml, renderLlmsTxt } from "./docs";
```

Add the `/llms.txt` route immediately after the existing `/openapi.json` block (before the rate-limiting section), so it is also rate-limit-exempt and cacheable:

```ts
    // llms.txt — public metadata for AI agents, exempt from rate limiting, cacheable.
    if (url.pathname === "/llms.txt") {
      return new Response(renderLlmsTxt(), {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS, "Cache-Control": "public, max-age=3600" },
      });
    }
```

Replace the entire existing `if (url.pathname === "/") { ... }` block with:

```ts
    if (url.pathname === "/") {
      // Content negotiation: browsers (Accept: text/html) get the human-readable
      // HTML docs page; API clients (curl's default Accept: */*, or
      // application/json) keep the existing JSON contract unchanged.
      const accept = request.headers.get("Accept") ?? "";
      if (accept.includes("text/html")) {
        return new Response(renderDocsHtml(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", ...CORS, "Cache-Control": "public, max-age=3600" },
        });
      }
      return jsonResponse(
        {
          service: "tw-vtuber-mcp",
          status: "ok",
          endpoints: {
            mcp: "/mcp",
            rest: "/v1/{vtubers,vtubers/:id,vtubers/:id/history,rankings,groups,groups/:name,events,status}",
            openapi: "/openapi.json",
            llms: "/llms.txt",
          },
          source: "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson",
          note: "Data cached from the upstream project; all credit to TaiwanVtuberData.",
        },
        200,
        { "Cache-Control": "public, max-age=3600" },
      );
    }
```

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS — all existing tests plus the new docs tests. (Confirms the existing `/v1/*`, `/mcp`, `/openapi.json` behavior is untouched.)

- [ ] **Step 5: Typecheck, lint, commit, push**

```bash
npm run typecheck
lineguard src/index.ts test/docs.test.ts
git add src/index.ts test/docs.test.ts
git commit -m "feat: serve HTML docs at / (content-negotiated) and add /llms.txt"
git push
```

---

## Task 4: Document the new surface in both READMEs

**Files:**
- Modify: `README.md` (after the `**OpenAPI spec：**` line, ~line 119)
- Modify: `README-en.md` (after the `**OpenAPI spec:**` line, ~line 119)

- [ ] **Step 1: Update `README.md`**

Immediately after the line beginning `**OpenAPI spec：**`, insert a new paragraph:

```markdown
**首頁與 llms.txt：** 用瀏覽器開 `https://twvtuber.oshi.tw/` 會看到 HTML 說明頁；API 用戶端（如 `curl`，預設 `Accept: */*`）對同一網址仍取得原本的 JSON。`https://twvtuber.oshi.tw/llms.txt` 提供給 AI 的精簡服務概覽（[llms.txt](https://llmstxt.org) 慣例）。
```

- [ ] **Step 2: Update `README-en.md`**

Immediately after the line beginning `**OpenAPI spec:**`, insert a new paragraph:

```markdown
**Homepage & llms.txt:** open `https://twvtuber.oshi.tw/` in a browser for an HTML docs page; API clients (e.g. `curl`, default `Accept: */*`) get the original JSON from the same URL. `https://twvtuber.oshi.tw/llms.txt` is a concise overview for AI agents (the [llms.txt](https://llmstxt.org) convention).
```

- [ ] **Step 3: Lint, commit, push**

```bash
lineguard README.md README-en.md
git add README.md README-en.md
git commit -m "docs: document the / docs page and /llms.txt in both READMEs"
git push
```

---

## Task 5: Final verification

- [ ] **Step 1: Full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Manual smoke (optional, recommended)**

```bash
npm run dev
# In another shell:
curl -s localhost:8787/ | head -1                       # expect JSON ({"service":"tw-vtuber-mcp",...)
curl -s -H 'Accept: text/html' localhost:8787/ | head -1 # expect <!doctype html>
curl -s localhost:8787/llms.txt | head -1               # expect "# TW VTuber Data API"
curl -s localhost:8787/v1/status                        # unchanged
```

Stop `wrangler dev` when done.

- [ ] **Step 3: Confirm subrequest budget unchanged**

`/` and `/llms.txt` render in-memory strings (no D1, no `fetch`) → 0 subrequests added. Existing `/v1/*` paths are untouched. No action needed; note in the PR/summary.

---

## Self-Review

**1. Spec coverage** (against `2026-06-09-docs-homepage-llms-txt-design.md`):
- Content-negotiated `/` (HTML vs JSON) → Task 3. ✓
- `/llms.txt`, rate-limit-exempt, cacheable → Task 3. ✓
- Shared catalog single source → Task 1 (`site.ts`), consumed by Tasks 2–3. ✓
- Reuse `TOOLS` for tool descriptions → Task 2 (`renderLlmsTxt`/`renderDocsHtml` import `TOOLS`). ✓
- HTML zh-Hant / llms.txt English language split → Task 1 data + Task 2 renderers. ✓
- Root JSON `endpoints.llms` additive field → Task 3. ✓
- Drift-guard tests → Task 2 (every path in both outputs). ✓
- Contract-preservation test (curl → JSON) → Task 3. ✓
- README updates (both languages) → Task 4. ✓
- Zero-subrequest guarantee → Task 5 Step 3. ✓

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**3. Type consistency:** `SITE`, `ENDPOINTS`, `EndpointDoc` defined in Task 1 and used verbatim in Tasks 2–3. `renderDocsHtml()`/`renderLlmsTxt()` names consistent between `docs.ts` (Task 2) and `index.ts` import (Task 3). `escapeHtml` is module-private to `docs.ts`. `TOOLS`/`SOURCE_REPO` match `src/tools.ts` exports. ✓
