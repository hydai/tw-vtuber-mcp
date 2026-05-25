import { ZodError } from "zod";
import { callTool, SOURCE_REPO } from "./tools";

export interface RestEnv {
  DB: D1Database;
  DATA_CDN_URL: string;
}

export interface LivestreamParams {
  region?: string;
  debut?: boolean;
  noTitle?: boolean;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const LIVESTREAM_REGIONS = new Set(["all", "TW", "HK", "MY"]);

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

/** Run a shared tool, mapping zod validation failures to HTTP 400. */
async function runTool(env: RestEnv, name: string, args: Record<string, unknown>): Promise<Response> {
  try {
    const result = await callTool(env.DB, name, args);
    return jsonResponse(result, 200, { "Cache-Control": "public, max-age=300" });
  } catch (e) {
    if (e instanceof ZodError) {
      return jsonResponse({ source: SOURCE_REPO, error: "invalid parameters", issues: e.issues }, 400);
    }
    return jsonResponse({ source: SOURCE_REPO, error: "internal error" }, 500);
  }
}

/** Build the upstream CDN URL for the (real-time, pass-through) livestreams file. */
export function buildLivestreamUpstreamUrl(env: { DATA_CDN_URL: string }, params: LivestreamParams): string {
  const region = params.region && LIVESTREAM_REGIONS.has(params.region) ? params.region : "all";
  const modifier = `${params.debut ? "debut" : "all"}${params.noTitle ? "-no-title" : ""}`;
  return `${env.DATA_CDN_URL}@master/api/v2/${region}/livestreams/${modifier}.json`;
}

/** Real-time livestreams: fetch upstream, short-cache at the edge (5 min). */
async function handleLivestreams(request: Request, env: RestEnv, ctx: ExecutionContext, q: Record<string, string>): Promise<Response> {
  const upstreamUrl = buildLivestreamUpstreamUrl(env, {
    region: q.region,
    debut: q.debut === "true",
    noTitle: q.no_title === "true",
  });

  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: { "User-Agent": "tw-vtuber-mcp (+https://github.com/TaiwanVtuberData)" } });
  } catch {
    return jsonResponse({ source: SOURCE_REPO, error: "upstream fetch failed", livestreams: [] }, 502);
  }
  if (!upstream.ok) {
    return jsonResponse({ source: SOURCE_REPO, error: `upstream ${upstream.status}`, livestreams: [] }, 502);
  }

  const data = (await upstream.json()) as Record<string, unknown>;
  const resp = jsonResponse({ source: SOURCE_REPO, ...data }, 200, { "Cache-Control": "public, max-age=300" });
  ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

/** Handle a `/v1/*` REST request; returns null if the path is not a REST route. */
export async function handleRest(request: Request, env: RestEnv, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/v1/")) return null;

  const q = Object.fromEntries(url.searchParams) as Record<string, string>;

  if (path === "/v1/vtubers") return runTool(env, "search_vtubers", q);
  if (path === "/v1/rankings") return runTool(env, "list_rankings", q);
  if (path === "/v1/groups") return runTool(env, "list_groups", q);
  if (path === "/v1/events") return runTool(env, "list_events", q);
  if (path === "/v1/status") return runTool(env, "get_data_status", {});
  if (path === "/v1/livestreams") return handleLivestreams(request, env, ctx, q);

  const history = path.match(/^\/v1\/vtubers\/([^/]+)\/history$/);
  if (history) return runTool(env, "get_vtuber_history", { ...q, id_or_name: decodeURIComponent(history[1]!) });

  const vtuber = path.match(/^\/v1\/vtubers\/([^/]+)$/);
  if (vtuber) return runTool(env, "get_vtuber", { id_or_name: decodeURIComponent(vtuber[1]!) });

  const group = path.match(/^\/v1\/groups\/([^/]+)$/);
  if (group) return runTool(env, "get_group", { name: decodeURIComponent(group[1]!) });

  return jsonResponse({ source: SOURCE_REPO, error: "not found" }, 404);
}

export { SOURCE_REPO, CORS, jsonResponse };
