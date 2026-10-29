import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE } from "../shared/mcp";
import { rest } from "./handler";

export const tool = defineTool({
	name: "portal_rest",
	title: "Raw ArcGIS REST",
	description: 'Raw REST with your sign-in, for anything the other tools do not cover: path relative to <portal>/sharing/rest/ (e.g. "portals/self", "content/users/<me>") or an absolute URL on your portal / its services. GET is free and cannot change anything (a file that is not JSON comes back as text); POST needs confirm unless read-only (query, search, generateRenderer...). file sends a multipart file with a POST, e.g. an item resource (updateResources with params {resourcesPrefix, fileName}): ArcGIS sanitizes a resource sent as text, a file it keeps.',
	schema: z.object({
		path: z.string(),
		method: z.enum(["GET", "POST"]).optional().describe("Default GET"),
		params: z.record(z.string(), z.unknown()).optional(),
		file: z.object({
			name: z.string().describe("File name, e.g. config.json"),
			content: z.unknown().describe("The file's text; an object is sent as JSON"),
			type: z.string().optional().describe("Media type; default from the name"),
			field: z.string().optional().describe("Form field; default file"),
		}).optional().describe("POST only: a file sent as multipart"),
		max_chars: z.number().int().min(500).max(100000).optional(),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => rest(ctx, args),
});
