/** The arguments portal_app takes, shared by every kind of app. */
import type { Condition, DateUnit } from "./filters";

export const APP_KINDS = ["instant", "dashboard", "experience", "storymap", "survey", "fieldmaps", "exb_developer"] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const WIDGET_TYPES = ["map", "indicator", "gauge", "pie", "bar", "line", "list", "table", "details", "legend", "text", "embed"] as const;
export const STATISTICS = ["count", "sum", "avg", "min", "max"] as const;
export const COLUMNS = ["left", "center", "right"] as const;
export const PERIODS = ["day", "month", "year"] as const;
export const STYLES = ["classic", "executive"] as const;
export const ICONS = ["person", "people", "billboard", "screen", "check", "pin", "chart", "alert", "building"] as const;
export const STACKS = ["side", "stacked", "percent"] as const;
export const SELECTOR_TYPES = ["category", "date", "number"] as const;
export const SELECTOR_PLACES = ["header", "sidebar"] as const;

export type WidgetSpec = {
	type: (typeof WIDGET_TYPES)[number];
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
};

/** A dashboard selector: it filters every widget of the layer and the map's copy of it. */
export type SelectorSpec = {
	type: (typeof SELECTOR_TYPES)[number];
	field: string;
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
	fields?: string[];
	redirect_uris?: string[];
	questions?: { type: string; label: string; choices?: (string | { value: string; label: string })[]; required?: boolean }[];
};
