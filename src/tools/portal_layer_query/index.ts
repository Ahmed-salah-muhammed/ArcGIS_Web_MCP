import { z } from "zod";
import { defineTool, layer, READ_ONLY, target } from "../shared/mcp";
import { DISTANCE_UNITS, layerQuery, MAX_ROWS, SPATIAL_RELS } from "./handler";

export const tool = defineTool({
	name: "portal_layer_query",
	title: "Query a feature layer",
	description: 'Read a feature layer or table: describe (fields + domains, capabilities, count, view filter, relationships) | query (paged rows: limit <= 1000, offset/next_offset; dates as ISO UTC; geometry only if return_geometry) | count | stats (["sum:POP","avg:INCOME"], group_by) | attachments (object_ids or where: names, types, sizes, URLs) | related (object_ids + relationship_id or name: the related records). query/count/stats filter by place too: geometry = [lon, lat] point, [xmin, ymin, xmax, ymax] box or Esri geometry JSON (WGS84 unless geometry_sr), spatial_rel, and distance + units for "within N km of".',
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
		geometry: z.union([z.array(z.number()).min(2).max(4), z.record(z.string(), z.unknown())]).optional()
			.describe("Spatial filter: [x, y] point, [xmin, ymin, xmax, ymax] box, or Esri geometry JSON"),
		geometry_sr: z.number().int().optional().describe("WKID of geometry; default 4326 (longitude/latitude)"),
		spatial_rel: z.enum(Object.keys(SPATIAL_RELS) as [keyof typeof SPATIAL_RELS, ...(keyof typeof SPATIAL_RELS)[]]).optional()
			.describe("Default intersects"),
		distance: z.number().positive().optional().describe("Features within this distance of geometry"),
		units: z.enum(Object.keys(DISTANCE_UNITS) as [keyof typeof DISTANCE_UNITS, ...(keyof typeof DISTANCE_UNITS)[]]).optional()
			.describe("For distance; default meters"),
		out_sr: z.number().int().optional().describe("WKID for returned geometry, e.g. 4326"),
	}),
	annotations: READ_ONLY,
	handle: (ctx, args) => layerQuery(ctx, args),
});
