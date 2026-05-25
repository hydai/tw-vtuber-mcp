import { describe, it, expect } from "vitest";
import { openApiSpec } from "../src/openapi";
import { TOOLS } from "../src/tools";

describe("openApiSpec", () => {
  it("is an OpenAPI 3 document with info", () => {
    expect(openApiSpec.openapi).toMatch(/^3\./);
    expect(openApiSpec.info.title).toBeTruthy();
    expect(openApiSpec.info.version).toBeTruthy();
    expect(openApiSpec.info.license?.name).toBe("MIT");
  });

  it("advertises the live server", () => {
    expect(openApiSpec.servers.some((s) => s.url.includes("twvtuber.oshi.tw"))).toBe(true);
  });

  it("documents every REST endpoint", () => {
    const paths = Object.keys(openApiSpec.paths);
    for (const p of [
      "/v1/vtubers",
      "/v1/vtubers/{idOrName}",
      "/v1/vtubers/{idOrName}/history",
      "/v1/rankings",
      "/v1/groups",
      "/v1/groups/{name}",
      "/v1/events",
      "/v1/status",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("covers one REST path per tool (parity with the MCP surface)", () => {
    // 8 tools, each reachable 1:1 over REST.
    expect(TOOLS.length).toBe(8);
    expect(Object.keys(openApiSpec.paths).length).toBeGreaterThanOrEqual(TOOLS.length);
  });

  it("defines the core response schemas", () => {
    expect(openApiSpec.components.schemas.VTuber).toBeDefined();
    expect(openApiSpec.components.schemas.HistoryPoint).toBeDefined();
    expect(openApiSpec.components.schemas.Group).toBeDefined();
  });
});
