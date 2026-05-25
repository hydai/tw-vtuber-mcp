import { runIngest } from "./ingest";

/**
 * Worker entry point.
 *
 * - `fetch`: serves `/mcp` (MCP) and `/v1/*` (REST). Wired up in later phases.
 * - `scheduled`: daily ingestion from the upstream data source.
 */
export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/v1/status") {
      return Response.json({
        service: "tw-vtuber-mcp",
        status: "under-construction",
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
