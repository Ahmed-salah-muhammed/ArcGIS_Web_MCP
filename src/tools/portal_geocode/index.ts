import { z } from "zod";
import { defineTool, READ_ONLY } from "../shared/mcp";
import { geocode } from "./handler";

const lonLat = z.array(z.number()).length(2);

export const tool = defineTool({
	name: "portal_geocode",
	title: "Find places",
	description: "Your org's geocoder: find (address -> places with [lon, lat] and a match score; country = ISO code, near = [lon, lat] to prefer places close to it) | reverse (location [lon, lat] -> its address). For looking up only: free, nothing saved. To geocode a whole table into a layer use portal_publish with address_fields (spends credits).",
	schema: z.object({
		action: z.enum(["find", "reverse"]).optional().describe("Default find"),
		address: z.string().max(500).optional().describe("find: e.g. \"Tahrir Square, Cairo\""),
		location: lonLat.optional().describe("reverse: [longitude, latitude]"),
		near: lonLat.optional().describe("find: [longitude, latitude] to prefer nearby places"),
		country: z.string().optional().describe("find: ISO country code(s), e.g. EGY or EG"),
		max_results: z.number().int().min(1).max(20).optional().describe("find: default 5"),
	}),
	annotations: READ_ONLY,
	handle: (ctx, args) => geocode(ctx, args),
});
