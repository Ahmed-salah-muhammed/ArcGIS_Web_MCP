import { z } from "zod";
import { defineTool, WRITES } from "../shared/mcp";
import { app } from "./handler";
import { QUESTION_TYPES } from "../portal_survey123/draft";
import { CONDITION_OPS, DATE_UNITS } from "./filters";
import { APP_KINDS, COLUMNS, ICONS, PERIODS, SELECTOR_PLACES, SELECTOR_TYPES, STACKS, STATISTICS, STORY_BLOCKS, STYLES, WIDGET_TYPES } from "./types";

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
	description: "Build apps from your maps and layers. action=templates lists a kind's templates; action=create (default) builds one: "
		+ "instant (webmap_id + template, default basic; options = the template's settings, checked: action=templates with template "
		+ "lists them; theme light|dark) | "
		+ "dashboard (target = feature layer item id and/or webmap_id; widgets = [{type: map|indicator|gauge|pie|bar|line|list|table|details|"
		+ "legend|text|embed, field, value_field, statistic, fields, title, text, url (https page or image), filter {FIELD: value | [values] | "
		+ "{op: =|!=|>|>=|<=|in|not_in|not_null|last|before_last|this_year|last_year, value, unit hour|day|month|year}}, column left|center|right, "
		+ "tab (same column + tab = one tabbed panel), color #rrggbb, period day|month|year for bar/line on a date field, rotated (bar/line "
		+ "down the side), icon (indicator: person|people|billboard|screen|check|pin|chart|alert|building or an <svg>), group_by + values "
		+ "(list: one row per value of a field with totals [{label, field, statistic, color}]), webmap_id (map: a second map, e.g. a "
		+ "heatmap, moving with the main one), compare_to {filter} + higher_is_better + compare_text (indicator vs a reference), min/max "
		+ "(gauge), split_by + stacked side|stacked|percent (bar/line series per value), labels, lines [{value, to, label, color}] "
		+ "(target lines/bands), highlight [{field, when, color, background}] (table cell / list row colours), sort_by \"FIELD desc\"}], "
		+ "or omitted for an automatic one; selectors [{type: category|date|number, field, title, multiple, display dropdown|buttons|"
		+ "calendar, presets [{label, last, unit}], operator >=|<=|=, min, max, step}] filter everything, selectors_at header|sidebar, "
		+ "sidebar_title; menu_links [{label, url}], logo_link; several layers: target / layer on any widget or selector (another item, "
		+ "or another layer of the web map); across layers widgets filter each other through a field both have (exactly the same "
		+ "name, or links [{from, to}] pairing two names) and selecting a polygon on the map filters what lies inside; interactive (default true: selecting in a chart/list/"
		+ "table filters the other widgets and the map and zooms to it, selecting on the map filters them), extent_filter (default true: "
		+ "moving the map filters them); style classic|executive (dark panels with icons, donuts with outside labels, smooth area "
		+ "lines; navy theme); theme light|dark|navy; subtitle; logo_url) | "
		+ "experience (Experience Builder. With widgets: an app built from them on a grid page with a header, every widget bound to "
		+ "a layer of webmap_id (layer = title/id/index): map | legend | layers | basemaps | table (fields) | bar | line | pie (donut) "
		+ "(field, value_field, statistic count|sum|min|max, color, rotated, labels, period) | list (field, fields) | filter "
		+ "(filters [{label, where {FIELD: condition}} or {label, ask: FIELD}]) | indicator (statistic count|sum|min|max of field, "
		+ "live) | details | text | image | embed (url); column left|center|right|bottom, tab, title; selecting in tables/lists "
		+ "zooms the map, selecting in charts filters the map, tables and lists; title, subtitle, logo_url, header_color, theme "
		+ "default|master|meadow|velvet|astro, theme_color. Without widgets: a template by name with webmap_id bound to its maps, "
		+ "theme_color; publish default true) | "
		+ "storymap (blocks = [{type: heading (level 2-4)|text|quote|bullets|numbered (items)|image (url, size, link)|map (webmap_id, size)|"
		+ "embed (url, display card|inline)|video (url)|button (text, url)|separator|number (value, text)|swipe (left/right: two webmap_id or "
		+ "two image)|sidecar (style docked|floating|slideshow, slides [{heading, text, webmap_id|image|url}])|timeline (style waterfall|"
		+ "timeline, events [{heading, text, image}]), caption, alt}] with **bold**, *italic*, [links](https://..) in text; or sections = "
		+ "[{heading, text, webmap_id}] or webmap_id; cover {type full|sidebyside|minimal, image, date}; navigation (h2 links); theme "
		+ "summit|obsidian|ridgeline|mesa|tidal|slate; publish default true) | "
		+ "survey (Survey123 draft that opens in the web designer, where Publish creates its layer; questions = [{type: "
		+ "text|textarea|number|integer|date|datetime|single|dropdown|multi|email|image|note|geopoint, label, choices, required}], "
		+ "or target = a layer whose fields become the questions, or a default set) | "
		+ "fieldmaps (webmap_id: forms for its editable layers from their fields, fields = which, form = {groups [{label, fields, "
		+ "collapsed}], hints {FIELD: text}, required [FIELD], read_only [FIELD], show_when {FIELD: {OTHER: condition}}, photos true|label}, "
		+ "options.offline, options.overwrite_forms) | "
		+ "exb_developer (registers Experience Builder Developer Edition; returns the client ID and the steps) | "
		+ "exb_widget (a custom widget for Developer Edition: custom_widget {name, label, description, data none|layer|map|layer_and_map}, "
		+ "exb_version; returns its files in Esri's widget layout (manifest.json, config.json, icon.svg, README.md, src/config.ts, "
		+ "src/runtime/widget.tsx, src/setting/setting.tsx, translations) and the steps to put them in client/your-extensions/widgets; "
		+ "creates nothing in ArcGIS). "
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
			target: z.string().optional().describe("dashboard: this widget's own feature layer item (default the dashboard's)"),
			layer: z.union([z.string(), z.number()]).optional()
				.describe("dashboard: this widget's layer: of target, or of the web map (title/id/index) when there is no target"),
			field: z.string().optional(),
			value_field: z.string().optional(),
			statistic: z.enum(STATISTICS).optional(),
			fields: z.array(z.string()).optional(),
			title: z.string().optional(),
			text: z.string().optional(),
			url: z.string().optional().describe("embed: the https page"),
			filter: conditions.optional()
				.describe('Only these rows: {"Role": "owner"}, {"Type": ["A", "B"]}, {"Cost": {"op": ">=", "value": 100}}, {"Date": {"op": "last", "value": 30, "unit": "day"}}'),
			column: z.enum(COLUMNS).optional(),
			tab: z.string().max(40).optional().describe("Tab name; widgets of a column with tabs share one tabbed panel"),
			color: z.string().optional().describe("#rrggbb"),
			period: z.enum(PERIODS).optional().describe("bar/line on a date field: bin by day, month or year"),
			rotated: z.boolean().optional().describe("bar/line: categories down the side"),
			icon: z.string().max(8000).optional().describe(`indicator: ${ICONS.join(" | ")}, or an <svg>`),
			group_by: z.string().optional().describe("list: one row per value of this field"),
			values: z.array(z.object({ label: z.string().max(40), field: z.string().optional(), statistic: z.enum(STATISTICS).optional(),
				color: z.string().optional() })).max(4).optional().describe("list with group_by: the numbers on each row; no field = count"),
			webmap_id: z.string().optional().describe("map: another web map that moves with the main one"),
			donut: z.boolean().optional().describe("experience pie: a hole in the middle"),
			filters: z.array(z.object({ label: z.string().max(60), where: conditions.optional(), ask: z.string().optional() })).max(12).optional()
				.describe("experience filter widget: [{label, where: {FIELD: condition}}] presets, or [{label, ask: FIELD}] asking the user"),
			compare_to: conditions.optional().describe("indicator: the reference rows ({} = all), e.g. last year"),
			compare_text: z.string().max(120).optional().describe("indicator: text under the value; {calculated/reference}, {calculated/percentChange}"),
			higher_is_better: z.boolean().optional().describe("indicator with compare_to: green at/above the reference (default true)"),
			min: z.number().optional().describe("gauge: start of the scale (default 0)"),
			max: z.number().optional().describe("gauge: end of the scale (default: today's value over every row)"),
			split_by: z.string().optional().describe("bar/line: a series per value of this field"),
			stacked: z.enum(STACKS).optional().describe("bar/line with split_by: side (default), stacked, percent"),
			labels: z.boolean().optional().describe("pie/bar/line: show values on the chart"),
			lines: z.array(z.object({ value: z.number(), to: z.number().optional(), label: z.string().max(60).optional(),
				color: z.string().optional() })).max(6).optional().describe("bar/line: target lines, or bands value..to"),
			highlight: z.array(z.object({ field: z.string(), when: condition, color: z.string().optional(), background: z.string().optional() }))
				.max(8).optional().describe("table: cell colours, list: row colours, when field meets the condition"),
			sort_by: z.string().optional().describe('list/table: "FIELD" or "FIELD desc"'),
		})).max(20).optional(),
		selectors: z.array(z.object({
			type: z.enum(SELECTOR_TYPES),
			field: z.string(),
			target: z.string().optional().describe("the selector's own layer item (default the dashboard's)"),
			layer: z.union([z.string(), z.number()]).optional(),
			title: z.string().max(80).optional(),
			multiple: z.boolean().optional().describe("category: pick several"),
			display: z.enum(["dropdown", "buttons", "calendar"]).optional().describe("category: dropdown|buttons; date: buttons (presets) or calendar"),
			presets: z.array(z.object({ label: z.string().max(40), last: z.number().int().min(1), unit: z.enum(DATE_UNITS) })).max(8).optional()
				.describe("date: the 'last N' buttons (default 24 hours, 7 days, 30 days, 12 months), then All"),
			operator: z.enum([">=", "<=", "="]).optional().describe("number: default >="),
			min: z.number().optional(),
			max: z.number().optional(),
			step: z.number().optional(),
		})).max(8).optional().describe("dashboard: selectors that filter every widget and the map"),
		selectors_at: z.enum(SELECTOR_PLACES).optional().describe("dashboard: header (default for up to 2) or sidebar"),
		sidebar_title: z.string().max(200).optional(),
		links: z.array(z.object({ from: z.string(), to: z.string() })).max(10).optional()
			.describe("dashboard: fields that mean the same in two layers under different names, e.g. {from: GOV_NAME, to: governorate}"),
		menu_links: z.array(z.object({ label: z.string().max(60), url: z.string() })).max(8).optional().describe("dashboard: header menu links (https)"),
		logo_link: z.string().optional().describe("dashboard: where clicking the logo goes (https)"),
		style: z.enum(STYLES).optional().describe("dashboard: classic (default) or executive"),
		interactive: z.boolean().optional().describe("dashboard: widgets filter each other and the map; default true"),
		extent_filter: z.boolean().optional().describe("dashboard: moving the map filters the widgets; default true"),
		subtitle: z.string().max(200).optional().describe("dashboard: header subtitle"),
		logo_url: z.string().optional().describe("dashboard: https link to a logo image"),
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
		})).max(80).optional().describe("storymap: the story's blocks in order"),
		cover: z.object({ type: z.enum(["full", "sidebyside", "minimal"]).optional(), image: z.string().optional(), alt: z.string().optional(),
			date: z.enum(["first-published", "last-published", "current-date", "none"]).optional() }).optional().describe("storymap: the cover"),
		navigation: z.boolean().optional().describe("storymap: a navigation bar of the h2 headings"),
		theme: z.string().optional(),
		publish: z.boolean().optional(),
		fields: z.array(z.string()).optional().describe("fieldmaps: the fields in the form, in order"),
		form: z.object({
			groups: z.array(z.object({ label: z.string().max(100), fields: z.array(z.string()).min(1), collapsed: z.boolean().optional() }))
				.max(20).optional(),
			hints: z.record(z.string(), z.string().max(300)).optional(),
			required: z.array(z.string()).optional(),
			read_only: z.array(z.string()).optional(),
			show_when: z.record(z.string(), conditions).optional().describe('{"REASON_OTHER": {"REASON": "Other"}}'),
			photos: z.union([z.boolean(), z.string().max(60)]).optional().describe("a photo element (layers with attachments)"),
		}).optional().describe("fieldmaps: how the forms look and behave"),
		theme_color: z.string().optional().describe("experience: the theme's primary colour #rrggbb"),
		header_color: z.string().optional().describe("experience built from widgets: the header colour #rrggbb"),
		redirect_uris: z.array(z.string()).optional().describe("exb_developer: default https://localhost:3001/"),
		custom_widget: z.object({ name: z.string().max(50), label: z.string().max(60).optional(), description: z.string().max(300).optional(),
			data: z.enum(["none", "layer", "map", "layer_and_map"]).optional(), author: z.string().max(80).optional() }).optional()
			.describe("exb_widget: the widget; data = what it works with (default layer)"),
		exb_version: z.string().optional().describe("exb_widget: Developer Edition version, default 1.21.0"),
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
