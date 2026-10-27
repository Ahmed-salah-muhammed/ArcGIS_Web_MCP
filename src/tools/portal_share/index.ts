import { z } from "zod";
import { confirm, defineTool, WRITES } from "../shared/mcp";
import { share } from "./handler";

export const tool = defineTool({
	name: "portal_share",
	title: "Share items",
	description: "Share items: level private | org | everyone (everyone = public, needs confirm), add_groups / remove_groups (ids or exact titles; ambiguous titles are refused). Returns before/after per item.",
	schema: z.object({
		item_ids: z.array(z.string()).min(1),
		level: z.enum(["private", "org", "everyone"]).optional(),
		add_groups: z.array(z.string()).optional(),
		remove_groups: z.array(z.string()).optional(),
		confirm,
	}),
	annotations: WRITES,
	handle: (ctx, args) => share(ctx, args),
});
