/** The arguments portal_app takes, shared by every kind of app. */

export const APP_KINDS = ["instant", "dashboard", "experience", "storymap", "survey", "fieldmaps", "exb_developer"] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const WIDGET_TYPES = ["map", "indicator", "pie", "bar", "line", "list", "table", "details", "legend", "text", "embed"] as const;
export const STATISTICS = ["count", "sum", "avg", "min", "max"] as const;
export const COLUMNS = ["left", "center", "right"] as const;
export const PERIODS = ["day", "month", "year"] as const;

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
	/** Only these rows: {FIELD: "value"} or {FIELD: ["a", "b"]} on text fields (all must hold). */
	filter?: Record<string, string | string[]>;
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
	/** dashboard: selections filter the other widgets and the map; default true. */
	interactive?: boolean;
	/** dashboard: moving the map filters the widgets to what it shows; default true. */
	extent_filter?: boolean;
	subtitle?: string;
	logo_url?: string;
	fields?: string[];
	redirect_uris?: string[];
	questions?: { type: string; label: string; choices?: (string | { value: string; label: string })[]; required?: boolean }[];
};
