import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { QUESTION_TYPES } from "./draft";
import { survey123 } from "./handler";

export const tool = defineTool({
	name: "portal_survey123",
	title: "Survey123",
	description: "Survey123 surveys, in the browser or with Survey123 Connect. "
		+ "create (default): a draft that opens in the Survey123 web designer (Publish there adds the layer) | "
		+ "publish: a published survey ready to fill in, made from an XLSForm the way Survey123 Connect publishes (form + layer + form view) | "
		+ "xlsform: an XLSForm Excel file for Survey123 Connect, checked by Survey123's converter and saved in your content to download "
		+ "(never press ArcGIS's Publish on it: that makes a table) | "
		+ "info (survey_id): status, questions, layer and records, and the links: open in browser, open in the Survey123 app, "
		+ "manage in the Survey123 website, edit in the web designer, edit in Survey123 Connect. "
		+ "Questions for create/publish/xlsform: questions = [{type: text|textarea|number|integer|date|datetime|single|dropdown|multi|email|image|note|geopoint, "
		+ "label, choices, required}], or target = a layer whose fields become the questions, or a default set.",
	schema: z.object({
		action: z.enum(["create", "publish", "xlsform", "info"]).optional().describe("Default create"),
		title: z.string().optional(),
		summary: z.string().optional(),
		questions: z.array(z.object({
			type: z.enum(QUESTION_TYPES),
			label: z.string(),
			choices: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string() })])).optional(),
			required: z.boolean().optional(),
		})).max(60).optional(),
		target: z.string().optional().describe("A feature layer item id whose fields become the questions"),
		layer: z.union([z.string(), z.number()]).optional().describe("Layer of target (index or name)"),
		survey_id: z.string().optional().describe("info: the survey's Form item id"),
		folder: z.string().optional(),
		tags: z.array(z.string()).optional(),
	}),
	annotations: WRITES,
	handle: (ctx, args) => survey123(ctx, args as any),
});
