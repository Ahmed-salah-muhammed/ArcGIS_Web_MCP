import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, DESTRUCTIVE, layer, run, target } from "../shared/mcp";
import { edit } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_layer_edit", {
		title: "Edit layer data",
		description: 'Change layer data: edit (adds/updates as attribute dicts or features - updates need the object id field; deletes = ids or where (confirm); batched, each result checked; dry_run previews a before/after diff; max 5000 edits) | calculate (where + expressions [{"field","value"} | {"field","sqlExpression"}]; confirm) | truncate (all rows of a hosted layer; confirm).',
		inputSchema: z.object({
			target,
			action: z.enum(["edit", "calculate", "truncate"]).optional().describe("Default edit"),
			layer,
			adds: z.array(z.unknown()).optional(),
			updates: z.array(z.unknown()).optional(),
			deletes: z.array(z.union([z.number(), z.string()])).optional().describe("Object ids to delete"),
			where: z.string().optional().describe("calculate: rows to change; edit: delete what matches"),
			expressions: z.union([z.array(z.record(z.string(), z.unknown())), z.record(z.string(), z.unknown())]).optional(),
			use_global_ids: z.boolean().optional(),
			rollback_on_failure: z.boolean().optional(),
			batch_size: z.number().int().min(1).max(2000).optional().describe("Default 500"),
			dry_run: z.boolean().optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(ctx.props, () => edit(ctx, args)));
}
