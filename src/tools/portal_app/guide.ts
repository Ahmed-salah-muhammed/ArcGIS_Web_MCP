/**
 * What action=templates says about each kind of app: every argument that kind takes. The tool's own description and
 * schema stay short (they are sent to the model in every conversation); the detail is here, read once, when an app
 * is about to be built.
 */
import { QUESTION_TYPES } from "../portal_survey123/draft";
import { type AppKind, ICONS } from "./types";

const CONDITION = 'A condition is a value, a list of values, or {op, value, unit}: {"Role": "owner"}, {"Type": ["A", "B"]}, '
	+ '{"Cost": {"op": ">=", "value": 100}}, {"Date": {"op": "last", "value": 30, "unit": "day"}}. op = | != | > | >= | <= | in | '
	+ "not_in | not_null on text and numbers; last | before_last (value + unit hour|day|month|year) | this_year | last_year on dates.";

export const KIND_GUIDE: Record<AppKind, Record<string, string>> = {
	instant: {
		create: "webmap_id + template (default basic); options = the template's settings, checked before saving "
			+ "(action=templates with template lists them); theme light | dark; title, summary, tags, folder.",
	},
	dashboard: {
		create: "target = a feature layer item id and/or webmap_id (layer = the layer of target by index/name, or of the web map by "
			+ "title/id/index); widgets = [{type, ...}] (see widgets), or omitted for an automatic dashboard; title, summary, tags, folder.",
		conditions: CONDITION,
		widget_details: `icon (indicator) = ${ICONS.join(" | ")}, or an <svg>. list with group_by: values = [{label, field, statistic, `
			+ "color}] (up to 4) are the numbers on each row; no field = count. indicator: compare_to = the reference rows ({} = all, "
			+ "e.g. last year), compare_text = text under the value with {calculated/reference} or {calculated/percentChange}, "
			+ "higher_is_better (default true) = green at or above the reference. highlight = [{field, when: condition, color, "
			+ "background}] (up to 8). lines = [{value, to, label, color}] (up to 6). Up to 20 widgets.",
		selector_details: "Up to 8 selectors. date presets default to 24 hours, 7 days, 30 days, 12 months, then All. selectors_at "
			+ "defaults to header for up to 2 selectors, sidebar for more.",
		several_layers: "target / layer on any widget or selector = its own layer (another item, or another layer of the web map). "
			+ "Across layers, widgets filter each other through a field both have: exactly the same name, or links = [{from, to}] "
			+ "pairing two names (e.g. {from: GOV_NAME, to: governorate}); selecting a polygon on the map filters what lies inside.",
		interaction: "interactive (default true): selecting in a chart, list or table filters the other widgets and the map and "
			+ "zooms to it; selecting on the map filters them. extent_filter (default true): moving the map filters the widgets.",
		look: "style classic (default) | executive; theme light | dark | navy; subtitle, logo_url (https image), logo_link (https), "
			+ "menu_links = [{label, url}] (up to 8, https), sidebar_title.",
	},
	experience: {
		create: "Experience Builder. With widgets: an app built from them on a grid page with a header, every widget bound to a "
			+ "layer of webmap_id (layer = title/id/index); selecting in tables and lists zooms the map, selecting in charts filters "
			+ "the map, tables and lists. Without widgets: template = a template by name, with webmap_id bound to its maps, and "
			+ "theme_color. publish (default true); title, summary, tags, folder.",
		conditions: CONDITION,
	},
	storymap: {
		create: "blocks = [{type, ...}] in order (see blocks), or sections = [{heading, text, webmap_id}], or just webmap_id; "
			+ "cover, navigation, theme (see themes); publish (default true); title, summary, tags, folder.",
	},
	survey: {
		create: "A Survey123 draft that opens in the web designer, where Publish creates its layer. questions = [{type, label, "
			+ `choices, required}] with type ${QUESTION_TYPES.join(" | ")} (choices = strings or {value, label}; up to 60), or target = `
			+ "a layer whose fields become the questions, or neither for a default set; title, summary, tags, folder.",
	},
	fieldmaps: {
		create: "webmap_id: forms for its editable layers, built from their fields. fields = which fields, in order. form = {groups "
			+ "[{label, fields, collapsed}], hints {FIELD: text}, required [FIELD], read_only [FIELD], show_when {FIELD: {OTHER: "
			+ 'condition}} (e.g. {"REASON_OTHER": {"REASON": "Other"}}), photos true | "a label" (layers with attachments)}. '
			+ "options.offline, options.overwrite_forms.",
		conditions: CONDITION,
	},
	exb_developer: {
		create: "Registers Experience Builder Developer Edition and returns the client ID and the steps. redirect_uris defaults to "
			+ "[https://localhost:3001/].",
	},
	exb_widget: {
		create: "A custom widget for Developer Edition: custom_widget = {name, label, description, data none | layer | map | "
			+ "layer_and_map (default layer), author}; exb_version = client/package.json exb-client.version (default 1.21.0). Returns "
			+ "its files in Esri's widget layout (manifest.json, config.json, icon.svg, README.md, src/config.ts, "
			+ "src/runtime/widget.tsx, src/setting/setting.tsx, translations) as a scaffold only: it writes no local files and creates "
			+ "no ArcGIS item. Continue locally with the arcgis-exb-widget-dev skill to implement behavior, then run npm run tscheck "
			+ "from client/.",
	},
};
