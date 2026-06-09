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
