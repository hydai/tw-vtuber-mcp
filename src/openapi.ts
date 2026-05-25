// OpenAPI 3.0 description of the public REST API. Single source of truth —
// served live at GET /openapi.json. Keep in sync with src/rest.ts + src/tools.ts.

const SOURCE_REPO = "https://github.com/TaiwanVtuberData/TaiwanVTuberTrackingDataJson";

const region = {
  name: "region",
  in: "query",
  description: "Region/nationality filter (e.g. TW, HK, MY, JP). Omit for all regions.",
  required: false,
  schema: { type: "string" },
} as const;

const limit = {
  name: "limit",
  in: "query",
  required: false,
  schema: { type: "integer", minimum: 1, maximum: 100 },
} as const;

const envelope = (extra: Record<string, unknown>) => ({
  type: "object",
  properties: { source: { type: "string", example: SOURCE_REPO }, ...extra },
});

const jsonResponse = (schemaRef: string, description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: schemaRef } } },
});

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "TW VTuber Data API",
    version: "0.1.0",
    description:
      "Public REST API for Taiwan VTuber data on Cloudflare Workers, with search, rankings, " +
      "groups, events, and an accumulating daily history time-series. " +
      `All data originates from ${SOURCE_REPO} and is re-served with attribution. ` +
      "Public + anonymous; rate-limited to 120 requests/60s per IP. An MCP server exposing the " +
      "same data lives at /mcp.",
    license: { name: "MIT", url: "https://github.com/hydai/tw-vtuber-mcp/blob/master/LICENSE" },
  },
  externalDocs: { description: "Source & docs", url: "https://github.com/hydai/tw-vtuber-mcp" },
  servers: [{ url: "https://twvtuber.oshi.tw", description: "Live instance" }],
  paths: {
    "/v1/vtubers": {
      get: {
        operationId: "searchVtubers",
        summary: "Search / filter / sort VTubers",
        parameters: [
          { name: "query", in: "query", required: false, schema: { type: "string" }, description: "Name substring (supports CJK)." },
          region,
          { name: "activity", in: "query", required: false, schema: { type: "string", enum: ["active", "graduate", "preparing"] } },
          { name: "group", in: "query", required: false, schema: { type: "string" } },
          { name: "min_subscribers", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
          { name: "max_subscribers", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
          { name: "sort_by", in: "query", required: false, schema: { type: "string", enum: ["subscribers", "views", "followers", "popularity", "growth_7d", "growth_30d", "debut_date"] } },
          { name: "order", in: "query", required: false, schema: { type: "string", enum: ["asc", "desc"] } },
          limit,
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": jsonResponse("#/components/schemas/VTuberList", "Matching VTubers"),
          "400": jsonResponse("#/components/schemas/Error", "Invalid parameters"),
          "429": jsonResponse("#/components/schemas/Error", "Rate limited"),
        },
      },
    },
    "/v1/vtubers/{idOrName}": {
      get: {
        operationId: "getVtuber",
        summary: "Get one VTuber by id (32-hex) or exact name",
        parameters: [{ name: "idOrName", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("#/components/schemas/VTuberOne", "One VTuber (or null)") },
      },
    },
    "/v1/vtubers/{idOrName}/history": {
      get: {
        operationId: "getVtuberHistory",
        summary: "Daily history time-series for one VTuber",
        parameters: [
          { name: "idOrName", in: "path", required: true, schema: { type: "string" } },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date" } },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date" } },
        ],
        responses: { "200": jsonResponse("#/components/schemas/History", "Time-series, oldest first") },
      },
    },
    "/v1/rankings": {
      get: {
        operationId: "listRankings",
        summary: "Top VTubers by a metric",
        parameters: [
          { name: "type", in: "query", required: true, schema: { type: "string", enum: ["top_subscribers", "top_views", "growing_7d", "growing_30d", "trending"] } },
          region,
          limit,
        ],
        responses: {
          "200": jsonResponse("#/components/schemas/RankingList", "Ranked VTubers"),
          "400": jsonResponse("#/components/schemas/Error", "Missing/invalid type"),
        },
      },
    },
    "/v1/groups": {
      get: {
        operationId: "listGroups",
        summary: "List groups/agencies, most popular first",
        parameters: [region],
        responses: { "200": jsonResponse("#/components/schemas/GroupList", "Groups") },
      },
    },
    "/v1/groups/{name}": {
      get: {
        operationId: "getGroup",
        summary: "One group with its members",
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("#/components/schemas/GroupDetail", "Group + members") },
      },
    },
    "/v1/events": {
      get: {
        operationId: "listEvents",
        summary: "Debut / anniversary / graduate events",
        parameters: [
          { name: "type", in: "query", required: true, schema: { type: "string", enum: ["debut", "anniversary", "graduate"] } },
          { name: "window", in: "query", required: false, schema: { type: "string", enum: ["recent", "upcoming"] }, description: "recent = last 7 days, upcoming = next 7 days" },
          region,
        ],
        responses: {
          "200": jsonResponse("#/components/schemas/EventList", "Matching VTubers"),
          "400": jsonResponse("#/components/schemas/Error", "Missing/invalid type"),
        },
      },
    },
    "/v1/status": {
      get: {
        operationId: "getDataStatus",
        summary: "Data freshness and counts",
        responses: { "200": jsonResponse("#/components/schemas/Status", "Status") },
      },
    },
  },
  components: {
    schemas: {
      VTuber: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", description: "32-hex GUID" },
          name: { type: "string" },
          nationality: { type: "string", nullable: true },
          activity: { type: "string", enum: ["active", "graduate", "preparing"], nullable: true },
          group_name: { type: "string", nullable: true },
          img_url: { type: "string", nullable: true },
          debut_date: { type: "string", format: "date", nullable: true },
          graduate_date: { type: "string", format: "date", nullable: true },
          youtube_id: { type: "string", nullable: true },
          youtube_subs: { type: "integer", nullable: true, description: "null when hidden" },
          youtube_views: { type: "integer", nullable: true },
          view_growth_7d: { type: "integer", nullable: true },
          view_growth_30d: { type: "integer", nullable: true },
          twitch_id: { type: "string", nullable: true },
          twitch_followers: { type: "integer", nullable: true },
          popularity: { type: "integer", nullable: true },
          popular_video_type: { type: "string", nullable: true },
          popular_video_id: { type: "string", nullable: true },
          updated_at: { type: "string" },
        },
      },
      HistoryPoint: {
        type: "object",
        required: ["vtuber_id", "date"],
        properties: {
          vtuber_id: { type: "string" },
          date: { type: "string", format: "date" },
          youtube_subs: { type: "integer", nullable: true },
          youtube_views: { type: "integer", nullable: true },
          twitch_followers: { type: "integer", nullable: true },
          popularity: { type: "integer", nullable: true },
          group_name: { type: "string", nullable: true },
          activity: { type: "string", nullable: true },
        },
      },
      Group: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          nationality: { type: "string", nullable: true },
          popularity: { type: "integer", nullable: true },
          livestream_popularity: { type: "integer", nullable: true },
          video_popularity: { type: "integer", nullable: true },
          updated_at: { type: "string", nullable: true },
        },
      },
      VTuberList: envelope({ count: { type: "integer" }, results: { type: "array", items: { $ref: "#/components/schemas/VTuber" } } }),
      RankingList: envelope({ type: { type: "string" }, count: { type: "integer" }, results: { type: "array", items: { $ref: "#/components/schemas/VTuber" } } }),
      EventList: envelope({ type: { type: "string" }, window: { type: "string" }, count: { type: "integer" }, results: { type: "array", items: { $ref: "#/components/schemas/VTuber" } } }),
      VTuberOne: envelope({ vtuber: { allOf: [{ $ref: "#/components/schemas/VTuber" }], nullable: true } }),
      History: envelope({ vtuber_id: { type: "string", nullable: true }, name: { type: "string" }, history: { type: "array", items: { $ref: "#/components/schemas/HistoryPoint" } } }),
      GroupList: envelope({ count: { type: "integer" }, groups: { type: "array", items: { $ref: "#/components/schemas/Group" } } }),
      GroupDetail: envelope({ group: { allOf: [{ $ref: "#/components/schemas/Group" }], nullable: true }, members: { type: "array", items: { $ref: "#/components/schemas/VTuber" } } }),
      Status: envelope({
        vtuber_count: { type: "integer" },
        upstream_data_updated_at: { type: "string", nullable: true },
        statistic_updated_at: { type: "string", nullable: true },
        last_ingest_at: { type: "string", nullable: true },
        last_ingest_status: { type: "string", nullable: true },
      }),
      Error: envelope({ error: { type: "string" } }),
    },
  },
} as const;
