import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, run, WRITES } from "../shared/mcp";
import { publish } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_publish", {
		title: "Publish a hosted feature layer",
		description: "Create a hosted feature layer from ONE source: csv_text (with latitude_field+longitude_field, or address_fields = geocoding credits, confirm), geojson_text, url (a public https CSV/GeoJSON), or item_id (an uploaded CSV / GeoJSON / Shapefile / File Geodatabase item). Up to 5 MB of text. Returns the published item and its layer URLs.",
		inputSchema: z.object({
			title: z.string(),
			csv_text: z.string().optional(),
			geojson_text: z.string().optional(),
			url: z.string().optional(),
			item_id: z.string().optional(),
			folder: z.string().optional().describe("Created if missing; omit for root"),
			tags: z.array(z.string()).optional(),
			snippet: z.string().optional(),
			latitude_field: z.string().optional(),
			longitude_field: z.string().optional(),
			address_fields: z.record(z.string(), z.string()).optional().describe('e.g. {"Address":"ADDR","City":"CITY"}'),
			confirm,
		}),
		annotations: WRITES,
	}, async (args) => run(ctx.props, () => publish(ctx, args)));
}
