import { ZodError } from "zod";
import { callTool, SOURCE_REPO } from "./tools";

export interface RestEnv {
  DB: D1Database;
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

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

/** Handle a `/v1/*` REST request; returns null if the path is not a REST route. */
export async function handleRest(request: Request, env: RestEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/v1/")) return null;

  const q = Object.fromEntries(url.searchParams) as Record<string, string>;

  if (path === "/v1/vtubers") return runTool(env, "search_vtubers", q);
  if (path === "/v1/rankings") return runTool(env, "list_rankings", q);
  if (path === "/v1/groups") return runTool(env, "list_groups", q);
  if (path === "/v1/events") return runTool(env, "list_events", q);
  if (path === "/v1/status") return runTool(env, "get_data_status", {});

  const history = path.match(/^\/v1\/vtubers\/([^/]+)\/history$/);
  if (history) return runTool(env, "get_vtuber_history", { ...q, id_or_name: decodeURIComponent(history[1]!) });

  const vtuber = path.match(/^\/v1\/vtubers\/([^/]+)$/);
  if (vtuber) return runTool(env, "get_vtuber", { id_or_name: decodeURIComponent(vtuber[1]!) });

  const group = path.match(/^\/v1\/groups\/([^/]+)$/);
  if (group) return runTool(env, "get_group", { name: decodeURIComponent(group[1]!) });

  return jsonResponse({ source: SOURCE_REPO, error: "not found" }, 404);
}

export { SOURCE_REPO, CORS, jsonResponse };
