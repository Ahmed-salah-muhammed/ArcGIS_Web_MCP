import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE } from "../shared/mcp";
import { EXPORT_FORMATS, exportItem, item, itemWrite, suggestMetadata } from "./handler";

export const tool = defineTool({
	name: "portal_item",
	title: "Item: read and manage",
	description: "One item by id: get (card, sharing level, tags, is_hosted/is_view, every layer/table of a service) | data (its JSON) | update (properties: title, snippet, description, tags...; and/or data JSON) | move (folder name/id; omit for root) | protect | unprotect | delete (confirm; refuses protected items; delete views before their source layer) | dependencies (what it uses / what uses it) | export (a feature layer to csv|geojson|shapefile|fgdb|excel|geopackage|kml as a new item, with a download link) | suggest_metadata (summary, description and tags inferred from its layers, fields and geometry; apply=true writes them).",
	schema: z.object({
		item_id: z.string().describe("32-character item id"),
		action: z.enum(["get", "data", "update", "move", "protect", "unprotect", "delete", "dependencies", "export",
			"suggest_metadata"]).optional().describe("Default get"),
		properties: z.record(z.string(), z.unknown()).optional().describe("For update"),
		data: z.unknown().optional().describe("For update: the item's JSON (e.g. a web map)"),
		folder: z.string().optional().describe("For move: folder name or id; omit for root"),
		permanent: z.boolean().optional().describe("For delete: skip the recycle bin"),
		max_chars: z.number().int().min(500).max(100000).optional().describe("For data; default 20000"),
		format: z.enum(Object.keys(EXPORT_FORMATS) as [string, ...string[]]).optional().describe("For export"),
		title: z.string().optional().describe("For export: title of the new item"),
		layers: z.array(z.number().int().min(0)).optional().describe("For export: layer ids to include; default all"),
		apply: z.boolean().optional().describe("For suggest_metadata: write the suggestion to the item"),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => {
		const action = args.action ?? "get";
		if (action === "get" || action === "data") return item(ctx, { ...args, action });
		if (action === "export") return exportItem(ctx, args);
		if (action === "suggest_metadata") return suggestMetadata(ctx, args);
		return itemWrite(ctx, { ...args, action });
	},
});
