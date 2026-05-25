/**
 * Worker entry point.
 *
 * - `fetch`: serves `/mcp` (MCP) and `/v1/*` (REST). Wired up in later phases.
 * - `scheduled`: daily ingestion from the upstream data source. Wired up in Phase 4.
 *
 * Right now this is a minimal placeholder so the project is deployable while we
 * build each layer (parse -> db -> mcp -> rest) incrementally.
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

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Daily ingestion is wired in Phase 4.
  },
} satisfies ExportedHandler<Env>;
