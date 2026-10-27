import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, DESTRUCTIVE, run } from "../shared/mcp";
import { item, itemWrite } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_item", {
		title: "Item: read and manage",
		description: "One item by id: get (card, sharing level, tags, is_hosted/is_view, every layer/table of a service) | data (its JSON) | update (properties: title, snippet, description, tags...; and/or data JSON) | move (folder name/id; omit for root) | protect | unprotect | delete (confirm; refuses protected items; delete views before their source layer) | dependencies (what it uses / what uses it).",
		inputSchema: z.object({
			item_id: z.string().describe("32-character item id"),
			action: z.enum(["get", "data", "update", "move", "protect", "unprotect", "delete", "dependencies"]).optional().describe("Default get"),
			properties: z.record(z.string(), z.unknown()).optional().describe("For update"),
			data: z.unknown().optional().describe("For update: the item's JSON (e.g. a web map)"),
			folder: z.string().optional().describe("For move: folder name or id; omit for root"),
			permanent: z.boolean().optional().describe("For delete: skip the recycle bin"),
			max_chars: z.number().int().min(500).max(100000).optional().describe("For data; default 20000"),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(ctx.props, () => {
		const action = args.action ?? "get";
		if (action === "get" || action === "data") return item(ctx, { ...args, action });
		return itemWrite(ctx, { ...args, action });
	}));
}
