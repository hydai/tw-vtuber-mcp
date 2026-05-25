import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { TOOLS } from "./tools";

/**
 * Public, authless MCP server (Streamable HTTP). Each session is its own
 * Durable Object; all queryable data lives in the shared D1 (`this.env.DB`),
 * never in the per-session DO storage.
 */
export class VTuberMCP extends McpAgent<Env, unknown, Record<string, never>> {
  server = new McpServer({ name: "tw-vtuber", version: "0.1.0" });

  async init(): Promise<void> {
    for (const tool of TOOLS) {
      this.server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args: unknown) => ({
          content: [{ type: "text" as const, text: JSON.stringify(await tool.run(this.env.DB, args)) }],
        }),
      );
    }
  }
}
