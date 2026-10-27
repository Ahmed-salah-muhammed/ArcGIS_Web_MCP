import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { webmap } from "./handler";

export const tool = defineTool({
	name: "portal_map",
	title: "Web maps",
	description: "Web maps: create (title + layers = item ids/layer URLs; basemap omitted = your org's default, or a gallery title/alias e.g. topo-vector, satellite, gray-vector; auto popups; renderer spec as in portal_layer_schema; definition_expression filter) | describe | add_layers | remove_layers | popup (layer, popup_fields, popup_title) | renderer | filter | basemap.",
	schema: z.object({
		action: z.enum(["create", "describe", "add_layers", "remove_layers", "popup", "renderer", "filter", "basemap"]).optional().describe("Default describe"),
		item_id: z.string().optional().describe("The web map (all actions but create)"),
		title: z.string().optional(),
		layers: z.array(z.union([z.string(), z.number()])).optional(),
		basemap: z.string().optional(),
		tags: z.array(z.string()).optional(),
		folder: z.string().optional(),
		snippet: z.string().optional(),
		popups: z.boolean().optional().describe("Default true"),
		renderer: z.record(z.string(), z.any()).optional(),
		layer: z.union([z.string(), z.number()]).optional().describe("Target layer: title, id, url or index"),
		popup_fields: z.array(z.string()).optional(),
		popup_title: z.string().optional(),
		definition_expression: z.string().optional(),
	}),
	annotations: WRITES,
	handle: (ctx, args) => webmap(ctx, args),
});
