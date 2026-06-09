import { describe, it, expect } from "vitest";
import { SITE, ENDPOINTS } from "../src/site";
import { TOOLS } from "../src/tools";
import { renderDocsHtml, renderLlmsTxt } from "../src/docs";

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
