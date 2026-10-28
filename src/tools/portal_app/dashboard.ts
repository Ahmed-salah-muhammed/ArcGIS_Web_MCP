/**
 * ArcGIS Dashboards from a hosted layer and/or a web map, written in the current schema (5.1.0 on ArcGIS Online,
 * 2026-10). Every widget below is shaped like the same widget in real 5.1.0 dashboards read from ArcGIS Online:
 * desktopView.widgets + a dockingLayout of nested stackLayoutElements whose leaves carry the widget ids. Data comes
 * from {type: "layerDataSource", itemId, layerId}: a Feature Service item + its numeric layer id, or a web map +
 * the operational layer's id (then selections follow the map). Pie colours need the real category values, so they
 * are read from the layer when the dashboard is made.
 * Interactive by default, wired like the Actions tab wires them (events -> filter / zoom, targets "<widget id>#main" or
 * "<map widget id>#<operational layer id>"): selecting in a chart, list or table filters the other widgets and the
 * map and zooms to it; selecting on the map or moving it filters the widgets. Widgets can share a tabbed panel
 * (tabsLayoutElement), carry their own filter (filterGroup of equal / is_in rules on text fields), and bar / line
 * charts on a date field bin by day, month or year (binTemporalData), all as in real 5.x dashboards.
 * style=executive gives the look of a hand-made operations dashboard (read from one on ArcGIS Online, 2026-10): the
 * navy custom theme (resource themes/user.json, theme {id: "user", type: "resource"}), indicators on dark panels with
 * an icon, donuts with outside labels and an "Other" slice, smooth area lines. A list can show one row per value of a
 * field with its totals: an Arcade data expression (arcadeDataSourceItems, GroupBy over FeatureSetByPortalItem) that
 * the other widgets filter and are filtered by through fieldMap. More maps (a heatmap, say) move with the main one.
 */
import { ArcGISError } from "../../arcgis";
import type { Ctx } from "../shared/context";
import { itemCard } from "../shared/format";
import { esc } from "../../pages/credit";
import { addItem, addResource, orgHome, orRemove, portalSelf } from "../shared/items";
import { base, requireId, resolveLayerUrl } from "../shared/lookup";
import type { AppArgs, COLUMNS, PERIODS, WidgetSpec } from "./types";
import { ICONS } from "./types";

const PALETTE = [[0, 122, 194], [53, 172, 70], [237, 81, 81], [252, 146, 31], [148, 103, 189], [23, 190, 207],
	[214, 39, 140], [140, 86, 75], [188, 189, 34], [127, 127, 127], [31, 119, 180], [255, 187, 120]];
const SYSTEM = /^(objectid|fid|globalid|shape__?(area|length)|shape|created_(user|date)|last_edited_(user|date)|creationdate|creator|editdate|editor)$/i;
const font = (weight = "normal", size?: number) => ({ family: "inherit", ...(size ? { size } : {}), style: "normal", weight });
const text = (angle = 0, weight = "normal", size?: number) => ({ type: "esriTS", angle, font: font(weight, size) });
const fill = (c: number[], outline = c, width = 1) => ({ type: "esriSFS", style: "esriSFSSolid", color: [...c, 255],
	outline: { type: "esriSLS", style: "esriSLSSolid", color: [...outline, 255], width } });
const NUMBER = { name: "value", prefix: true, style: "decimal", useGrouping: true, maximumFractionDigits: 1 };

/** How widgets look: classic (the editor's defaults) or executive. */
export type Look = { exec: boolean };
const CLASSIC: Look = { exec: false };
const EXEC_PALETTE = [[250, 204, 21], [0, 191, 255], [53, 172, 70], [252, 146, 31], [158, 85, 156], [20, 158, 206], [219, 124, 0],
	[84, 153, 77], [107, 107, 214], [181, 71, 121], [60, 175, 153], [183, 129, 74]];
const EXEC_PANEL = "#1e232d";
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** The navy theme of the executive look, saved as the dashboard's resource themes/user.json. */
export const NAVY_THEME = { colorScheme: { id: "light", type: "custom", mode: "dark", brandColor: "#009af2", brandHoverColor: "#40b9ff",
	brandPressColor: "#80d1ff", backgroundColor: "rgb(42, 47, 57)", foregroundColor1: EXEC_PANEL, foregroundColor2: "rgb(18, 23, 33)",
	foregroundColor3: "rgb(6, 11, 21)", textColor1: "#ffffff", textColor2: "#bfbfbf", textColor3: "#9e9e9e", textInverseColor: "#141414",
	textLinkColor: "#00a0ff", borderColor1: "rgb(84, 89, 99)", borderColor2: "rgb(72, 77, 87)", borderColor3: "rgb(60, 65, 75)",
	borderInputColor: "rgb(90, 95, 105)", statusInfoColor: "#00a0ff", statusInfoHoverColor: "#40b9ff", statusInfoPressColor: "#80d1ff",
	statusSuccessColor: "#36da43", statusSuccessHoverColor: "#6df278", statusSuccessPressColor: "#9df2a3", statusWarningColor: "#f89927",
	statusWarningHoverColor: "#ffaf4f", statusWarningPressColor: "#ffc47d", statusDangerColor: "#fe583e", statusDangerHoverColor: "#fe7863",
	statusDangerPressColor: "#fe9989", panelHeaderBackgroundColor: EXEC_PANEL, panelHeadingTextColor: "#ffffff",
	panelHeaderActionTextColor: "#9e9e9e", panelHeaderActionTextColorPress: "#ffffff", panelHeaderActionBackgroundColor: EXEC_PANEL,
	panelHeaderActionBackgroundColorHover: "rgb(18, 23, 33)", panelHeaderActionBackgroundColorPress: "rgb(6, 11, 21)" },
	corners: "round", spacing: "default", fontFamily: "Avenir Next", headingFontFamily: "Avenir Next", headingScaleFactor: 1 };

const ICON_PATHS: Record<(typeof ICONS)[number], string> = {
	person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
	people: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 "
		+ "6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 "
		+ "3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
	billboard: "M3 4h18v11H3zM11 15h2v5h-2z",
	screen: "M3 4h18v12H3zm2 2v8h14V6zM8 18h8v2H8z",
	check: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 14-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9z",
	pin: "M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z",
	chart: "M4 20h16v2H4zM6 10h3v8H6zm5-6h3v14h-3zm5 9h3v5h-3z",
	alert: "M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z",
	building: "M4 22V2h12v6h4v14h-7v-4h-2v4zm3-16v2h2V6zm4 0v2h2V6zM7 10v2h2v-2zm4 0v2h2v-2zm6 2v2h2v-2zM7 14v2h2v-2zm4 0v2h2v-2zm6 2v2h2v-2z",
};

/** An indicator icon: a ready one by name in the value's colour, or an <svg> of your own (no scripts or handlers). */
export function iconSvg(icon: string, color: string): string {
	const named = ICON_PATHS[icon as (typeof ICONS)[number]];
	if (named) {
		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="${color}"><path d="${named}"/></svg>`;
	}
	const svg = icon.trim();
	if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg) || svg.length > 8000
		|| /<\s*(script|foreignObject|iframe)|\son\w+\s*=|javascript:|href\s*=/i.test(svg)) {
		throw new ArcGISError(`icon must be one of ${ICONS.join(", ")}, or a plain <svg>...</svg> (no scripts, handlers or links).`,
			"bad_argument");
	}
	return svg;
}

export const WIDGET_HELP = {
	map: "The web map (needs webmap_id).",
	indicator: "One number: statistic (count | sum | avg | min | max) of field.",
	pie: "Share of each value of field (count, or statistic of value_field).",
	bar: "Bars per value of field (count, or statistic of value_field).",
	line: "Line per value of field (count, or statistic of value_field).",
	list: "Features listed by field, plus fields under it; or with group_by, one row per value of a field with its totals (values).",
	table: "A table of fields (default: the first five).",
	details: "The selected feature's details.",
	legend: "The map's legend.",
	text: "Rich text (text).",
	embed: "A web page shown inside the dashboard (url, https): an Experience Builder app, a video...",
	every_widget: "filter = {FIELD: value or [values]} on text fields; column = left | center | right; tab = a tab name "
		+ "(widgets of a column with a tab share one tabbed panel); color = #rrggbb (indicator value, bar/line series); "
		+ "period = day | month | year for bar/line on a date field; rotated = bar/line down the side; icon = an indicator icon.",
	more_maps: "A map widget with its own webmap_id (a heatmap, say) moves with the dashboard's main map.",
	styles: "style=executive: dark panels, indicator icons, donuts with outside labels and an Other slice, smooth area lines, "
		+ "the navy theme. theme = light | dark | navy.",
};

type Source = { type: "layerDataSource"; itemId: string; layerId: string | number };
/** The data layer: its URL, how widgets read it, its definition, the map it came through, and its portal item. */
type Layer = { url: string; source: Source; info: any; mapId: string | null; item?: { id: string; layer: number } | null };

const uuid = () => crypto.randomUUID();
const widget = (type: string, name: string) => ({ id: uuid(), dashboardItemType: "widget", name, noDataState: {},
	noFilterState: {}, focusModeEnabled: false, type });
const dataset = (source: Source, extra: Record<string, unknown>) => ({ type: "serviceDataset", name: "main", dataSource: source,
	groupByFields: [], orderByFields: [], statisticDefinitions: [], maxFeatures: 1000, outFields: ["*"],
	returnDistinctValues: false, allowSourceDownload: false, allowSummaryDownload: false, ...extra });
const DATE_TYPES = new Set(["esriFieldTypeDate", "esriFieldTypeDateOnly", "esriFieldTypeTimestampOffset"]);
const BINS: Record<(typeof PERIODS)[number], { unit: string; minPeriod: string }> = {
	day: { unit: "days", minPeriod: "DD" }, month: { unit: "months", minPeriod: "MM" }, year: { unit: "years", minPeriod: "YYYY" } };
const DATE_FORMAT = { type: "date", intlOptions: {}, formatPerDateTimeUnit: { year: { year: "numeric" }, month: { month: "short" },
	day: { day: "numeric", month: "short" }, hour: { minute: "2-digit", hour: "2-digit", hour12: false },
	minute: { minute: "2-digit", hour: "2-digit", hour12: false }, second: { second: "2-digit", minute: "2-digit", hour: "2-digit", hour12: false } } };
const caption = (t: string) => `<p style="text-align:center;"><span style="font-size:16px;">${t.replace(/[<>&]/g, "")}</span></p>`;
const outName = (stat: string, field: string) => `${stat}_${field}`.toUpperCase();

export function fieldOf(info: any, name: string | undefined, what: string): string {
	const f = (info.fields ?? []).find((x: any) => x.name.toLowerCase() === String(name ?? "").toLowerCase());
	if (!f) {
		throw new ArcGISError(`${what}: no field '${name}'. Fields: ${(info.fields ?? []).map((x: any) => x.name).join(", ")}`,
			"bad_argument");
	}
	return f.name;
}

/** "#rrggbb" checked, or undefined. */
export function hexColor(color: string | undefined): string | undefined {
	if (color === undefined) return undefined;
	if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ArcGISError(`color must be #rrggbb, not '${color}'.`, "bad_argument");
	return color.toLowerCase();
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * A widget's own filter, as the dashboard editor saves it: {FIELD: "value"} -> equal, {FIELD: [...]} -> is_in, all of
 * them AND-ed. Text fields only; a coded value may be given by its description.
 */
export function widgetFilter(info: any, filter: WidgetSpec["filter"]) {
	const entries = Object.entries(filter ?? {});
	if (!entries.length) return undefined;
	const rules = entries.map(([name, wanted]) => {
		const field = (info.fields ?? []).find((f: any) => f.name === fieldOf(info, name, "filter"));
		if (field.type !== "esriFieldTypeString") {
			throw new ArcGISError(`filter: '${field.name}' is not a text field. Filter numbers and dates with a view `
				+ "(portal_layer_schema action=create_view) and make the dashboard from it.", "bad_argument");
		}
		const coded: any[] = field.domain?.codedValues ?? [];
		const values = (Array.isArray(wanted) ? wanted : [wanted]).map((v) => String(coded.find((c) => c.name === v)?.code ?? v));
		if (!values.length) throw new ArcGISError(`filter: no values for '${field.name}'.`, "bad_argument");
		const constraint = values.length === 1 ? { type: "value", value: values[0] } : { type: "values", values };
		return { type: "filterRule", field: { name: field.name, type: "string" }, operator: values.length === 1 ? "equal" : "is_in", constraint };
	});
	return { type: "filterGroup", condition: "OR", rules: [{ type: "filterGroup", condition: "AND", rules }] };
}

function oidField(info: any): string {
	return info.objectIdField ?? (info.fields ?? []).find((f: any) => f.type === "esriFieldTypeOID")?.name ?? "OBJECTID";
}

/** Map widget, as in real dashboards; linkTo = the main map it moves with. */
export function mapWidget(webmapId: string, title: string, look: Look = CLASSIC, linkTo?: string) {
	const tools = linkTo ? [] : look.exec ? [{ type: "legendTool" }, { type: "mapContentsTool" }]
		: [{ type: "legendTool" }, { type: "searchTool" }, { type: "basemapGalleryTool" }];
	return { ...widget("mapWidget", title), itemId: webmapId, linkedMapWidgetIds: linkTo ? [linkTo] : [], flashRepeats: 3,
		mapTools: tools, showMeasureTool: false, showNavigation: !look.exec, showPanRotate: false, showLocate: false, showCompass: false,
		showPopup: true, scalebarStyle: look.exec ? "none" : "line", editingEnabled: false, trackedFeatureRadius: 60,
		selectTool: { type: "selectTool", clickToSelect: false, advanceSketchTools: [] } };
}

export function indicatorWidget(l: Layer, spec: WidgetSpec, look: Look = CLASSIC) {
	const stat = spec.statistic ?? "count";
	const field = stat === "count" && !spec.field ? oidField(l.info) : fieldOf(l.info, spec.field, "indicator");
	const label = spec.title ?? (stat === "count" ? "Features" : `${stat} of ${field}`);
	const color = hexColor(spec.color) ?? (look.exec ? hex(EXEC_PALETTE[0]) : undefined);
	const icon = spec.icon ? { iconInfo: { align: "left", icon: iconSvg(spec.icon, color ?? "currentColor") } } : {};
	const value = { text: "{calculated/value}", weight: color ? "bold" : "normal", ...(color ? { fillColor: color } : {}) };
	return { ...widget("indicatorWidget", label),
		datasets: [dataset(l.source, { maxFeatures: undefined, outFields: [field], filter: widgetFilter(l.info, spec.filter),
			statisticDefinitions: [{ onStatisticField: field, statisticType: stat, outStatisticFieldName: outName(stat, field) }] })],
		defaultSettings: look.exec
			? { backgroundColor: EXEC_PANEL, topSection: { maxHeight: 30, textInfo: { text: label, weight: "bold", fillColor: "#ffffff" } },
				middleSection: { maxHeight: 44.1, textInfo: value, ...icon }, bottomSection: { maxHeight: 0, textInfo: { text: null, weight: "normal" } } }
			: { topSection: { maxHeight: 0, textInfo: { weight: "normal" } }, middleSection: { maxHeight: 30, textInfo: value, ...icon },
				bottomSection: { maxHeight: 30, textInfo: { text: label, weight: "normal" } } },
		verticalAlignment: "middle", comparison: "none", valueType: "statistic", noValueState: {}, showFeatureMenu: false,
		valueFormat: { ...NUMBER, prefix: false }, percentageFormat: { name: "percentage", prefix: false, style: "percent", useGrouping: true },
		ratioFormat: { name: "ratio", prefix: false, style: "decimal", useGrouping: true, maximumFractionDigits: 2 } };
}

function grouped(l: Layer, spec: WidgetSpec, kind: string) {
	const category = fieldOf(l.info, spec.field, `${kind} chart (field = the category)`);
	const stat = spec.statistic ?? (spec.value_field ? "sum" : "count");
	const value = stat === "count" ? (spec.value_field ? fieldOf(l.info, spec.value_field, kind) : category)
		: fieldOf(l.info, spec.value_field, `${kind} chart (value_field for ${stat})`);
	const y = outName(stat, value);
	return { category, stat, value, y, ds: dataset(l.source, { groupByFields: [category], orderByFields: [`${category} ASC`],
		outFields: [category], filter: widgetFilter(l.info, spec.filter),
		statisticDefinitions: [{ onStatisticField: value, statisticType: stat, outStatisticFieldName: y }] }) };
}

/** Up to 12 category values with labels (coded-value domain names when there is a domain), most frequent first. */
export async function categories(ctx: Ctx, l: Layer, field: string): Promise<{ value: unknown; label: string }[]> {
	const res = await ctx.request(`${l.url}/query`, { where: "1=1", returnGeometry: false, groupByFieldsForStatistics: field,
		outStatistics: [{ statisticType: "count", onStatisticField: oidField(l.info), outStatisticFieldName: "n" }],
		orderByFields: "n DESC" });
	const coded = (l.info.fields ?? []).find((f: any) => f.name === field)?.domain?.codedValues ?? [];
	return (res.features ?? []).slice(0, 12).map((f: any) => {
		const value = f.attributes?.[field] ?? f.attributes?.[field.toLowerCase()] ?? null;
		return { value, label: String(coded.find((c: any) => c.code === value)?.name ?? value ?? "null") };
	});
}

export function pieWidget(l: Layer, spec: WidgetSpec, values: { value: unknown; label: string }[], look: Look = CLASSIC) {
	const g = grouped(l, spec, "pie");
	const palette = look.exec ? EXEC_PALETTE : PALETTE;
	return { ...widget("pieChartWidget", spec.title ?? `${g.value === g.category ? "Count" : `${g.stat} of ${g.value}`} by ${g.category}`),
		topCaption: caption(spec.title ?? `By ${g.category}`), datasets: [g.ds], actionMode: "monoSelection",
		categoryType: "groupByValues", dataLabelsFormat: "percentage", valueFormat: { ...NUMBER, prefix: false, useGrouping: false },
		percentageFormat: { name: "percentage", prefix: false, style: "percent", useGrouping: false, minimumFractionDigits: 1,
			maximumFractionDigits: 1 },
		chartConfig: { version: "25.1.0", type: "chart", orderOptions: {}, colorMatch: true,
			chartRenderer: { type: "uniqueValue", field1: g.category, uniqueValueInfos: values.map((v, i) => ({ label: v.label,
				symbol: fill(palette[i % palette.length], [255, 255, 255], 0), value: v.value })) },
			series: [{ type: "pieSeries", id: "main", name: "main", x: g.category, y: g.y,
				dataLabels: { type: "chartText", visible: look.exec, content: text(0, "normal", look.exec ? undefined : 13) },
				dataTooltipVisible: true, dataTooltipReverseColor: true, optimizeDataLabelsOverlapping: true, alignDataLabels: true,
				innerRadius: look.exec ? 61 : 50, startAngle: look.exec ? 270 : 0,
				ticks: { type: "pieTick", lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color: [214, 214, 214, 127.5] } },
				fillSymbol: fill([214, 214, 214], [255, 255, 255], 0), dataLabelsOffset: 10,
				// executive: slices under 10% join one grey "Other" slice
				sliceGrouping: look.exec
					? { sliceId: "__other-slice__", percentageThreshold: 10, fillSymbol: fill([214, 214, 214], [255, 255, 255], 0) }
					: { sliceId: "__other-slice__", percentageThreshold: 0, fillSymbol: fill([255, 255, 255], [255, 255, 255], 0), label: null } }],
			legend: { type: "chartLegend", visible: !look.exec, body: text(0, "normal", 13), position: "right", displayPercentage: true,
				displayNumericValue: false, labelMaxWidth: 100, valueLabelMaxWidth: 50 } } };
}

const axis = (category: boolean) => ({ type: "chartAxis", visible: true,
	title: { type: "chartText", visible: true, content: text(category ? 0 : 270, "bold") },
	valueFormat: category ? { type: "category", characterLimit: 11 }
		: { type: "number", intlOptions: { style: "decimal", notation: "standard", minimumFractionDigits: 0, maximumFractionDigits: 1 } },
	lineSymbol: { type: "esriSLS", style: "esriSLSSolid", width: 1 }, labels: { type: "chartText", visible: true, content: text() },
	grid: { type: "esriSLS", style: "esriSLSSolid", width: 1 }, guides: [],
	...(category ? { scrollbar: { visible: true, width: 15, gripSize: 22 } } : { buffer: true }) });

export function serialWidget(l: Layer, spec: WidgetSpec, line: boolean, look: Look = CLASSIC) {
	const g = grouped(l, spec, line ? "line" : "bar");
	const color = spec.color ? rgb(hexColor(spec.color)!) : look.exec ? EXEC_PALETTE[line ? 1 : 0] : PALETTE[0];
	const isDate = DATE_TYPES.has((l.info.fields ?? []).find((f: any) => f.name === g.category)?.type);
	if (spec.period && !isDate) throw new ArcGISError(`period needs a date field; '${g.category}' is not one.`, "bad_argument");
	const bin = isDate ? BINS[spec.period ?? "month"] : null;
	const series: Record<string, unknown> = { type: line ? "lineSeries" : "barSeries", id: g.y, name: "groupByValues", x: g.category, y: g.y,
		dataLabels: { type: "chartText", visible: false, content: text() }, dataTooltipVisible: true, dataTooltipReverseColor: true,
		...(bin ? { binTemporalData: true, temporalBinning: { size: 1, unit: bin.unit, nullPolicy: "interpolate" } } : {}) };
	if (line) {
		Object.assign(series, { lineSmoothed: look.exec, lineSymbol: { type: "esriSLS", style: "esriSLSSolid", color: [...color, 255],
			width: look.exec ? 1 : 2 }, markerVisible: true, markerSymbol: { type: "esriSMS", style: "esriSMSCircle", color: [...color, 255],
			size: 8, outline: { type: "esriSLS", style: "esriSLSSolid", color: [...color, 255] } }, showArea: look.exec,
			...(look.exec ? { areaColor: [...color, 127.5] } : {}), connectLines: true });
	} else {
		series.fillSymbol = fill(color);
	}
	return { ...widget("serialChartWidget", spec.title ?? `${g.value === g.category ? "Count" : `${g.stat} of ${g.value}`} by ${g.category}`),
		topCaption: caption(spec.title ?? `By ${g.category}`), datasets: [g.ds], actionMode: "monoSelection", categoryType: "groupByValues",
		valueFormat: NUMBER, labelFormat: { ...NUMBER, name: "label" }, category: { labelOverrides: [], nullLabel: "null", blankLabel: "blank" },
		parseDates: Boolean(bin), minPeriod: bin?.minPeriod ?? "MM", categoryAxisLabelsBehavior: "wrap",
		chartConfig: { version: "25.1.0", type: "chart", orderOptions: {}, colorMatch: false,
			axes: [bin ? { ...axis(true), valueFormat: DATE_FORMAT } : axis(true), axis(false)], series: [series],
			legend: { type: "chartLegend", visible: false, body: text(), position: "bottom" }, horizontalAxisLabelsBehavior: "wrap",
			verticalAxisLabelsBehavior: "hide", cursorCrosshair: { type: "cursorCrosshair", verticalLineVisible: false,
				horizontalLineVisible: false }, stackedType: "sideBySide", ...(spec.rotated ? { rotated: true } : {}) } };
}

function usefulFields(info: any, wanted?: string[]): string[] {
	if (wanted?.length) return wanted.map((f) => fieldOf(info, f, "fields"));
	return (info.fields ?? []).filter((f: any) => !SYSTEM.test(f.name) && f.type !== "esriFieldTypeGeometry").slice(0, 5).map((f: any) => f.name);
}

export function listWidget(l: Layer, spec: WidgetSpec, look: Look = CLASSIC) {
	const first = spec.field ? fieldOf(l.info, spec.field, "list") : (l.info.displayField || usefulFields(l.info)[0] || oidField(l.info));
	const more = (spec.fields ?? []).map((f) => fieldOf(l.info, f, "list"));
	const text = look.exec
		? `<div style="align-items:center;display:flex;justify-content:space-between;padding:6px 5px;"><div style="color:#FFFFFF;`
			+ `font-size:13px;font-weight:500;">{field/${first}}</div><div style="color:#A0AEC0;font-size:11px;">`
			+ `${more.map((f) => `{field/${f}}`).join(" · ")}</div></div>`
		: [`<p><strong>{field/${first}}</strong></p>`, ...more.map((f) => `<p>${f}: {field/${f}}</p>`)].join("");
	return { ...widget("listWidget", spec.title ?? "List"), ...(spec.title ? { topCaption: caption(spec.title) } : {}),
		datasets: [dataset(l.source, { maxFeatures: 50, orderByFields: [`${first} ASC`], outFields: [first, ...more],
			filter: widgetFilter(l.info, spec.filter) })],
		selectionMode: "single", iconType: look.exec ? "none" : "symbol", showFilter: true, text };
}

const STAT_ARCADE: Record<string, string> = { count: "COUNT", sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" };
/** A SQL string literal. */
const sqlText = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * A list with one row per value of group_by and its totals, like a hand-made "per governorate" list: an Arcade data
 * expression (GroupBy over FeatureSetByPortalItem, biggest first) and a list showing it. Returns the list widget and
 * the arcadeDataSourceItems entry it reads.
 */
export function groupedListWidget(l: Layer, spec: WidgetSpec, home: string, look: Look = CLASSIC) {
	if (!l.item) throw new ArcGISError("A grouped list needs the layer's item (target, or a map layer added from an item).", "bad_argument");
	const group = fieldOf(l.info, spec.group_by, "list group_by");
	const values = spec.values?.length ? spec.values : [{ label: "Count" }];
	if (values.length > 4) throw new ArcGISError("A grouped list shows up to 4 values per row.", "bad_argument");
	const stats = values.map((v, i) => {
		const statistic = v.statistic ?? (v.field ? "sum" : "count");
		const field = v.field ? fieldOf(l.info, v.field, `list value '${v.label}'`) : null;
		if (statistic !== "count" && !field) throw new ArcGISError(`list value '${v.label}': ${statistic} needs a field.`, "bad_argument");
		return { name: `value_${i + 1}`, label: String(v.label ?? `Value ${i + 1}`), field, statistic,
			color: hexColor(v.color) ?? hex(EXEC_PALETTE[i % EXEC_PALETTE.length]) };
	});
	const filtered = Object.keys(spec.filter ?? {}).map((name) => fieldOf(l.info, name, "filter"));
	// every field the expression touches is read: the group, the values, and the filter's fields
	const read = [...new Set([group, ...stats.map((s) => s.field).filter((f): f is string => Boolean(f)), ...filtered])];
	const filter = Object.entries(spec.filter ?? {}).map(([name, wanted]) => {
		const field = fieldOf(l.info, name, "filter");
		widgetFilter(l.info, { [field]: wanted }); // the same checks as other widgets' filters (text fields only)
		const list = (Array.isArray(wanted) ? wanted : [wanted]).map(String);
		return list.length === 1 ? `${field} = ${sqlText(list[0])}` : `${field} IN (${list.map(sqlText).join(", ")})`;
	}).join(" AND ");
	const script = [
		`var fs = FeatureSetByPortalItem(Portal(${JSON.stringify(home)}), ${JSON.stringify(l.item.id)}, ${l.item.layer}, ${JSON.stringify(read)}, false);`,
		...(filter ? [`fs = Filter(fs, ${JSON.stringify(filter)});`] : []),
		`var rows = GroupBy(fs, [${JSON.stringify(group)}], [${stats.map((s) => `{ name: '${s.name}', expression: ${JSON.stringify(s.field ?? "1")}, `
			+ `statistic: '${STAT_ARCADE[s.statistic]}' }`).join(", ")}]);`,
		`return OrderBy(rows, '${stats[0].name} DESC');`,
	].join("\n");
	const title = spec.title ?? `By ${group}`;
	const arcade = { type: "arcadeItem", itemId: uuid(), name: title, script, refreshInterval: 0 };
	const name = look.exec ? "color:#FFFFFF;font-size:13px;font-weight:500;" : "font-size:13px;font-weight:500;";
	const text = `<div style="align-items:center;display:flex;justify-content:space-between;padding:6px 5px;"><div style="${name}">`
		+ `{field/${group}}</div><div style="align-items:center;display:flex;gap:15px;">${stats.map((s) => `<div><span style="color:`
		+ `${s.color};font-size:14px;"><strong>{field/${s.name}}</strong></span> <span style="color:#A0AEC0;font-size:10px;"><span `
		+ `style="margin-left:2px;">${esc(s.label)}</span></span></div>`).join("")}</div></div>`;
	const list = { ...widget("listWidget", title), ...(spec.title ? { topCaption: caption(spec.title) } : {}),
		datasets: [{ type: "serviceDataset", name: "main", dataSource: { type: "arcadeDataSource", itemId: arcade.itemId }, groupByFields: [],
			orderByFields: [], statisticDefinitions: [], maxFeatures: 50, outFields: [group, ...stats.map((s) => s.name)],
			returnDistinctValues: false, allowSourceDownload: false, allowSummaryDownload: false }],
		selectionMode: "single", iconType: "none", showFilter: false, text };
	return { list, arcade, group };
}

export function tableWidget(l: Layer, spec: WidgetSpec) {
	const fields = usefulFields(l.info, spec.fields);
	const alias = (n: string) => (l.info.fields ?? []).find((f: any) => f.name === n)?.alias ?? n;
	return { ...widget("tableWidget", spec.title ?? "Table"),
		datasets: [dataset(l.source, { outFields: fields, filter: widgetFilter(l.info, spec.filter) })],
		dataSettings: { type: "features", valueFields: fields },
		tableSettings: { layout: "fit-columns", scale: "medium", hoverText: false, rowStriping: true, selectionMode: "single",
			verticalGrid: { thickness: 1 }, horizontalGrid: { thickness: 1 },
			headerSettings: { textColor: "#ffffff", backgroundColor: "#004da8", rule: { thickness: 3 } } },
		columnSettings: fields.map((f) => ({ title: alias(f), fieldName: f, textAlign: "left", isBold: false, isItalic: false,
			isUnderlined: false })) };
}

export function detailsWidget(l: Layer, mapWidgetId: string | null, spec: WidgetSpec) {
	return { ...widget("detailsWidget", spec.title ?? "Details"), title: spec.title ?? "Details",
		noFilterState: { text: "Select a feature to see its details" },
		datasets: [dataset(l.source, { maxFeatures: 50, outFields: [], filter: widgetFilter(l.info, spec.filter) })],
		showTitle: true, showContents: true, showMedia: true, showAttachments: true, showFeatureMenu: true,
		...(mapWidgetId ? { mapWidgetId } : {}) };
}

export const legendWidget = (mapWidgetId: string) => ({ ...widget("legendWidget", "Legend"), mapWidgetId });
export const textWidget = (html: string) => ({ ...widget("richTextWidget", "Text"), datasets: [], text: html });

/** A web page inside the dashboard, as the Embedded content widget saves it. */
export function embedWidget(spec: WidgetSpec) {
	const url = String(spec.url ?? "").trim();
	if (!/^https:\/\/\S+$/i.test(url)) {
		throw new ArcGISError("An embed widget needs url: an https page (an Experience Builder app, a video...).", "bad_argument");
	}
	return { ...widget("embeddedContentWidget", spec.title ?? "Embedded content"), datasets: [], url, contentType: "document",
		imageRefreshInterval: 0, videoSettings: { controls: true, autoplay: false, loop: false, muted: false, controlsList: "nodownload" },
		showFeatureMenu: false };
}

type Column = (typeof COLUMNS)[number];
/** A widget id, or a tabbed panel of several. */
export type LayoutEntry = string | { tabs: { id: string; tab: string }[] };
const COLUMN_OF: Record<WidgetSpec["type"], Column> = { map: "center", table: "center", embed: "center", indicator: "left",
	list: "left", legend: "left", text: "left", pie: "right", bar: "right", line: "right", details: "right" };

/** Puts a widget in its column; widgets of one column with a tab share that column's tabbed panel. */
export function placeWidget(columns: Record<Column, LayoutEntry[]>, id: string, spec: Pick<WidgetSpec, "type" | "column" | "tab">) {
	const col = columns[spec.column ?? COLUMN_OF[spec.type]];
	const tab = spec.tab?.trim();
	if (!tab) {
		col.push(id);
		return;
	}
	const panel = col.find((e): e is Exclude<LayoutEntry, string> => typeof e !== "string");
	if (panel) panel.tabs.push({ id, tab });
	else col.push({ tabs: [{ id, tab }] });
}

const SOURCE_TYPES = new Set(["pieChartWidget", "serialChartWidget", "listWidget", "tableWidget"]);
const DATA_TYPES = new Set([...SOURCE_TYPES, "indicatorWidget", "detailsWidget"]);
type Target = { targetId: string; by: "whereClause" | "geometry"; requiresSelection: false; fieldMap?: { sourceName: string; targetName: string }[] };
const to = (targetId: string, by: Target["by"], field?: string): Target => ({ targetId, by, requiresSelection: false,
	...(field ? { fieldMap: [{ sourceName: field, targetName: field }] } : {}) });

/** What wiring needs to know about a widget: the field a chart groups by, or the field a grouped (Arcade) list rows are. */
export type WidgetMeta = Map<string, { category?: string; groupedBy?: string }>;

/**
 * Wires the widgets like the dashboard's Actions tab: a selection in a chart, list or table filters every other data
 * widget and the map's layer (by where clause) and zooms the map to it; a selection on the map's layer, and moving
 * the map (extent_filter), filter the data widgets by geometry. Grouped (Arcade) lists have no geometry: they filter
 * and are filtered by where clause through their field (fieldMap), by the map's selection and by charts of that field.
 * Returns what was wired.
 */
export function wireActions(widgets: any[], map: { widget: any; layerId: string | null } | null, extentFilter: boolean,
	meta: WidgetMeta = new Map()) {
	const groupedBy = (w: any) => meta.get(w.id)?.groupedBy;
	const data = widgets.filter((w) => DATA_TYPES.has(w.type) && !groupedBy(w));
	const lists = widgets.filter((w) => groupedBy(w));
	const listsOn = (field: string | undefined, not?: any) => (field ? lists.filter((g) => g !== not && groupedBy(g) === field) : [])
		.map((g) => to(`${g.id}#main`, "whereClause", field));
	for (const w of data.filter((o) => SOURCE_TYPES.has(o.type))) {
		const targets = [...data.filter((o) => o !== w).map((o) => to(`${o.id}#main`, "whereClause")),
			...listsOn(meta.get(w.id)?.category),
			...(map?.layerId ? [to(`${map.widget.id}#${map.layerId}`, "whereClause")] : [])];
		const actions: any[] = targets.length ? [{ type: "filter", targets }] : [];
		if (map) actions.push({ type: "zoom", targets: [to(map.widget.id, "geometry")] });
		if (actions.length) w.events = [{ type: "selectionChanged", actions }];
	}
	for (const g of lists) {
		const field = groupedBy(g)!;
		const targets = [...data.map((o) => to(`${o.id}#main`, "whereClause", field)), ...listsOn(field, g),
			...(map?.layerId ? [to(`${map.widget.id}#${map.layerId}`, "whereClause", field)] : [])];
		if (targets.length) g.events = [{ type: "selectionChanged", actions: [{ type: "filter", targets }] }];
	}
	const byGeometry = () => data.map((o) => to(`${o.id}#main`, "geometry"));
	const extent = Boolean(map && extentFilter && data.length);
	const mapSelect = Boolean(map?.layerId && (data.length || lists.length));
	if (extent) map!.widget.events = [{ type: "extentChanged", actions: [{ type: "filter", targets: byGeometry() }] }];
	if (mapSelect) {
		const targets = [...byGeometry(), ...lists.map((g) => to(`${g.id}#main`, "whereClause", groupedBy(g)))];
		map!.widget.layers = [{ type: "layer", dataSource: { type: "layerDataSource", itemId: map!.widget.itemId, layerId: map!.layerId },
			events: [{ type: "selectionChanged", actions: [{ type: "filter", targets }] }] }];
		map!.widget.selectTool = { ...map!.widget.selectTool, clickToSelect: true };
	}
	return { selecting_filters_others: [...data.filter((o) => SOURCE_TYPES.has(o.type)), ...lists].map((w) => w.name),
		map_extent_filters: extent, map_selection_filters: mapSelect, zoom_to_selection: Boolean(map) };
}

/** Columns of widget ids / tabbed panels -> nested stack layout (columns side by side, entries stacked in each). */
export function layoutFor(columns: { ids: LayoutEntry[]; width: number }[]) {
	const cols = columns.filter((c) => c.ids.length);
	const total = cols.reduce((s, c) => s + c.width, 0) || 1;
	const entry = (e: LayoutEntry, height: number) => (typeof e === "string"
		? { width: 1, height, type: "itemLayoutElement", id: e }
		: { width: 1, height, id: uuid(), type: "tabsLayoutElement",
			elements: e.tabs.map((t) => ({ width: 1, height: 1, tabName: t.tab, type: "itemLayoutElement", id: t.id })) });
	return { type: "dockingLayout", rootElement: { width: 1, height: 1, id: uuid(), type: "stackLayoutElement", orientation: "col",
		elements: cols.map((c) => ({ width: c.width / total, height: 1, id: uuid(), type: "stackLayoutElement", orientation: "row",
			elements: c.ids.map((e) => entry(e, 1 / c.ids.length)) })) } };
}

async function dataLayer(ctx: Ctx, args: AppArgs, map: any | null, mapData: any): Promise<Layer> {
	if (args.target) {
		const id = requireId(args.target);
		const url = await resolveLayerUrl(ctx, id, args.layer ?? 0);
		const layer = Number(url.split("/").pop());
		return { url, source: { type: "layerDataSource", itemId: id, layerId: layer }, info: await ctx.request(url), mapId: null,
			item: { id, layer } };
	}
	if (!map) throw new ArcGISError("A dashboard needs data: target (a feature layer item id) and/or webmap_id.", "bad_argument");
	const ops = (mapData?.operationalLayers ?? []).filter((o: any) => o.url && /\/(FeatureServer|MapServer)\/\d+$/i.test(o.url));
	const ref = String(args.layer ?? "").toLowerCase();
	const op = args.layer === undefined ? ops[0]
		: typeof args.layer === "number" || /^\d+$/.test(ref) ? ops[Number(args.layer)]
			: ops.find((o: any) => [o.title, o.id].map((v) => String(v).toLowerCase()).includes(ref));
	if (!op) throw new ArcGISError(`No feature layer '${args.layer ?? 0}' in the map: ${ops.map((o: any) => o.title).join(", ") || "none"}`, "not_found");
	return { url: op.url, source: { type: "layerDataSource", itemId: map.id, layerId: op.id }, info: await ctx.request(op.url), mapId: map.id,
		item: op.itemId ? { id: op.itemId, layer: Number(String(op.url).split("/").pop()) } : null };
}

/** Widgets chosen from the layer when none are asked for: a count, a chart by a category field, a table. */
export function autoWidgets(info: any, hasMap: boolean): WidgetSpec[] {
	const fields = (info.fields ?? []).filter((f: any) => !SYSTEM.test(f.name));
	const cat = fields.find((f: any) => f.type === "esriFieldTypeString" && f.domain?.codedValues)
		?? fields.find((f: any) => f.type === "esriFieldTypeString" && /type|status|categ|class|kind|zone|region/i.test(f.name))
		?? fields.find((f: any) => f.type === "esriFieldTypeString" && f.name !== info.displayField);
	const num = fields.find((f: any) => ["esriFieldTypeDouble", "esriFieldTypeInteger", "esriFieldTypeSingle"].includes(f.type));
	const date = fields.find((f: any) => DATE_TYPES.has(f.type));
	const out: WidgetSpec[] = [{ type: "indicator", statistic: "count", title: "Features" }];
	if (num) out.push({ type: "indicator", statistic: "sum", field: num.name });
	if (hasMap) out.push({ type: "map" }, { type: "legend" });
	if (cat) out.push({ type: "pie", field: cat.name });
	if (cat && num) out.push({ type: "bar", field: cat.name, value_field: num.name, statistic: "sum" });
	if (date) out.push({ type: "line", field: date.name, period: "month", title: `Over time (${date.alias || date.name})` });
	out.push({ type: "table" });
	return out;
}

const sameUrl = (a: unknown, b: unknown) => String(a ?? "").replace(/\/+$/, "").toLowerCase() === String(b ?? "").replace(/\/+$/, "").toLowerCase();

export async function createDashboard(ctx: Ctx, args: AppArgs) {
	const map = args.webmap_id ? await ctx.request(`${base(ctx)}/content/items/${requireId(args.webmap_id)}`) : null;
	if (map && map.type !== "Web Map") throw new ArcGISError(`webmap_id must be a Web Map; ${map.id} is a ${map.type}.`, "bad_argument");
	const mapData = map ? await ctx.request(`${base(ctx)}/content/items/${map.id}/data`) : null;
	const l = await dataLayer(ctx, args, map, mapData);
	const specs = args.widgets?.length ? args.widgets : autoWidgets(l.info, Boolean(map));
	const look: Look = { exec: args.style === "executive" };
	const theme = args.theme ?? (look.exec ? "navy" : "light");
	const logo = args.logo_url?.trim();
	if (logo && !/^https:\/\/\S+$/i.test(logo)) throw new ArcGISError("logo_url must be an https link to an image.", "bad_argument");
	const title = args.title ?? `${l.info.name ?? "Layer"} dashboard`;
	const self = await portalSelf(ctx);
	const columns: Record<Column, LayoutEntry[]> = { left: [], center: [], right: [] };
	const widgets: any[] = [];
	const arcade: any[] = [];
	const meta: WidgetMeta = new Map();
	// the main map is webmap_id; more map widgets (each with its own webmap_id) move with it
	const mapSpecs = specs.filter((s) => s.type === "map");
	const mainSpec = mapSpecs.find((s) => !s.webmap_id || s.webmap_id === args.webmap_id);
	if (mapSpecs.length && !map) throw new ArcGISError("A map widget needs webmap_id (the dashboard's main map).", "bad_argument");
	if (mapSpecs.length && !mainSpec) throw new ArcGISError("One map widget must show the dashboard's webmap_id.", "bad_argument");
	const mapW: any = mainSpec && map ? mapWidget(map.id, mainSpec.title ?? map.title, look) : null;
	for (const s of specs) {
		let w: any;
		if (s.type === "map") {
			if (s === mainSpec) w = mapW;
			else {
				const other = await ctx.request(`${base(ctx)}/content/items/${requireId(s.webmap_id!)}`);
				if (other.type !== "Web Map") throw new ArcGISError(`map webmap_id must be a Web Map; ${other.id} is a ${other.type}.`, "bad_argument");
				w = mapWidget(other.id, s.title ?? other.title, look, mapW.id);
			}
		} else if (s.type === "indicator") w = indicatorWidget(l, s, look);
		else if (s.type === "pie") {
			w = pieWidget(l, s, await categories(ctx, l, fieldOf(l.info, s.field, "pie chart (field = the category)")), look);
			meta.set(w.id, { category: fieldOf(l.info, s.field, "pie") });
		} else if (s.type === "bar" || s.type === "line") {
			w = serialWidget(l, s, s.type === "line", look);
			meta.set(w.id, { category: fieldOf(l.info, s.field, s.type) });
		} else if (s.type === "list" && s.group_by) {
			const g = groupedListWidget(l, s, orgHome(self, ctx.props.portal), look);
			w = g.list;
			arcade.push(g.arcade);
			meta.set(w.id, { groupedBy: g.group });
		} else if (s.type === "list") w = listWidget(l, s, look);
		else if (s.type === "table") w = tableWidget(l, s);
		else if (s.type === "details") w = detailsWidget(l, mapW?.id ?? null, s);
		else if (s.type === "legend") {
			if (!mapW) throw new ArcGISError("A legend needs a map widget (webmap_id).", "bad_argument");
			w = legendWidget(mapW.id);
		} else if (s.type === "text") w = textWidget(String(s.text ?? s.title ?? "").replace(/<\s*script/gi, ""));
		else if (s.type === "embed") w = embedWidget(s);
		else throw new ArcGISError(`Unknown widget type '${(s as any).type}'.`, "bad_argument");
		widgets.push(w);
		placeWidget(columns, w.id, s);
	}
	// the map's own copy of the data layer, so selections can filter what the map draws
	const mapLayerId = !mapW ? null : l.mapId ? String(l.source.layerId)
		: (mapData?.operationalLayers ?? []).find((o: any) => sameUrl(o.url, l.url))?.id ?? null;
	const wired = args.interactive === false ? null
		: wireActions(widgets, mapW ? { widget: mapW, layerId: mapLayerId } : null, args.extent_filter ?? true, meta);
	const data = { version: "5.1.0", authoringApp: "ArcGIS Dashboards", authoringAppVersion: "5.1.0", maxPaginationRecords: 50000,
		maxChartRecords: 10000, timeZone: "system",
		theme: theme === "navy" ? { id: "user", type: "resource" } : { id: theme === "dark" ? "dark" : "light", type: "defined" },
		numberPrefixOverrides: [["yotta", "Y"], ["zeta", "Z"], ["exa", "E"], ["peta", "P"], ["tera", "T"], ["giga", "G"], ["mega", "M"],
			["kilo", "k"], ["base", ""], ["deci", "d", false], ["centi", "c", false], ["milli", "m", false], ["micro", "µ", false],
			["nano", "n", false]].map(([key, symbol, enabled = true]) => ({ key, symbol, enabled })),
		...(arcade.length ? { arcadeDataSourceItems: arcade } : {}),
		desktopView: { type: "desktop", widgets, settings: { allowElementResizing: false, allowReset: false },
			layout: layoutFor([{ ids: columns.left, width: 0.22 }, { ids: columns.center, width: 0.48 }, { ids: columns.right, width: 0.3 }]),
			header: { dashboardItemType: "panel", type: "header", title, logoSize: "small", backgroundImageSizing: "fit-height",
				normalBackgroundImagePlacement: "left", horizontalBackgroundImagePlacement: "top", showSignOutMenu: false, selectors: [],
				...(look.exec ? { showMargin: true } : {}),
				...(args.subtitle ? { subtitle: args.subtitle, subtitlePlacement: "sameLine" } : {}), ...(logo ? { logoImageURL: logo } : {}) } },
		elementMappings: {} };
	const { id } = await addItem(ctx, args.folder, { type: "Dashboard", title, text: JSON.stringify(data),
		typeKeywords: "ArcGIS Dashboards,Dashboard,Operations Dashboard", tags: (args.tags ?? ["arcgis-web-mcp", "Dashboard"]).join(","),
		snippet: args.summary ?? `Dashboard of ${l.info.name ?? "a layer"}` });
	return orRemove(ctx, [id], async () => {
		if (theme === "navy") await addResource(ctx, id, "themes/user.json", JSON.stringify(NAVY_THEME));
		const item = await ctx.request(`${base(ctx)}/content/items/${id}`);
		return { app: itemCard(item, ctx.props.portal), open: `${orgHome(self, ctx.props.portal)}/apps/dashboards/${id}`,
			widgets: widgets.map((w) => ({ type: w.type, name: w.name })), data_from: l.mapId ? "the web map's layer" : "the feature layer",
			theme, style: look.exec ? "executive" : "classic", interactive: wired ?? false };
	});
}
