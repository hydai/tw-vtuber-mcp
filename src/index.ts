import { runIngest } from "./ingest";
import { VTuberMCP } from "./mcp";
import { handleRest, jsonResponse, CORS } from "./rest";
import { openApiSpec } from "./openapi";
import { renderApiDocsHtml, renderDocsHtml, renderLlmsTxt } from "./docs";

// Re-export the Durable Object class so the runtime can find it.
export { VTuberMCP };

/**
 * Worker entry point.
 *
 * - `fetch`: per-IP rate limit -> `/mcp` (MCP) | `/v1/*` (REST) | root info.
 * - `scheduled`: daily ingestion from the upstream data source.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // OpenAPI spec — public metadata, exempt from rate limiting, cacheable.
    if (url.pathname === "/openapi.json") {
      return jsonResponse(openApiSpec, 200, { "Cache-Control": "public, max-age=3600" });
    }

    // llms.txt — public metadata for AI agents, exempt from rate limiting, cacheable.
    if (url.pathname === "/llms.txt") {
      return new Response(renderLlmsTxt(), {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS, "Cache-Control": "public, max-age=3600" },
      });
    }

    // Interactive API reference — public metadata, exempt from rate limiting, cacheable.
    if (url.pathname === "/docs") {
      return new Response(renderApiDocsHtml(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", ...CORS, "Cache-Control": "public, max-age=3600" },
      });
    }

    // Per-IP rate limiting (Workers Rate Limiting binding; per-colo, 60s window).
    const ip = request.headers.get("cf-connecting-ip") ?? "anon";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return jsonResponse({ error: "rate limited", retry_after_seconds: 60 }, 429, { "Retry-After": "60" });
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return VTuberMCP.serve("/mcp", { binding: "VTUBER_MCP" }).fetch(request, env, ctx);
    }

    const rest = await handleRest(request, env);
    if (rest) return rest;

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
            docs: "/docs",
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

    return jsonResponse({ error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await runIngest(env);
    console.log(`[ingest] ${JSON.stringify(result)}`);
  },
} satisfies ExportedHandler<Env>;
