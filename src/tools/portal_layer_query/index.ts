import { z } from "zod";
import { defineTool, layer, READ_ONLY, target } from "../shared/mcp";
import { layerQuery, MAX_ROWS } from "./handler";

export const tool = defineTool({
	name: "portal_layer_query",
	title: "Query a feature layer",
	description: 'Read a feature layer or table: describe (fields + domains, capabilities, count, view filter, relationships) | query (paged rows: limit <= 1000, offset/next_offset; dates as ISO UTC; geometry only if return_geometry) | count | stats (["sum:POP","avg:INCOME"], group_by) | attachments (object_ids or where: names, types, sizes, URLs) | related (object_ids + relationship_id or name: the related records).',
	schema: z.object({
		target,
		action: z.enum(["describe", "query", "count", "stats", "attachments", "related"]).optional().describe("Default query"),
		layer,
		where: z.string().optional().describe("SQL where clause; default 1=1"),
		fields: z.array(z.string()).optional().describe("Fields to return; default all"),
		limit: z.number().int().min(1).max(MAX_ROWS).optional().describe("Default 50"),
		offset: z.number().int().min(0).optional(),
		order_by: z.string().optional().describe("e.g. POP DESC"),
		return_geometry: z.boolean().optional(),
		stats: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional()
			.describe('kind:field shorthand ("sum:POP") or raw outStatistics objects'),
		group_by: z.string().optional().describe("Field(s) to group stats by"),
		object_ids: z.array(z.number().int()).optional().describe("For attachments / related"),
		relationship_id: z.union([z.number().int(), z.string()]).optional().describe("For related: id or name; default the first"),
	}),
	annotations: READ_ONLY,
	handle: (ctx, args) => layerQuery(ctx, args),
});
