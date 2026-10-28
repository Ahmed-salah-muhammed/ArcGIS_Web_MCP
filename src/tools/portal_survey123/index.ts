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
		+ "label, choices, required, hint}], or target = a layer whose fields become the questions, or a default set. "
		+ "publish / xlsform also take (an XLSForm makes them): types time|barcode|signature|file|audio|geotrace (line layer)|geoshape "
		+ "(polygon layer)|rank|calculate|hidden; name (for ${name} in expressions), group (consecutive questions with one group are a "
		+ "group; pages=true puts each group on its own page), relevant, constraint + constraint_message, calculation, default, "
		+ "appearance, read_only, required_message, choice_filter (with choices [{value, label, filter}]).",
	schema: z.object({
		action: z.enum(["create", "publish", "xlsform", "info"]).optional().describe("Default create"),
		title: z.string().optional(),
		summary: z.string().optional(),
		questions: z.array(z.object({
			type: z.enum(QUESTION_TYPES),
			label: z.string(),
			choices: z.array(z.union([z.string(), z.object({ value: z.string(), label: z.string(), filter: z.string().optional() })])).optional(),
			required: z.boolean().optional(),
			hint: z.string().max(500).optional(),
			name: z.string().max(31).optional().describe("publish/xlsform: the name used as ${name} in expressions"),
			group: z.string().max(100).optional().describe("publish/xlsform: questions in a row with one group form a group"),
			relevant: z.string().optional().describe("publish/xlsform: show when, e.g. ${status} = 'damaged'"),
			constraint: z.string().optional().describe("publish/xlsform: valid when, e.g. . >= 0"),
			constraint_message: z.string().optional(),
			calculation: z.string().optional(),
			default: z.string().optional(),
			appearance: z.string().optional(),
			read_only: z.boolean().optional(),
			required_message: z.string().optional(),
			choice_filter: z.string().optional().describe("publish/xlsform: e.g. filter=${region}"),
		})).max(100).optional(),
		pages: z.boolean().optional().describe("publish/xlsform: each group on its own page"),
		target: z.string().optional().describe("A feature layer item id whose fields become the questions"),
		layer: z.union([z.string(), z.number()]).optional().describe("Layer of target (index or name)"),
		survey_id: z.string().optional().describe("info: the survey's Form item id"),
		folder: z.string().optional(),
		tags: z.array(z.string()).optional(),
	}),
	annotations: WRITES,
	handle: (ctx, args) => survey123(ctx, args as any),
});
