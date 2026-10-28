import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { app } from "./handler";
import { QUESTION_TYPES } from "../portal_survey123/draft";
import { APP_KINDS, STATISTICS, WIDGET_TYPES } from "./types";

export const tool = defineTool({
	name: "portal_app",
	title: "Apps from your content",
	description: "Build apps from your maps and layers. action=templates lists a kind's templates; action=create (default) builds one: "
		+ "instant (webmap_id + template, default basic; options = app settings) | "
		+ "dashboard (target = feature layer item id and/or webmap_id; widgets = [{type: map|indicator|pie|bar|line|list|table|details|legend|text, "
		+ "field, value_field, statistic, fields, title, text}], or omitted for an automatic one; theme light|dark) | "
		+ "experience (Experience Builder: template name, webmap_id bound to its maps; publish default true) | "
		+ "storymap (sections = [{heading, text, webmap_id}] or webmap_id; theme summit|obsidian|ridgeline|mesa|tidal|slate; publish default true) | "
		+ "survey (Survey123 draft that opens in the web designer, where Publish creates its layer; questions = [{type: "
		+ "text|textarea|number|integer|date|datetime|single|dropdown|multi|email|image|note|geopoint, label, choices, required}], "
		+ "or target = a layer whose fields become the questions, or a default set) | "
		+ "fieldmaps (webmap_id: forms for its editable layers from their fields, fields = which, options.offline, options.overwrite_forms) | "
		+ "exb_developer (registers Experience Builder Developer Edition; returns the client ID and the steps). "
		+ "Returns the new item and the link to open it.",
	schema: z.object({
		action: z.enum(["templates", "create"]).optional().describe("Default create"),
		kind: z.enum(APP_KINDS),
		title: z.string().optional(),
		summary: z.string().optional(),
		tags: z.array(z.string()).optional(),
		folder: z.string().optional().describe("Folder title or id (created if missing)"),
		webmap_id: z.string().optional().describe("The web map the app shows"),
		target: z.string().optional().describe("dashboard / survey: a feature layer item id"),
		layer: z.union([z.string(), z.number()]).optional().describe("Layer of target (index/name) or of the web map (title/id/index)"),
		template: z.string().optional().describe("instant / experience template name (action=templates lists them)"),
		options: z.record(z.string(), z.any()).optional(),
		widgets: z.array(z.object({
			type: z.enum(WIDGET_TYPES),
			field: z.string().optional(),
			value_field: z.string().optional(),
			statistic: z.enum(STATISTICS).optional(),
			fields: z.array(z.string()).optional(),
			title: z.string().optional(),
			text: z.string().optional(),
		})).max(20).optional(),
		sections: z.array(z.object({ heading: z.string().optional(), text: z.string().optional(), webmap_id: z.string().optional() }))
			.max(30).optional(),
		theme: z.string().optional(),
		publish: z.boolean().optional(),
		fields: z.array(z.string()).optional().describe("fieldmaps: the fields in the form, in order"),
		redirect_uris: z.array(z.string()).optional().describe("exb_developer: default https://localhost:3001/"),
		questions: z.array(z.object({
			type: z.enum(QUESTION_TYPES),
			label: z.string(),
			choices: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])).optional(),
			required: z.boolean().optional(),
		})).max(60).optional(),
	}),
	annotations: WRITES,
	handle: (ctx, args) => app(ctx, args),
});
