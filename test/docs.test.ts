import { describe, it, expect } from "vitest";
import { SITE, ENDPOINTS } from "../src/site";
import { TOOLS } from "../src/tools";
import { renderDocsHtml, renderLlmsTxt } from "../src/docs";
import worker from "../src/index";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

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
