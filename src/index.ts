import { runIngest } from "./ingest";
import { VTuberMCP } from "./mcp";

// Re-export the Durable Object class so the runtime can find it.
export { VTuberMCP };

/**
 * Worker entry point.
 *
 * - `fetch`: serves `/mcp` (Streamable HTTP MCP) and `/v1/*` (REST, later phase).
 * - `scheduled`: daily ingestion from the upstream data source.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return VTuberMCP.serve("/mcp", { binding: "VTUBER_MCP" }).fetch(request, env, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/v1/status") {
      return Response.json({
        service: "tw-vtuber-mcp",
        status: "ok",
        endpoints: { mcp: "/mcp", rest: "/v1/*" },
        source: "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson",
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const result = await runIngest(env);
    console.log(`[ingest] ${JSON.stringify(result)}`);
  },
} satisfies ExportedHandler<Env>;
