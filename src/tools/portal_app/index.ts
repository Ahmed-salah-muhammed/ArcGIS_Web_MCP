import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { app } from "./handler";
import { QUESTION_TYPES } from "../portal_survey123/draft";
import { CONDITION_OPS, DATE_UNITS } from "./filters";
import { APP_KINDS, COLUMNS, PERIODS, SELECTOR_PLACES, SELECTOR_TYPES, STACKS, STATISTICS, STORY_BLOCKS, STYLES, WIDGET_TYPES } from "./types";

const scalar = z.union([z.string(), z.number()]);
/** A filter condition: a value, a list, or {op, value, unit}. */
const condition = z.union([scalar, z.array(scalar), z.object({ op: z.enum(CONDITION_OPS), value: z.union([scalar, z.array(scalar)]).optional(),
	unit: z.enum(DATE_UNITS).optional() })]);
const conditions = z.record(z.string(), condition);
const storyMedia = z.object({ webmap_id: z.string().optional(), image: z.string().optional(), url: z.string().optional(),
	caption: z.string().max(500).optional() });

export const tool = defineTool({
	name: "portal_app",
	title: "Apps from your content",
	description: "Build apps from your maps and layers. FIRST call action=templates with the kind: it returns that kind's guide "
		+ "(every argument, widget and option create takes) and its templates. Then action=create (default) builds the app and "
		+ "returns its ArcGIS item and link. Kinds: instant (an Instant Apps template on webmap_id) | dashboard (widgets and "
		+ "selectors on a feature layer and/or a web map; automatic when widgets are omitted) | experience (Experience Builder: "
		+ "built from widgets on webmap_id, or from a template) | storymap (blocks, sections, or just a webmap_id) | survey (a "
		+ "Survey123 draft from questions or a layer's fields) | fieldmaps (forms for a web map's editable layers) | exb_developer "
		+ "(registers Experience Builder Developer Edition; returns the client ID and the steps) | exb_widget (a custom widget "
		+ "scaffold for Developer Edition, returned as files: nothing is written to ArcGIS; continue locally with the "
		+ "arcgis-exb-widget-dev skill).",
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
			target: z.string().optional(),
			layer: z.union([z.string(), z.number()]).optional(),
			field: z.string().optional(),
			value_field: z.string().optional(),
			statistic: z.enum(STATISTICS).optional(),
			fields: z.array(z.string()).optional(),
			title: z.string().optional(),
			text: z.string().optional(),
			url: z.string().optional(),
			filter: conditions.optional(),
			column: z.enum(COLUMNS).optional(),
			tab: z.string().max(40).optional(),
			color: z.string().optional(),
			period: z.enum(PERIODS).optional(),
			rotated: z.boolean().optional(),
			icon: z.string().max(8000).optional(),
			group_by: z.string().optional(),
			values: z.array(z.object({ label: z.string().max(40), field: z.string().optional(), statistic: z.enum(STATISTICS).optional(),
				color: z.string().optional() })).max(4).optional(),
			webmap_id: z.string().optional(),
			donut: z.boolean().optional(),
			filters: z.array(z.object({ label: z.string().max(60), where: conditions.optional(), ask: z.string().optional() })).max(12).optional(),
			compare_to: conditions.optional(),
			compare_text: z.string().max(120).optional(),
			higher_is_better: z.boolean().optional(),
			min: z.number().optional(),
			max: z.number().optional(),
			split_by: z.string().optional(),
			stacked: z.enum(STACKS).optional(),
			labels: z.boolean().optional(),
			lines: z.array(z.object({ value: z.number(), to: z.number().optional(), label: z.string().max(60).optional(),
				color: z.string().optional() })).max(6).optional(),
			highlight: z.array(z.object({ field: z.string(), when: condition, color: z.string().optional(), background: z.string().optional() }))
				.max(8).optional(),
			sort_by: z.string().optional(),
		})).max(20).optional(),
		selectors: z.array(z.object({
			type: z.enum(SELECTOR_TYPES),
			field: z.string(),
			target: z.string().optional(),
			layer: z.union([z.string(), z.number()]).optional(),
			title: z.string().max(80).optional(),
			multiple: z.boolean().optional(),
			display: z.enum(["dropdown", "buttons", "calendar"]).optional(),
			presets: z.array(z.object({ label: z.string().max(40), last: z.number().int().min(1), unit: z.enum(DATE_UNITS) })).max(8).optional(),
			operator: z.enum([">=", "<=", "="]).optional(),
			min: z.number().optional(),
			max: z.number().optional(),
			step: z.number().optional(),
		})).max(8).optional(),
		selectors_at: z.enum(SELECTOR_PLACES).optional(),
		sidebar_title: z.string().max(200).optional(),
		links: z.array(z.object({ from: z.string(), to: z.string() })).max(10).optional(),
		menu_links: z.array(z.object({ label: z.string().max(60), url: z.string() })).max(8).optional(),
		logo_link: z.string().optional(),
		style: z.enum(STYLES).optional(),
		interactive: z.boolean().optional(),
		extent_filter: z.boolean().optional(),
		subtitle: z.string().max(200).optional(),
		logo_url: z.string().optional(),
		sections: z.array(z.object({ heading: z.string().optional(), text: z.string().optional(), webmap_id: z.string().optional() }))
			.max(30).optional(),
		blocks: z.array(z.object({
			type: z.enum(STORY_BLOCKS),
			text: z.string().max(5000).optional(),
			level: z.number().int().min(2).max(4).optional(),
			items: z.array(z.string().max(500)).max(30).optional(),
			url: z.string().optional(),
			webmap_id: z.string().optional(),
			caption: z.string().max(500).optional(),
			alt: z.string().max(300).optional(),
			size: z.enum(["small", "standard", "wide", "full", "float"]).optional(),
			link: z.string().optional(),
			display: z.enum(["card", "inline"]).optional(),
			value: z.string().max(40).optional(),
			left: storyMedia.optional(),
			right: storyMedia.optional(),
			style: z.enum(["docked", "floating", "slideshow", "waterfall", "timeline"]).optional(),
			slides: z.array(storyMedia.extend({ heading: z.string().max(200).optional(), text: z.string().max(3000).optional() })).max(20).optional(),
			events: z.array(z.object({ heading: z.string().max(200).optional(), text: z.string().max(2000).optional(), image: z.string().optional() }))
				.max(30).optional(),
		})).max(80).optional(),
		cover: z.object({ type: z.enum(["full", "sidebyside", "minimal"]).optional(), image: z.string().optional(), alt: z.string().optional(),
			date: z.enum(["first-published", "last-published", "current-date", "none"]).optional() }).optional(),
		navigation: z.boolean().optional(),
		theme: z.string().optional(),
		publish: z.boolean().optional(),
		fields: z.array(z.string()).optional(),
		form: z.object({
			groups: z.array(z.object({ label: z.string().max(100), fields: z.array(z.string()).min(1), collapsed: z.boolean().optional() }))
				.max(20).optional(),
			hints: z.record(z.string(), z.string().max(300)).optional(),
			required: z.array(z.string()).optional(),
			read_only: z.array(z.string()).optional(),
			show_when: z.record(z.string(), conditions).optional(),
			photos: z.union([z.boolean(), z.string().max(60)]).optional(),
		}).optional(),
		theme_color: z.string().optional(),
		header_color: z.string().optional(),
		redirect_uris: z.array(z.string()).optional(),
		custom_widget: z.object({ name: z.string().max(50), label: z.string().max(60).optional(), description: z.string().max(300).optional(),
			data: z.enum(["none", "layer", "map", "layer_and_map"]).optional(), author: z.string().max(80).optional() }).optional(),
		exb_version: z.string().optional(),
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
