import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE } from "../shared/mcp";
import { rest } from "./handler";

export const tool = defineTool({
	name: "portal_rest",
	title: "Raw ArcGIS REST",
	description: 'Raw REST with your sign-in, for anything the other tools do not cover: path relative to <portal>/sharing/rest/ (e.g. "portals/self", "content/users/<me>") or an absolute URL on your portal / its services. GET is free and cannot change anything; POST needs confirm unless read-only (query, search, generateRenderer...).',
	schema: z.object({
		path: z.string(),
		method: z.enum(["GET", "POST"]).optional().describe("Default GET"),
		params: z.record(z.string(), z.unknown()).optional(),
		max_chars: z.number().int().min(500).max(100000).optional(),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => rest(ctx, args),
});
