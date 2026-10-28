/** The arguments portal_app takes, shared by every kind of app. */

export const APP_KINDS = ["instant", "dashboard", "experience", "storymap", "survey", "fieldmaps", "exb_developer"] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const WIDGET_TYPES = ["map", "indicator", "pie", "bar", "line", "list", "table", "details", "legend", "text"] as const;
export const STATISTICS = ["count", "sum", "avg", "min", "max"] as const;

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
	fields?: string[];
	redirect_uris?: string[];
	questions?: { type: string; label: string; choices?: (string | { value: string; label: string })[]; required?: boolean }[];
};
