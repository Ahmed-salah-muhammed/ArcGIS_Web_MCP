import { z } from "zod";
import { defineTool, DESTRUCTIVE, type ToolSpec } from "../shared/mcp";
import { batch, MAX_CALLS } from "./handler";

/** portal_batch runs the other tools, so it is built from their definitions. */
export function batchTool(tools: Map<string, ToolSpec>) {
	return defineTool({
		name: "portal_batch",
		title: "Run several tools at once",
		description: `Run up to ${MAX_CALLS} portal_* calls in ONE request, in order: calls=[{"tool":"portal_publish","args":{...}},{"tool":"portal_layer_schema","args":{"target":"{{call0.data.published_item.id}}",...}}]. {{callN.path}} / {{prev.path}} reuse earlier results (path from the envelope: data.items.0.id). Each call is validated and confirmed as if called alone; a call answering confirm_required stops the batch with its preview (stop_on_error, default true). parallel=true runs independent calls at once (no placeholders).`,
		schema: z.object({
			calls: z.array(z.object({
				tool: z.string().describe("A portal_* tool name"),
				args: z.record(z.string(), z.unknown()).optional().describe("That tool's arguments; may contain {{callN.path}}"),
			})).min(1).max(MAX_CALLS),
			stop_on_error: z.boolean().optional().describe("Default true"),
			parallel: z.boolean().optional().describe("Independent calls only; default false"),
		}),
		annotations: DESTRUCTIVE,
		handle: (ctx, args) => batch(ctx, args, tools),
	});
}
