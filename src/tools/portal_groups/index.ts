import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE } from "../shared/mcp";
import { groups, MAX_USERS } from "./handler";

export const tool = defineTool({
	name: "portal_groups",
	title: "Groups",
	description: "Groups (group = id or exact title): search | get (members and items) | create (title, access private|org|public - public needs confirm) | update | delete (confirm; items stay) | add_users (users = usernames in your org, as_managers) | invite_users (they accept it) | remove_users (confirm).",
	schema: z.object({
		action: z.enum(["search", "get", "create", "update", "delete", "add_users", "invite_users", "remove_users"]).optional()
			.describe("Default search"),
		users: z.array(z.string()).max(MAX_USERS).optional().describe("add_users / invite_users / remove_users: usernames"),
		as_managers: z.boolean().optional().describe("add_users / invite_users: as group managers"),
		group: z.string().optional(),
		query: z.string().optional(),
		title: z.string().optional(),
		tags: z.array(z.string()).optional(),
		description: z.string().optional(),
		access: z.enum(["private", "org", "public"]).optional(),
		is_invitation_only: z.boolean().optional(),
		max_groups: z.number().int().min(1).max(100).optional(),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => groups(ctx, args),
});
