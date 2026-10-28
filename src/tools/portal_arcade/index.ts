import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { arcade, FORM_ROLES } from "./handler";
import { CONTEXTS } from "./library";

export const tool = defineTool({
	name: "portal_arcade",
	title: "Arcade expressions",
	description: "Arcade, ArcGIS's expression language: templates (ready-made per context; values fill {FIELD} placeholders) | "
		+ "check (expression + context popup|label|form|style|dashboard; with target or webmap_id + layer its fields are checked too) | "
		+ "popup (webmap_id + layer + expression + title: a computed popup field) | label (webmap_id + layer + expression) | "
		+ "form (Field Maps: webmap_id + layer + field + role calculated|visible|required|editable + expression). "
		+ "Saving checks the expression first and saves nothing if it has errors.",
	schema: z.object({
		action: z.enum(["templates", "check", "popup", "label", "form"]).optional().describe("Default check"),
		context: z.enum(CONTEXTS).optional(),
		expression: z.string().max(20000).optional(),
		values: z.record(z.string(), z.string()).optional().describe("templates: placeholder values"),
		webmap_id: z.string().optional(),
		target: z.string().optional().describe("check: a feature layer item id or URL"),
		layer: z.union([z.string(), z.number()]).optional().describe("The map layer (title, id or index) or the layer of target"),
		title: z.string().optional(),
		field: z.string().optional().describe("form: the field the expression is for"),
		role: z.enum(Object.keys(FORM_ROLES) as [keyof typeof FORM_ROLES, ...(keyof typeof FORM_ROLES)[]]).optional(),
		return_type: z.enum(["string", "number", "boolean", "date"]).optional(),
	}),
	annotations: WRITES,
	handle: (ctx, args) => arcade(ctx, args),
});
