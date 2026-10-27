import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { READ_ONLY, run } from "../shared/mcp";
import { search } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_search", {
		title: "Search items",
		description: 'Search portal items (newest first): query syntax title:"Parcels" AND tags:roads; item_type exact ("Feature Service", "Web Map", "CSV", "Dashboard", ...); owner ("me" ok). Org-only on ArcGIS Online unless outside_org. Page with start/next_start. Titles are not unique - continue with item ids.',
		inputSchema: z.object({
			query: z.string().optional().describe("Search text / ArcGIS query syntax"),
			item_type: z.string().optional().describe('Exact item type, e.g. "Feature Service"'),
			owner: z.string().optional().describe('Owner username, or "me"'),
			tags: z.array(z.string()).optional(),
			max_items: z.number().int().min(1).max(100).optional().describe("Default 20"),
			start: z.number().int().min(1).optional().describe("1-based paging start (use next_start)"),
			sort_field: z.string().optional().describe("e.g. modified, title, numViews; default modified"),
			sort_order: z.enum(["asc", "desc"]).optional(),
			outside_org: z.boolean().optional().describe("Include public items from other orgs"),
		}),
		annotations: READ_ONLY,
	}, async (args) => run(ctx.props, () => search(ctx, args)));
}
