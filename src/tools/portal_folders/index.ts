import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE } from "../shared/mcp";
import { folders } from "./handler";

export const tool = defineTool({
	name: "portal_folders",
	title: "Folders",
	description: "Your folders: list | create (no-op if it exists) | delete (confirm; items inside are deleted too).",
	schema: z.object({
		action: z.enum(["list", "create", "delete"]).optional().describe("Default list"),
		name: z.string().optional(),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => folders(ctx, args),
});
