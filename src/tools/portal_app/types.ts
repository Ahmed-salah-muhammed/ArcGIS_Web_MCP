/** The arguments portal_app takes, shared by every kind of app. */
import type { Condition, DateUnit } from "./filters";

export const APP_KINDS = ["instant", "dashboard", "experience", "storymap", "survey", "fieldmaps", "exb_developer"] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const WIDGET_TYPES = ["map", "indicator", "gauge", "pie", "bar", "line", "list", "table", "details", "legend", "text", "embed",
	"filter", "layers", "basemaps", "image"] as const;
/** Widget types only Experience Builder apps take. */
export const EXB_ONLY = new Set(["filter", "layers", "basemaps", "image"]);
export const STATISTICS = ["count", "sum", "avg", "min", "max"] as const;
export const COLUMNS = ["left", "center", "right", "bottom"] as const;
export const PERIODS = ["day", "month", "year"] as const;
export const STYLES = ["classic", "executive"] as const;
export const ICONS = ["person", "people", "billboard", "screen", "check", "pin", "chart", "alert", "building"] as const;
export const STACKS = ["side", "stacked", "percent"] as const;
export const SELECTOR_TYPES = ["category", "date", "number"] as const;
export const SELECTOR_PLACES = ["header", "sidebar"] as const;

export type WidgetSpec = {
	type: (typeof WIDGET_TYPES)[number];
	/** The widget's own layer: another feature layer item (target, with layer = its sublayer), or layer alone = a
	 * layer of the web map (title, id or index), or of the dashboard's item when there is no web map. */
	target?: string;
	layer?: string | number;
	/** indicator: the field the statistic is on; pie/bar/line: the category field; list: the line shown. */
	field?: string;
	/** pie/bar/line: the summed/averaged field (count needs none). */
	value_field?: string;
	statistic?: (typeof STATISTICS)[number];
	fields?: string[];
	title?: string;
	text?: string;
	/** Only these rows, all must hold: {FIELD: "value"}, {FIELD: ["a", "b"]}, {FIELD: {op: ">=", value: 10}}, {DATE: {op: "last", value: 7, unit: "day"}}. */
	filter?: Record<string, Condition>;
	/** Where it goes; the default depends on the type (indicators left, map and table center, charts right). */
	column?: (typeof COLUMNS)[number];
	/** Widgets of a column with a tab share one tabbed panel; this is the tab's name. */
	tab?: string;
	/** "#rrggbb": an indicator's value, a bar or line chart's series. */
	color?: string;
	/** bar/line on a date field: one bar or point per day, month or year. */
	period?: (typeof PERIODS)[number];
	/** embed: the page shown (https). */
	url?: string;
	/** indicator: a ready icon (person, people, billboard...) or an <svg> of your own, drawn in the value's colour. */
	icon?: string;
	/** bar/line: categories down the side instead of along the bottom. */
	rotated?: boolean;
	/** list: one row per value of this field, with the totals in values (an Arcade data expression). */
	group_by?: string;
	/** list with group_by: the numbers on each row; no field = how many rows. */
	values?: { label: string; field?: string; statistic?: (typeof STATISTICS)[number]; color?: string }[];
	/** map: another web map (e.g. a heatmap of the same data), moving together with the dashboard's main map. */
	webmap_id?: string;
	/** indicator: compare with the same statistic over these rows ({} = all rows): last year, a target group... */
	compare_to?: Record<string, Condition>;
	/** indicator with compare_to: the line under the value; default "vs {calculated/reference} ({calculated/percentChange})". */
	compare_text?: string;
	/** indicator with compare_to: green when at or above the reference (default), or red (false: lower is better). */
	higher_is_better?: boolean;
	/** gauge: the scale; max defaults to the statistic over every row when the dashboard is made. */
	min?: number;
	max?: number;
	/** bar/line: one series per value of this field (up to 12), side by side or stacked. */
	split_by?: string;
	stacked?: (typeof STACKS)[number];
	/** pie/bar/line: show the values on the chart. */
	labels?: boolean;
	/** bar/line: target lines (value) or bands (value to "to") across the value axis. */
	lines?: { value: number; to?: number; label?: string; color?: string }[];
	/** table: colour a cell, list: colour a row, when its field meets a condition. */
	highlight?: { field: string; when: Condition; color?: string; background?: string }[];
	/** list / table: the order, "FIELD" or "FIELD desc". */
	sort_by?: string;
	/** experience pie: a hole in the middle. */
	donut?: boolean;
	/** experience filter widget: preset items ({label, where: {FIELD: condition}}) or items asking the user ({label, ask: FIELD}). */
	filters?: { label: string; where?: Record<string, Condition>; ask?: string }[];
};

/** A dashboard selector: it filters every widget of the layer and the map's copy of it. */
export type SelectorSpec = {
	type: (typeof SELECTOR_TYPES)[number];
	field: string;
	/** The selector's layer, as for widgets (default the dashboard's). */
	target?: string;
	layer?: string | number;
	title?: string;
	/** category: pick several values (default one). */
	multiple?: boolean;
	/** category: dropdown (default) or buttons; date: buttons of presets (default) or calendar (pick a day). */
	display?: "dropdown" | "buttons" | "calendar";
	/** date: the preset ranges, "last N units"; default 24 hours, 7 days, 30 days, 12 months, then All. */
	presets?: { label: string; last: number; unit: DateUnit }[];
	/** number: rows with field >= (default), <= or = the chosen value. */
	operator?: ">=" | "<=" | "=";
	/** number: the range and step; min/max default to the field's range when the dashboard is made. */
	min?: number;
	max?: number;
	step?: number;
};

export type Section = { heading?: string; text?: string; webmap_id?: string };

/** fieldmaps: how the forms look and behave, by field name (on every layer that has the field). */
export type FormSpec = {
	groups?: { label: string; fields: string[]; collapsed?: boolean }[];
	hints?: Record<string, string>;
	required?: string[];
	read_only?: string[];
	/** FIELD shows only when the other fields meet these conditions (all of them). */
	show_when?: Record<string, Record<string, Condition>>;
	/** A photo element (layers with attachments); a string is its label. */
	photos?: boolean | string;
};

export const STORY_BLOCKS = ["heading", "text", "quote", "bullets", "numbered", "image", "map", "embed", "video", "button", "separator",
	"number", "swipe", "sidecar", "timeline"] as const;
/** What a slide, a swipe side or a cover shows: a web map, an image (https), or a page (url). */
export type StoryMedia = { webmap_id?: string; image?: string; url?: string; caption?: string };
export type StoryBlock = {
	type: (typeof STORY_BLOCKS)[number];
	/** heading / text / quote / button text; number: the line under the value. Text takes **bold**, *italic*, [link](https://...). */
	text?: string;
	level?: number;
	items?: string[];
	url?: string;
	webmap_id?: string;
	caption?: string;
	alt?: string;
	/** image: small | standard | wide | full | float; map: standard | wide | full | float. */
	size?: string;
	/** image: where clicking it goes. */
	link?: string;
	/** embed: card | inline. */
	display?: string;
	/** number: the big value ("1,250", "73%"). */
	value?: string;
	left?: StoryMedia;
	right?: StoryMedia;
	/** sidecar: docked | floating | slideshow; timeline: waterfall | timeline. */
	style?: string;
	slides?: (StoryMedia & { heading?: string; text?: string })[];
	events?: { heading?: string; text?: string; image?: string }[];
};

export type AppArgs = {
	action?: "templates" | "create";
	kind?: AppKind;
	title?: string;
	summary?: string;
	tags?: string[];
	folder?: string;
	webmap_id?: string;
	target?: string;
	layer?: string | number;
	template?: string;
	options?: Record<string, unknown>;
	widgets?: WidgetSpec[];
	sections?: Section[];
	/** storymap: the story's blocks in order (after sections). */
	blocks?: StoryBlock[];
	/** storymap: the cover: full | sidebyside | minimal, an image, and the date shown. */
	cover?: { type?: string; image?: string; alt?: string; date?: string };
	/** storymap: a navigation bar of the h2 headings. */
	navigation?: boolean;
	theme?: string;
	publish?: boolean;
	/** dashboard: classic, or executive (dark panels, icons, donuts, smooth area lines; navy theme by default). */
	style?: (typeof STYLES)[number];
	/** dashboard: selections filter the other widgets and the map; default true. */
	interactive?: boolean;
	/** dashboard: moving the map filters the widgets to what it shows; default true. */
	extent_filter?: boolean;
	subtitle?: string;
	logo_url?: string;
	/** dashboard: where clicking the logo goes. */
	logo_link?: string;
	/** dashboard: links in the header's menu. */
	menu_links?: { label: string; url: string }[];
	/** dashboard: category / date / number selectors that filter the whole dashboard. */
	selectors?: SelectorSpec[];
	/** dashboard: selectors in the header or a sidebar (default: header for up to 2, else sidebar). */
	selectors_at?: (typeof SELECTOR_PLACES)[number];
	/** dashboard: text at the top of the sidebar. */
	sidebar_title?: string;
	/** dashboard: fields that mean the same thing in two layers under different names, for filtering across layers. */
	links?: { from: string; to: string }[];
	fields?: string[];
	/** fieldmaps: groups, hints, required / read-only fields, show_when, photos. */
	form?: FormSpec;
	/** experience: the theme's primary colour (#rrggbb). */
	theme_color?: string;
	/** experience built from widgets: the header's colour (#rrggbb). */
	header_color?: string;
	redirect_uris?: string[];
	questions?: { type: string; label: string; choices?: (string | { value: string; label: string; filter?: string })[]; required?: boolean;
		hint?: string; name?: string; group?: string; relevant?: string; constraint?: string; constraint_message?: string; calculation?: string;
		default?: string; appearance?: string; read_only?: boolean; required_message?: string; choice_filter?: string }[];
};
