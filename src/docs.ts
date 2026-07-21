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

const SCALAR_CDN_URL = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.9";

const API_DOCS_STYLE = `
  :root { color-scheme: light dark; --fg:#1a1a1a; --bg:#fff; --muted:#666; --link:#0061d5; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e8e8e8; --bg:#161616; --muted:#aaa; --link:#62a8ff; } }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--fg); background:var(--bg); font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans TC","PingFang TC",sans-serif; }
  #fallback { max-width:720px; margin:0 auto; padding:3rem 1.25rem; }
  #fallback h1 { margin:0 0 .5rem; font-size:1.6rem; }
  #fallback p { color:var(--muted); }
  #fallback a { color:var(--link); }
`;

/** Interactive REST API reference backed by the live `/openapi.json`. */
export function renderApiDocsHtml(): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(SITE.title)} — API Reference</title>
<style>${API_DOCS_STYLE}</style>
</head>
<body>
<div id="app"></div>
<main id="fallback">
<h1>${escapeHtml(SITE.title)}</h1>
<p>正在載入互動 API 文件…</p>
<p><a href="/">返回首頁</a> · <a href="/openapi.json">OpenAPI JSON</a> · <a href="${escapeHtml(SITE.githubRepo)}">GitHub</a></p>
<noscript>
<p>互動 API 文件需要 JavaScript。你仍可直接開啟 <a href="/openapi.json">OpenAPI JSON</a>。</p>
</noscript>
</main>
<script src="${SCALAR_CDN_URL}"></script>
<script>
Scalar.createApiReference("#app", {
  url: "/openapi.json",
  darkMode: window.matchMedia("(prefers-color-scheme: dark)").matches,
  agent: {
    disabled: true,
  },
});
document.querySelector("#fallback")?.remove();
</script>
</body>
</html>`;
}

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
<li><a href="/docs">/docs</a> — 互動 API 文件，可直接在線上測試 REST API</li>
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
