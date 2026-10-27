import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, DESTRUCTIVE, run } from "../shared/mcp";
import { rest } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_rest", {
		title: "Raw ArcGIS REST",
		description: 'Raw REST with your sign-in, for anything the other tools do not cover: path relative to <portal>/sharing/rest/ (e.g. "portals/self", "content/users/<me>") or an absolute URL on your portal / its services. GET is free and cannot change anything; POST needs confirm unless read-only (query, search, generateRenderer...).',
		inputSchema: z.object({
			path: z.string(),
			method: z.enum(["GET", "POST"]).optional().describe("Default GET"),
			params: z.record(z.string(), z.unknown()).optional(),
			max_chars: z.number().int().min(500).max(100000).optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(ctx.props, () => rest(ctx, args)));
}
