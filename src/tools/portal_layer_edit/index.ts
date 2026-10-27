import { z } from "zod";
import { confirm, defineTool, DESTRUCTIVE, layer, target } from "../shared/mcp";
import { edit } from "./handler";

export const tool = defineTool({
	name: "portal_layer_edit",
	title: "Edit layer data",
	description: 'Change layer data: edit (adds/updates as attribute dicts or features - updates need the object id field; deletes = ids or where (confirm); batched, each result checked; dry_run previews a before/after diff; max 5000 edits) | calculate (where + expressions [{"field","value"} | {"field","sqlExpression"}]; confirm) | truncate (all rows of a hosted layer; confirm) | add_attachment (object_id, file_name, content_base64 or content_text, content_type; up to 10 MB) | delete_attachments (object_id, attachment_ids; confirm).',
	schema: z.object({
		target,
		action: z.enum(["edit", "calculate", "truncate", "add_attachment", "delete_attachments"]).optional().describe("Default edit"),
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
		object_id: z.number().int().optional().describe("For attachments: the feature"),
		file_name: z.string().optional(),
		content_base64: z.string().optional().describe("The file, base64 (data: URLs accepted)"),
		content_text: z.string().optional().describe("Or the file as plain text"),
		content_type: z.string().optional().describe("e.g. image/jpeg, application/pdf"),
		attachment_ids: z.array(z.number().int()).optional(),
		confirm,
	}),
	annotations: DESTRUCTIVE,
	handle: (ctx, args) => edit(ctx, args),
});
