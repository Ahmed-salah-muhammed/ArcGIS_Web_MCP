import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Ctx } from "../shared/context";
import { confirm, DESTRUCTIVE, layer, run, target } from "../shared/mcp";
import { schema } from "./handler";

export function register(server: McpServer, ctx: Ctx): void {
	server.registerTool("portal_layer_schema", {
		title: "Shape a hosted layer",
		description: 'Shape a HOSTED layer: add_field (fields=[{"name","type":TEXT|SHORT|LONG|BIGINT|DOUBLE|FLOAT|DATE|DATEONLY|GUID,"length","alias"}]; never on a view) | delete_field (field_names; confirm) | capabilities ("Query,Create,Update,Delete,Editing,Sync,Extract") | renderer (Esri JSON, or {"type":"unique","field"} / {"type":"class_breaks","field","classes"} / {"type":"simple","color":[r,g,b]} built from the data) | labels (label_field or Arcade label_expression) | create_view (view_name, view_where filter, view_fields; read-only).',
		inputSchema: z.object({
			target,
			action: z.enum(["add_field", "delete_field", "capabilities", "renderer", "labels", "create_view"]),
			layer,
			fields: z.array(z.object({ name: z.string(), type: z.string().optional(), length: z.number().int().optional(),
				alias: z.string().optional(), nullable: z.boolean().optional() })).optional(),
			field_names: z.array(z.string()).optional(),
			capabilities: z.string().optional(),
			renderer: z.record(z.string(), z.any()).optional(),
			label_field: z.string().optional(),
			label_expression: z.string().optional(),
			view_name: z.string().optional(),
			view_where: z.string().optional(),
			view_fields: z.array(z.string()).optional(),
			confirm,
		}),
		annotations: DESTRUCTIVE,
	}, async (args) => run(ctx.props, () => schema(ctx, args)));
}
