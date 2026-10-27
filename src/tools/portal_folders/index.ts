import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, DESTRUCTIVE, run } from "../shared/mcp";
import { folders } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_folders", {
		title: "Folders",
		description: "Your folders: list | create (no-op if it exists) | delete (confirm; items inside are deleted too).",
		inputSchema: z.object({
			action: z.enum(["list", "create", "delete"]).optional().describe("Default list"),
			name: z.string().optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(ctx.props, () => folders(ctx, args)));
}
