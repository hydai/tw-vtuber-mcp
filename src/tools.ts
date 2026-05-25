import { z } from "zod";
import {
  searchVTubers,
  getVTuber,
  getVTuberHistory,
  listRankings,
  listGroups,
  getGroup,
  listEvents,
} from "./db";

export const SOURCE_REPO = "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  run: (db: D1Database, rawArgs: unknown) => Promise<unknown>;
}

const region = z
  .string()
  .min(1)
  .max(16)
  .optional()
  .describe("Region/nationality filter (e.g. TW, HK, MY, JP). Omit for all regions.");

const searchSchema = z.object({
  query: z.string().optional().describe("Substring match on VTuber name (supports Chinese)."),
  region,
  activity: z.enum(["active", "graduate", "preparing"]).optional(),
  group: z.string().optional(),
  min_subscribers: z.coerce.number().int().nonnegative().optional(),
  max_subscribers: z.coerce.number().int().nonnegative().optional(),
  sort_by: z
    .enum(["subscribers", "views", "followers", "popularity", "growth_7d", "growth_30d", "debut_date"])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const getVtuberSchema = z.object({ id_or_name: z.string().min(1).describe("VTuber id (32-hex) or exact name.") });

const historySchema = z.object({
  id_or_name: z.string().min(1),
  from: z.string().optional().describe("Start date YYYY-MM-DD (inclusive)."),
  to: z.string().optional().describe("End date YYYY-MM-DD (inclusive)."),
  limit: z.coerce.number().int().min(1).max(3650).optional(),
});

const rankingSchema = z.object({
  type: z.enum(["top_subscribers", "top_views", "growing_7d", "growing_30d", "trending"]),
  region,
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const groupsSchema = z.object({ region });
const getGroupSchema = z.object({ name: z.string().min(1) });
const eventsSchema = z.object({
  type: z.enum(["debut", "anniversary", "graduate"]),
  window: z.enum(["recent", "upcoming"]).optional().describe("recent = last 7 days, upcoming = next 7 days."),
  region,
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function getDataStatus(db: D1Database): Promise<unknown> {
  const meta = await db
    .prepare("SELECT vtuber_data_update_time, statistic_update_time, ingested_at, last_status FROM ingest_meta WHERE k='singleton'")
    .first<{ vtuber_data_update_time: string | null; statistic_update_time: string | null; ingested_at: string | null; last_status: string | null }>();
  const c = await db.prepare("SELECT count(*) AS n FROM vtuber").first<{ n: number }>();
  return {
    source: SOURCE_REPO,
    vtuber_count: c?.n ?? 0,
    upstream_data_updated_at: meta?.vtuber_data_update_time ?? null,
    statistic_updated_at: meta?.statistic_update_time ?? null,
    last_ingest_at: meta?.ingested_at ?? null,
    last_ingest_status: meta?.last_status ?? null,
  };
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_vtubers",
    description:
      "Search and filter Taiwan VTubers by name, region, activity, group, and subscriber range; sort by subscribers/views/followers/popularity/growth/debut date.",
    inputSchema: searchSchema.shape,
    run: async (db, raw) => {
      const a = searchSchema.parse(raw ?? {});
      const results = await searchVTubers(db, {
        query: a.query,
        nationality: a.region,
        activity: a.activity,
        group: a.group,
        minSubs: a.min_subscribers,
        maxSubs: a.max_subscribers,
        sortBy: a.sort_by,
        order: a.order,
        limit: a.limit,
        offset: a.offset,
      });
      return { source: SOURCE_REPO, count: results.length, results };
    },
  },
  {
    name: "get_vtuber",
    description: "Get one VTuber's full current record by id (32-hex) or exact name.",
    inputSchema: getVtuberSchema.shape,
    run: async (db, raw) => {
      const a = getVtuberSchema.parse(raw ?? {});
      return { source: SOURCE_REPO, vtuber: await getVTuber(db, a.id_or_name) };
    },
  },
  {
    name: "get_vtuber_history",
    description:
      "Get a VTuber's daily history time-series (subscribers, total views, Twitch followers, popularity) — data not available upstream.",
    inputSchema: historySchema.shape,
    run: async (db, raw) => {
      const a = historySchema.parse(raw ?? {});
      const vt = await getVTuber(db, a.id_or_name);
      if (!vt) return { source: SOURCE_REPO, vtuber_id: null, history: [], note: "VTuber not found" };
      const history = await getVTuberHistory(db, vt.id, { from: a.from, to: a.to, limit: a.limit });
      return { source: SOURCE_REPO, vtuber_id: vt.id, name: vt.name, history };
    },
  },
  {
    name: "list_rankings",
    description:
      "Top VTubers by a metric: top_subscribers, top_views, growing_7d, growing_30d (view growth), or trending (popularity).",
    inputSchema: rankingSchema.shape,
    run: async (db, raw) => {
      const a = rankingSchema.parse(raw ?? {});
      const results = await listRankings(db, { type: a.type, nationality: a.region, limit: a.limit });
      return { source: SOURCE_REPO, type: a.type, count: results.length, results };
    },
  },
  {
    name: "list_groups",
    description: "List VTuber groups/agencies, most popular first.",
    inputSchema: groupsSchema.shape,
    run: async (db, raw) => {
      const a = groupsSchema.parse(raw ?? {});
      const groups = await listGroups(db, a.region);
      return { source: SOURCE_REPO, count: groups.length, groups };
    },
  },
  {
    name: "get_group",
    description: "Get one group with its members (most subscribed first).",
    inputSchema: getGroupSchema.shape,
    run: async (db, raw) => {
      const a = getGroupSchema.parse(raw ?? {});
      return { source: SOURCE_REPO, ...(await getGroup(db, a.name)) };
    },
  },
  {
    name: "list_events",
    description:
      "List debut / anniversary / graduate events within a recent (last 7d) or upcoming (next 7d) window.",
    inputSchema: eventsSchema.shape,
    run: async (db, raw) => {
      const a = eventsSchema.parse(raw ?? {});
      const results = await listEvents(db, { type: a.type, window: a.window, nationality: a.region, limit: a.limit });
      return { source: SOURCE_REPO, type: a.type, window: a.window ?? "upcoming", count: results.length, results };
    },
  },
  {
    name: "get_data_status",
    description: "Report data freshness: VTuber count, upstream update times, and last ingestion status.",
    inputSchema: {},
    run: async (db) => getDataStatus(db),
  },
];

export async function callTool(db: D1Database, name: string, rawArgs: unknown): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(db, rawArgs);
}
