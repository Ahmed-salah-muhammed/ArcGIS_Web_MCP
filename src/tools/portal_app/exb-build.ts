/**
 * Experience Builder apps built from a list of widgets, instead of a template: one page on a GRID layout (the
 * blankfullscreengrid template's: a tree of panels side by side, stacked or in tabs, each with an optional title bar),
 * a header with the title and logo, and the web map as the data source (WEB_MAP, its layers addressed as
 * "<data source>-<operational layer id>"). Every widget is shaped like the same widget in published experiences read
 * from ArcGIS Online (2026-10, ExB 1.17-1.21), with the widget version of the app it was read from, so Experience
 * Builder's own upgraders bring it to the current version when it loads (exbVersion 1.17.0):
 *  map, legend, map layers, basemap gallery, table (layersConfig), chart (bar / column from 1.21, pie / donut with
 *  slices from 1.17; line uses the chart spec's lineSeries as dashboards write it), list (a card of field
 *  expressions), filter (preset SQL items and ask-for-value items), text, numbers (text with COUNT / SUM / MIN / MAX
 *  expressions), feature info, image, embed.
 * Interactions are message actions as the Actions tab saves them: selecting in a table or list flashes and zooms to
 * the features on the map; selecting in a chart flashes them and filters the map, tables and lists of its layer
 * through its category field (the "filter" action from the chart's output data source).
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { base } from "../shared/lookup";
import { categories, fieldOf, hexColor } from "./dashboard";
import type { Condition } from "./filters";
import type { AppArgs, WidgetSpec } from "./types";

export const EXB_THEMES = ["default", "master", "meadow", "velvet", "astro"] as const;
const EXB_VERSION = "1.17.0";

/** What action=templates says about building an experience from widgets. */
export const EXB_WIDGET_HELP = {
	map: "The web map (webmap_id), with zoom, home, search, layers, basemap and select tools.",
	legend: "The map's legend.", layers: "The map's layer list.", basemaps: "A basemap gallery for the map.",
	table: "A table of a layer (layer = the web map's layer by title, id or index): fields, sort_by; search on text fields.",
	bar: "Bars per value of field (count, or statistic sum | min | max | avg of value_field); rotated = horizontal; color.",
	line: "A line per value of field (a date field bins by period day | month | year).",
	pie: "Slices per value of field, each its own colour (the values read from the layer); donut = true for a hole.",
	list: "Cards of a layer's features: field in bold, fields under it.",
	filter: "Filter items: filters = [{label, where: {FIELD: condition}} preset, or {label, ask: FIELD} asking the user "
		+ "(text: pick a value, number: at least, date: between two dates)].",
	indicator: "A number: statistic count | sum | min | max of field, live with the layer's filters.",
	details: "The selected feature's details (feature info).",
	text: "Rich text (text).", image: "An image (url, https).", embed: "A web page (url, https).",
	layout: "column = left | center | right | bottom; tab = a tab name (widgets of a column with a tab share one tabbed "
		+ "panel); title = the panel's title bar. Defaults: map center, table bottom, charts right, the rest left.",
	app: "title, subtitle, logo_url, theme default | master | meadow | velvet | astro, theme_color (#rrggbb), "
		+ "header_color (#rrggbb); interactive (default true).",
};

const EXB_TYPES = new Set(["map", "legend", "layers", "basemaps", "table", "bar", "line", "pie", "list", "filter", "indicator",
	"details", "text", "image", "embed"]);
type Column = "left" | "center" | "right" | "bottom";
const COLUMN_OF: Record<string, Column> = { map: "center", table: "bottom", bar: "right", line: "right", pie: "right",
	details: "right", embed: "center" };
const WITH_HEADER = new Set(["table", "bar", "line", "pie", "list", "filter", "legend", "layers", "basemaps", "details"]);
const PALETTE = ["#5E8FD0", "#77B484", "#DF6B35", "#DBCF4E", "#41546D", "#8257C2", "#D6558B", "#45B0A6", "#E69B3F", "#9A6A4F",
	"#7F7F7F", "#1F77B4"];

/** A data source reference as widgets keep it. */
type DsRef = { dataSourceId: string; mainDataSourceId: string; rootDataSourceId: string | null; fields?: string[] };
/** A layer of the web map: its operational layer, definition, and data source id. */
export type ExbLayer = { op: any; info: any; dsId: string; title: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const https = (u: unknown, what: string) => {
	const v = String(u ?? "").trim();
	if (!/^https:\/\/\S+$/i.test(v)) throw new ArcGISError(`${what} must be an https link.`, "bad_argument");
	return v;
};

/** The web map's feature layers (in group layers too), each with the data source id Experience Builder gives it. */
export function mapLayers(mapData: any, rootDs: string): { op: any; dsId: string; title: string }[] {
	const out: { op: any; dsId: string; title: string }[] = [];
	const walk = (ops: any[], prefix: string) => {
		for (const op of ops ?? []) {
			const id = `${prefix}-${op.id}`;
			if (Array.isArray(op.layers) && !op.url) walk(op.layers, id);
			else if (op.url && /\/(FeatureServer|MapServer)\/\d+\/?$/i.test(op.url)) out.push({ op, dsId: id, title: String(op.title ?? op.id) });
		}
	};
	walk(mapData?.operationalLayers ?? [], rootDs);
	return out;
}

/** Field types as Experience Builder writes them. */
export function jimuType(esriType: string): "STRING" | "NUMBER" | "DATE" {
	if (/Date|Timestamp/.test(esriType)) return "DATE";
	if (/OID|Integer|Double|Single/.test(esriType)) return "NUMBER";
	return "STRING";
}
const jimuField = (f: any) => ({ jimuName: f.name, name: f.name, type: jimuType(f.type), esriType: f.type, alias: f.alias ?? f.name });

const SYSTEM = /^(objectid|fid|globalid|shape__?(area|length)|shape|created_(user|date)|last_edited_(user|date)|creationdate|creator|editdate|editor)$/i;
const useful = (info: any, n = 6) => (info.fields ?? []).filter((f: any) => !SYSTEM.test(f.name) && !/Geometry|Blob|Raster/.test(f.type))
	.slice(0, n).map((f: any) => f.name);
const oid = (info: any) => info.objectIdField ?? (info.fields ?? []).find((f: any) => f.type === "esriFieldTypeOID")?.name ?? "OBJECTID";
const fieldDef = (info: any, name: string) => (info.fields ?? []).find((f: any) => f.name === name);

/** An expression element of rich text: a field of the current record (lists) or a statistic of a layer (numbers). */
function expHtml(dsId: string, parts: any[], name: string) {
	const uid = crypto.randomUUID().replace(/-/g, "_");
	const data = encodeURIComponent(JSON.stringify({ name, parts }));
	return `<exp data-uniqueid="${uid}" data-dsid="${dsId}" data-expression="${data}">﻿<span contenteditable="false">${esc(name)}</span>﻿</exp>`;
}
const fieldExp = (l: ExbLayer, name: string, repeated = true) => {
	const alias = fieldDef(l.info, name)?.alias ?? name;
	return expHtml(l.dsId, [{ type: "FIELD", exp: `{${alias}}`, dataSourceId: l.dsId, jimuFieldName: name,
		...(repeated ? { isFromRepeatedDataSourceContext: true } : {}) }], `{${alias}}`);
};

const STAT_FN: Record<string, string> = { count: "COUNT", sum: "SUM", min: "MIN", max: "MAX" };

/** One app in the making: ids, widgets, layouts, data sources and message actions. */
class App {
	widgets: Record<string, any> = {};
	layouts: Record<string, any> = {};
	dataSources: Record<string, any> = {};
	messageConfigs: Record<string, any> = {};
	private n = { widget: 0, layout: 0, message: 0 };
	widgetId() { return `widget_${++this.n.widget}`; }
	layoutId() { return `layout_${++this.n.layout}`; }
	add(w: any) { this.widgets[w.id] = w; return w; }
	message(source: string, type: string, actions: any[]) {
		const id = `messageConfig_${++this.n.message}`;
		this.messageConfigs[id] = { id, widgetId: source, messageType: type, actions };
	}
}

const ref = (l: ExbLayer, root: string, fields?: string[]): DsRef => ({ dataSourceId: l.dsId, mainDataSourceId: l.dsId, rootDataSourceId: root,
	...(fields ? { fields } : {}) });

function mapWidget(app: App, ds: string, title: string) {
	const layout = app.layoutId();
	app.layouts[layout] = { content: {}, type: "FIXED", label: "Map FixedLayout" };
	return app.add({ uri: "widgets/arcgis/arcgis-map/", version: "1.19.0", label: title,
		config: { toolConfig: { canZoom: true, canHome: true, canSearch: true, canNavigation: true, canLayers: true, canBaseMap: true,
			canSelect: true, canSelectState: true }, isUseCustomMapState: false, initialMapDataSourceID: ds, initialMapState: null,
		scaleRange: null, customLODs: null },
		id: app.widgetId(), layouts: { MapFixedLayout: { LARGE: layout } }, useDataSources: [{ dataSourceId: ds, mainDataSourceId: ds }] });
}

function tableWidget(app: App, l: ExbLayer, root: string, spec: WidgetSpec) {
	const fields: string[] = spec.fields?.length ? spec.fields.map((f) => fieldOf(l.info, f, "table fields")) : useful(l.info);
	const all = (l.info.fields ?? []).filter((f: any) => !/Geometry|Blob|Raster/.test(f.type)).map(jimuField);
	const text = fields.filter((f) => jimuType(fieldDef(l.info, f)?.type ?? "") === "STRING");
	return app.add({ uri: "widgets/common/table/", version: "1.17.0", label: spec.title ?? l.title,
		config: { layersConfig: [{ id: `${l.dsId}-1`, name: spec.title ?? l.title, useDataSource: ref(l, root, fields), allFields: all,
			tableFields: fields.map((f) => ({ ...jimuField(fieldDef(l.info, f)), editAuthority: false, editable: false, visible: true })),
			enableAttachments: false, enableEdit: false, allowCsv: false, enableSearch: text.length > 0, searchFields: text.slice(0, 3),
			enableRefresh: true, enableSelect: true, enableDelete: false, selectMode: "SINGLE", showCount: true,
			headerFontSetting: { backgroundColor: "", fontSize: 14, bold: false, color: "" },
			columnSetting: { responsiveType: "FIXED", columnWidth: 200 }, layerHonorMode: "CUSTOM" }],
		mapViewsConfig: {}, tableMode: "LAYER", enableMapExtentFilter: false, defaultExtentFilterEnabled: false, enableAttachments: false,
		arrangeType: "TABS" },
		id: app.widgetId(), useDataSources: [ref(l, root, fields)] });
}

const textStyle = (color: string, size: number, weight = "normal") => ({ type: "esriTS", color,
	font: { family: "inherit", size, style: "normal", weight, decoration: "none" }, horizontalAlignment: "center", verticalAlignment: "middle" });
/** A chart axis as ExB 1.21 writes it. */
const axis = (category: boolean) => ({ type: "chartAxis", visible: true, isLogarithmic: false,
	title: { type: "chartText", visible: false, content: textStyle("var(--sys-color-surface-paper-text)", 14) },
	labels: { type: "chartText", visible: true, content: textStyle("var(--sys-color-surface-paper-hint)", 12) },
	valueFormat: category ? { type: "category", characterLimit: 25 }
		: { type: "number", intlOptions: { style: "decimal", useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 } },
	lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color: "var(--sys-color-divider-primary)", width: 1 },
	grid: { type: "esriSLS", style: "esriSLSDash", color: "var(--sys-color-divider-tertiary)", width: 0 } });
const chartText = (text: string, size: number, visible: boolean) => ({ type: "chartText", visible,
	content: { type: "esriTS", color: "var(--sys-color-surface-paper-text)", font: { family: "inherit", size, style: "normal", weight: "normal",
		decoration: "none" }, horizontalAlignment: "center", text } });
const BINS: Record<string, string> = { day: "days", month: "months", year: "years" };

/**
 * A chart and its output data source (the statistics the chart shows, which its selections come from): bars and lines
 * as ExB 1.21 writes them, pie and donut slices coloured one by one as 1.17 writes them (the values read from the layer).
 */
export function chartWidget(app: App, l: ExbLayer, root: string, spec: WidgetSpec, slices: { value: unknown; label: string }[] = []) {
	const kind = spec.type as "bar" | "line" | "pie";
	const category = fieldOf(l.info, spec.field, `${kind} chart (field = the category)`);
	const stat = spec.statistic ?? (spec.value_field ? "sum" : "count");
	if (stat === "avg") throw new ArcGISError("Experience Builder charts here take count | sum | min | max.", "bad_argument");
	const value = stat === "count" ? (spec.value_field ? fieldOf(l.info, spec.value_field, kind) : oid(l.info))
		: fieldOf(l.info, spec.value_field, `${kind} chart (value_field for ${stat})`);
	const y = `${stat}_of_${value}`;
	const color = hexColor(spec.color) ?? PALETTE[0];
	const id = app.widgetId();
	const output = `${id}_output`;
	const isDate = jimuType(fieldDef(l.info, category)?.type ?? "") === "DATE";
	if (spec.period && !isDate) throw new ArcGISError(`period needs a date field; '${category}' is not one.`, "bad_argument");
	const labels = { type: "chartText", visible: spec.labels ?? false, content: textStyle("var(--sys-color-surface-paper-hint)", 10) };
	const donut = kind === "pie" && Boolean(spec.donut);
	let series: any;
	if (kind === "pie") {
		const fillOf = (c: string) => ({ type: "esriSFS", style: "esriSFSSolid", color: c,
			outline: { type: "esriSLS", style: "esriSLSSolid", color: "var(--ref-palette-neutral-200)", width: 1 } });
		series = { type: "pieSeries", id: value, name: value, x: category, y, innerRadius: donut ? 60 : 0, startAngle: 0, endAngle: 360,
			displayNumericValueOnDataLabel: true, displayPercentageOnDataLabel: false, displayNumericValueOnTooltip: true,
			displayPercentageOnTooltip: true, dataLabelsOffset: 0, sliceGrouping: { sliceId: "__other-slice__", percentageThreshold: 0, label: "Other" },
			numericValueFormat: { type: "number", intlOptions: { style: "decimal", useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 3 } },
			percentValueFormat: { type: "number", intlOptions: { style: "percent", notation: "standard", minimumFractionDigits: 0, maximumFractionDigits: 3 } },
			fillSymbol: fillOf("#D6D6D6"), dataLabels: { ...labels, visible: spec.labels ?? true }, dataTooltipVisible: true, binTemporalData: false,
			slices: slices.map((s, i) => ({ sliceId: String(s.value), label: s.label, fillSymbol: fillOf(PALETTE[i % PALETTE.length]) })) };
	} else if (kind === "line") {
		series = { type: "lineSeries", id: value, name: value, x: category, y, dataLabels: labels, dataTooltipVisible: true,
			lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color, width: 2 }, markerVisible: true,
			markerSymbol: { type: "esriSMS", style: "esriSMSCircle", color, size: 8, outline: { type: "esriSLS", style: "esriSLSSolid", color } },
			binTemporalData: isDate, ...(isDate ? { temporalBinning: { size: 1, unit: BINS[spec.period ?? "month"], nullPolicy: "interpolate" } } : {}) };
	} else {
		series = { type: "barSeries", id: value, name: value, x: category, y,
			fillSymbol: { type: "esriSFS", style: "esriSFSSolid", color,
				outline: { type: "esriSLS", style: "esriSLSSolid", color: "var(--sys-color-divider-secondary)", width: 0 } },
			dataLabels: labels, binTemporalData: isDate,
			...(isDate ? { temporalBinning: { size: 1, unit: BINS[spec.period ?? "month"], nullPolicy: "interpolate" } } : {}),
			hideOversizedStackedLabels: false, dataTooltipVisible: true };
	}
	const template = kind === "pie" ? (donut ? "donut" : "pie") : kind === "line" ? "line" : "column";
	const webChart = { version: kind === "pie" ? "16.1.1" : "25.0.0", id: template, type: "chart",
		dataSource: { query: { groupByFieldsForStatistics: [category],
			outStatistics: [{ statisticType: stat, onStatisticField: value, outStatisticFieldName: y }] } },
		...(kind === "pie" ? {} : { rotated: Boolean(spec.rotated), stackedType: "sideBySide", axes: [axis(true), axis(false)] }),
		colorMatch: false, series: [series], background: "var(--sys-color-surface-paper)",
		title: chartText(spec.title ?? "", 16, false), footer: chartText("", 12, false),
		legend: { type: "chartLegend", visible: kind === "pie", title: chartText("", 14, true),
			body: { ...chartText("", 12, true).content }, position: kind === "pie" ? "right" : "bottom" },
		orderOptions: { orderByFields: [`${category} ASC`], data: { orderType: "arcgis-charts-category", orderBy: "ASC", preferLabel: true } } };
	const cat = fieldDef(l.info, category);
	app.dataSources[output] = { id: output, type: "FEATURE_LAYER", label: `${spec.title ?? l.title} statistics`,
		originDataSources: [ref(l, root)], isOutputFromWidget: true, isDataInDataSourceInstance: true,
		schema: { idField: "__outputid__", label: `${spec.title ?? l.title} statistics`, fields: {
			__outputid__: { jimuName: "__outputid__", alias: "OBJECTID", type: "NUMBER", esriType: "esriFieldTypeOID", name: "__outputid__" },
			[category]: { ...jimuField(cat), originFields: [category] },
			[y]: { jimuName: y, name: y, type: "NUMBER", esriType: stat === "count" ? "esriFieldTypeInteger" : "esriFieldTypeDouble",
				alias: `${stat[0].toUpperCase()}${stat.slice(1)} of ${fieldDef(l.info, value)?.alias ?? value}`, originFields: [value] } } } };
	return { widget: app.add({ uri: "widgets/common/chart/", version: kind === "pie" ? "1.17.0" : "1.21.0", label: spec.title ?? `${category}`,
		config: { template, webChart, tools: { cursorEnable: true } }, id, useDataSources: [ref(l, root, [category, value])],
		outputDataSources: [output] }), output, category };
}

/** Cards of the layer's features: a text widget of field expressions in the list's card layout (as ExB 1.19 writes it). */
function listWidget(app: App, l: ExbLayer, root: string, spec: WidgetSpec) {
	const first = spec.field ? fieldOf(l.info, spec.field, "list") : (l.info.displayField && fieldDef(l.info, l.info.displayField) ? l.info.displayField : useful(l.info, 1)[0] ?? oid(l.info));
	const more = (spec.fields ?? []).map((f) => fieldOf(l.info, f, "list fields")).filter((f) => f !== first).slice(0, 4);
	const text = { uri: "widgets/common/text/", version: "1.19.0", label: "Card text", id: app.widgetId(),
		config: { text: `<p><strong style="font-size: 15px;">${fieldExp(l, first)}</strong></p>`
			+ (more.length ? `<p><span style="font-size: 13px;">${more.map((f) => `${esc(fieldDef(l.info, f)?.alias ?? f)}: ${fieldExp(l, f)}`).join(" · ")}</span></p>` : ""),
		style: { verticalAlign: "start", wrap: true, overflow: "scroll", padding: "p-1" } },
		useDataSources: [ref(l, root, [first, ...more])], useDataSourcesEnabled: true };
	app.add(text);
	const card = app.layoutId();
	const height = more.length ? 80 : 50;
	app.layouts[card] = { type: "FIXED", label: "Default", order: ["0"], content: { 0: { type: "WIDGET", widgetId: text.id,
		bbox: { left: "8px", top: "4px", width: "95%", height: "90%", right: "8px", bottom: "4px" },
		setting: { lockParent: true, autoProps: { width: true, height: false }, vCenter: false, hCenter: false }, isPending: false } } };
	const size = { LARGE: { width: 320, height } };
	return app.add({ uri: "widgets/common/list/", version: "1.19.0", label: spec.title ?? l.title, id: app.widgetId(),
		config: { maxItems: 100, space: 10, verticalSpace: 10, horizontalSpace: 10, layoutType: "ROW", itemsPerPage: 10, isItemStyleConfirm: true,
			isInitialed: true, pageStyle: "SCROLL", itemStyle: "STYLE4", hoverType: "HOVER0", selectedStyle: "STYLE0", differentOddEven: false,
			scrollBarOpen: true, direction: "VERTICAL", alignType: "CENTER", scrollStep: 2,
			cardConfigs: { DEFAULT: { cardSize: size, enable: true, backgroundStyle: { border: { type: "solid", color: "var(--sys-color-divider-secondary)", width: "1px" } }, listLayout: "Custom" },
				HOVER: { cardSize: size, enable: false, backgroundStyle: { border: { type: "solid", color: "var(--sys-color-divider-secondary)", width: "1px" } }, listLayout: "Auto" },
				SELECTED: { cardSize: size, backgroundStyle: { border: { type: "solid", color: "var(--sys-color-action-selected)", width: "1px" } }, selectionMode: "SINGLE", listLayout: "Auto" } },
			style: { id: "default" }, isCheckEmptyTemplate: false, searchFields: null, filters: null, sorts: null, isShowAutoRefresh: false,
			keepAspectRatio: false, noDataMessage: "", showRecordCount: false },
		useDataSourcesEnabled: true, layouts: { DEFAULT: { LARGE: card } }, useDataSources: [ref(l, root, [])] });
}

const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** One preset condition as a filter expression part and its SQL (operators read from real filter widgets). */
function presetPart(l: ExbLayer, name: string, c: Condition): { part: any; sql: string } {
	const f = fieldDef(l.info, fieldOf(l.info, name, "filter"));
	const type = jimuType(f.type);
	const coded: any[] = f.domain?.codedValues ?? [];
	const label = (v: unknown) => String(coded.find((d) => String(d.code) === String(v))?.name ?? v);
	const code = (v: unknown) => coded.find((d) => d.name === v)?.code ?? v;
	const cond: { op: string; value?: unknown; unit?: string } = typeof c === "object" && !Array.isArray(c) ? c
		: { op: Array.isArray(c) ? "in" : "=", value: c };
	const vals = (Array.isArray(cond.value) ? cond.value : cond.value === undefined ? [] : [cond.value]).map(code);
	const single = (operator: string, valueOptions: any) => ({ type: "SINGLE", jimuFieldName: f.name, operator, valueOptions,
		displayType: "NONE", askForValueOptions: null, displayLabel: null, caseSensitive: false });
	if (cond.op === "not_null") {
		return { part: single(`${type}_OPERATOR_IS_NOT_BLANK`, { isValid: true, sourceType: "USER_INPUT", inputEditor: "BLANK_SELECTOR", value: null }),
			sql: `${f.name} IS NOT NULL` };
	}
	if (type === "STRING" && (cond.op === "=" || cond.op === "in")) {
		if (!vals.length) throw new ArcGISError(`filter: no value for '${f.name}'.`, "bad_argument");
		const parts = vals.map((v) => single("STRING_OPERATOR_IS", { isValid: true, sourceType: "USER_INPUT", inputEditor: "SIMPLE_SELECT",
			value: [{ value: String(v), label: label(v) }] }));
		return vals.length === 1 ? { part: parts[0], sql: `(${f.name} = ${sqlText(String(vals[0]))})` }
			: { part: { type: "SET", logicalOperator: "OR", parts }, sql: `(${vals.map((v) => `(${f.name} = ${sqlText(String(v))})`).join(" OR ")})` };
	}
	if (type === "STRING" && (cond.op === "!=" || cond.op === "not_in")) {
		return { part: single("STRING_OPERATOR_IS_NONE_OF", { isValid: true, sourceType: "MULTIPLE", inputEditor: "MULTIPLE_SELECT",
			value: vals.map((v) => ({ value: String(v), label: label(v) })) }), sql: `(${f.name} NOT IN (${vals.map((v) => sqlText(String(v))).join(",")}))` };
	}
	if (type === "NUMBER" && (cond.op === ">=" || cond.op === "=")) {
		const n = Number(vals[0]);
		if (vals.length !== 1 || !Number.isFinite(n)) throw new ArcGISError(`filter: '${f.name}' ${cond.op} needs one number.`, "bad_argument");
		return { part: single(cond.op === ">=" ? "NUMBER_OPERATOR_IS_AT_LEAST" : "NUMBER_OPERATOR_IS",
			{ isValid: true, sourceType: "USER_INPUT", inputEditor: "TEXT_BOX", value: n }), sql: `(${f.name} ${cond.op} ${n})` };
	}
	if (type === "DATE" && cond.op === "last" && (cond.unit ?? "day") === "day") {
		const n = Number(cond.value);
		if (!Number.isInteger(n) || n < 1) throw new ArcGISError(`filter: '${f.name}' last needs a whole number of days.`, "bad_argument");
		return { part: single("DATE_OPERATOR_IS_IN_THE_LAST", { isValid: true, sourceType: "USER_INPUT", inputEditor: "NUMBER_LIST_SELECTOR",
			value: [{ value: n, label: "DAY" }] }), sql: `(${f.name} BETWEEN CURRENT_TIMESTAMP - ${n} AND CURRENT_TIMESTAMP)` };
	}
	throw new ArcGISError(`A filter widget here takes: text = | in | != | not_in, number = | >=, date last N days, not_null; `
		+ `not '${cond.op}' on '${f.name}' (${type.toLowerCase()}).`, "bad_argument");
}

/** An ask-for-value part: a value from the layer (text), at least (number), between two dates (date). */
function askPart(l: ExbLayer, name: string) {
	const f = fieldDef(l.info, fieldOf(l.info, name, "filter ask"));
	const type = jimuType(f.type);
	const ask = (operator: string, valueOptions: any) => ({ type: "SINGLE", jimuFieldName: f.name, operator, valueOptions,
		displayType: "USE_ASK_FOR_VALUE", askForValueOptions: { label: f.alias ?? f.name, display: "BLOCK", hint: "", cascade: null },
		displayLabel: null, caseSensitive: false });
	if (type === "DATE") return ask("DATE_OPERATOR_IS_BETWEEN", { isValid: true, sourceType: "USER_INPUT", inputEditor: "DOUBLE_DATE_PICKER", value: [null, null] });
	if (type === "NUMBER") return ask("NUMBER_OPERATOR_IS_AT_LEAST", { isValid: true, sourceType: "USER_INPUT", inputEditor: "TEXT_BOX", value: null });
	return ask("STRING_OPERATOR_IS", { isValid: true, sourceType: "UNIQUE", inputEditor: "SIMPLE_SELECT", value: null });
}

function filterWidget(app: App, l: ExbLayer, root: string, spec: WidgetSpec) {
	const items = spec.filters ?? [];
	if (!items.length) throw new ArcGISError("A filter widget needs filters: [{label, where: {FIELD: condition}} or {label, ask: FIELD}].", "bad_argument");
	const used = new Set<string>();
	const filterItems = items.map((it, i) => {
		if (!String(it.label ?? "").trim()) throw new ArcGISError(`filters[${i}] needs a label.`, "bad_argument");
		let parts: any[];
		let sql = "";
		if (it.ask) {
			parts = [askPart(l, it.ask)];
		} else {
			const made = Object.entries(it.where ?? {}).map(([name, c]) => presetPart(l, name, c));
			if (!made.length) throw new ArcGISError(`filters[${i}] needs where or ask.`, "bad_argument");
			parts = made.map((m) => m.part);
			sql = made.length === 1 ? `(${made[0].sql})` : `(${made.map((m) => m.sql).join(" AND ")})`;
		}
		const fields = parts.flatMap((p) => (p.type === "SET" ? p.parts : [p]).map((x: any) => x.jimuFieldName));
		fields.forEach((f) => used.add(f));
		return { type: "SINGLE", name: String(it.label).replace(/[<>]/g, ""), useDataSources: [ref(l, root, [...new Set(fields)])],
			sqlExprObj: { logicalOperator: "AND", parts, sql, displaySQL: sql || parts.map((p) => `(${p.jimuFieldName} ?)`).join(" and ") },
			autoApplyWhenWidgetOpen: false, collapseFilterExprs: false };
	});
	return app.add({ uri: "widgets/common/filter/", version: "1.17.0", label: spec.title ?? "Filter",
		config: { logicalOperator: "AND", filterItems, arrangeType: "BLOCK", triggerType: "TOGGLE", omitInternalStyle: false, resetAll: false,
			turnOffAll: false },
		id: app.widgetId(), useDataSources: [ref(l, root, [...used])] });
}

/** A number: a text widget whose COUNT / SUM / MIN / MAX expression follows the layer's filters (as ExB 1.17 writes it). */
function numberWidget(app: App, l: ExbLayer, root: string, spec: WidgetSpec) {
	const stat = spec.statistic ?? "count";
	const fn = STAT_FN[stat];
	if (!fn) throw new ArcGISError("An Experience Builder number takes statistic count | sum | min | max.", "bad_argument");
	const field = stat === "count" && !spec.field ? oid(l.info) : fieldOf(l.info, spec.field, "indicator");
	const alias = fieldDef(l.info, field)?.alias ?? field;
	const exp = expHtml(l.dsId, [{ type: "FUNCTION", exp: fn }, { type: "OPERATOR", exp: "(" },
		{ type: "FIELD", exp: `{${alias}}`, dataSourceId: l.dsId, jimuFieldName: field }, { type: "OPERATOR", exp: ")" }], `${fn}({${alias}})`);
	const color = hexColor(spec.color) ?? "#007ac2";
	const label = spec.title ?? (stat === "count" ? l.title : `${stat} of ${alias}`);
	return app.add({ uri: "widgets/common/text/", version: "1.17.0", label,
		config: { text: `<p style="text-align: center;"><span style="font-size: 14px;">${esc(label)}</span></p>`
			+ `<p style="text-align: center;"><strong style="font-size: 30px; color: ${color};">${exp}</strong></p>`, style: { wrap: true } },
		id: app.widgetId(), useDataSourcesEnabled: true, useDataSources: [ref(l, root, [field])] });
}

function featureInfo(app: App, l: ExbLayer, root: string, spec: WidgetSpec) {
	return app.add({ uri: "widgets/arcgis/feature-info/", version: "1.21.0", label: spec.title ?? "Details",
		config: { limitGraphics: false, maxGraphics: 0, noDataMessage: "Select a feature to see its details.", styleType: "custom",
			style: { textColor: "", fontSizeType: "auto", fontSize: { distance: 14, unit: "px" }, backgroundColor: "" },
			dsConfigs: [{ id: "default_data_source_config", useDataSourceId: l.dsId,
				contentConfig: { title: true, fields: true, media: true, attachments: true, lastEditInfo: true } }],
			dsNavigator: true, featureNavigator: true, useMapWidget: false },
		id: app.widgetId(), useDataSources: [{ ...ref(l, root), useFieldsInPopupInfo: true }] });
}

const textWidget = (app: App, html: string, label = "Text") => app.add({ uri: "widgets/common/text/", version: "1.18.0", label,
	config: { text: html, style: { wrap: true } }, id: app.widgetId() });

function imageWidget(app: App, url: string, label = "Image") {
	const name = url.split("/").pop()!.split("?")[0] || "image";
	return app.add({ uri: "widgets/common/image/", version: "1.17.0", label, id: app.widgetId(),
		config: { functionConfig: { altText: label, toolTip: "", linkParam: {}, scale: "Fit",
			imageParam: { url, originalUrl: url, fileName: name, originalName: name, imgSourceType: "BY_URL" }, imageDisplayQualityMode: "ORIGINAL",
			imgSourceType: "", srcExpression: null }, styleConfig: {} } });
}

/** Rich text kept to safe markup: no scripts, handlers or javascript: links. */
function safeHtml(html: string): string {
	return String(html).replace(/<\s*(script|iframe|object|embed|style)[\s\S]*?(<\s*\/\s*\1\s*>|$)/gi, "")
		.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|\S+)/gi, "").replace(/javascript:/gi, "");
}

/** Message actions as the Actions tab writes them (1.17-1.21). */
function flash(map: string, source: string) {
	return { actionId: `${map}-flash-${Date.now()}`, widgetId: map, dataSourceId: null, sectionId: null, messageWidgetId: source,
		actionName: "flash", description: null, config: { useAnyTriggerData: true, messageUseDataSource: null, actionUseDataSource: null,
			sqlExprObj: null, enabledDataRelationShip: true, connectionType: "SET_CUSTOM_FIELDS" }, version: "1.21.0" };
}
function zoom(map: string, source: string, ds: DsRef) {
	return { actionId: `${map}-zoomToFeature-${Date.now()}`, widgetId: map, dataSourceId: null, sectionId: null, messageWidgetId: source,
		actionName: "zoomToFeature", description: null, config: { useDataSource: ds, useDataSources: [ds],
			goToInitialMapExtentWhenSelectionCleared: true, useAnyTriggerData: true }, version: "1.21.0", useDataSources: [ds] };
}
function filterAction(target: string, chart: string, output: string, field: string, ds: DsRef) {
	const message = { dataSourceId: output, mainDataSourceId: output, rootDataSourceId: null, fields: [field] };
	const action = { ...ds, fields: [field] };
	return { actionId: `${target}-filter-${Date.now()}`, widgetId: target, messageWidgetId: chart, actionName: "filter", description: null,
		config: { useAnyTriggerData: false, messageUseDataSource: message, actionUseDataSource: action, sqlExprObj: null,
			enabledDataRelationShip: true, connectionType: "SET_CUSTOM_FIELDS" }, version: "1.17.0", useDataSources: [message, action] };
}

type Entry = { id: string; tab?: string; title?: string; header: boolean };

/** Columns of widgets -> the page's GRID layout: columns side by side (gridType 0), widgets stacked (1), tabs (2), leaves (3). */
export function gridLayout(columns: Record<Column, Entry[]>, mainItemId: string | null, header: { bg: string; fg: string }) {
	const content: Record<string, any> = {};
	let n = 0;
	const next = () => String(n++);
	const leaf = (e: Entry, width: number, parent: string) => {
		const id = next();
		content[id] = { type: "WIDGET", widgetId: e.id, gridType: 3, bbox: { width }, ...(parent ? { parent } : {}), expandable: true, hasItemHeader: e.header,
			...(e.header ? { headerBackground: header.bg, headerForeground: header.fg } : {}) };
		return id;
	};
	const split = (gridType: number, width: number, parent: string | null, fill: (id: string) => string[]) => {
		const id = next();
		content[id] = { gridType, bbox: { width }, ...(parent ? { parent } : {}), children: [] };
		content[id].children = fill(id);
		if (gridType === 2) content[id].activeTab = 0;
		return id;
	};
	/**
	 * One column: its widgets stacked (or, for the bottom row, side by side), those with a tab in one tabbed panel where
	 * the first of them stands.
	 */
	const column = (entries: Entry[], width: number, parent: string, gridType = 1) => {
		const groups: (Entry | Entry[])[] = [];
		for (const e of entries) {
			if (!e.tab) { groups.push(e); continue; }
			const g = groups.find((x): x is Entry[] => Array.isArray(x));
			if (g) g.push(e); else groups.push([e]);
		}
		const one = (g: Entry | Entry[], w: number, p: string) => (Array.isArray(g)
			? (g.length === 1 ? leaf(g[0], w, p) : split(2, w, p, (id) => g.map((e) => leaf(e, 100, id)))) : leaf(g, w, p));
		if (groups.length === 1) return one(groups[0], width, parent);
		return split(gridType, width, parent, (id) => groups.map((g) => one(g, 100 / groups.length, id)));
	};
	const widths: Record<string, number> = { left: 25, center: 50, right: 25 };
	const main = (["left", "center", "right"] as const).filter((c) => columns[c].length);
	const total = main.reduce((s, c) => s + widths[c], 0) || 1;
	const row = (parent: string | null, width: number) => (main.length === 1 && parent !== null ? column(columns[main[0]], width, parent)
		: split(0, width, parent, (id) => main.map((c) => column(columns[c], (widths[c] / total) * 100, id))));
	const bottom = columns.bottom;
	let root: string;
	if (!bottom.length) root = row(null, 100);
	else if (!main.length) root = column(bottom, 100, "", 0);
	else root = split(1, 100, null, (id) => [row(id, 65), column(bottom, 35, id, 0)]);
	return { type: "GRID", content, order: [], setting: { rootItem: root, ...(mainItemId ? { mainItemId } : {}),
		style: { padding: { number: [10, 10, 10, 10], unit: "px" } }, splitSize: 10 } };
}

/** Light or dark text for a header colour. */
const textOn = (bg: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a1a1a" : "#ffffff";
};

/**
 * The experience's config.json, built from the widgets asked for. Reads the web map and the layers it needs (and a
 * layer's values for pie slices); returns the config and what was built.
 */
export async function buildExperience(ctx: Ctx, args: AppArgs, map: any | null, home: string) {
	const specs = args.widgets ?? [];
	for (const s of specs) {
		if (!EXB_TYPES.has(s.type)) {
			throw new ArcGISError(`Experience Builder widgets here: ${[...EXB_TYPES].join(", ")}; not '${s.type}'.`, "bad_argument");
		}
	}
	const needsMap = specs.some((s) => !["text", "image", "embed"].includes(s.type));
	if (needsMap && !map) throw new ArcGISError("These widgets need webmap_id: the web map the app's data comes from.", "bad_argument");
	const theme = String(args.theme ?? "default");
	if (!(EXB_THEMES as readonly string[]).includes(theme)) throw new ArcGISError(`theme must be ${EXB_THEMES.join(" | ")}.`, "bad_argument");
	const headerBg = hexColor(args.header_color) ?? "#1f3a5f";
	const logo = args.logo_url === undefined ? null : https(args.logo_url, "logo_url");
	const app = new App();
	const root = "dataSource_1";
	const mapData = map ? await ctx.request(`${base(ctx)}/content/items/${map.id}/data`) : null;
	const available = map ? mapLayers(mapData, root) : [];
	const cache = new Map<string, Promise<ExbLayer>>();
	const layerFor = (want: string | number | undefined): Promise<ExbLayer> => {
		if (!available.length) throw new ArcGISError("The web map has no feature layers.", "bad_argument");
		const key = String(want ?? 0).toLowerCase();
		const hit = want === undefined ? available[0] : typeof want === "number" || /^\d+$/.test(key) ? available[Number(want)]
			: available.find((a) => [a.title, a.op.id].map((v) => String(v).toLowerCase()).includes(key));
		if (!hit) throw new ArcGISError(`No feature layer '${want}' in the map: ${available.map((a) => a.title).join(", ")}`, "not_found");
		if (!cache.has(hit.dsId)) cache.set(hit.dsId, ctx.request(hit.op.url).then((info: any) => ({ ...hit, info })));
		return cache.get(hit.dsId)!;
	};
	const columns: Record<Column, Entry[]> = { left: [], center: [], right: [], bottom: [] };
	const built: { type: string; label: string; layer?: string }[] = [];
	let mapW: any = null;
	const charts: { widget: any; output: string; category: string; layer: ExbLayer }[] = [];
	const pickers: { widget: any; layer: ExbLayer }[] = [];
	const users: { widget: any; layer: ExbLayer; filterable: boolean }[] = [];
	for (const s of specs) {
		let w: any;
		let layer: ExbLayer | undefined;
		const lyr = async () => (layer = await layerFor(s.layer));
		switch (s.type) {
			case "map":
				if (mapW) throw new ArcGISError("One map widget per experience here.", "bad_argument");
				w = mapW = mapWidget(app, root, s.title ?? map.title);
				break;
			case "legend": case "layers": case "basemaps":
				w = app.add({ uri: `widgets/arcgis/${{ legend: "legend", layers: "map-layers", basemaps: "basemap-gallery" }[s.type]}/`, version: "1.19.0",
					label: s.title ?? { legend: "Legend", layers: "Layers", basemaps: "Basemaps" }[s.type],
					config: s.type === "layers" ? { useMapWidget: true, customizeLayerOptions: {} } : {}, id: app.widgetId(), useMapWidgetIds: [] });
				break;
			case "table": w = tableWidget(app, await lyr(), root, s); users.push({ widget: w, layer: layer!, filterable: true }); pickers.push({ widget: w, layer: layer! }); break;
			case "list": w = listWidget(app, await lyr(), root, s); users.push({ widget: w, layer: layer!, filterable: true }); pickers.push({ widget: w, layer: layer! }); break;
			case "bar": case "line": case "pie": {
				const l = await lyr();
				const slices = s.type === "pie" ? await categories(ctx, { url: l.op.url, info: l.info } as any, fieldOf(l.info, s.field, "pie chart (field = the category)")) : [];
				const c = chartWidget(app, l, root, s, slices);
				w = c.widget;
				charts.push({ ...c, layer: l });
				users.push({ widget: w, layer: l, filterable: false });
				break;
			}
			case "filter": w = filterWidget(app, await lyr(), root, s); break;
			case "indicator": w = numberWidget(app, await lyr(), root, s); break;
			case "details": w = featureInfo(app, await lyr(), root, s); break;
			case "text": w = textWidget(app, safeHtml(String(s.text ?? `<p>${esc(s.title ?? "")}</p>`)), s.title ?? "Text"); break;
			case "image": w = imageWidget(app, https(s.url, "image url"), s.title ?? "Image"); break;
			case "embed":
				w = app.add({ uri: "widgets/common/embed/", version: "1.18.0", label: s.title ?? "Embed",
					config: { embedType: "url", expression: `<p>${esc(https(s.url, "embed url"))}</p>`, enableLabel: false }, id: app.widgetId(), useDataSources: [] });
				break;
		}
		const col = (s.column ?? COLUMN_OF[s.type] ?? "left") as Column;
		if (!columns[col]) throw new ArcGISError(`column must be left | center | right | bottom, not '${s.column}'.`, "bad_argument");
		columns[col].push({ id: w.id, tab: s.tab?.trim() || undefined, title: w.label, header: WITH_HEADER.has(s.type) });
		built.push({ type: w.uri.split("/").slice(-2)[0], label: w.label, ...(layer ? { layer: layer.title } : {}) });
	}
	// map tools (legend, layers, basemaps) point at the map
	for (const w of Object.values(app.widgets)) {
		if (Array.isArray(w.useMapWidgetIds)) {
			if (!mapW) throw new ArcGISError(`'${w.label}' needs a map widget.`, "bad_argument");
			w.useMapWidgetIds = [mapW.id];
		}
	}
	const interactions: string[] = [];
	if (args.interactive !== false && mapW) {
		for (const p of pickers) {
			app.message(p.widget.id, "DATA_RECORDS_SELECTION_CHANGE", [flash(mapW.id, p.widget.id), zoom(mapW.id, p.widget.id, ref(p.layer, root))]);
			interactions.push(`selecting in '${p.widget.label}' flashes and zooms to it on the map`);
		}
		for (const c of charts) {
			const targets = [{ widget: mapW, layer: c.layer }, ...users.filter((u) => u.filterable && u.layer.dsId === c.layer.dsId)];
			app.message(c.widget.id, "DATA_RECORDS_SELECTION_CHANGE", [flash(mapW.id, c.widget.id),
				...targets.map((t) => filterAction(t.widget.id, c.widget.id, c.output, c.category, ref(c.layer, root)))]);
			interactions.push(`selecting in '${c.widget.label}' filters ${targets.map((t) => `'${t.widget.label}'`).join(", ")} by ${c.category}`);
		}
	}
	// the header: title (and subtitle), and the logo when there is one
	const headerLayout = app.layoutId();
	const title = args.title ?? (map ? map.title : "New experience");
	const fg = textOn(headerBg);
	const titleW = textWidget(app, `<p><strong style="font-size: 22px; color: ${fg};">${esc(title)}</strong>`
		+ (args.subtitle ? `<span style="font-size: 14px; color: ${fg};">&nbsp;&nbsp;${esc(args.subtitle)}</span>` : "") + "</p>", "Title");
	const content: Record<string, any> = { 0: { type: "WIDGET", widgetId: titleW.id,
		bbox: { left: logo ? "7%" : "1%", right: "20%", top: "0%", bottom: "0%", width: logo ? "73%" : "79%", height: "100%" },
		setting: { autoProps: { left: false, right: true, top: false, bottom: false }, vCenter: false, hCenter: false } } };
	if (logo) {
		const img = imageWidget(app, logo, "Logo");
		content[1] = { type: "WIDGET", widgetId: img.id, bbox: { left: "0.5%", right: "94.5%", top: "10%", bottom: "10%", width: "5%", height: "80%" },
			setting: { autoProps: { left: false, right: true, top: false, bottom: false }, vCenter: false, hCenter: false } };
	}
	app.layouts[headerLayout] = { type: "FIXED", content, order: Object.keys(content) };
	const pageLayout = app.layoutId();
	app.layouts[pageLayout] = gridLayout(columns, mapW?.id ?? null, { bg: headerBg, fg });
	if (map) app.dataSources[root] = { id: root, type: "WEB_MAP", sourceLabel: map.title, itemId: map.id, portalUrl: home };
	const accent = hexColor(args.theme_color);
	const config = { pages: { page_1: { id: "page_1", mode: "FIT_WINDOW", type: "NORMAL", layout: { LARGE: pageLayout }, isDefault: true,
		isVisible: true, label: "Page", header: true } },
	layouts: app.layouts, exbVersion: EXB_VERSION, mainSizeMode: "LARGE", theme: `themes/${theme}/`, forBuilderAttributes: { lockLayout: false },
	template: "blankfullscreengrid", widgets: app.widgets, widgetsManifest: {}, views: {}, sections: {}, dialogs: {},
	dataSources: app.dataSources, messageConfigs: app.messageConfigs, attributes: { portalUrl: home }, pageStructure: [{ page_1: [] }],
	header: { layout: { LARGE: headerLayout }, height: { LARGE: 64 }, backgroundColor: headerBg, textColor: fg },
	...(accent ? { customTheme: { colors: { primary: accent } } } : {}), timestamp: Date.now() };
	return { config, title, built, interactions, layout: Object.fromEntries(Object.entries(columns).filter(([, v]) => v.length)
		.map(([k, v]) => [k, v.map((e) => (e.tab ? `${e.title} (tab ${e.tab})` : e.title))])) };
}
